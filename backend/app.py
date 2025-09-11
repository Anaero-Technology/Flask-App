from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_sse import sse
from database.models import *
import serial.tools.list_ports
from device_manager import DeviceManager
from config import Config
import atexit

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
@app.route("/api/v1/samples", methods=['POST'])
def create_sample():
    """Create a new sample with associated inoculum data"""
    try:
        from datetime import datetime
        data = request.get_json()
        
        # Create inoculum record if data is provided
        inoculum = None
        if any([data.get('inoculum_source'), data.get('inoculum_percent_ts'), data.get('inoculum_percent_vs')]):
            inoculum = InoculumSample(
                inoculum_source=data.get('inoculum_source'),
                inoculum_percent_ts=float(data.get('inoculum_percent_ts')) if data.get('inoculum_percent_ts') else None,
                inoculum_percent_vs=float(data.get('inoculum_percent_vs')) if data.get('inoculum_percent_vs') else None,
                date_created=datetime.now()
            )
            db.session.add(inoculum)
            db.session.flush()  # Get the ID without committing
        
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
            other=data.get('other'),
            reactor=data.get('reactor'),
            temperature=float(data.get('temperature')) if data.get('temperature') else None,
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
def list_samples():
    """Get all samples"""
    try:
        samples = Sample.query.all()
        return jsonify([{
            "id": sample.id,
            "sample_name": sample.sample_name,
            "substrate_source": sample.substrate_source,
            "description": sample.description,
            "substrate_type": sample.substrate_type,
            "author": sample.author,
            "date_created": sample.date_created.isoformat() if sample.date_created else None,
            "temperature": sample.temperature
        } for sample in samples])
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/inoculum", methods=['POST'])
def create_inoculum():
    """Create a new inoculum record"""
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('inoculum_source'):
            return jsonify({"error": "inoculum_source is required"}), 400
        
        # Create inoculum record
        from datetime import datetime
        inoculum = InoculumSample(
            inoculum_source=data.get('inoculum_source'),
            inoculum_percent_ts=float(data.get('inoculum_percent_ts')) if data.get('inoculum_percent_ts') else None,
            inoculum_percent_vs=float(data.get('inoculum_percent_vs')) if data.get('inoculum_percent_vs') else None,
            date_created=datetime.now()
        )
        
        db.session.add(inoculum)
        db.session.commit()
        
        return jsonify({
            "success": True,
            "inoculum_id": inoculum.id,
            "message": "Inoculum created successfully"
        }), 201
        
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": f"Invalid number format: {str(e)}"}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/inoculum", methods=['GET'])
def list_inoculum():
    """Get all inoculum records"""
    try:
        inoculum_records = InoculumSample.query.all()
        return jsonify([{
            "id": inoculum.id,
            "date_created": inoculum.date_created.isoformat() if inoculum.date_created else None,
            "inoculum_source": inoculum.inoculum_source,
            "inoculum_percent_ts": inoculum.inoculum_percent_ts,
            "inoculum_percent_vs": inoculum.inoculum_percent_vs
        } for inoculum in inoculum_records])
    except Exception as e:
        return jsonify({"error": str(e)}), 400

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

@app.route("/api/v1/inoculum/<int:inoculum_id>", methods=['PUT'])
def update_inoculum(inoculum_id):
    """Update an existing inoculum"""
    try:
        inoculum = InoculumSample.query.get(inoculum_id)
        if not inoculum:
            return jsonify({"error": "Inoculum not found"}), 404

        data = request.get_json()
        
        # Update fields
        if 'inoculum_source' in data:
            inoculum.inoculum_source = data['inoculum_source']
        if 'inoculum_percent_ts' in data:
            inoculum.inoculum_percent_ts = float(data['inoculum_percent_ts']) if data['inoculum_percent_ts'] else None
        if 'inoculum_percent_vs' in data:
            inoculum.inoculum_percent_vs = float(data['inoculum_percent_vs']) if data['inoculum_percent_vs'] else None

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Inoculum updated successfully"
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/inoculum/<int:inoculum_id>", methods=['DELETE'])
def delete_inoculum(inoculum_id):
    """Delete an inoculum"""
    try:
        inoculum = InoculumSample.query.get(inoculum_id)
        if not inoculum:
            return jsonify({"error": "Inoculum not found"}), 404

        db.session.delete(inoculum)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Inoculum deleted successfully"
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
        tests = Test.query.all()
        return jsonify([{
            "id": test.id,
            "name": test.name,
            "description": test.description,
            "created_by": test.created_by,
            "date_created": test.date_created.isoformat() if test.date_created else None,
            "date_started": test.date_started.isoformat() if test.date_started else None,
            "date_ended": test.date_ended.isoformat() if test.date_ended else None,
            "status": test.status
        } for test in tests])
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
    """Start a test and assign it to devices"""
    try:
        from datetime import datetime
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404
        
        if test.status != 'setup':
            return jsonify({"error": "Test must be in setup status to start"}), 400
        
        # Get all devices involved in this test
        configurations = ChannelConfiguration.query.filter_by(test_id=test_id).all()
        device_ids = list(set([config.device_id for config in configurations]))
        
        # Update test status
        test.status = 'running'
        test.date_started = datetime.now()
        
        # Assign test to devices
        for device_id in device_ids:
            device = Device.query.get(device_id)
            if device:
                device.active_test_id = test_id
        
        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": f"Test started with {len(device_ids)} devices"
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400

@app.route("/api/v1/tests/<int:test_id>/stop", methods=['POST'])
def stop_test(test_id):
    """Stop a test"""
    try:
        from datetime import datetime
        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404
        
        # Update test status
        test.status = 'completed'
        test.date_ended = datetime.now()
        
        # Remove test from devices
        devices = Device.query.filter_by(active_test_id=test_id).all()
        for device in devices:
            device.active_test_id = None
        
        db.session.commit()
        
        return jsonify({
            "success": True,
            "message": "Test stopped successfully"
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
        for row_num, row in enumerate(csv_reader, start=1):
            try:
                # Check if we've reached the "End of data" marker
                sample_description = row.get('Sample description', '').strip()
                if sample_description == 'End of data':
                    break
                
                # Skip empty rows or rows with non-numeric sample descriptions
                if not sample_description or not sample_description.isdigit():
                    continue
                
                # Parse CSV columns based on the format:
                # Sample description,In service,Inoculum only,Inoculum mass VS (g),Sample mass VS (g),Tumbler volume (ml)
                channel_number = int(sample_description)
                in_service = int(row['In service']) == 1
                inoculum_only = int(row['Inoculum only']) == 1
                inoculum_weight = float(row['Inoculum mass VS (g)'])
                substrate_weight = 0 if inoculum_only else float(row['Sample mass VS (g)'])
                tumbler_volume = float(row['Tumbler volume (ml)'])
                
                # Only include channels that are in service
                if in_service:
                    configurations.append({
                        'channel_number': channel_number,
                        'inoculum_weight_grams': inoculum_weight,
                        'substrate_weight_grams': substrate_weight,
                        'tumbler_volume': tumbler_volume,
                        'is_control': inoculum_only,
                        'notes': f"Imported from CSV - {'Control (inoculum only)' if inoculum_only else 'Test sample'}"
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


from routes.black_box import black_box_bp
from routes.chimera import chimera_bp
app.register_blueprint(black_box_bp)
app.register_blueprint(chimera_bp)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=6000)
