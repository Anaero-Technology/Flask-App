import threading
from typing import Dict, Union, Optional
from database.models import Device, db
from serial_handler import SerialHandler
from black_box_handler import BlackBoxHandler
from chimera_handler import ChimeraHandler
from plc_handler import PlcHandler

class DeviceManager:
    _instance = None
    _lock = threading.Lock()
    _active_handlers = {}  # Keyed by device_id (not port) for robustness
    _app = None  # Flask app reference

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
            return cls._instance

    def __init__(self):
        if not hasattr(self, 'initialized'):
            self.initialized = True

    @classmethod
    def set_app(cls, app):
        """Set the Flask app reference for database operations"""
        cls._app = app

    def _handle_disconnect(self, device_id: int):
        """Handle device disconnection - update database and remove from active handlers"""
        if device_id in self._active_handlers:
            del self._active_handlers[device_id]

        # Update database with app context
        if self._app:
            with self._app.app_context():
                device = Device.query.get(device_id)
                if device:
                    device.connected = False
                    db.session.commit()

    def connect(self, port: str, device_name: Optional[str] = None) -> bool:
        """
        Connect to a device on the specified port.
        Uses MAC address to identify returning devices (port may change).
        Auto-registers the device if not in DB.
        Returns True on success.
        """
        if not self._app:
            return False

        # Check if port is already connected
        if self.is_port_connected(port):
            print(f"[DeviceManager] Port {port} is already connected")
            return True

        with self._app.app_context():
            # Auto-detect device type and get MAC address
            temp_handler = SerialHandler()
            device_type = None
            mac_address = None
            try:
                device_type = temp_handler.get_type(port)
                temp_handler.disconnect()
            except Exception as e:
                print(f"Exception: {e}")
                if temp_handler:
                    temp_handler.disconnect()
                return False

            # Create appropriate handler based on device type
            handler = None
            try:
                if device_type in ['black_box', 'black-box']:
                    handler = BlackBoxHandler(port)
                elif device_type in ['chimera', 'chimera-max']:
                    handler = ChimeraHandler(port)
                elif device_type in ["plc"]:
                    handler = PlcHandler(port)
                else:
                    return False

                handler.app = self._app  # Set app context
                if not handler.connect():
                    print(f"[DeviceManager] Handler failed to connect to {port}")
                    return False
                mac_address = handler.mac_address

                # Look up device by MAC address first (robust across port changes)
                device = None
                if mac_address:
                    device = Device.query.filter_by(mac_address=mac_address).first()

                # Check if already connected
                if device and device.id in self._active_handlers:
                    handler.disconnect()  # Don't need duplicate connection
                    return True

                if device:
                    # Existing device - update port if changed
                    if device.serial_port != port:
                        print(f"[DeviceManager] Device {device.id} moved from {device.serial_port} to {port}")
                        device.serial_port = port
                    device.connected = True
                    device.logging = handler.is_logging
                    handler.set_test_id(device.active_test_id)
                    if device_name:
                        device.name = device_name
                    handler.set_name(device.name)
                    db.session.commit()
                else:
                    # New device - create record
                    if device_name:
                        handler.set_name(device_name)
                    else:
                        device_name = handler.device_name

                    device = Device(
                        name=device_name,
                        device_type=device_type,
                        serial_port=port,
                        mac_address=mac_address,
                        connected=True,
                        logging=handler.is_logging
                    )
                    db.session.add(device)
                    db.session.commit()
                    db.session.refresh(device)

                handler.id = device.id

                # Set the disconnect callback (pass device_id, not port)
                handler.on_disconnect = lambda: self._handle_disconnect(device.id)

                # Store handler by device_id (not port)
                self._active_handlers[device.id] = handler

                return True

            except Exception as e:
                print(f"EXCEPTION: {e}")
                if handler:
                    handler.disconnect()
                return False

    def connect_black_box(self, device_id: int, port: str) -> bool:
        from black_box_handler import BlackBoxHandler

        if not self._app:
            return False

        with self._app.app_context():
            device = Device.query.get(device_id)
            if not device or device.device_type != 'black-box':
                return False

            if device_id in self._active_handlers:
                return True  # Already connected

            handler = BlackBoxHandler(port)
            handler.id = device_id
            handler.app = self._app
            if not handler.connect():
                print(f"[DeviceManager] BlackBox handler failed to connect to {port}")
                return False

            handler.on_disconnect = lambda: self._handle_disconnect(device_id)

            self._active_handlers[device_id] = handler

            # Update database (including port in case it changed)
            device.serial_port = port
            device.connected = True
            device.logging = handler.is_logging
            if handler.mac_address:
                device.mac_address = handler.mac_address
            if handler.device_name:
                device.name = handler.device_name
            db.session.commit()

            return True

    def connect_chimera(self, device_id: int, port: str) -> bool:
        from chimera_handler import ChimeraHandler

        if not self._app:
            return False

        with self._app.app_context():
            device = Device.query.get(device_id)
            if not device or device.device_type not in ['chimera', 'chimera-max']:
                return False

            if device_id in self._active_handlers:
                return True  # Already connected

            handler = ChimeraHandler(port)
            handler.id = device_id
            handler.app = self._app
            if not handler.connect():
                print(f"[DeviceManager] Chimera handler failed to connect to {port}")
                return False

            handler.on_disconnect = lambda: self._handle_disconnect(device_id)

            self._active_handlers[device_id] = handler

            # Update database (including port in case it changed)
            device.serial_port = port
            device.connected = True
            if handler.mac_address:
                device.mac_address = handler.mac_address
            if handler.device_name:
                device.name = handler.device_name
            db.session.commit()

            return True

    def disconnect_by_port(self, port: str) -> bool:
        """Disconnect device by port (finds device_id first)"""
        if not self._app:
            return False

        with self._app.app_context():
            device = Device.query.filter_by(serial_port=port).first()
            if not device:
                return False
            return self.disconnect_device(device.id)

    def disconnect_device(self, device_id: int) -> bool:
        if not self._app:
            return False

        with self._app.app_context():
            device = Device.query.get(device_id)

            if not device:
                return False

            # Disconnect handler if active
            if device_id in self._active_handlers:
                handler = self._active_handlers[device_id]
                handler.disconnect()
                del self._active_handlers[device_id]

            # Update database
            device.connected = False
            db.session.commit()

            return True

    def get_device(self, device_id: int) -> Optional[Union['BlackBoxHandler', 'ChimeraHandler']]:
        if not self._app:
            return None

        # Check cache first
        if device_id in self._active_handlers:
            return self._active_handlers[device_id]

        with self._app.app_context():
            device = Device.query.get(device_id)
            if not device or not device.connected:
                return None

            # Not in cache but marked as connected - try to reconnect
            handler = None
            if device.device_type == "black-box":
                handler = BlackBoxHandler(device.serial_port)
                handler.app = self._app
                handler.id = device.id
                if not handler.connect():
                    device.connected = False
                    db.session.commit()
                    return None
                handler.mac_address = device.mac_address
                handler.device_name = device.name
            elif device.device_type in ["chimera", "chimera-max"]:
                handler = ChimeraHandler(device.serial_port)
                handler.app = self._app
                handler.id = device.id
                if not handler.connect():
                    device.connected = False
                    db.session.commit()
                    return None
                handler.mac_address = device.mac_address
                handler.device_name = device.name
            else:
                return None

            handler.on_disconnect = lambda: self._handle_disconnect(device_id)
            self._active_handlers[device_id] = handler
            return handler

    def get_device_by_port(self, port: str):
        """Get device handler by port (finds device_id first)"""
        if not self._app:
            return None

        with self._app.app_context():
            device = Device.query.filter_by(serial_port=port).first()
            if device:
                return self._active_handlers.get(device.id)
        return None

    def list_devices(self) -> Dict:
        if not self._app:
            return {"black_boxes": [], "chimeras": []}

        with self._app.app_context():
            devices = Device.query.all()

            black_box_list = []
            chimera_list = []

            for device in devices:
                if device.device_type == "black-box":
                    device_info = {
                        "device_id": device.id,
                        "port": device.serial_port,
                        "name": device.name or "Unknown",
                        "mac_address": device.mac_address,
                        "connected": device.connected,
                        "status": "logging" if device.logging else "idle"
                    }

                    if device.connected:
                        handler = self.get_black_box(device.id)
                        if handler:
                            device_info["status"] = "logging" if handler.is_logging else "idle"
                            device_info["current_log_file"] = getattr(handler, 'current_log_file', None)

                    black_box_list.append(device_info)

                elif device.device_type in ["chimera", "chimera-max"]:
                    device_info = {
                        "device_id": device.id,
                        "port": device.serial_port,
                        "name": device.name or "Unknown",
                        "mac_address": device.mac_address,
                        "connected": device.connected,
                        "status": "logging" if device.logging else "idle"
                    }

                    if device.connected:
                        handler = self.get_chimera(device.id)
                        if handler:
                            device_info["status"] = "logging" if handler.is_logging else "idle"
                            device_info["current_channel"] = getattr(handler, 'current_channel', None)
                            device_info["seconds_elapsed"] = getattr(handler, 'seconds_elapsed', 0)

                    chimera_list.append(device_info)

            return {
                "black_boxes": black_box_list,
                "chimeras": chimera_list
            }

    def get_black_box(self, device_id: int):
        return self.get_device(device_id)

    def get_chimera(self, device_id: int):
        return self.get_device(device_id)

    def list_connected_ports(self) -> list:
        """List all currently connected ports"""
        if not self._app:
            return []
        with self._app.app_context():
            ports = []
            for device_id in self._active_handlers:
                device = Device.query.get(device_id)
                if device:
                    ports.append(device.serial_port)
            return ports

    def is_port_connected(self, port: str) -> bool:
        """Check if a port is currently connected"""
        if not self._app:
            return False
        with self._app.app_context():
            device = Device.query.filter_by(serial_port=port).first()
            return device and device.id in self._active_handlers

    def get_chimera_reading_channel(self, test_id: int) -> Optional[int]:
        """Get the channel currently being read by the Chimera for a given test.
        Returns the channel number (1-15) if reading, None otherwise."""
        for handler in self._active_handlers.values():
            if (handler.device_type in ['chimera', 'chimera-max'] and
                getattr(handler, 'test_id', None) == test_id and
                getattr(handler, 'current_status', None) == 'reading'):
                return getattr(handler, 'current_channel', None)
        return None
