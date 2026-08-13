from flask import Blueprint, request, jsonify, current_app
from flask_sse import sse
from flask_jwt_extended import jwt_required
from datetime import datetime
import hashlib
import os
import threading
import time
from device_manager import DeviceManager
from database.models import *
from utils.auth import require_role, check_stream_token
from utils.errors import internal_error

black_box_bp = Blueprint('black_box', __name__)
device_manager = DeviceManager()


@black_box_bp.route('/api/v1/black_box/connected', methods=['GET'])
@jwt_required()
def get_connected_black_boxes():
    """Get all connected BlackBox devices from database"""
    try:
        connected_black_boxes = Device.query.filter_by(
            device_type='black-box',
            connected=True
        ).all()

        devices_list = []
        for device in connected_black_boxes:
            device_data = {
                "device_id": device.id,
                "name": device.name,
                "port": device.serial_port,
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
        return internal_error(e)
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/connect', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
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
        return internal_error(e)
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/disconnect', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
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
        return internal_error(e)
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/start_logging', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def start_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Check if device is already part of an active test
        if device.active_test_id:
            test = Test.query.get(device.active_test_id)
            if test and test.status == 'running':
                return jsonify({
                    "error": f"Cannot start logging. Device is already part of active test '{test.name}'. Please stop the test first."
                }), 400

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
        return internal_error(e)
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/stop_logging', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def stop_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Check if device is part of an active test
        if device.active_test_id:
            test = Test.query.get(device.active_test_id)
            if test and test.status == 'running':
                return jsonify({
                    "error": f"Cannot stop logging. Device is part of active test '{test.name}'. Please stop the test first."
                }), 400

        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        success, message = handler.stop_logging()
        if success:
            device.logging = False

            # Clear any residual test assignment (in case test is not running)
            if device.active_test_id:
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
        return internal_error(e)
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/info', methods=['GET'])
@jwt_required()
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
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def get_files(device_id):
    try:
        started_at = time.perf_counter()
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        files_info = handler.get_files()
        elapsed_ms = (time.perf_counter() - started_at) * 1000.0
        if elapsed_ms > 1500:
            file_count = len(files_info.get("files", []))
            print(f"[BLACKBOX FILES] Slow file list: device_id={device_id} elapsed_ms={elapsed_ms:.1f} files={file_count}")
        
        return jsonify(files_info)
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/download', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
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
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
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
@jwt_required()
@require_role(['admin', 'operator'])
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
@jwt_required()
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
        
        success, dt = handler.get_time()
        
        return jsonify({
            "success": success,
            "datetime": dt
        })
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/time', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
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
        
        success, message = handler.set_time()
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/name', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
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
        return internal_error(e)
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/hourly_tips', methods=['GET'])
@jwt_required()
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
@jwt_required()
@require_role(['admin', 'operator'])
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
        return internal_error(e)
    finally:
        db.session.close()

@black_box_bp.route('/api/v1/black_box/<int:device_id>/stream', methods=['GET'])
def stream(device_id):
    """SSE endpoint for real-time blackbox notifications for a specific device.

    Authenticated via short-lived ?token= (see /api/v1/auth/stream-token)
    because EventSource cannot send Authorization headers - the same check the
    chimera and plc streams use. flask-sse serves every event on one channel,
    so an unauthenticated reader here would see the whole fleet's traffic.
    """
    auth_error = check_stream_token()
    if auth_error:
        return auth_error
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


# --- Firmware update ---------------------------------------------------------
# The black box's ESP32 takes the same style of over-serial update as the
# chimera, but its firmware spells the commands "startUpdate"/"firmwareHash".
# Progress is published on this blueprint's per-device SSE stream, which is
# already in the unbuffered nginx location block.

BUNDLED_FIRMWARE_PATH = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', '..', 'firmware', 'blackbox', 'firmware.bin'
))


def _load_bundled_firmware():
    """Read the repo-bundled firmware.bin and derive its expected device hash.

    esptool appends a SHA-256 digest as the final 32 bytes of the image, and
    that is exactly what the device's firmwareHash command reports (it returns
    esp_partition_get_sha256 of the running OTA partition) - so the expected
    hash IS those 32 bytes, validated here by recomputing sha256(image minus
    digest).

    Returns (data, hash_hex, error_reason); data is None when unavailable.
    """
    if not os.path.isfile(BUNDLED_FIRMWARE_PATH):
        return None, None, 'no_bundled'
    with open(BUNDLED_FIRMWARE_PATH, 'rb') as f:
        data = f.read()
    if len(data) < 33 or data[0] != 0xE9:
        return None, None, 'invalid_bundle'
    appended_digest = data[-32:]
    if hashlib.sha256(data[:-32]).digest() != appended_digest:
        return None, None, 'invalid_bundle'
    return data, appended_digest.hex(), None


