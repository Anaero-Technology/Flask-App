from flask import Flask, request, jsonify, send_file, current_app
from flask_cors import CORS
from flask_sse import sse
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from database.models import *
from utils.auth import require_role, log_audit
import serial.tools.list_ports
from device_manager import DeviceManager
from config import Config
import atexit
import threading
import os
import re
import socket
import subprocess
from werkzeug.utils import secure_filename
from sqlalchemy.engine import make_url
from sqlalchemy import text, or_

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = Config.SQLALCHEMY_DATABASE_URI
app.config["REDIS_URL"] = Config.REDIS_URL
app.config["JWT_SECRET_KEY"] = Config.JWT_SECRET_KEY
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = Config.JWT_ACCESS_TOKEN_EXPIRES
app.config["JWT_REFRESH_TOKEN_EXPIRES"] = Config.JWT_REFRESH_TOKEN_EXPIRES
app.config["CHIMERA_DEVICE_MODEL"] = Config.CHIMERA_DEVICE_MODEL
CORS(app, supports_credentials=True)  # Enable CORS for all routes
db.init_app(app)
jwt = JWTManager(app)
device_manager = DeviceManager()
DeviceManager.set_app(app)  # Set app reference for db

# Register CLI commands
from utils.cli import register_cli
register_cli(app)

# Create tables
with app.app_context():
    db.create_all()

    def ensure_channel_in_service_column():
        try:
            if db.engine.dialect.name != 'sqlite':
                return
            columns = [row[1] for row in db.session.execute(text("PRAGMA table_info(channel_configurations)"))]
            if 'in_service' not in columns:
                db.session.execute(text("ALTER TABLE channel_configurations ADD COLUMN in_service BOOLEAN DEFAULT 1"))
                db.session.execute(text("UPDATE channel_configurations SET in_service = 1 WHERE in_service IS NULL"))
                db.session.commit()
        except Exception as exc:
            print(f"[WARN] Failed to ensure in_service column on channel_configurations: {exc}")

    ensure_channel_in_service_column()

# Create uploads directory for branding assets
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)


def auto_connect_devices():
    """Auto-scan and connect to devices on startup.
    Keeps retrying every 10 seconds until a Chimera is found.
    """
    import time
    import concurrent.futures
    
    time.sleep(2)  # Brief delay to ensure app is fully ready
    
    chimera_found = False
    
    def check_port(port_info):
        """Check a single port for valid device. Returns True if Chimera found."""
        nonlocal chimera_found
        
        # Skip Bluetooth ports to avoid blocking issues
        if 'Bluetooth' in port_info.device or 'Bluetooth' in port_info.description:
            return False
        
        try:
            # Connect to the device
            connected = device_manager.connect(port_info.device)
            
            if not connected:
                return False
            
            device = device_manager.get_device_by_port(port_info.device)
            if device and hasattr(device, 'device_type'):
                if device.device_type in ['chimera', 'chimera-max']:
                    print(f"[AUTO-CONNECT] ✓ Connected to Chimera on {port_info.device}")
                    chimera_found = True
                    return True
                elif device.device_type in ['black-box', 'black_box']:
                    print(f"[AUTO-CONNECT] ✓ Connected to BlackBox on {port_info.device}")
                else:
                    print(f"[AUTO-CONNECT] ✓ Connected to {device.device_type} on {port_info.device}")
        except Exception as e:
            pass
        return False
    
    while not chimera_found:
        print("[AUTO-CONNECT] Scanning for Chimera device...")
        
        with app.app_context():
            try:
                # Get all available serial ports
                ports = list(serial.tools.list_ports.comports())
                
                # Check all ports in parallel with a thread pool
                with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(ports) or 1)) as executor:
                    executor.map(check_port, ports)
                
                if chimera_found:
                    print("[AUTO-CONNECT] Chimera found, stopping scan")
                else:
                    print("[AUTO-CONNECT] No Chimera found, retrying in 5 seconds...")
            except Exception as e:
                print(f"[AUTO-CONNECT] Error during auto-connect: {e}")
        
        if not chimera_found:
            time.sleep(5) 
    
    print("[AUTO-CONNECT] Device scan complete")


# Start auto-connect in background thread (won't block app startup)
auto_connect_thread = threading.Thread(target=auto_connect_devices, daemon=True)
auto_connect_thread.start()


@app.route("/api/v1/ports")
@jwt_required()
def list_ports():
    ports = []
    for port in serial.tools.list_ports.comports():
        ports.append({
            "name": port.name,
            "device": port.device,
            "description": port.description
        })
    return jsonify(ports)

@atexit.register
def on_exit():
    with app.app_context():
        devices = db.session.query(Device).all()
        for device in devices:
            device.connected = False
        db.session.commit()
        db.session.close()

@app.route("/api/v1/devices")
@jwt_required()
def list_devices():
    try:
        devices = db.session.query(Device).all()
        return jsonify([{
            "id": device.id,
            "name": device.name,
            "device_type": device.device_type,
            "serial_port": device.serial_port,
            "mac_address": device.mac_address,
            "logging": device.logging,
            "connected": device.connected
        } for device in devices])
    finally:
        db.session.close()


@app.route("/api/v1/devices/<int:device_id>", methods=['GET'])
@jwt_required()
def get_device(device_id):
    """Get a specific device by ID"""
    try:
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found"}), 404
        
        return jsonify({
            "id": device.id,
            "name": device.name,
            "device_type": device.device_type,
            "serial_port": device.serial_port,
            "mac_address": device.mac_address,
            "logging": device.logging,
            "connected": device.connected
        })
    finally:
        db.session.close()


