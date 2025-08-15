from flask import Flask, request, jsonify
from flask_cors import CORS
from database.models import *
import serial.tools.list_ports
from device_manager import DeviceManager
from config import Config
import atexit

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = Config.SQLALCHEMY_DATABASE_URI
CORS(app)  # Enable CORS for all routes
db.init_app(app)
device_manager = DeviceManager()

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
            # Use context manager to ensure proper cleanup
            with app.app_context():
                connected = device_manager.connect(port_info.device)
            
            if not connected:
                return
            
            device_type = device_manager.get_device_by_port(port_info.device).device_type
            if device_type in ['black-box', 'chimera']:
                with lock:
                    valid_devices.append({
                        "port": port_info.device,
                        "device_type": device_type,
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
        with app.app_context():
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
        with app.app_context():
            success = device_manager.disconnect_device(device_id)
        
        if success:
            return jsonify({"message": "Device disconnected successfully"}), 200
        else:
            return jsonify({"error": "Device not found or not connected"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/v1/devices/connected")
def list_connected_devices():
    """List all currently connected devices"""
    try:
        # Simply query the database for connected devices
        connected_devices = Device.query.filter_by(connected=True).all()
        
        devices_list = [{
            "id": device.id,
            "name": device.name,
            "device_type": device.device_type,
            "serial_port": device.serial_port,
            "mac_address": device.mac_address,
            "connected": device.connected,
            "logging": device.logging
        } for device in connected_devices]
        
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
from routes.black_box import black_box_bp
from routes.chimera import chimera_bp
app.register_blueprint(black_box_bp)
app.register_blueprint(chimera_bp)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=6000)
