import threading
from typing import Dict, Union, Optional


class DeviceManager:
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
            return cls._instance
    
    def __init__(self):
        if not hasattr(self, 'initialized'):
            self.black_boxes = {}  # Key: database device_id, Value: handler
            self.chimeras = {}     # Key: database device_id, Value: handler
            self.initialized = True
    
    def connect_black_box(self, device_id: int, port: str) -> bool:
        from black_box_handler import BlackBoxHandler
        
        # Check if already connected
        if device_id in self.black_boxes:
            return False
        
        handler = BlackBoxHandler(port)
        handler.connect()
        
        self.black_boxes[device_id] = handler
        return True
    
    def connect_chimera(self, device_id: int, port: str) -> bool:
        from chimera_handler import ChimeraHandler
        
        # Check if already connected
        if device_id in self.chimeras:
            return False
        
        handler = ChimeraHandler(port)
        handler.connect()
        
        self.chimeras[device_id] = handler
        return True
    
    def disconnect_device(self, device_type: str, device_id: int) -> bool:
        if device_type == "black_box":
            if device_id in self.black_boxes:
                self.black_boxes[device_id].disconnect()
                del self.black_boxes[device_id]
                return True
        elif device_type == "chimera":
            if device_id in self.chimeras:
                self.chimeras[device_id].disconnect()
                del self.chimeras[device_id]
                return True
        return False
    
    def get_device(self, device_type: str, device_id: int) -> Optional[Union['BlackBoxHandler', 'ChimeraHandler']]:
        if device_type == "black_box":
            return self.black_boxes.get(device_id)
        elif device_type == "chimera":
            return self.chimeras.get(device_id)
        return None
    
    def list_devices(self) -> Dict:
        black_box_list = []
        for device_id, handler in self.black_boxes.items():
            black_box_list.append({
                "device_id": device_id,
                "port": handler.port,
                "name": handler.device_name or "Unknown",
                "serial": handler.device_serial,
                "status": "collecting" if handler.is_collecting else "idle"
            })
        
        chimera_list = []
        for device_id, handler in self.chimeras.items():
            chimera_list.append({
                "device_id": device_id,
                "port": handler.port,
                "status": "calibrating" if handler.is_calibrating else "ready",
                "valve_open": handler.valve_open,
                "flow_rate": handler.current_flow_rate
            })
        
        return {
            "black_boxes": black_box_list,
            "chimeras": chimera_list
        }
    
    def get_black_box(self, device_id: int) -> Optional['BlackBoxHandler']:
        return self.black_boxes.get(device_id)
    
    def get_chimera(self, device_id: int) -> Optional['ChimeraHandler']:
        return self.chimeras.get(device_id)