@app.route("/api/v1/devices/<int:device_id>", methods=['PUT'])
@jwt_required()
@require_role(['admin', 'operator'])
def update_device(device_id):
    """Update device information"""
    try:
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        name = data.get('name')
        
        if not name:
            return jsonify({"error": "name is required"}), 400
        
        success = handler.set_name(name)
        
        if success:
            # Update database too
            device.name = name
        
        if 'serial_port' in data:
            # Check if new port is already in use by another device
            if data['serial_port'] != device.serial_port:
                existing = Device.query.filter_by(serial_port=data['serial_port']).first()
                if existing:
                    return jsonify({"error": f"Port {data['serial_port']} already in use by another device"}), 409
            device.serial_port = data['serial_port']
        
        db.session.commit()
        
        return jsonify({
            "id": device.id,
            "name": device.name,
            "device_type": device.device_type,
            "serial_port": device.serial_port,
            "mac_address": device.mac_address,
            "logging": device.logging,
            "connected": device.connected
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@app.route("/api/v1/devices/<int:device_id>", methods=['DELETE'])
@jwt_required()
@require_role(['admin', 'operator'])
def delete_device(device_id):
    """Delete a device (only if not connected)"""
    try:
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found"}), 404
        
        if device.connected:
            return jsonify({"error": "Cannot delete connected device. Disconnect first."}), 400
        
        db.session.delete(device)
        db.session.commit()
        
        return jsonify({"message": "Device deleted successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@app.route("/api/v1/devices/by_mac/<mac_address>")
@jwt_required()
def find_device_by_mac(mac_address):
    """Find a device by MAC address"""
    try:
        device = Device.query.filter_by(mac_address=mac_address).first()
        if not device:
            return jsonify({"error": "Device not found"}), 404
        
        return jsonify({
            "id": device.id,
            "name": device.name,
            "device_type": device.device_type,
            "serial_port": device.serial_port,
            "mac_address": device.mac_address,
            "logging": device.logging,
            "connected": device.connected
        })
    finally:
        db.session.close()


@app.route("/api/v1/devices/discover")
@jwt_required()
@require_role(['admin', 'operator'])
def discover_devices():
    """Discover and register all valid devices (blackbox or chimera) on available serial ports"""
    import concurrent.futures
    import threading
    
    valid_devices = []
    lock = threading.Lock()
    
    def check_port(port_info):
        """Check a single port for valid device"""
        # Skip Bluetooth ports to avoid blocking issues
        if 'Bluetooth' in port_info.device or 'Bluetooth' in port_info.description:
            return
        
        try:
            # Connect to the device
            connected = device_manager.connect(port_info.device)
            
            if not connected:
                return
            
            device = device_manager.get_device_by_port(port_info.device)
            if device.device_type in ['black-box', 'chimera']:
                with lock:
                    valid_devices.append({
                        "id": device.id, 
                        "name": device.device_name,
                        "port": port_info.device,
                        "device_type": device.device_type,
                        "logging": device.is_logging
                    })
        except Exception as e:
            print(str(e))
            pass
    
    # Get all available serial ports
    ports = list(serial.tools.list_ports.comports())

    
    # Check all ports in parallel with a thread pool
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(ports))) as executor:
        executor.map(check_port, ports)
    
    return jsonify(valid_devices)

@app.route("/api/v1/devices/connect", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def connect_device():
    """Connect to a device and auto-register if needed"""
    try:
        data = request.get_json()
        serial_port = data.get('serial_port')
        device_name = data.get('device_name')
        
        if not serial_port:
            return jsonify({"error": "serial_port is required"}), 400
        
        # Use device manager to connect (auto-registers if needed)
        result = device_manager.connect(serial_port, device_name)
        
        if result:
            return jsonify(result), 200
        else:
            return jsonify(result), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/devices/disconnect/<string:port>", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def disconnect_device_by_port(port):
    """Disconnect a device by port"""
    try:
        success = device_manager.disconnect_by_port(port)
        
        if success:
            return jsonify({"message": "Device disconnected successfully"}), 200
        else:
            return jsonify({"error": "Device not found or not connected"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/devices/<int:device_id>/disconnect", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def disconnect_device(device_id):
    """Disconnect a device by ID"""
    try:
        success = device_manager.disconnect_device(device_id)
        
        if success:
            return jsonify({"message": "Device disconnected successfully"}), 200
        else:
            return jsonify({"error": "Device not found or not connected"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/devices/connected")
@jwt_required()
def list_connected_devices():
    """List all currently connected devices with availability status"""
    try:
        # Simply query the database for connected devices
        connected_devices = Device.query.filter_by(connected=True).all()

        devices_list = []
        for device in connected_devices:
            device_data = {
                "id": device.id,
                "name": device.name,
                "device_type": device.device_type,
                "serial_port": device.serial_port,
                "mac_address": device.mac_address,
                "connected": device.connected,
                "logging": device.logging,
                "active_test_id": device.active_test_id,
                "active_test_name": None
            }

            # Get test name if device is in an active test
            if device.active_test_id:
                from database.models import Test
                test = Test.query.get(device.active_test_id)
                if test:
                    device_data["active_test_name"] = test.name

            devices_list.append(device_data)

        return jsonify(devices_list)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/devices/discover", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def discover_device():
    """Discover device information without registering it"""
    try:
        data = request.get_json()
        
        if not data.get('serial_port'):
            return jsonify({"error": "serial_port is required"}), 400
        if not data.get('device_type'):
            return jsonify({"error": "device_type is required"}), 400
        
        device_info = {"error": "Device type not supported"}
        temp_handler = None
        
        try:
            if data.get('device_type') == 'black-box':
                from black_box_handler import BlackBoxHandler
                temp_handler = BlackBoxHandler(data.get('serial_port'))
                temp_handler.connect()
                device_info = {
                    "device_type": "blackbox",
                    "port": data.get('serial_port'),
                    "device_name": temp_handler.device_name,
                    "mac_address": temp_handler.mac_address,
                    "is_logging": temp_handler.is_logging,
                    "current_log_file": temp_handler.current_log_file
                }
            elif data.get('device_type') == 'chimera':
                from chimera_handler import ChimeraHandler
                temp_handler = ChimeraHandler(data.get('serial_port'))
                temp_handler.connect()
                device_info = {
                    "device_type": "chimera",
                    "port": temp_handler.port,
                    "device_name": temp_handler.device_name,
                    "mac_address": temp_handler.mac_address,
                    "is_logging": temp_handler.is_logging,
                    "current_channel": temp_handler.current_channel,
                    "seconds_elapsed": temp_handler.seconds_elapsed
                }
            
            if temp_handler:
                temp_handler.disconnect()
        except Exception as e:
            if temp_handler:
                temp_handler.disconnect()
            return jsonify({"error": f"Failed to discover device: {str(e)}"}), 500
        
        return jsonify(device_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Sample Management Endpoints
@app.route("/api/v1/samples", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def create_sample():
    """Create a new sample"""
    try:
        from datetime import datetime
        data = request.get_json()

        # Get current user from JWT token
        user_id = get_jwt_identity()
        user = User.query.get(int(user_id))
        author = user.username if user else None

        # Create sample record
        sample = Sample(
            sample_name=data.get('sample_name'),
            substrate_source=data.get('substrate_source'),
            description=data.get('description'),
            substrate_type=data.get('substrate_type'),
            substrate_subtype=data.get('substrate_subtype'),
            ash_content=float(data.get('ash_content')) if data.get('ash_content') else None,
            c_content=float(data.get('c_content')) if data.get('c_content') else None,
            n_content=float(data.get('n_content')) if data.get('n_content') else None,
            substrate_percent_ts=float(data.get('substrate_percent_ts')) if data.get('substrate_percent_ts') else None,
            substrate_percent_vs=float(data.get('substrate_percent_vs')) if data.get('substrate_percent_vs') else None,
            author=author,
            is_inoculum=data.get('is_inoculum', False),
            date_created=datetime.now()
        )

        db.session.add(sample)
        db.session.commit()

        return jsonify({
            "success": True,
            "sample_id": sample.id,
            "message": "Sample created successfully"
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/samples", methods=['GET'])
@jwt_required()
def list_substrate_samples():
    """Get samples (substrates by default). Use include_inoculum=true to include inoculums."""
    try:
        include_inoculum = request.args.get('include_inoculum') == 'true'
        query = Sample.query
        if not include_inoculum:
            query = query.filter_by(is_inoculum=False)
        samples = query.all()
        return jsonify([{
            "id": sample.id,
            "sample_name": sample.sample_name,
            "substrate_source": sample.substrate_source,
            "description": sample.description,
            "substrate_type": sample.substrate_type,
            "substrate_subtype": sample.substrate_subtype,
            "ash_content": sample.ash_content,
            "c_content": sample.c_content,
            "n_content": sample.n_content,
            "substrate_percent_ts": sample.substrate_percent_ts,
            "substrate_percent_vs": sample.substrate_percent_vs,
            "author": sample.author,
            "date_created": sample.date_created.isoformat() if sample.date_created else None,
            "is_inoculum": sample.is_inoculum
        } for sample in samples])
    except Exception as e:
        db.session.rollback()
        print(f"Error fetching samples: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/inoculum", methods=['GET'])
@jwt_required()
def list_inoculum_samples():
    """Get all inoculum samples"""
    try:
        # Only return inoculum samples for inoculum selection
        inoculums = Sample.query.filter_by(is_inoculum=True).all()
        return jsonify([{
            "id": sample.id,
            "inoculum_source": sample.substrate_source,  # Display as inoculum_source for compatibility
            "sample_name": sample.sample_name,
            "description": sample.description,
            "date_created": sample.date_created.isoformat() if sample.date_created else None
        } for sample in inoculums])
    except Exception as e:
        db.session.rollback()
        print(f"Error fetching inoculums: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/samples/<int:sample_id>", methods=['PUT'])
@jwt_required()
@require_role(['admin', 'operator'])
def update_sample(sample_id):
    """Update an existing sample"""
    try:
        sample = Sample.query.get(sample_id)
        if not sample:
            return jsonify({"error": "Sample not found"}), 404

        data = request.get_json()
        
        # Update fields
        if 'sample_name' in data:
            sample.sample_name = data['sample_name']
        if 'substrate_source' in data:
            sample.substrate_source = data['substrate_source']
        if 'description' in data:
            sample.description = data['description']
        if 'substrate_type' in data:
            sample.substrate_type = data['substrate_type']
        if 'substrate_subtype' in data:
            sample.substrate_subtype = data['substrate_subtype']
        if 'ash_content' in data:
            sample.ash_content = float(data['ash_content']) if data['ash_content'] else None
        if 'c_content' in data:
            sample.c_content = float(data['c_content']) if data['c_content'] else None
        if 'n_content' in data:
            sample.n_content = float(data['n_content']) if data['n_content'] else None
        if 'substrate_percent_ts' in data:
            sample.substrate_percent_ts = float(data['substrate_percent_ts']) if data['substrate_percent_ts'] else None
        if 'substrate_percent_vs' in data:
            sample.substrate_percent_vs = float(data['substrate_percent_vs']) if data['substrate_percent_vs'] else None
        if 'author' in data:
            sample.author = data['author']
        if 'other' in data:
            sample.other = data['other']
        if 'reactor' in data:
            sample.reactor = data['reactor']
        if 'temperature' in data:
            sample.temperature = float(data['temperature']) if data['temperature'] else None

        db.session.commit()

        # Audit log entry
        try:
            user_id = get_jwt_identity()
            log_audit(
                int(user_id),
                'update_sample',
                'sample',
                sample_id,
                f"Updated sample '{sample.sample_name}'"
            )
        except Exception as audit_error:
            print(f"[AUDIT] Failed to log sample update: {audit_error}")

        return jsonify({
            "success": True,
            "message": "Sample updated successfully"
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/samples/<int:sample_id>", methods=['DELETE'])
@jwt_required()
@require_role(['admin', 'operator'])
def delete_sample(sample_id):
    """Delete a sample"""
    try:
        sample = Sample.query.get(sample_id)
        if not sample:
            return jsonify({"error": "Sample not found"}), 404

        db.session.delete(sample)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Sample deleted successfully"
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


# Test Management Endpoints
@app.route("/api/v1/tests", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def create_test():
    """Create a new test"""
    try:
        from datetime import datetime
        data = request.get_json()

        if not data.get('name'):
            return jsonify({"error": "Test name is required"}), 400

        # Get current user from JWT token
        user_id = get_jwt_identity()
        user = User.query.get(int(user_id))
        created_by = user.username if user else None

        test = Test(
            name=data.get('name'),
            description=data.get('description'),
            created_by=created_by,
            date_created=datetime.now(),
            status='setup'
        )
        
        db.session.add(test)
        db.session.commit()
        
        return jsonify({
            "success": True,
            "test_id": test.id,
            "message": "Test created successfully"
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests", methods=['GET'])
@jwt_required()
def list_tests():
    """Get all tests"""
    try:
        status = request.args.get('status')
        include_devices = request.args.get('include_devices') == 'true'
        
        query = Test.query
        if status:
            query = query.filter_by(status=status)
            
        tests = query.all()
        
        results = []
        for test in tests:
            test_data = {
                "id": test.id,
                "name": test.name,
                "description": test.description,
                "created_by": test.created_by,
                "date_created": test.date_created.isoformat() if test.date_created else None,
                "date_started": test.date_started.isoformat() if test.date_started else None,
                "date_ended": test.date_ended.isoformat() if test.date_ended else None,
                "status": test.status
            }
            
            if include_devices:
                # Get devices from active assignment OR configuration
                # 1. Active devices
                device_ids = set([d.id for d in Device.query.filter_by(active_test_id=test.id).all()])
                
                # 2. Configured devices (for completed tests)
                configs = ChannelConfiguration.query.filter_by(test_id=test.id).all()
                for c in configs:
                    device_ids.add(c.device_id)
                    
                chimera_configs = ChimeraConfiguration.query.filter_by(test_id=test.id).all()
                for c in chimera_configs:
                    device_ids.add(c.device_id)
                
                # Fetch device details
                if device_ids:
                    devices = Device.query.filter(Device.id.in_(list(device_ids))).all()
                    test_data['devices'] = [{
                        "id": d.id,
                        "name": d.name,
                        "device_type": d.device_type,
                        "serial_port": d.serial_port,
                        "logging": d.logging
                    } for d in devices]
                else:
                    test_data['devices'] = []
                
            results.append(test_data)
            
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests/<int:test_id>", methods=['GET'])
@jwt_required()
def get_test(test_id):
    """Get a specific test with its channel configurations"""
    try:
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        # Get channel configurations for this test
        configurations = ChannelConfiguration.query.filter_by(test_id=test_id).all()

        return jsonify({
            "id": test.id,
            "name": test.name,
            "description": test.description,
            "created_by": test.created_by,
            "date_created": test.date_created.isoformat() if test.date_created else None,
            "date_started": test.date_started.isoformat() if test.date_started else None,
            "date_ended": test.date_ended.isoformat() if test.date_ended else None,
            "status": test.status,
            "configurations": [{
                "id": config.id,
                "device_id": config.device_id,
                "channel_number": config.channel_number,
                "inoculum_sample_id": config.inoculum_sample_id,
                "inoculum_weight_grams": config.inoculum_weight_grams,
                "substrate_sample_id": config.substrate_sample_id,
                "substrate_weight_grams": config.substrate_weight_grams,
                "tumbler_volume": config.tumbler_volume,
                "chimera_channel": config.chimera_channel,
                "in_service": config.in_service if config.in_service is not None else True,
                "notes": config.notes
            } for config in configurations]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests/<int:test_id>", methods=['PUT'])
@jwt_required()
@require_role(['admin', 'operator'])
def update_test(test_id):
    """Update test name/description"""
    try:
        data = request.get_json() or {}
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        name = data.get('name')
        description = data.get('description')

        if name is not None:
            if not str(name).strip():
                return jsonify({"error": "Test name cannot be empty"}), 400
            test.name = name
        if description is not None:
            test.description = description

        db.session.commit()

        user_id = get_jwt_identity()
        user = User.query.get(int(user_id))
        audit_log = AuditLog(
            user_id=int(user_id),
            action='update_test',
            target_type='test',
            target_id=test_id,
            details=f"Updated test '{test.name}' by {user.username if user else 'Unknown'}"
        )
        db.session.add(audit_log)
        db.session.commit()

        return jsonify({
            "success": True,
            "test": {
                "id": test.id,
                "name": test.name,
                "description": test.description
            }
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests/<int:test_id>/chimera-configuration", methods=['GET'])
@jwt_required()
def get_chimera_configuration(test_id):
    """Get comprehensive test configuration including Chimera timing and channel details"""
    try:
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        # Get Chimera configuration for this test
        chimera_config = ChimeraConfiguration.query.filter_by(test_id=test_id).first()

        if not chimera_config:
            return jsonify({
                "test_id": test_id,
                "test_name": test.name,
                "test_status": test.status,
                "chimera_config": None,
                "channels": []
            }), 200

        # Build Chimera config response
        chimera_config_data = {
            "id": chimera_config.id,
            "flush_time_seconds": chimera_config.flush_time_seconds,
            "recirculation_mode": chimera_config.recirculation_mode,
            "recirculation_delay_seconds": chimera_config.recirculation_delay_seconds,
            "service_sequence": chimera_config.service_sequence
        }

        # Get all channel configurations for this Chimera config
        channel_configs = ChimeraChannelConfiguration.query.filter_by(
            chimera_config_id=chimera_config.id
        ).all()

        channels = []
        for channel_cfg in channel_configs:
            # Get sample information linked to this channel
            sample_name = None
            inoculum_name = None
            substrate_name = None
            inoculum_sample_id = None
            substrate_sample_id = None

            # Find BlackBox configuration for this Chimera channel
            bb_config = ChannelConfiguration.query.filter_by(
                test_id=test_id,
                chimera_channel=channel_cfg.channel_number
            ).first()

            if bb_config:
                if bb_config.inoculum_sample_id:
                    inoculum_sample_id = bb_config.inoculum_sample_id
                    inoculum = Sample.query.get(bb_config.inoculum_sample_id)
                    inoculum_name = inoculum.sample_name if inoculum else "Unknown Inoculum"

                if bb_config.substrate_sample_id:
                    substrate_sample_id = bb_config.substrate_sample_id
                    substrate = Sample.query.get(bb_config.substrate_sample_id)
                    substrate_name = substrate.sample_name if substrate else "Unknown Substrate"

                if inoculum_name and substrate_name:
                    sample_name = f"{inoculum_name} + {substrate_name}"
                elif inoculum_name:
                    sample_name = inoculum_name
                elif substrate_name:
                    sample_name = substrate_name

            channels.append({
                "channel_number": channel_cfg.channel_number,
                "open_time_seconds": channel_cfg.open_time_seconds,
                "volume_threshold_ml": channel_cfg.volume_threshold_ml,
                "sample_name": sample_name,
                "inoculum_sample_id": inoculum_sample_id,
                "inoculum_name": inoculum_name,
                "substrate_sample_id": substrate_sample_id,
                "substrate_name": substrate_name
            })

        # Sort channels by channel number
        channels.sort(key=lambda x: x['channel_number'])

        return jsonify({
            "test_id": test_id,
            "test_name": test.name,
            "test_status": test.status,
            "chimera_config": chimera_config_data,
            "channels": channels
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/tests/<int:test_id>/blackbox-configuration/<int:device_id>", methods=['GET'])
@jwt_required()
def get_blackbox_configuration(test_id, device_id):
    """Get BlackBox channel-to-sample mapping for a specific device in a test"""
    try:
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found"}), 404

        # Get all channel configurations for this test and device
        channel_configs = ChannelConfiguration.query.filter_by(
            test_id=test_id,
            device_id=device_id
        ).all()

        channels = []
        for channel_cfg in channel_configs:
            inoculum_name = None
            substrate_name = None

            if channel_cfg.inoculum_sample_id:
                inoculum = Sample.query.get(channel_cfg.inoculum_sample_id)
                inoculum_name = inoculum.sample_name if inoculum else "Unknown Inoculum"

            if channel_cfg.substrate_sample_id:
                substrate = Sample.query.get(channel_cfg.substrate_sample_id)
                substrate_name = substrate.sample_name if substrate else "Unknown Substrate"

            # Determine sample name display
            if inoculum_name and substrate_name:
                sample_name = f"{inoculum_name} + {substrate_name}"
            elif inoculum_name:
                sample_name = inoculum_name
            elif substrate_name:
                sample_name = substrate_name
            else:
                sample_name = None

            channels.append({
                "channel_number": channel_cfg.channel_number,
                "sample_name": sample_name,
                "inoculum_sample_id": channel_cfg.inoculum_sample_id,
                "inoculum_name": inoculum_name,
                "substrate_sample_id": channel_cfg.substrate_sample_id,
                "substrate_name": substrate_name,
                "inoculum_weight_grams": channel_cfg.inoculum_weight_grams,
                "substrate_weight_grams": channel_cfg.substrate_weight_grams,
                "tumbler_volume": channel_cfg.tumbler_volume,
                "chimera_channel": channel_cfg.chimera_channel,
                "in_service": channel_cfg.in_service if channel_cfg.in_service is not None else True
            })

        # Sort channels by channel number
        channels.sort(key=lambda x: x['channel_number'])

        return jsonify({
            "test_id": test_id,
            "device_id": device_id,
            "device_name": device.name,
            "test_name": test.name,
            "channels": channels
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/tests/<int:test_id>/start", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def start_test(test_id):
    """Start a test and assign it to devices, initiating logging"""
    started_devices = []
    try:
        from datetime import datetime
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        if test.status != 'setup':
            return jsonify({"error": "Test must be in setup status to start"}), 400

        # Get device_ids from request body (explicitly selected devices)
        request_data = request.get_json() or {}
        device_ids = request_data.get('device_ids', [])

        # If no explicit device selection, fallback to devices in configurations
        if not device_ids:
            configurations = ChannelConfiguration.query.filter_by(test_id=test_id).all()
            device_ids = list(set([config.device_id for config in configurations]))

        # Get all configurations for channel setup (still needed for BlackBox config)
        configurations = ChannelConfiguration.query.filter_by(test_id=test_id).all()

        # Only configure Chimera devices that are explicitly selected in device_ids
        # Find Chimera devices in the selected device_ids
        chimera_devices = Device.query.filter(
            Device.id.in_(device_ids),
            Device.device_type.in_(['chimera', 'chimera-max'])
        ).all()

        for chimera_device in chimera_devices:
            # Check ChimeraConfiguration for settings
            chimera_config = ChimeraConfiguration.query.filter_by(
                test_id=test_id,
                device_id=chimera_device.id
            ).first()

            chimera_handler = device_manager.get_device(chimera_device.id)
            if chimera_handler and chimera_config:
                # 1. Set flush time (convert seconds to milliseconds)
                # First get current timing to preserve channel times
                success, current_timing, _ = chimera_handler.get_timing()
                channel_times = current_timing.get('channel_times_ms', [600000] * 15) if success else [600000] * 15
                current_open_time_ms = channel_times[0] if channel_times else 600000
                flush_time_ms = int(chimera_config.flush_time_seconds * 1000)
                success, msg = chimera_handler.set_all_timing(current_open_time_ms, flush_time_ms)
                if not success:
                    return jsonify({"error": f"Failed to configure Chimera timing on {chimera_device.name}: {msg}"}), 500

                # 2. Set service sequence (which channels are in service)
                success, msg = chimera_handler.set_service(chimera_config.service_sequence)
                if not success:
                    return jsonify({"error": f"Failed to configure Chimera service sequence on {chimera_device.name}: {msg}"}), 500

                # 3. Set per-channel timing for all in-service channels
                channel_configs = ChimeraChannelConfiguration.query.filter_by(
                    chimera_config_id=chimera_config.id
                ).all()
                for channel_cfg in channel_configs:
                    chimera_handler.set_channel_timing(
                        channel_cfg.channel_number,
                        channel_cfg.open_time_seconds
                    )

                # 4. Set recirculation mode
                # Recirculation is only available for chimera-max devices (check global config)
                # Standard chimera devices must have recirculation disabled
                mode_map = {'off': 0, 'periodic': 1, 'volume': 2}
                device_model = app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')

                if device_model == 'chimera-max':
                    # chimera-max can use configured recirculation settings
                    chimera_mode = mode_map.get(chimera_config.recirculation_mode, 0)
                    chimera_handler.set_recirculate(chimera_mode)

                    # If periodic mode, also set the delay
                    if chimera_config.recirculation_mode == 'periodic':
                        if chimera_config.recirculation_delay_seconds:
                            chimera_handler.set_recirculation_delay(chimera_config.recirculation_delay_seconds)
                else:
                    # Standard chimera devices must have recirculation disabled
                    chimera_handler.set_recirculate(0)

        # Use exactly the device_ids that were explicitly selected by the user
        all_device_ids = device_ids

        # Check all devices are connected
        for device_id in all_device_ids:
            device = Device.query.get(device_id)
            if not device:
                return jsonify({"error": f"Device {device_id} not found"}), 404
            if not device.connected:
                return jsonify({"error": f"Device {device.name} is not connected"}), 400
            if device.active_test_id and device.active_test_id != test_id:
                return jsonify({"error": f"Device {device.name} is already in use by another test"}), 400

        # Ensure at least one in-service channel for each selected BlackBox device
        def is_blackbox_device_type(device_type):
            if not device_type:
                return False
            normalized = str(device_type).lower().replace('_', '-').replace(' ', '-')
            return normalized in ['black-box', 'blackbox']

        blackbox_devices = []
        for device_id in all_device_ids:
            device = Device.query.get(device_id)
            if device and is_blackbox_device_type(device.device_type):
                blackbox_devices.append(device)
        for device in blackbox_devices:
            has_in_service = ChannelConfiguration.query.filter(
                ChannelConfiguration.test_id == test_id,
                ChannelConfiguration.device_id == device.id,
                or_(ChannelConfiguration.in_service == True, ChannelConfiguration.in_service.is_(None))
            ).first()
            if not has_in_service:
                return jsonify({"error": f"No in-service channels configured for {device.name}. Please enable at least one channel."}), 400

        # Update test status
        test.status = 'running'
        test.date_started = datetime.now()

        # Start logging on each device
        logging_results = []
        for device_id in all_device_ids:
            device = Device.query.get(device_id)
            handler = device_manager.get_device(device_id)

            if not handler:
                for started_device, started_handler in started_devices:
                    try:
                        if started_handler:
                            started_handler.stop_logging()
                    except Exception:
                        pass
                    if started_handler:
                        try:
                            started_handler.set_test_id(None)
                        except Exception:
                            pass
                db.session.rollback()
                return jsonify({"error": f"Handler not found for device {device.name}. Any devices already started were stopped."}), 500

            # Start logging based on device type
            if device.device_type in ['black-box', 'black_box']:
                # Generate filename - keep it very short for BlackBox firmware compatibility
                # Device firmware has 20-char limit to avoid buffer overflow
                import re

                # Clean test name: only letters, numbers, and underscores
                clean_test_name = re.sub(r'[^a-zA-Z0-9_]', '', test.name.replace(' ', '_'))[:8]
                # Clean device name
                clean_device_name = re.sub(r'[^a-zA-Z0-9_]', '', device.name.replace(' ', '_'))[:5]
                # Short timestamp
                timestamp = datetime.now().strftime('%m%d%H%M')  # MMDDHHMM (8 chars)

                # Format: testname_dev_timestamp (max 8+1+5+1+8 = 23 chars before truncation)
                filename = f"{clean_test_name}_{clean_device_name}_{timestamp}"

                # Final safety: truncate to 20 chars max (firmware buffer limit)
                if len(filename) > 20:
                    filename = filename[:20]

                print(f"[DEBUG] Generated filename: '{filename}' (length: {len(filename)})")
                success, message = handler.start_logging(filename)
                if not success:
                    for started_device, started_handler in started_devices:
                        try:
                            if started_handler:
                                started_handler.stop_logging()
                        except Exception:
                            pass
                        if started_handler:
                            try:
                                started_handler.set_test_id(None)
                            except Exception:
                                pass
                    db.session.rollback()
                    return jsonify({"error": f"Failed to start logging on {device.name}: {message}. Any devices already started were stopped."}), 500

                logging_results.append({
                    "device": device.name,
                    "filename": filename,
                    "message": message
                })

            elif device.device_type in ['chimera', 'chimera-max']:
                print(f"[DEBUG] Starting Chimera logging for device {device.name} (ID: {device.id})")

                # Generate filename - Chimera supports up to 59 characters
                import re

                # Clean test name: only letters, numbers, and underscores
                clean_test_name = re.sub(r'[^a-zA-Z0-9_]', '', test.name.replace(' ', '_'))
                # Clean device name
                clean_device_name = re.sub(r'[^a-zA-Z0-9_]', '', device.name.replace(' ', '_'))

                # Format: testname_devicename_testid (max 59 chars)
                filename = f"{clean_test_name}_{clean_device_name}_t{test_id}"

                # Truncate to 59 chars max (Chimera firmware limit)
                if len(filename) > 59:
                    filename = filename[:59]

                print(f"[DEBUG] Generated Chimera filename: '{filename}' (length: {len(filename)})")
                    
                success, message = handler.start_logging(filename)
                print(f"[DEBUG] Chimera start_logging result: success={success}, message={message}")

                if not success:
                    for started_device, started_handler in started_devices:
                        try:
                            if started_handler:
                                started_handler.stop_logging()
                        except Exception:
                            pass
                        if started_handler:
                            try:
                                started_handler.set_test_id(None)
                            except Exception:
                                pass
                    db.session.rollback()
                    return jsonify({"error": f"Failed to start logging on {device.name}: {message}. Any devices already started were stopped."}), 500

                logging_results.append({
                    "device": device.name,
                    "message": message
                })

            # Set test ID on handler and update device
            handler.set_test_id(test_id)
            device.active_test_id = test_id
            device.logging = True
            started_devices.append((device, handler))

        db.session.commit()

        # Create audit log entry
        user_id = get_jwt_identity()
        user = User.query.get(int(user_id))
        device_names = [Device.query.get(d_id).name for d_id in all_device_ids]
        audit_log = AuditLog(
            user_id=int(user_id),
            action='start_test',
            target_type='test',
            target_id=test_id,
            details=f"Started test '{test.name}' by {user.username if user else 'Unknown'} with devices: {', '.join(device_names)}"
        )
        db.session.add(audit_log)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": f"Test started with {len(all_device_ids)} devices",
            "logging_results": logging_results
        }), 200

    except Exception as e:
        if started_devices:
            for started_device, started_handler in started_devices:
                try:
                    if started_handler:
                        started_handler.stop_logging()
                except Exception:
                    pass
                if started_handler:
                    try:
                        started_handler.set_test_id(None)
                    except Exception:
                        pass
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests/<int:test_id>/stop", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def stop_test(test_id):
    """Stop a test and stop logging on all associated devices"""
    try:
        from datetime import datetime
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        # Get all devices involved in this test
        devices = Device.query.filter_by(active_test_id=test_id).all()

        # Stop logging on each device. Keep stopping the test even if one device fails.
        stop_results = []
        for device in devices:
            handler = device_manager.get_device(device.id)
            result = None

            try:
                if handler is None:
                    result = {
                        "device": device.name,
                        "success": False,
                        "message": "Device handler unavailable; marked as stopped in database"
                    }
                else:
                    # Always issue a stop command for every device in this test.
                    # Relying on cached handler.is_logging can miss devices that are still logging.
                    success, message = handler.stop_logging()
                    result = {
                        "device": device.name,
                        "success": success,
                        "message": message
                    }
            except OSError as e:
                result = {
                    "device": device.name,
                    "success": False,
                    "message": f"Serial I/O error while stopping logging: {e}"
                }
            except Exception as e:
                result = {
                    "device": device.name,
                    "success": False,
                    "message": f"Failed to stop logging: {e}"
                }
            finally:
                # Test is being stopped regardless of serial state.
                device.logging = False
                device.active_test_id = None
                if handler:
                    try:
                        handler.set_test_id(None)
                    except Exception:
                        pass

            stop_results.append(result or {
                "device": device.name,
                "success": False,
                "message": "Unknown stop state"
            })

        # Update test status
        test.status = 'completed'
        test.date_ended = datetime.now()

        db.session.commit()

        # Create audit log entry
        user_id = get_jwt_identity()
        user = User.query.get(int(user_id))
        device_names = [d.name for d in devices]
        audit_log = AuditLog(
            user_id=int(user_id),
            action='stop_test',
            target_type='test',
            target_id=test_id,
            details=f"Stopped test '{test.name}' by {user.username if user else 'Unknown'}" + (f" (devices: {', '.join(device_names)})" if device_names else "")
        )
        db.session.add(audit_log)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Test stopped successfully",
            "stop_results": stop_results
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

# Channel Configuration Endpoints
@app.route("/api/v1/tests/<int:test_id>/configurations", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def create_channel_configuration(test_id):
    """Create or update channel configurations for a test"""
    try:
        data = request.get_json()
        configurations = data.get('configurations', [])
        
        if not configurations:
            return jsonify({"error": "No configurations provided"}), 400
        
        def normalize_optional_int(value):
            if value is None:
                return None
            if isinstance(value, str) and value.strip() == '':
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def normalize_float(value, default=0.0):
            if value is None:
                return default
            if isinstance(value, str) and value.strip() == '':
                return default
            try:
                return float(value)
            except (TypeError, ValueError):
                return default

        def normalize_optional_id(value):
            if value is None:
                return None
            if isinstance(value, str) and value.strip() == '':
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def normalize_bool(value, default=True):
            if value is None:
                return default
            if isinstance(value, bool):
                return value
            if isinstance(value, (int, float)):
                return bool(value)
            if isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in ['true', '1', 'yes', 'y', 'on']:
                    return True
                if lowered in ['false', '0', 'no', 'n', 'off']:
                    return False
            return default

        created_configs = []
        affected_device_ids = set()

        def normalize_device_id(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
        for config_data in configurations:
            device_id = normalize_device_id(config_data.get('device_id'))
            if device_id is None:
                raise ValueError("Invalid device_id in configuration payload")
            inoculum_sample_id = normalize_optional_id(config_data.get('inoculum_sample_id'))
            substrate_sample_id = normalize_optional_id(config_data.get('substrate_sample_id'))
            inoculum_weight_grams = normalize_float(config_data.get('inoculum_weight_grams'), default=0.0)
            substrate_weight_grams = normalize_float(config_data.get('substrate_weight_grams'), default=0.0)
            tumbler_volume = normalize_float(config_data.get('tumbler_volume'), default=0.0)
            chimera_channel = normalize_optional_int(config_data.get('chimera_channel'))
            affected_device_ids.add(device_id)

            # Check if configuration already exists
            existing = ChannelConfiguration.query.filter_by(
                test_id=test_id,
                device_id=device_id,
                channel_number=config_data['channel_number']
            ).first()

            in_service_raw = config_data.get('in_service')
            in_service = normalize_bool(in_service_raw, default=True)
            if in_service_raw is None and existing is not None:
                in_service = existing.in_service

            if existing:
                # Update existing
                existing.inoculum_sample_id = inoculum_sample_id
                existing.inoculum_weight_grams = inoculum_weight_grams
                existing.substrate_sample_id = substrate_sample_id
                existing.substrate_weight_grams = substrate_weight_grams
                existing.tumbler_volume = tumbler_volume
                existing.chimera_channel = chimera_channel
                existing.in_service = in_service
                existing.notes = config_data.get('notes')
                created_configs.append(existing)
            else:
                # Create new
                config = ChannelConfiguration(
                    test_id=test_id,
                    device_id=device_id,
                    channel_number=config_data['channel_number'],
                    inoculum_sample_id=inoculum_sample_id,
                    inoculum_weight_grams=inoculum_weight_grams,
                    substrate_sample_id=substrate_sample_id,
                    substrate_weight_grams=substrate_weight_grams,
                    tumbler_volume=tumbler_volume,
                    chimera_channel=chimera_channel,
                    in_service=in_service,
                    notes=config_data.get('notes')
                )
                db.session.add(config)
                created_configs.append(config)
        
        def is_blackbox_device(device):
            if not device or not device.device_type:
                return False
            normalized = device.device_type.strip().lower().replace('_', '-')
            return normalized in ['black-box', 'blackbox']

        db.session.flush()

        if affected_device_ids:
            from black_box_handler import BlackBoxHandler

            with BlackBoxHandler._db_write_lock:
                blackbox_device_ids = {
                    device.id
                    for device in Device.query.filter(Device.id.in_(affected_device_ids)).all()
                    if is_blackbox_device(device)
                }

                for device_id in blackbox_device_ids:
                    # Clear calculated logs and channel running counters for deterministic rebuild.
                    BlackBoxEventLogData.query.filter_by(test_id=test_id, device_id=device_id).delete(synchronize_session=False)
                    ChannelConfiguration.query.filter_by(
                        test_id=test_id,
                        device_id=device_id
                    ).update({
                        ChannelConfiguration.tip_count: 0,
                        ChannelConfiguration.total_stp_volume: 0.0,
                        ChannelConfiguration.total_net_volume: 0.0,
                        ChannelConfiguration.hourly_tips: 0,
                        ChannelConfiguration.daily_tips: 0,
                        ChannelConfiguration.last_tip_time: None,
                        ChannelConfiguration.hourly_volume: 0.0,
                        ChannelConfiguration.daily_volume: 0.0
                    }, synchronize_session=False)

                    db.session.flush()
                    db.session.expire_all()

                    raw_tips_query = BlackboxRawData.query.filter_by(
                        test_id=test_id,
                        device_id=device_id
                    ).order_by(
                        BlackboxRawData.tip_number.asc(),
                        BlackboxRawData.timestamp.asc(),
                        BlackboxRawData.id.asc()
                    ).yield_per(1000)

                    handler = BlackBoxHandler(port="")
                    handler.app = app
                    handler.test_id = test_id
                    handler.id = device_id

                    for tip in raw_tips_query:
                        tip_data = {
                            "tip_number": tip.tip_number,
                            "timestamp": tip.timestamp,
                            "seconds_elapsed": tip.seconds_elapsed,
                            "channel_number": tip.channel_number,
                            "temperature": tip.temperature,
                            "pressure": tip.pressure
                        }
                        handler.calculateEventLogTip(tip_data, reprocess_mode=True, commit_changes=False)

        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": f"Created/updated {len(created_configs)} channel configurations"
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


@app.route("/api/v1/tests/<int:test_id>/chimera-configuration", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def create_chimera_configuration(test_id):
    """Create or update Chimera configuration for a test"""
    try:
        data = request.get_json()
        device_id = data.get('device_id')

        if not device_id:
            return jsonify({"error": "device_id is required"}), 400

        # Check if configuration already exists
        existing = ChimeraConfiguration.query.filter_by(
            test_id=test_id,
            device_id=device_id
        ).first()

        recirculation_mode = data.get('recirculation_mode', 'off')
        recirculation_delay_seconds = data.get('recirculation_delay_seconds')

        # Validate: periodic mode requires a delay to be set
        if recirculation_mode == 'periodic' and (not recirculation_delay_seconds or recirculation_delay_seconds <= 0):
            return jsonify({"error": "Periodic recirculation requires a delay time to be set"}), 400

        if existing:
            # Update existing
            existing.flush_time_seconds = data.get('flush_time_seconds', 30.0)
            existing.recirculation_mode = recirculation_mode
            existing.recirculation_delay_seconds = recirculation_delay_seconds
            existing.service_sequence = data.get('service_sequence', '111111111111111')
            chimera_config = existing
        else:
            # Create new
            chimera_config = ChimeraConfiguration(
                test_id=test_id,
                device_id=device_id,
                flush_time_seconds=data.get('flush_time_seconds', 30.0),
                recirculation_mode=recirculation_mode,
                recirculation_delay_seconds=recirculation_delay_seconds,
                service_sequence=data.get('service_sequence', '111111111111111')
            )
            db.session.add(chimera_config)

        db.session.flush()  # Get the ID for channel configs

        # Handle per-channel configurations for ALL channels in service
        service_sequence = data.get('service_sequence', '111111111111111')
        channel_settings = data.get('channel_settings', {})

        for i in range(15):
            channel_num = i + 1
            is_in_service = service_sequence[i] == '1' if i < len(service_sequence) else True

            # Get settings for this channel (may be empty)
            settings = channel_settings.get(str(channel_num), {})

            # Check if channel config exists
            existing_channel = ChimeraChannelConfiguration.query.filter_by(
                chimera_config_id=chimera_config.id,
                channel_number=channel_num
            ).first()

            if is_in_service:
                # Create or update channel config for in-service channels
                open_time = float(settings.get('openTime', 600.0)) if settings.get('openTime') else 600.0
                volume_threshold = float(settings.get('volumeThreshold')) if settings.get('volumeThreshold') else None

                if existing_channel:
                    existing_channel.open_time_seconds = open_time
                    existing_channel.volume_threshold_ml = volume_threshold
                else:
                    channel_config = ChimeraChannelConfiguration(
                        chimera_config_id=chimera_config.id,
                        channel_number=channel_num,
                        open_time_seconds=open_time,
                        volume_threshold_ml=volume_threshold
                    )
                    db.session.add(channel_config)
            else:
                # Remove channel config if not in service
                if existing_channel:
                    db.session.delete(existing_channel)

        db.session.commit()

        return jsonify({
            "success": True,
            "chimera_config_id": chimera_config.id,
            "message": "Chimera configuration saved"
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


@app.route("/api/v1/tests/upload-csv", methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def upload_csv_configuration():
    """Parse CSV file and return channel configurations"""
    try:
        import csv
        import io
        
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        if not file.filename.lower().endswith('.csv'):
            return jsonify({"error": "File must be a CSV"}), 400
        
        # Read and parse CSV (support BOM + comma/semicolon/tab delimiters)
        raw_bytes = file.stream.read()
        try:
            text_content = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            text_content = raw_bytes.decode("latin-1")

        sample_text = text_content[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample_text, delimiters=[',', ';', '\t'])
            delimiter = dialect.delimiter
        except csv.Error:
            delimiter = ','

        stream = io.StringIO(text_content, newline=None)
        csv_reader = csv.DictReader(stream, delimiter=delimiter)
        
        configurations = []
        next_channel_number = 1

        def normalize_header(header):
            return ' '.join(str(header or '').strip().lower().replace('_', ' ').split())

        def get_row_value(normalized_row, *aliases):
            for alias in aliases:
                normalized_alias = normalize_header(alias)
                if normalized_alias in normalized_row:
                    return normalized_row.get(normalized_alias, '')
            return ''

        def parse_bool(value, default=False):
            if value is None:
                return default
            text = str(value).strip()
            if text == '':
                return default
            lowered = text.lower()
            if lowered in ['1', 'true', 'yes', 'y', 'on']:
                return True
            if lowered in ['0', 'false', 'no', 'n', 'off']:
                return False
            try:
                return float(text) != 0.0
            except ValueError:
                raise ValueError(f"Invalid boolean value: {value}")

        def parse_float(value, default=0.0):
            if value is None:
                return default
            text = str(value).strip()
            if text == '':
                return default
            return float(text)

        def parse_optional_channel(value):
            text = str(value or '').strip()
            if text == '':
                return None
            parsed = int(text)
            if parsed < 1 or parsed > 15:
                raise ValueError("Channel number must be between 1 and 15")
            return parsed

        if not csv_reader.fieldnames:
            return jsonify({"error": "CSV file has no headers"}), 400

        normalized_headers = {normalize_header(name) for name in csv_reader.fieldnames if name is not None}
        required_header_groups = [
            {'channel number', 'sample description'},
            {'in service'},
            {'inoculum only'},
            {'inoculum mass vs (g)'},
            {'sample mass vs (g)'},
            {'tumbler volume (ml)'}
        ]
        for group in required_header_groups:
            if normalized_headers.isdisjoint(group):
                expected = ' / '.join(sorted(group))
                return jsonify({"error": f"Missing expected CSV header: {expected}"}), 400

        for row_num, row in enumerate(csv_reader, start=1):
            try:
                normalized_row = {
                    normalize_header(key): ('' if value is None else str(value).strip())
                    for key, value in row.items()
                }
                if not any(normalized_row.values()):
                    continue

                channel_text = get_row_value(
                    normalized_row,
                    'channel number',
                    'channel_number',
                    'channel'
                )
                sample_description = get_row_value(
                    normalized_row,
                    'sample description',
                    'sample name',
                    'description'
                )
                identifier = sample_description or channel_text

                if str(identifier).strip().lower() == 'end of data':
                    break

                in_service_raw = get_row_value(normalized_row, 'in service', 'active')
                inoculum_only = parse_bool(get_row_value(normalized_row, 'inoculum only'), default=False)
                inoculum_weight = parse_float(get_row_value(normalized_row, 'inoculum mass vs (g)'), default=0.0)
                substrate_weight_input = parse_float(get_row_value(normalized_row, 'sample mass vs (g)'), default=0.0)
                tumbler_volume = parse_float(get_row_value(normalized_row, 'tumbler volume (ml)'), default=0.0)
                chimera_channel = parse_optional_channel(get_row_value(normalized_row, 'chimera channel'))

                # If "In service" is blank but row has meaningful values, treat as active.
                inferred_in_service = any([
                    inoculum_weight > 0,
                    substrate_weight_input > 0,
                    tumbler_volume > 0,
                    chimera_channel is not None,
                    inoculum_only
                ])
                in_service = parse_bool(in_service_raw, default=inferred_in_service)

                explicit_channel = parse_optional_channel(channel_text)
                effective_channel = explicit_channel if explicit_channel is not None else next_channel_number
                if explicit_channel is None:
                    next_channel_number += 1

                if effective_channel < 1 or effective_channel > 15:
                    continue

                substrate_weight = 0.0 if inoculum_only else substrate_weight_input
                note_text = sample_description if sample_description else str(effective_channel)

                configurations.append({
                    'channel_number': effective_channel,
                    'inoculum_weight_grams': inoculum_weight,
                    'substrate_weight_grams': substrate_weight,
                    'tumbler_volume': tumbler_volume,
                    'is_control': inoculum_only,
                    'chimera_channel': chimera_channel,
                    'in_service': in_service,
                    'notes': note_text
                })
            except (ValueError, KeyError) as e:
                return jsonify({"error": f"Invalid data in row {row_num}: {str(e)}"}), 400
        
        return jsonify({
            "success": True,
            "configurations": configurations,
            "message": f"Parsed {len(configurations)} channel configurations from CSV"
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/v1/tests/<int:test_id>", methods=['DELETE'])
@jwt_required()
@require_role(['admin', 'operator'])
def delete_test(test_id):
    """Delete a test and all associated data"""
    try:
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        if test.status == 'running':
            return jsonify({"error": "Cannot delete a running test. Stop it first."}), 400

        # Save test name for audit log before deletion
        test_name = test.name

        # Delete associated data (cascading deletes should handle this if models are set up correctly,
        # but explicit deletion is safer)

        # 1. Delete Channel Configurations
        ChannelConfiguration.query.filter_by(test_id=test_id).delete()

        # 2. Delete Chimera Configurations (and cascade to ChimeraChannelConfiguration)
        chimera_configs = ChimeraConfiguration.query.filter_by(test_id=test_id).all()
        for cc in chimera_configs:
            ChimeraChannelConfiguration.query.filter_by(chimera_config_id=cc.id).delete()
            db.session.delete(cc)

        # 3. Delete Data (Event Logs, Raw Data) - This might be heavy, consider async or restrictions
        BlackBoxEventLogData.query.filter_by(test_id=test_id).delete()
        BlackboxRawData.query.filter_by(test_id=test_id).delete()
        ChimeraRawData.query.filter_by(test_id=test_id).delete()

        # 4. Clear device active_test_id if pointing to this test (should be cleared on stop, but safety check)
        devices = Device.query.filter_by(active_test_id=test_id).all()
        for device in devices:
            device.active_test_id = None
            device.logging = False

        # 5. Delete Test
        db.session.delete(test)
        db.session.commit()

        # Create audit log entry
        user_id = get_jwt_identity()
        user = User.query.get(int(user_id))
        audit_log = AuditLog(
            user_id=int(user_id),
            action='delete_test',
            target_type='test',
            target_id=test_id,
            details=f"Deleted test '{test_name}' (ID: {test_id}) by {user.username if user else 'Unknown'}"
        )
        db.session.add(audit_log)
        db.session.commit()

        return jsonify({"success": True, "message": "Test deleted successfully"}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/tests/<int:test_id>/download", methods=['GET'])
@jwt_required()
def download_test_data(test_id):
    """Download test data. Auto-detects available data:
    - Both GFM and Chimera -> ZIP file with 2 CSVs
    - Only GFM -> GFM CSV
    - Only Chimera -> Chimera CSV
    """
    try:
        import io
        import csv
        import zipfile
        from datetime import datetime
        from flask import send_file

        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        # Get current user's CSV delimiter preference
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        csv_delimiter = user.csv_delimiter if user else ','

        # 1. Fetch BlackBox Event Log Data
        bb_events = db.session.query(
            BlackBoxEventLogData, Device.name
        ).join(
            Device, BlackBoxEventLogData.device_id == Device.id
        ).filter(
            BlackBoxEventLogData.test_id == test_id
        ).order_by(BlackBoxEventLogData.timestamp).all()

        # 2. Fetch BlackBox Raw Data
        bb_raw = db.session.query(
            BlackboxRawData, Device.name
        ).join(
            Device, BlackboxRawData.device_id == Device.id
        ).filter(
            BlackboxRawData.test_id == test_id
        ).order_by(BlackboxRawData.timestamp).all()

        # 3. Fetch Chimera Data
        chimera_data = db.session.query(
            ChimeraRawData, Device.name
        ).join(
            Device, ChimeraRawData.device_id == Device.id
        ).filter(
            ChimeraRawData.test_id == test_id
        ).order_by(ChimeraRawData.timestamp).all()

        has_bb_events = len(bb_events) > 0
        has_bb_raw = len(bb_raw) > 0
        has_chimera = len(chimera_data) > 0

        # When event log data exists, raw data is redundant (same tips, less processing).
        # Only use raw data as a fallback when no event log exists.
        if has_bb_events:
            has_bb_raw = False

        if not has_bb_events and not has_bb_raw and not has_chimera:
             return jsonify({"error": "No data found for this test"}), 404

        # Helper to create CSV string
        def create_csv_string(header, rows, row_mapper, delimiter=','):
            output = io.StringIO()
            writer = csv.writer(output, delimiter=delimiter)
            writer.writerow(header)
            for row in rows:
                writer.writerow(row_mapper(row))
            return output.getvalue()

        # Mappers
        def map_bb_event(item):
            event, device_name = item
            return [
                datetime.fromtimestamp(event.timestamp).isoformat(),
                device_name,
                event.channel_number,
                event.channel_name,
                event.days,
                event.hours,
                event.minutes,
                event.tumbler_volume,
                event.temperature,
                event.pressure,
                event.cumulative_tips,
                event.volume_this_tip_stp,
                event.total_volume_stp,
                event.tips_this_day,
                event.volume_this_day_stp,
                event.tips_this_hour,
                event.volume_this_hour_stp,
                event.net_volume_per_gram
            ]

        def map_bb_raw(item):
            row, device_name = item
            return [
                datetime.fromtimestamp(row.timestamp).isoformat() if row.timestamp else '',
                device_name,
                row.channel_number,
                row.tip_number,
                row.seconds_elapsed,
                row.temperature,
                row.pressure
            ]

        def map_chimera(item):
            row, device_name = item
            return [
                datetime.fromtimestamp(row.timestamp).isoformat(),
                device_name,
                row.channel_number,
                row.gas_name,
                row.peak_value,
                row.sensor_number
            ]

        bb_event_header = [
            'Timestamp', 'Device', 'Channel', 'Channel Name', 'Days', 'Hours', 'Minutes', 
            'Tumbler Volume', 'Temperature (C)', 'Pressure (mbar)', 'Cumulative Tips', 
            'Volume This Tip STP', 'Total Volume STP', 'Tips This Day', 
            'Volume This Day STP', 'Tips This Hour', 'Volume This Hour STP', 'Net Volume Per Gram'
        ]
        
        bb_raw_header = [
            'Timestamp', 'Device', 'Channel', 'Tip Number', 'Seconds Elapsed', 'Temperature (C)', 'Pressure (mbar)'
        ]

        chimera_header = ['Timestamp', 'Device', 'Channel', 'Gas', 'Peak Value', 'Sensor Number']

        # Logic for return
        # If multiple types exist, ZIP them.
        # If only one type exists, return single CSV.
        
        sources_count = sum([has_bb_events, has_bb_raw, has_chimera])

        if sources_count > 1:
            # Create ZIP
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                if has_bb_events:
                    csv_data = create_csv_string(bb_event_header, bb_events, map_bb_event, csv_delimiter)
                    zf.writestr(f"{test.name}_gfm_events.csv", csv_data)

                if has_bb_raw:
                    csv_data = create_csv_string(bb_raw_header, bb_raw, map_bb_raw, csv_delimiter)
                    zf.writestr(f"{test.name}_gfm_raw.csv", csv_data)

                if has_chimera:
                    csv_data = create_csv_string(chimera_header, chimera_data, map_chimera, csv_delimiter)
                    zf.writestr(f"{test.name}_chimera.csv", csv_data)

            zip_buffer.seek(0)
            return send_file(
                zip_buffer,
                mimetype='application/zip',
                as_attachment=True,
                download_name=f"{test.name}_data.zip"
            )

        elif has_bb_events:
            # Return BlackBox Events CSV
            csv_content = create_csv_string(bb_event_header, bb_events, map_bb_event, csv_delimiter)
            return send_file(
                io.BytesIO(csv_content.encode()),
                mimetype='text/csv',
                as_attachment=True,
                download_name=f"{test.name}_gfm_events.csv"
            )

        elif has_bb_raw:
             # Return BlackBox Raw CSV
            csv_content = create_csv_string(bb_raw_header, bb_raw, map_bb_raw, csv_delimiter)
            return send_file(
                io.BytesIO(csv_content.encode()),
                mimetype='text/csv',
                as_attachment=True,
                download_name=f"{test.name}_gfm_raw.csv"
            )

        elif has_chimera:
             # Return Chimera CSV
            csv_content = create_csv_string(chimera_header, chimera_data, map_chimera, csv_delimiter)
            return send_file(
                io.BytesIO(csv_content.encode()),
                mimetype='text/csv',
                as_attachment=True,
                download_name=f"{test.name}_chimera.csv"
            )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


from routes.black_box import black_box_bp
from routes.chimera import chimera_bp
from routes.wifi import wifi_bp
from routes.data import data_bp
from routes.auth import auth_bp
from routes.users import users_bp
app.register_blueprint(black_box_bp)
app.register_blueprint(chimera_bp)
app.register_blueprint(wifi_bp)
app.register_blueprint(data_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(sse, url_prefix='/stream')


@app.route("/api/v1/system/serial-log", methods=['GET'])
@jwt_required()
def download_serial_log():
    """Download the serial communication log file"""
    from flask import send_file
    from utils.serial_logger import serial_logger
    import io

    try:
        if not serial_logger.log_exists():
            return jsonify({"error": "No serial log data available"}), 404

        return send_file(
            serial_logger.log_file_path,
            mimetype='text/plain',
            as_attachment=True,
            download_name='serial_messages.log'
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/system/serial-log", methods=['DELETE'])
@jwt_required()
@require_role(['admin'])
def clear_serial_log():
    """Clear the serial communication log file"""
    from utils.serial_logger import serial_logger

    try:
        success = serial_logger.clear_log()
        if success:
            return jsonify({"success": True, "message": "Serial log cleared"}), 200
        else:
            return jsonify({"error": "Failed to clear serial log"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/system/serial-log/info", methods=['GET'])
@jwt_required()
def serial_log_info():
    """Get information about the serial log file"""
    from utils.serial_logger import serial_logger

    try:
        size_bytes = serial_logger.get_log_size()
        # Convert to human-readable format
        if size_bytes < 1024:
            size_str = f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            size_str = f"{size_bytes / 1024:.1f} KB"
        else:
            size_str = f"{size_bytes / (1024 * 1024):.1f} MB"

        return jsonify({
            "exists": serial_logger.log_exists(),
            "size_bytes": size_bytes,
            "size_formatted": size_str,
            "enabled": serial_logger.enabled
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def get_sqlite_db_path():
    uri = current_app.config.get("SQLALCHEMY_DATABASE_URI")

    try:
        url = make_url(uri) if uri else db.engine.url
    except Exception:
        return None, "Invalid database URI"

    if url.get_backend_name() != "sqlite":
        return None, "Database download/transfer is only supported for SQLite"

    db_path = url.database
    if not db_path or db_path == ":memory:":
        return None, "SQLite database file is not available"

    if not os.path.isabs(db_path):
        # Flask resolves relative SQLite paths against the instance folder
        db_path = os.path.abspath(os.path.join(current_app.instance_path, db_path))

    return db_path, None


@app.route("/api/v1/system/database/download", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def download_database():
    """Download the SQLite database file (admin only)."""
    try:
        db_path, error = get_sqlite_db_path()
        if error:
            return jsonify({"error": error}), 400
        if not os.path.exists(db_path):
            return jsonify({"error": "Database file not found"}), 404

        return send_file(
            db_path,
            mimetype='application/octet-stream',
            as_attachment=True,
            download_name=os.path.basename(db_path)
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/system/database/transfer", methods=['POST'])
@jwt_required()
@require_role(['admin'])
def transfer_database():
    """Replace the SQLite database file with an uploaded one (admin only)."""
    from datetime import datetime
    import tempfile

    try:
        confirm = request.form.get('confirm')
        if confirm != 'TRANSFER':
            return jsonify({"error": "Confirmation required"}), 400

        upload = request.files.get('database')
        if not upload or not upload.filename:
            return jsonify({"error": "No database file provided"}), 400

        db_path, error = get_sqlite_db_path()
        if error:
            return jsonify({"error": error}), 400

        os.makedirs(os.path.dirname(db_path), exist_ok=True)

        temp_fd, temp_path = tempfile.mkstemp(suffix='.sqlite', dir=os.path.dirname(db_path))
        with os.fdopen(temp_fd, 'wb') as temp_file:
            upload.save(temp_file)

        with open(temp_path, 'rb') as temp_file:
            header = temp_file.read(16)
            if header != b'SQLite format 3\x00':
                os.remove(temp_path)
                return jsonify({"error": "Uploaded file is not a valid SQLite database"}), 400

        db.session.remove()
        db.engine.dispose()

        backup_path = None
        if os.path.exists(db_path):
            timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
            backup_path = f"{db_path}.bak-{timestamp}"
            os.replace(db_path, backup_path)

        os.replace(temp_path, db_path)

        return jsonify({
            "success": True,
            "message": "Database transferred successfully",
            "backup_path": backup_path
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/system/database", methods=['DELETE'])
@jwt_required()
@require_role(['admin'])
def delete_database():
    """Delete all database data but preserve admin users (admin only)."""
    try:
        data = request.get_json(silent=True) or {}
        if data.get('confirm') != 'DELETE':
            return jsonify({"error": "Confirmation required"}), 400

        admin_users = User.query.filter_by(role='admin').all()
        admin_ids = {admin.id for admin in admin_users}
        preserved_admins = []

        for admin in admin_users:
            preserved_admins.append({
                "id": admin.id,
                "username": admin.username,
                "email": admin.email,
                "password_hash": admin.password_hash,
                "role": admin.role,
                "is_active": admin.is_active,
                "created_at": admin.created_at,
                "created_by": admin.created_by if admin.created_by in admin_ids else None,
                "csv_delimiter": admin.csv_delimiter,
                "language": admin.language,
                "profile_picture_filename": admin.profile_picture_filename,
            })

        db.session.remove()
        db.drop_all()
        db.create_all()

        for admin_data in preserved_admins:
            admin = User(
                username=admin_data["username"],
                email=admin_data["email"],
                password_hash=admin_data["password_hash"],
                role=admin_data["role"],
                is_active=admin_data["is_active"],
                created_at=admin_data["created_at"],
                created_by=admin_data["created_by"],
                csv_delimiter=admin_data["csv_delimiter"],
                language=admin_data["language"],
                profile_picture_filename=admin_data["profile_picture_filename"],
            )
            admin.id = admin_data["id"]
            db.session.add(admin)

        db.session.commit()

        return jsonify({
            "success": True,
            "message": f"Database cleared. Preserved {len(preserved_admins)} admin user(s)."
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/system/git-pull", methods=['POST'])
@jwt_required()
@require_role(['admin'])
def git_pull():
    """Pull latest changes from GitHub repository"""
    import subprocess
    import os

    try:
        # Get the project root directory (parent of backend)
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # Run git pull origin master
        result = subprocess.run(
            ['git', 'pull', 'origin', 'master'],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            return jsonify({
                "success": True,
                "message": result.stdout.strip() or "Already up to date"
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": result.stderr.strip() or "Git pull failed"
            }), 500

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Git pull timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _ensure_avahi_config():
    """Ensure critical avahi settings haven't been reverted by package upgrades."""
    AVAHI_CONF = '/etc/avahi/avahi-daemon.conf'
    try:
        with open(AVAHI_CONF, 'r') as f:
            conf = f.read()
        fixes = [
            ('use-ipv6=yes', 'use-ipv6=no'),
            ('#publish-aaaa-on-ipv4=yes', 'publish-aaaa-on-ipv4=no'),
        ]
        changed = False
        for old, new in fixes:
            if old in conf:
                conf = conf.replace(old, new)
                changed = True
        if changed:
            subprocess.run(
                ['sudo', 'tee', AVAHI_CONF],
                input=conf, capture_output=True, text=True, timeout=5,
            )
            print(f"[HOSTNAME] Re-applied avahi safety settings")
    except Exception as e:
        print(f"[HOSTNAME] Warning: could not verify avahi config: {e}")


@app.route("/api/v1/system/hostname", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def get_hostname():
    """Get the current system hostname and active mDNS URLs (admin only)"""
    hostname = socket.gethostname()
    return jsonify({
        "hostname": hostname,
        "url": f"http://{hostname}.local:5173",
    })


@app.route("/api/v1/system/hostname", methods=['POST'])
@jwt_required()
@require_role(['admin'])
def set_hostname():
    """Set the system hostname and restart Avahi (admin only)"""

    data = request.get_json()
    hostname = data.get('hostname', '').strip() if data else ''

    # Validate: lowercase letters, numbers, hyphens; 1-63 chars; no leading/trailing hyphen
    if not hostname or not re.match(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$', hostname):
        return jsonify({
            "error": "Invalid hostname. Use only lowercase letters, numbers, and hyphens (max 63 characters, cannot start or end with a hyphen)."
        }), 400

    try:
        old_hostname = socket.gethostname()

        result = subprocess.run(
            ['sudo', 'hostnamectl', 'set-hostname', hostname],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return jsonify({"error": result.stderr.strip() or "Failed to set hostname"}), 500

        # Update /etc/hosts — replace existing 127.0.1.1 line, or append one
        try:
            with open('/etc/hosts', 'r') as f:
                hosts_content = f.read()

            if '127.0.1.1' in hosts_content:
                new_hosts = re.sub(
                    r'^127\.0\.1\.1\s+.*$',
                    f'127.0.1.1\t{hostname}',
                    hosts_content,
                    flags=re.MULTILINE,
                )
            else:
                new_hosts = hosts_content.rstrip('\n') + f'\n127.0.1.1\t{hostname}\n'

            subprocess.run(
                ['sudo', 'tee', '/etc/hosts'],
                input=new_hosts, capture_output=True, text=True, timeout=5,
            )
        except Exception as e:
            print(f"[HOSTNAME] Warning: failed to update /etc/hosts: {e}")

        # Ensure avahi safety settings survive package upgrades
        _ensure_avahi_config()

        # Restart avahi-daemon so it broadcasts the new base name
        result = subprocess.run(
            ['sudo', 'systemctl', 'restart', 'avahi-daemon'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            print(f"[HOSTNAME] avahi-daemon restart failed: {result.stderr}")

        # Send updated ipset to all connected Chimera devices
        from chimera_handler import ChimeraHandler
        display_url = f"http://{hostname}.local:5173"
        for handler in device_manager._active_handlers.values():
            if isinstance(handler, ChimeraHandler) and handler.connection and handler.connection.is_open:
                try:
                    handler.send_command(f"ipset {display_url}", timeout=2.0)
                except Exception:
                    pass

        return jsonify({
            "hostname": hostname,
            "url": f"http://{hostname}.local:5173",
        })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Hostname change timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/audit-logs", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def get_audit_logs():
    """
    Get audit logs (admin only).

    Query parameters:
        - limit: Max number of logs to return (default: 100)
        - offset: Number of logs to skip (default: 0)

    Returns:
        {
            "total": int,
            "logs": [
                {
                    "id": int,
                    "user_id": int,
                    "username": string,
                    "action": string,
                    "target_type": string,
                    "target_id": int,
                    "details": string,
                    "timestamp": ISO datetime string
                },
                ...
            ]
        }
    """
    try:
        limit = request.args.get('limit', 100, type=int)
        offset = request.args.get('offset', 0, type=int)

        # Validate pagination parameters
        limit = max(1, min(limit, 1000))  # Cap at 1000
        offset = max(0, offset)

        # Get total count
        total = AuditLog.query.count()

        # Get paginated logs with user info
        logs = db.session.query(AuditLog, User.username).outerjoin(
            User, AuditLog.user_id == User.id
        ).order_by(AuditLog.timestamp.desc()).limit(limit).offset(offset).all()

        logs_data = []
        for log, username in logs:
            logs_data.append({
                'id': log.id,
                'user_id': log.user_id,
                'username': username,
                'action': log.action,
                'target_type': log.target_type,
                'target_id': log.target_id,
                'details': log.details,
                'timestamp': log.timestamp.isoformat() if log.timestamp else None
            })

        return jsonify({
            'total': total,
            'logs': logs_data
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/audit-logs/download", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def download_audit_logs():
    """
    Download audit logs as CSV (admin only).

    Query parameters:
        - action: Filter by action type (optional)
        - target_type: Filter by target type (optional)
        - user_id: Filter by user ID (optional)

    Returns: CSV file
    """
    try:
        import io
        import csv
        from datetime import datetime
        from flask import send_file

        # Get filters from query parameters
        action_filter = request.args.get('action', None)
        target_type_filter = request.args.get('target_type', None)
        user_id_filter = request.args.get('user_id', None, type=int)

        # Build query
        query = db.session.query(AuditLog, User.username).outerjoin(
            User, AuditLog.user_id == User.id
        )

        # Apply filters
        if action_filter:
            query = query.filter(AuditLog.action == action_filter)
        if target_type_filter:
            query = query.filter(AuditLog.target_type == target_type_filter)
        if user_id_filter:
            query = query.filter(AuditLog.user_id == user_id_filter)

        # Order by timestamp descending
        logs = query.order_by(AuditLog.timestamp.desc()).all()

        if not logs:
            return jsonify({"error": "No audit logs found"}), 404

        # Get current user's CSV delimiter preference
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        csv_delimiter = user.csv_delimiter if user else ','

        # Create CSV
        csv_headers = [
            'Timestamp', 'User ID', 'Username', 'Action', 'Target Type',
            'Target ID', 'Details'
        ]

        output = io.StringIO()
        writer = csv.writer(output, delimiter=csv_delimiter)
        writer.writerow(csv_headers)

        for log, username in logs:
            writer.writerow([
                log.timestamp.isoformat() if log.timestamp else '',
                log.user_id or '',
                username or 'Unknown',
                log.action or '',
                log.target_type or '',
                log.target_id or '',
                log.details or ''
            ])

        # Create filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"audit_logs_{timestamp}.csv"

        return send_file(
            io.BytesIO(output.getvalue().encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=filename
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# App Settings Endpoints (Branding)

@app.route('/api/v1/app-settings', methods=['GET'])
def get_app_settings():
    """Get public app settings (company name and logo URL)."""
    try:
        company_name = os.environ.get('COMPANY_NAME', 'Anaero Technology')
        logo_filename = os.environ.get('LOGO_FILENAME', '')

        # Build logo URL only if a custom logo exists
        logo_url = None
        if logo_filename:
            logo_url = '/api/v1/app-settings/logo'

        return jsonify({
            'company_name': company_name,
            'logo_url': logo_url
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/app-settings', methods=['PUT'])
@jwt_required()
@require_role(['admin'])
def update_app_settings():
    """Update company name (admin only)."""
    try:
        data = request.get_json()

        if 'company_name' not in data:
            return jsonify({'error': 'company_name is required'}), 400

        company_name = data['company_name'].strip()
        if not company_name:
            return jsonify({'error': 'company_name cannot be empty'}), 400

        # Update environment variable
        os.environ['COMPANY_NAME'] = company_name

        # Update .env file
        env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
        with open(env_file, 'r') as f:
            contents = f.read()

        # Replace or append COMPANY_NAME
        pattern = r'^COMPANY_NAME=.*$'
        if re.search(pattern, contents, re.MULTILINE):
            contents = re.sub(pattern, f'COMPANY_NAME={company_name}', contents, flags=re.MULTILINE)
        else:
            contents += f'\nCOMPANY_NAME={company_name}'

        with open(env_file, 'w') as f:
            f.write(contents)

        return jsonify({'success': True, 'company_name': company_name})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/app-settings/logo', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def upload_logo():
    """Upload and save logo file (admin only)."""
    try:
        if 'logo' not in request.files:
            return jsonify({'error': 'No logo file provided'}), 400

        file = request.files['logo']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # Validate file extension
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        if file_ext not in allowed_extensions:
            return jsonify({'error': 'Invalid file type. Allowed: PNG, JPG, JPEG, GIF, WebP'}), 400

        # Check file size (max 2 MB)
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Seek back to start
        if file_size > 2 * 1024 * 1024:  # 2 MB
            return jsonify({'error': 'File too large. Max 2 MB'}), 400

        # Delete previous logo if it exists
        old_logo_filename = os.environ.get('LOGO_FILENAME', '')
        if old_logo_filename:
            old_logo_path = os.path.join(UPLOADS_DIR, old_logo_filename)
            if os.path.exists(old_logo_path):
                os.remove(old_logo_path)

        # Save new logo with secure filename
        filename = secure_filename(file.filename)
        # Add timestamp to ensure uniqueness
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_')
        filename = timestamp + filename

        file_path = os.path.join(UPLOADS_DIR, filename)
        file.save(file_path)

        # Update environment variable
        os.environ['LOGO_FILENAME'] = filename

        # Update .env file
        env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
        with open(env_file, 'r') as f:
            contents = f.read()

        # Replace or append LOGO_FILENAME
        pattern = r'^LOGO_FILENAME=.*$'
        if re.search(pattern, contents, re.MULTILINE):
            contents = re.sub(pattern, f'LOGO_FILENAME={filename}', contents, flags=re.MULTILINE)
        else:
            contents += f'\nLOGO_FILENAME={filename}'

        with open(env_file, 'w') as f:
            f.write(contents)

        return jsonify({'success': True, 'logo_url': '/api/v1/app-settings/logo'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/app-settings/logo', methods=['GET'])
def get_logo():
    """Serve the uploaded logo file."""
    try:
        logo_filename = os.environ.get('LOGO_FILENAME', '')

        if not logo_filename:
            return jsonify({'error': 'No custom logo set'}), 404

        logo_path = os.path.join(UPLOADS_DIR, logo_filename)
        if not os.path.exists(logo_path):
            return jsonify({'error': 'Logo file not found'}), 404

        return send_file(logo_path, mimetype='image/png')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/app-settings/logo', methods=['DELETE'])
@jwt_required()
@require_role(['admin'])
def delete_logo():
    """Remove the uploaded logo file (admin only)."""
    try:
        logo_filename = os.environ.get('LOGO_FILENAME', '')

        if logo_filename:
            logo_path = os.path.join(UPLOADS_DIR, logo_filename)
            if os.path.exists(logo_path):
                os.remove(logo_path)

        # Clear environment variable
        os.environ['LOGO_FILENAME'] = ''

        # Update .env file
        env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
        with open(env_file, 'r') as f:
            contents = f.read()

        # Clear LOGO_FILENAME value
        pattern = r'^LOGO_FILENAME=.*$'
        if re.search(pattern, contents, re.MULTILINE):
            contents = re.sub(pattern, 'LOGO_FILENAME=', contents, flags=re.MULTILINE)
        else:
            contents += '\nLOGO_FILENAME='

        with open(env_file, 'w') as f:
            f.write(contents)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Profile Picture Endpoints

@app.route('/api/v1/users/<int:user_id>/profile-picture', methods=['POST'])
@jwt_required()
def upload_profile_picture(user_id):
    """Upload profile picture for a user (user self or admin)."""
    try:
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)

        # Check permission: user own or admin
        if user_id != current_user_id and not (current_user and current_user.role == 'admin'):
            return jsonify({'error': 'Unauthorized'}), 403

        if 'profile_picture' not in request.files:
            return jsonify({'error': 'No profile picture file provided'}), 400

        file = request.files['profile_picture']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # Validate file extension
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        if file_ext not in allowed_extensions:
            return jsonify({'error': 'Invalid file type. Allowed: PNG, JPG, JPEG, GIF, WebP'}), 400

        # Check file size (max 2 MB)
        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        if file_size > 2 * 1024 * 1024:
            return jsonify({'error': 'File too large. Max 2 MB'}), 400

        # Get user
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        # Delete previous profile picture if exists
        if user.profile_picture_filename:
            old_pic_path = os.path.join(UPLOADS_DIR, user.profile_picture_filename)
            if os.path.exists(old_pic_path):
                os.remove(old_pic_path)

        # Save new profile picture with secure filename
        filename = secure_filename(file.filename)
        # Add timestamp and user_id to ensure uniqueness
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_')
        filename = f'profile_{user_id}_{timestamp}{filename}'

        file_path = os.path.join(UPLOADS_DIR, filename)
        file.save(file_path)

        # Update user in database
        user.profile_picture_filename = filename
        db.session.commit()

        return jsonify({'success': True, 'profile_picture_url': f'/api/v1/users/{user_id}/profile-picture'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/users/<int:user_id>/profile-picture', methods=['GET'])
def get_profile_picture(user_id):
    """Serve the profile picture file."""
    try:
        user = User.query.get(user_id)
        if not user or not user.profile_picture_filename:
            return jsonify({'error': 'Profile picture not found'}), 404

        pic_path = os.path.join(UPLOADS_DIR, user.profile_picture_filename)
        if not os.path.exists(pic_path):
            return jsonify({'error': 'Profile picture file not found'}), 404

        return send_file(pic_path, mimetype='image/png')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/v1/users/<int:user_id>/profile-picture', methods=['DELETE'])
@jwt_required()
def delete_profile_picture(user_id):
    """Delete profile picture for a user (user self or admin)."""
    try:
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)

        # Check permission: user own or admin
        if user_id != current_user_id and not (current_user and current_user.role == 'admin'):
            return jsonify({'error': 'Unauthorized'}), 403

        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        # Delete file if exists
        if user.profile_picture_filename:
            pic_path = os.path.join(UPLOADS_DIR, user.profile_picture_filename)
            if os.path.exists(pic_path):
                os.remove(pic_path)

        # Clear filename in database
        user.profile_picture_filename = None
        db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=6000)
