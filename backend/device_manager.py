import threading
from typing import Dict, Union, Optional
from database.models import Device, db


class DeviceManager:
    _instance = None
    _lock = threading.Lock()
    _active_handlers = {}  # Temporary cache for active handlers during a session
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
            return cls._instance
    
    def __init__(self):
        if not hasattr(self, 'initialized'):
            self.initialized = True
    
    def connect_black_box(self, device_id: int, port: str) -> bool:
        from black_box_handler import BlackBoxHandler
        
        # Check if device exists and is not already connected
        device = Device.query.get(device_id)
        if not device or device.device_type != 'black_box':
            return False
        
        if device.connected:
            return False
        
        # Create and connect handler
        handler = BlackBoxHandler(port)
        handler.connect()
        
        # Store handler temporarily for this session
        self._active_handlers[f"black_box_{device_id}"] = handler
        
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
        
        # Check if device exists and is not already connected
        device = Device.query.get(device_id)
        if not device or device.device_type != 'chimera':
            return False
        
        if device.connected:
            return False
        
        # Create and connect handler
        handler = ChimeraHandler(port)
        handler.connect()
        
        # Store handler temporarily for this session
        self._active_handlers[f"chimera_{device_id}"] = handler
        
        # Update database
        device.connected = True
        if handler.mac_address:
            device.mac_address = handler.mac_address
        if handler.device_name:
            device.name = handler.device_name
        db.session.commit()
        
        return True
    
    def disconnect_device(self, device_type: str, device_id: int) -> bool:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or device.device_type != device_type:
            return False
        
        if not device.connected:
            return False
        
        # Check if handler exists in cache
        cache_key = f"{device_type}_{device_id}"
        handler = self._active_handlers.get(cache_key)
        
        if handler:
            handler.disconnect()
            del self._active_handlers[cache_key]
        
        # Update database
        device.connected = False
        device.logging = False
        db.session.commit()
        
        return True
    
    def get_device(self, device_type: str, device_id: int) -> Optional[Union['BlackBoxHandler', 'ChimeraHandler']]:
        # First check if device exists and is connected in database
        device = Device.query.get(device_id)
        if not device or device.device_type != device_type or not device.connected:
            return None
        
        # Check cache for active handler
        cache_key = f"{device_type}_{device_id}"
        handler = self._active_handlers.get(cache_key)
        
        if handler:
            return handler
        
        # If not in cache but marked as connected in DB, create new handler
        if device_type == "black_box":
            from black_box_handler import BlackBoxHandler
            handler = BlackBoxHandler(device.serial_port)
            handler.connect()
            handler.mac_address = device.mac_address
            handler.device_name = device.name
        elif device_type == "chimera":
            from chimera_handler import ChimeraHandler
            handler = ChimeraHandler(device.serial_port)
            handler.connect()
            handler.mac_address = device.mac_address
            handler.device_name = device.name
        
        # Cache the handler
        self._active_handlers[cache_key] = handler
        return handler
    
    def list_devices(self) -> Dict:
        # Get all devices from database
        devices = Device.query.all()
        
        black_box_list = []
        chimera_list = []
        
        for device in devices:
            if device.device_type == "black_box":
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
        return self.get_device("black_box", device_id)
    
    def get_chimera(self, device_id: int):
        return self.get_device("chimera", device_id)