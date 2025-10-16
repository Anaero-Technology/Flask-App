from flask import Blueprint, request, jsonify
from flask_sse import sse
from datetime import datetime
from device_manager import DeviceManager
from database.models import *

black_box_bp = Blueprint('black_box', __name__)
device_manager = DeviceManager()


@black_box_bp.route('/api/v1/black_box/connected', methods=['GET'])
def get_connected_black_boxes():
    """Get all connected BlackBox devices from database"""
    try:
        connected_black_boxes = Device.query.filter_by(
            device_type='black-box',
            connected=True
        ).all()
        
        devices_list = [{
            "device_id": device.id,
            "name": device.name,
            "port": device.serial_port,
            "mac_address": device.mac_address,
            "connected": device.connected,
            "logging": device.logging
        } for device in connected_black_boxes]
        
        return jsonify(devices_list)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/connect', methods=['POST'])
def connect_black_box(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found in database"}), 404
        
        if device.device_type != 'black-box':
            return jsonify({"error": "Device is not a black box"}), 400
        
        if device.connected:
            return jsonify({"error": "Device already connected"}), 400
        
        # Connect to the device (DeviceManager now handles DB updates)
        success = device_manager.connect_black_box(device_id, device.serial_port)
        if not success:
            return jsonify({"error": "Failed to connect to device"}), 500
        
        # Get the handler to return device info
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Handler not found after connection"}), 500
        
        return jsonify({
            "success": True,
            "device_id": device_id,
            "device_name": handler.device_name,
            "mac_address": handler.mac_address,
            "is_logging": handler.is_logging,
            "current_log_file": handler.current_log_file
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/disconnect', methods=['POST'])
def disconnect_black_box(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found in database"}), 404
        
        if not device.connected:
            return jsonify({"error": "Device not connected"}), 400
        
        # Disconnect device
        success = device_manager.disconnect_device(device_id)
        if success:
            device.connected = False
            db.session.commit()
            return jsonify({"success": True}), 200
        
        return jsonify({"error": "Failed to disconnect device"}), 500
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/start_logging', methods=['POST'])
def start_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        filename = data.get('filename')
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        
        # Handle test creation/linking
        test_id = data.get('test_id')
        test = None
        
        if test_id:
            # Use existing test
            test = Test.query.get(test_id)
            if not test:
                return jsonify({"error": "Test not found"}), 404
        else:
            # Create new test automatically
            test_name = data.get('test_name', f"BlackBox Log - {device.name} - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            test = Test(
                name=test_name,
                description=data.get('test_description', f"Auto-created test for BlackBox logging on {device.name}"),
                created_by=data.get('created_by', 'system'),
                date_created=datetime.now(),
                status='running',
                date_started=datetime.now()
            )
            db.session.add(test)
            db.session.flush()  # Get the ID without committing
        
        # Start logging on device
        success, message = handler.start_logging(filename)
        if success:
            # Link test to handler and device
            handler.set_test_id(test.id)
            device.logging = True
            device.active_test_id = test.id
            
            # Update test status if it was existing and in setup
            if test.status == 'setup':
                test.status = 'running'
                test.date_started = datetime.now()
            
            db.session.commit()
            
            return jsonify({
                "success": True,
                "message": message,
                "filename": filename,
                "test_id": test.id,
                "test_name": test.name
            })
        else:
            # If logging failed and we created a test, don't save it
            device.logging = False
            if not test_id:  # Only rollback if we created a new test
                db.session.rollback()
            return jsonify({
                "success": False,
                "message": message
            })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/stop_logging', methods=['POST'])
def stop_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, message = handler.stop_logging()
        if success:
            device.logging = False
            
            if device.active_test_id:
                test = Test.query.get(device.active_test_id)
                if test and test.status == 'running':
                    test.status = 'completed'
                    test.date_ended = datetime.now()
        
                # Clear test from device and handler
                device.active_test_id = None
                handler.set_test_id(None)
            
            db.session.commit()
            
            return jsonify({
                "success": True,
                "message": message
            })
        else:
            return jsonify({
                "success": False,
                "message": message
            })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/info', methods=['GET'])
def get_info(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        info = handler.get_info()
        
        return jsonify(info)
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/files', methods=['GET'])
def get_files(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        files_info = handler.get_files()
        
        return jsonify(files_info)
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/download', methods=['POST'])
def download_file(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        filename = data.get('filename')
        max_bytes = data.get('max_bytes')
        
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        
        success, lines = handler.download_file(filename, max_bytes)
        
        return jsonify({
            "success": success,
            "filename": filename,
            "data": lines if success else None,
            "error": lines[0] if not success and lines else None
        })
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/download_from', methods=['POST'])
def download_file_from(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        filename = data.get('filename')
        byte_from = data.get('byte_from', 0)
        
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        
        success, lines = handler.download_file_from(filename, byte_from)
        
        return jsonify({
            "success": success,
            "filename": filename,
            "byte_from": byte_from,
            "data": lines if success else None,
            "error": lines[0] if not success and lines else None
        })
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/delete_file', methods=['POST'])
def delete_file(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        filename = data.get('filename')
        
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        
        success, message = handler.delete_file(filename)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/time', methods=['GET'])
def get_time(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        timestamp = handler.get_time()
        
        return jsonify({
            "timestamp": timestamp,
            "success": timestamp is not None
        })
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/time', methods=['POST'])
def set_time(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        timestamp = data.get('timestamp')
        
        if not timestamp:
            return jsonify({"error": "timestamp is required (format: year,month,day,hour,minute,second)"}), 400
        
        success, message = handler.set_time(timestamp)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/name', methods=['POST'])
def set_name(device_id):
    try:
        # Get device from database
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
            db.session.commit()
        
        return jsonify({
            "success": success,
            "name": name if success else None
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/hourly_tips', methods=['GET'])
def get_hourly_tips(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, lines = handler.get_hourly_tips()
        
        return jsonify({
            "success": success,
            "data": lines if success else None,
            "error": lines[0] if not success and lines else None
        })
    
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/send_command', methods=['POST'])
def send_command(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        command = data.get('command')
        if not command:
            return jsonify({"error": "command is required"}), 400
        
        response = handler.send_command(command)
        
        return jsonify({
            "command": command,
            "response": response
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()

@black_box_bp.route('/api/v1/black_box/<int:device_id>/stream', methods=['GET'])
def stream(device_id):
    """SSE endpoint for real-time blackbox notifications for a specific device"""
    try:
        # Verify device exists and is connected
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found"}), 404
        
        if device.device_type != 'black-box':
            return jsonify({"error": "Device is not a black-box"}), 400
        
        # Check both database and device manager state
        if not device.connected:
            return jsonify({"error": "Device not connected in database"}), 400
            
        # Verify device manager has active handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not active"}), 400
        
        # Return SSE stream directly
        print(f"Starting SSE stream for device {device_id}")
        return sse.stream()
        
    finally:
        db.session.close()
