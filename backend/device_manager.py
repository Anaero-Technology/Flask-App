import threading
from typing import Dict, Union, Optional
from database.models import Device, db
from serial_handler import SerialHandler


class DeviceManager:
    _instance = None
    _lock = threading.Lock()
    _active_handlers = {}  # Temporary cache for active handlers during a session
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
    
    def _handle_disconnect(self, port: str):
        """Handle device disconnection - update database and remove from active handlers"""
        if port in self._active_handlers:
            del self._active_handlers[port]
        
        # Update database with app context
        if self._app:
            with self._app.app_context():
                device = Device.query.filter_by(serial_port=port).first()
                if device:
                    device.connected = False
                    db.session.commit()
    
    def connect(self, port: str, device_name: Optional[str] = None) -> bool:
        """
        Connect to a device on the specified port.
        Auto-registers the device if not in DB.
        Returns device info dict on success.

        DEPENDS ON APP
        """
        if not self._app:
            return False
            
        with self._app.app_context():
            device = Device.query.filter_by(serial_port=port).first()

            # Check if already connected to this port
            if port in self._active_handlers and device:
                    return True
        
            # Auto-detect device type
            temp_handler = SerialHandler()
            device_type = None
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
                    from black_box_handler import BlackBoxHandler
                    handler = BlackBoxHandler(port)
                    handler.connect()
                elif device_type == 'chimera':
                    from chimera_handler import ChimeraHandler
                    handler = ChimeraHandler(port)
                    handler.connect()
                else:
                    return False
                
                # If the device isn't already in the database
                if not device:
                    # Use provided name or get from device
                    if device_name:
                        handler.set_name(device_name)
                    else:
                        device_name = handler.device_name

                    # Create new device record
                    device = Device(
                        name=device_name,
                        device_type=device_type,
                        serial_port=port,
                        mac_address=handler.mac_address,
                        connected=True,
                        logging=handler.is_logging
                    )
                    db.session.add(device)
                    db.session.commit()
                    db.session.refresh(device)
                else:
                    device.connected = True       
                    if device_name:
                        device.name = device_name
                        handler.set_name(device_name)
                    db.session.commit()
                
                handler.id = device.id
                
                # Set the disconnect callback
                handler.on_disconnect = self._handle_disconnect

                # Store handler in cache
                self._active_handlers[port] = handler
                
                return True
                
            except Exception as e:
                if handler:
                    handler.disconnect()
                return False
    
    def connect_black_box(self, device_id: int, port: str) -> bool:
        from black_box_handler import BlackBoxHandler
        
        if not self._app:
            return False
            
        with self._app.app_context():
            # Check if device exists and is not already connected
            device = Device.query.get(device_id)
            if not device or device.device_type != 'black-box':
                return False
            
            if device.connected:
                return False
            
            # Create and connect handler
            handler = BlackBoxHandler(port)
            handler.connect()
            
            # Set the disconnect callback
            handler.on_disconnect = self._handle_disconnect
            
            # Store handler temporarily for this session
            self._active_handlers[port] = handler
            
            # Update database
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
            # Check if device exists and is not already connected
            device = Device.query.get(device_id)
            if not device or device.device_type != 'chimera':
                return False
            
            if device.connected:
                return False
            
            # Create and connect handler
            handler = ChimeraHandler(port)
            handler.connect()
            
            # Set the disconnect callback
            handler.on_disconnect = self._handle_disconnect
            
            # Store handler temporarily for this session
            self._active_handlers[port] = handler
            
            # Update database
            device.connected = True
            if handler.mac_address:
                device.mac_address = handler.mac_address
            if handler.device_name:
                device.name = handler.device_name
            db.session.commit()
            
            return True
    
    def disconnect_by_port(self, port: str) -> bool:
        """Disconnect device by port"""
        if port not in self._active_handlers:
            return False
        
        handler = self._active_handlers[port]
        handler.disconnect()
        del self._active_handlers[port]
        
        if not self._app:
            return True
            
        with self._app.app_context():
            # Update database
            device = Device.query.filter_by(serial_port=port).first()
            if device:
                device.connected = False
                device.logging = False
                db.session.commit()
        
        return True
    
    def disconnect_device(self, device_id: int) -> bool:
        if not self._app:
            return False
            
        with self._app.app_context():
            # Get device from database
            device = Device.query.get(device_id)
            
            if not device or not device.connected:
                return False
            
            # Check if handler exists in cache by port
            if device.serial_port in self._active_handlers:
                handler = self._active_handlers[device.serial_port]
                handler.disconnect()
                del self._active_handlers[device.serial_port]
            
            # Update database
            device.connected = False
            db.session.commit()
            
            return True
    
    def get_device(self, device_id: int) -> Optional[Union['BlackBoxHandler', 'ChimeraHandler']]:
        if not self._app:
            return None
            
        with self._app.app_context():
            # First check if device exists and is connected in database
            device = Device.query.get(device_id)
            if not device:
                return None
            
            # Check cache for active handler by port
            if device.serial_port in self._active_handlers:
                return self._active_handlers[device.serial_port]
            
            # If not in cache but marked as connected in DB, create new handler
            if device.device_type == "black-box":
                from black_box_handler import BlackBoxHandler
                handler = BlackBoxHandler(device.serial_port)
                handler.connect()
                handler.mac_address = device.mac_address
                handler.device_name = device.name
            elif device.device_type == "chimera":
                from chimera_handler import ChimeraHandler
                handler = ChimeraHandler(device.serial_port)
                handler.connect()
                handler.mac_address = device.mac_address
                handler.device_name = device.name
            else:
                return None
            
            # Set the disconnect callback
            handler.on_disconnect = self._handle_disconnect
            
            # Cache the handler by port
            self._active_handlers[device.serial_port] = handler
            return handler
    
    def get_device_by_port(self, port: str):
        """Get device handler by port"""
        return self._active_handlers.get(port)
    
    def list_devices(self) -> Dict:
        if not self._app:
            return {"black_boxes": [], "chimeras": []}
            
        with self._app.app_context():
            # Get all devices from database
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
                    
                    # If connected and we have a handler, get real-time status
                    if device.connected:
                        handler = self.get_black_box(device.id)
                        if handler:
                            device_info["status"] = "logging" if handler.is_logging else "idle"
                            device_info["current_log_file"] = getattr(handler, 'current_log_file', None)
                    
                    black_box_list.append(device_info)
                    
                elif device.device_type == "chimera":
                    device_info = {
                        "device_id": device.id,
                        "port": device.serial_port,
                        "name": device.name or "Unknown",
                        "mac_address": device.mac_address,
                        "connected": device.connected,
                        "status": "logging" if device.logging else "idle"
                    }
                    
                    # If connected and we have a handler, get real-time status
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
        return list(self._active_handlers.keys())
    
    def is_port_connected(self, port: str) -> bool:
        """Check if a port is currently connected"""
        return port in self._active_handlers