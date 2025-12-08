from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_sse import sse
from database.models import *
import serial.tools.list_ports
from device_manager import DeviceManager
from config import Config
import atexit
import threading

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = Config.SQLALCHEMY_DATABASE_URI
app.config["REDIS_URL"] = Config.REDIS_URL
CORS(app)  # Enable CORS for all routes
db.init_app(app)
device_manager = DeviceManager()
DeviceManager.set_app(app)  # Set app reference for db

# Create tables
with app.app_context():
    db.create_all()


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
        
        if result['success']:
            return jsonify(result), 200
        else:
            return jsonify(result), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/devices/disconnect/<string:port>", methods=['POST'])
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


# Register blueprints
@app.route("/api/v1/samples", methods=['POST'])
def create_sample():
    """Create a new sample"""
    try:
        from datetime import datetime
        data = request.get_json()

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
            author=data.get('author'),
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
def list_substrate_samples():
    """Get all samples (substrates only, not inoculums)"""
    try:
        # Only return non-inoculum samples for substrate selection
        samples = Sample.query.filter_by(is_inoculum=False).all()
        return jsonify([{
            "id": sample.id,
            "sample_name": sample.sample_name,
            "substrate_source": sample.substrate_source,
            "description": sample.description,
            "substrate_type": sample.substrate_type,
            "author": sample.author,
            "date_created": sample.date_created.isoformat() if sample.date_created else None
        } for sample in samples])
    except Exception as e:
        db.session.rollback()
        print(f"Error fetching samples: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/inoculum", methods=['GET'])
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

        return jsonify({
            "success": True,
            "message": "Sample updated successfully"
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/samples/<int:sample_id>", methods=['DELETE'])
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
def create_test():
    """Create a new test"""
    try:
        from datetime import datetime
        data = request.get_json()
        
        if not data.get('name'):
            return jsonify({"error": "Test name is required"}), 400
        
        test = Test(
            name=data.get('name'),
            description=data.get('description'),
            created_by=data.get('created_by'),
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
                "notes": config.notes
            } for config in configurations]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests/<int:test_id>/start", methods=['POST'])
def start_test(test_id):
    """Start a test and assign it to devices, initiating logging"""
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
                # First get current timing to preserve open_time
                success, current_timing, _ = chimera_handler.get_timing()
                current_open_time_ms = current_timing.get('open_time_ms', 600000) if success else 600000
                flush_time_ms = int(chimera_config.flush_time_seconds * 1000)
                success, msg = chimera_handler.set_timing(current_open_time_ms, flush_time_ms)
                print(f"[DEBUG] Chimera timing set: open={current_open_time_ms}ms, flush={flush_time_ms}ms - {msg}")

                # 2. Set service sequence (which channels are in service)
                success, msg = chimera_handler.set_service(chimera_config.service_sequence)
                print(f"[DEBUG] Chimera service sequence set to {chimera_config.service_sequence} - {msg}")

                # 3. Set per-channel timing for all in-service channels
                channel_configs = ChimeraChannelConfiguration.query.filter_by(
                    chimera_config_id=chimera_config.id
                ).all()
                for channel_cfg in channel_configs:
                    success, msg = chimera_handler.set_channel_timing(
                        channel_cfg.channel_number,
                        channel_cfg.open_time_seconds
                    )
                    print(f"[DEBUG] Chimera channel {channel_cfg.channel_number} timing set to {channel_cfg.open_time_seconds}s - {msg}")

                # 4. Set recirculation mode 
                # Map mode: 'volume' -> 2, 'periodic' -> 1, 'off' -> 0
                mode_map = {'off': 0, 'periodic': 1, 'volume': 2}
                chimera_mode = mode_map.get(chimera_config.recirculation_mode, 0)
                print(chimera_handler.set_recirculate(chimera_mode))
                print(f"[DEBUG] Chimera recirculation mode set to {chimera_mode} ({chimera_config.recirculation_mode})")

                # If periodic mode, also set the schedule
                if chimera_config.recirculation_mode == 'periodic':
                    if chimera_config.recirculation_days:
                        chimera_handler.set_recirculation_days(chimera_config.recirculation_days)
                    if chimera_config.recirculation_hour is not None:
                        chimera_handler.set_recirculation_time(
                            chimera_config.recirculation_hour,
                            chimera_config.recirculation_minute or 0
                        )

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

        # Update test status
        test.status = 'running'
        test.date_started = datetime.now()

        # Start logging on each device
        logging_results = []
        for device_id in all_device_ids:
            device = Device.query.get(device_id)
            handler = device_manager.get_device(device_id)

            if not handler:
                db.session.rollback()
                return jsonify({"error": f"Handler not found for device {device.name}"}), 500

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
                    db.session.rollback()
                    return jsonify({"error": f"Failed to start logging on {device.name}: {message}"}), 500

                logging_results.append({
                    "device": device.name,
                    "filename": filename,
                    "message": message
                })

            elif device.device_type in ['chimera', 'chimera-max']:
                print(f"[DEBUG] Starting Chimera logging for device {device.name} (ID: {device.id})")

                # Generate filename - similar to BlackBox but with 25 char limit
                import re
                
                # Clean test name: only letters, numbers, and underscores
                clean_test_name = re.sub(r'[^a-zA-Z0-9_]', '', test.name.replace(' ', '_'))[:10]
                # Clean device name
                clean_device_name = re.sub(r'[^a-zA-Z0-9_]', '', device.name.replace(' ', '_'))[:5]
                # Short timestamp
                timestamp = datetime.now().strftime('%m%d%H%M')  # MMDDHHMM (8 chars)
                
                # Format: testname_dev_timestamp
                filename = f"{clean_test_name}_{clean_device_name}_{timestamp}"
                
                # Truncate to 25 chars max
                if len(filename) > 25:
                    filename = filename[:25]
                
                print(f"[DEBUG] Generated Chimera filename: '{filename}' (length: {len(filename)})")
                    
                success, message = handler.start_logging(filename)
                print(f"[DEBUG] Chimera start_logging result: success={success}, message={message}")

                if not success:
                    db.session.rollback()
                    return jsonify({"error": f"Failed to start logging on {device.name}: {message}"}), 500

                logging_results.append({
                    "device": device.name,
                    "message": message
                })

            # Set test ID on handler and update device
            handler.set_test_id(test_id)
            device.active_test_id = test_id
            device.logging = True

        db.session.commit()

        return jsonify({
            "success": True,
            "message": f"Test started with {len(all_device_ids)} devices",
            "logging_results": logging_results
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests/<int:test_id>/stop", methods=['POST'])
def stop_test(test_id):
    """Stop a test and stop logging on all associated devices"""
    try:
        from datetime import datetime
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        # Get all devices involved in this test
        devices = Device.query.filter_by(active_test_id=test_id).all()

        # Stop logging on each device
        stop_results = []
        for device in devices:
            handler = device_manager.get_device(device.id)
            if handler and handler.is_logging:
                success, message = handler.stop_logging()
                stop_results.append({
                    "device": device.name,
                    "success": success,
                    "message": message
                })
                if success:
                    device.logging = False

            # Remove test assignment
            device.active_test_id = None

        # Update test status
        test.status = 'completed'
        test.date_ended = datetime.now()

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
def create_channel_configuration(test_id):
    """Create or update channel configurations for a test"""
    try:
        data = request.get_json()
        configurations = data.get('configurations', [])
        
        if not configurations:
            return jsonify({"error": "No configurations provided"}), 400
        
        created_configs = []
        for config_data in configurations:
            # Check if configuration already exists
            existing = ChannelConfiguration.query.filter_by(
                test_id=test_id,
                device_id=config_data['device_id'],
                channel_number=config_data['channel_number']
            ).first()
            
            if existing:
                # Update existing
                existing.inoculum_sample_id = config_data['inoculum_sample_id']
                existing.inoculum_weight_grams = config_data['inoculum_weight_grams']
                existing.substrate_sample_id = config_data.get('substrate_sample_id')
                existing.substrate_weight_grams = config_data.get('substrate_weight_grams', 0)
                existing.tumbler_volume = config_data['tumbler_volume']
                existing.chimera_channel = config_data.get('chimera_channel')
                existing.notes = config_data.get('notes')
                created_configs.append(existing)
            else:
                # Create new
                config = ChannelConfiguration(
                    test_id=test_id,
                    device_id=config_data['device_id'],
                    channel_number=config_data['channel_number'],
                    inoculum_sample_id=config_data['inoculum_sample_id'],
                    inoculum_weight_grams=config_data['inoculum_weight_grams'],
                    substrate_sample_id=config_data.get('substrate_sample_id'),
                    substrate_weight_grams=config_data.get('substrate_weight_grams', 0),
                    tumbler_volume=config_data['tumbler_volume'],
                    chimera_channel=config_data.get('chimera_channel'),
                    notes=config_data.get('notes')
                )
                db.session.add(config)
                created_configs.append(config)
        
        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": f"Created/updated {len(created_configs)} channel configurations"
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


@app.route("/api/v1/tests/<int:test_id>/chimera-configuration", methods=['POST'])
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

        if existing:
            # Update existing
            existing.flush_time_seconds = data.get('flush_time_seconds', 30.0)
            existing.recirculation_mode = data.get('recirculation_mode', 'off')
            existing.recirculation_days = data.get('recirculation_days')
            existing.recirculation_hour = data.get('recirculation_hour')
            existing.recirculation_minute = data.get('recirculation_minute')
            existing.service_sequence = data.get('service_sequence', '111111111111111')
            chimera_config = existing
        else:
            # Create new
            chimera_config = ChimeraConfiguration(
                test_id=test_id,
                device_id=device_id,
                flush_time_seconds=data.get('flush_time_seconds', 30.0),
                recirculation_mode=data.get('recirculation_mode', 'off'),
                recirculation_days=data.get('recirculation_days'),
                recirculation_hour=data.get('recirculation_hour'),
                recirculation_minute=data.get('recirculation_minute'),
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
        
        if not file.filename.endswith('.csv'):
            return jsonify({"error": "File must be a CSV"}), 400
        
        # Read and parse CSV
        stream = io.StringIO(file.stream.read().decode("UTF8"), newline=None)
        csv_reader = csv.DictReader(stream)
        
        configurations = []
        channel_number = 1  # Start from channel 1
        for row_num, row in enumerate(csv_reader, start=1):
            try:
                # Get sample description (should be a string)
                sample_description = row.get('Sample description', '').strip()

                # Check if we've reached the "End of data" marker
                if sample_description == 'End of data':
                    break

                # Skip empty rows
                if not sample_description:
                    continue

                # Parse CSV columns based on the format:
                # Sample description,In service,Inoculum only,Inoculum mass VS (g),Sample mass VS (g),Tumbler volume (ml),Chimera channel (optional)
                in_service = int(row['In service']) == 1
                inoculum_only = int(row['Inoculum only']) == 1
                inoculum_weight = float(row['Inoculum mass VS (g)'])
                substrate_weight = 0 if inoculum_only else float(row['Sample mass VS (g)'])
                tumbler_volume = float(row['Tumbler volume (ml)'])

                # Parse optional Chimera channel column
                chimera_channel = None
                chimera_column_key = None
                # Try different possible column names
                for key in ['Chimera channel', 'Chimera Channel', 'chimera_channel', 'chimera channel']:
                    if key in row:
                        chimera_column_key = key
                        break

                if chimera_column_key and row[chimera_column_key].strip():
                    try:
                        chimera_val = int(row[chimera_column_key].strip())
                        if 1 <= chimera_val <= 15:
                            chimera_channel = chimera_val
                    except ValueError:
                        pass  # Invalid value, keep as None

                # Only include channels that are in service
                if in_service:
                    configurations.append({
                        'channel_number': channel_number,
                        'inoculum_weight_grams': inoculum_weight,
                        'substrate_weight_grams': substrate_weight,
                        'tumbler_volume': tumbler_volume,
                        'is_control': inoculum_only,
                        'chimera_channel': chimera_channel,
                        'notes': sample_description  # Store sample description in notes
                    })
                    channel_number += 1  # Increment channel number for next in-service row
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
def delete_test(test_id):
    """Delete a test and all associated data"""
    try:
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        if test.status == 'running':
            return jsonify({"error": "Cannot delete a running test. Stop it first."}), 400

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

        return jsonify({"success": True, "message": "Test deleted successfully"}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/tests/<int:test_id>/download", methods=['GET'])
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

        if not has_bb_events and not has_bb_raw and not has_chimera:
             return jsonify({"error": "No data found for this test"}), 404

        # Helper to create CSV string
        def create_csv_string(header, rows, row_mapper):
            output = io.StringIO()
            writer = csv.writer(output)
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
                    csv_data = create_csv_string(bb_event_header, bb_events, map_bb_event)
                    zf.writestr(f"{test.name}_gfm_events.csv", csv_data)
                
                if has_bb_raw:
                    csv_data = create_csv_string(bb_raw_header, bb_raw, map_bb_raw)
                    zf.writestr(f"{test.name}_gfm_raw.csv", csv_data)

                if has_chimera:
                    csv_data = create_csv_string(chimera_header, chimera_data, map_chimera)
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
            csv_content = create_csv_string(bb_event_header, bb_events, map_bb_event)
            return send_file(
                io.BytesIO(csv_content.encode()),
                mimetype='text/csv',
                as_attachment=True,
                download_name=f"{test.name}_gfm_events.csv"
            )
        
        elif has_bb_raw:
             # Return BlackBox Raw CSV
            csv_content = create_csv_string(bb_raw_header, bb_raw, map_bb_raw)
            return send_file(
                io.BytesIO(csv_content.encode()),
                mimetype='text/csv',
                as_attachment=True,
                download_name=f"{test.name}_gfm_raw.csv"
            )

        elif has_chimera:
             # Return Chimera CSV
            csv_content = create_csv_string(chimera_header, chimera_data, map_chimera)
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
app.register_blueprint(black_box_bp)
app.register_blueprint(chimera_bp)
app.register_blueprint(wifi_bp)
app.register_blueprint(data_bp)
app.register_blueprint(sse, url_prefix='/stream')


@app.route("/api/v1/system/git-pull", methods=['POST'])
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

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=6000)