def _firmware_update_preflight(device_id):
    """Shared validation for the firmware update routes.

    Returns (handler, error_response); exactly one is None.
    """
    device = Device.query.get(device_id)
    if not device or not device.connected:
        return None, (jsonify({"error": "Device not found or not connected"}), 404)

    if device.device_type != 'black-box':
        return None, (jsonify({"error": "Device is not a black-box"}), 400)

    handler = device_manager.get_black_box(device_id)
    if not handler:
        return None, (jsonify({"error": "Device handler not found"}), 404)

    if device.active_test_id:
        test = Test.query.get(device.active_test_id)
        if test and test.status == 'running':
            return None, (jsonify({
                "error": "Cannot update firmware while a test is running on this device"
            }), 409)

    if handler.is_logging:
        return None, (jsonify({"error": "Cannot update firmware while the device is logging"}), 409)

    if getattr(handler, 'firmware_update_in_progress', False):
        return None, (jsonify({"error": "A firmware update is already in progress"}), 409)

    return handler, None


def _launch_firmware_update(handler, device_id, firmware_data):
    """Start the background flash thread; caller must have run preflight."""
    handler.firmware_update_in_progress = True
    app = current_app._get_current_object()

    def run_update():
        try:
            with app.app_context():
                last_percent = [-1]

                def progress(sent, total):
                    percent = int(sent * 100 / total)
                    if percent == last_percent[0]:
                        return
                    last_percent[0] = percent
                    try:
                        sse.publish({
                            "device_id": device_id,
                            "sent": sent,
                            "total": total,
                            "percent": percent,
                            # 100% only fires after the serial flush, so
                            # from there the device is flashing/rebooting
                            "phase": "verifying" if sent >= total else "transferring"
                        }, type='black_box_firmware_progress')
                    except Exception:
                        pass

                success, message = handler.update_firmware(firmware_data, progress_cb=progress)
                print(f"[BLACK BOX FIRMWARE] Device {device_id}: success={success} - {message}")
                try:
                    sse.publish({
                        "device_id": device_id,
                        "success": success,
                        "message": message
                    }, type='black_box_firmware_complete')
                except Exception:
                    pass
        finally:
            handler.firmware_update_in_progress = False

    threading.Thread(
        target=run_update,
        daemon=True,
        name=f"BlackBoxFirmwareUpdate-{device_id}"
    ).start()


def _validate_firmware_image(firmware_data):
    """Size/magic sanity checks shared by the upload route. Returns an error
    string, or None when the image looks like a flashable ESP32 build."""
    if len(firmware_data) < 100 * 1024 or len(firmware_data) > 8 * 1024 * 1024:
        return "Firmware file size looks wrong (expected 100KB-8MB)"
    # Every ESP32 app image starts with the 0xE9 magic byte; catches uploads
    # of the wrong file before anything is sent to the device.
    if firmware_data[0] != 0xE9:
        return "Not a valid ESP32 firmware image"
    return None


@black_box_bp.route('/api/v1/black_box/<int:device_id>/firmware_check', methods=['GET'])
@jwt_required()
def firmware_check(device_id):
    """Compare the repo-bundled firmware.bin against the device's running
    firmware (via the firmwareHash serial command)."""
    try:
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        if device.device_type != 'black-box':
            return jsonify({"error": "Device is not a black-box"}), 400

        handler = device_manager.get_black_box(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        data, bundled_hash, reason = _load_bundled_firmware()
        if data is None:
            return jsonify({"update_available": None, "reason": reason})

        if getattr(handler, 'firmware_update_in_progress', False):
            return jsonify({
                "update_available": None,
                "reason": "update_in_progress",
                "bundled_hash": bundled_hash
            })

        success, device_hash = handler.get_firmware_hash()
        if not success:
            return jsonify({
                "update_available": None,
                "reason": "device_unknown",
                "bundled_hash": bundled_hash,
                "bundled_size": len(data)
            })

        return jsonify({
            "update_available": device_hash != bundled_hash,
            "device_hash": device_hash,
            "bundled_hash": bundled_hash,
            "bundled_size": len(data)
        })

    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/firmware_update', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def firmware_update(device_id):
    """Upload a .bin file and flash it onto the black box over serial.

    Runs in a background thread; progress is published via SSE as
    'black_box_firmware_progress' events and the outcome as
    'black_box_firmware_complete'.
    """
    try:
        handler, error = _firmware_update_preflight(device_id)
        if error:
            return error

        if 'firmware' not in request.files:
            return jsonify({"error": "No firmware file uploaded (expected field 'firmware')"}), 400

        file = request.files['firmware']
        if not file.filename or not file.filename.lower().endswith('.bin'):
            return jsonify({"error": "Firmware must be a .bin file"}), 400

        firmware_data = file.read()
        invalid = _validate_firmware_image(firmware_data)
        if invalid:
            return jsonify({"error": invalid}), 400

        _launch_firmware_update(handler, device_id, firmware_data)

        return jsonify({
            "success": True,
            "message": "Firmware update started",
            "size": len(firmware_data)
        }), 202

    finally:
        db.session.close()


@black_box_bp.route('/api/v1/black_box/<int:device_id>/firmware_update_bundled', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def firmware_update_bundled(device_id):
    """Flash the firmware.bin bundled with this software release."""
    try:
        handler, error = _firmware_update_preflight(device_id)
        if error:
            return error

        data, bundled_hash, reason = _load_bundled_firmware()
        if data is None:
            return jsonify({"error": "No valid bundled firmware available", "reason": reason}), 404

        _launch_firmware_update(handler, device_id, data)

        return jsonify({
            "success": True,
            "message": "Firmware update started",
            "size": len(data),
            "bundled_hash": bundled_hash
        }), 202

    finally:
        db.session.close()
