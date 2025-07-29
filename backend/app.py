from flask import Flask, request, jsonify
from database.models import *
from sqlalchemy import Column, String, Integer, Boolean
import serial.tools.list_ports
from config import Config

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = Config.SQLALCHEMY_DATABASE_URI
db.init_app(app)

# Create tables
with app.app_context():
    db.create_all()

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


@app.route("/api/v1/devices", methods=['POST'])
def register_device():
    """Register a new device by connecting and calling info"""
    try:
        data = request.get_json()
        
        # Only serial_port is required
        if not data.get('serial_port'):
            return jsonify({"error": "serial_port is required"}), 400
        
        # Check if device already exists on this port
        existing = Device.query.filter_by(serial_port=data.get('serial_port')).first()
        if existing:
            return jsonify({"error": f"Device already registered on port {data.get('serial_port')}"}), 409
        
        # Connect to device to get info
        device_type = data.get('device_type')
        temp_handler = None
        
        try:
            if device_type == 'black_box':
                from black_box_handler import BlackBoxHandler
                temp_handler = BlackBoxHandler(data.get('serial_port'))
            elif device_type == 'chimera':
                from chimera_handler import ChimeraHandler
                temp_handler = ChimeraHandler(data.get('serial_port'))
            else:
                # Try to auto-detect device type
                # Try black box first
                try:
                    from black_box_handler import BlackBoxHandler
                    temp_handler = BlackBoxHandler(data.get('serial_port'))
                    temp_handler.connect()
                    info = temp_handler.get_info()
                    device_type = 'black_box'
                except Exception:
                    temp_handler.disconnect() if temp_handler else None
                    # Try chimera
                    try:
                        from chimera_handler import ChimeraHandler
                        temp_handler = ChimeraHandler(data.get('serial_port'))
                        temp_handler.connect()
                        info = temp_handler.get_info()
                        device_type = 'chimera'
                    except Exception:
                        return jsonify({"error": "Could not determine device type. Please specify device_type parameter."}), 400
            
            if temp_handler and not temp_handler.is_connected:
                temp_handler.connect()
            
            info = temp_handler.get_info()
            
            # Get device name - either from POST request or from device
            device_name = data.get('name') or info.get('device_name')
            if not device_name:
                temp_handler.disconnect()
                return jsonify({"error": "Device name not provided and could not be retrieved from device"}), 400
            
            # Get MAC address from device
            mac_address = info.get('mac_address')
            
            temp_handler.disconnect()
            
        except Exception as e:
            if temp_handler:
                temp_handler.disconnect()
            return jsonify({"error": f"Failed to connect to device: {str(e)}"}), 400
        
        # Create device record
        db_device = Device(
            name=device_name,
            device_type=device_type,
            serial_port=data.get('serial_port'),
            mac_address=mac_address,
            connected=False,
            logging=False
        )
        
        db.session.add(db_device)
        db.session.commit()
        db.session.refresh(db_device)
        
        return jsonify({
            "id": db_device.id,
            "name": db_device.name,
            "device_type": db_device.device_type,
            "serial_port": db_device.serial_port,
            "mac_address": db_device.mac_address,
            "logging": db_device.logging,
            "connected": db_device.connected
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
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
        if not device:
            return jsonify({"error": "Device not found"}), 404
        
        data = request.get_json()
        
        # Update allowed fields
        if 'name' in data:
            device.name = data['name']
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


@app.route("/api/v1/devices/connected")
def list_connected_devices():
    """Get status of all connected devices from DeviceManager"""
    from device_manager import DeviceManager
    device_manager = DeviceManager()
    return jsonify(device_manager.list_devices())


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
            if data.get('device_type') == 'black_box':
                from black_box_handler import BlackBoxHandler
                temp_handler = BlackBoxHandler(data.get('serial_port'))
                temp_handler.connect()
                info = temp_handler.get_info()
                device_info = {
                    "device_type": "black_box",
                    "port": data.get('serial_port'),
                    "device_name": info.get('device_name'),
                    "mac_address": info.get('mac_address'),
                    "is_logging": info.get('is_logging'),
                    "current_log_file": info.get('current_log_file')
                }
            elif data.get('device_type') == 'chimera':
                from chimera_handler import ChimeraHandler
                temp_handler = ChimeraHandler(data.get('serial_port'))
                temp_handler.connect()
                info = temp_handler.get_info()
                device_info = {
                    "device_type": "chimera",
                    "port": data.get('serial_port'),
                    "device_name": info.get('device_name'),
                    "mac_address": info.get('mac_address'),
                    "is_logging": info.get('is_logging'),
                    "current_channel": info.get('current_channel'),
                    "seconds_elapsed": info.get('seconds_elapsed')
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
from routes.black_box import black_box_bp
from routes.chimera import chimera_bp
app.register_blueprint(black_box_bp)
app.register_blueprint(chimera_bp)
