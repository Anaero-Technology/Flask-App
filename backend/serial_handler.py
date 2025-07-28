import serial
import threading
import time
from typing import Optional, Tuple


class SerialHandler:
    def __init__(self, baudrate: int = 115200, timeout: int = 1):
        self.port = None
        self.baudrate = baudrate
        self.timeout = timeout
        self.connection = None
        self.is_connected = False
        self.read_buffer = ""
        self._lock = threading.Lock()

    
    def connect(self, port) -> bool:
        self.port = port
        try:
            self.connection = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout
            )
            self.is_connected = True
            self.clear_buffer()
            return True
        except serial.SerialException as e:
            raise Exception(f"Failed to connect to {self.port}: {str(e)}")
    
    def disconnect(self) -> bool:
        if self.connection and self.is_connected:
            self.connection.close()
            self.is_connected = False
            return True
        return False
    
    def send_command(self, command: str, wait_for_response: bool = True, timeout: int = 5) -> Optional[str]:
        if not self.is_connected:
            raise Exception("Device not connected")
        
        with self._lock:
            self.connection.write(f"{command}\n".encode())
            self.connection.flush()
            
            if wait_for_response:
                return self._read_response(timeout)
        return None
    
    
    def clear_buffer(self):
        if self.is_connected and self.connection:
            self.connection.reset_input_buffer()
            self.connection.reset_output_buffer()
            self.read_buffer = ""
    
    def read_multiline_response(self, start_marker: str, end_marker: str, timeout: int = 5) -> Tuple[bool, list]:
        start_time = time.time()
        lines = []
        started = False
        
        while time.time() - start_time < timeout:
            line = self.read_line()
            if line:
                if not started and line.startswith(start_marker):
                    started = True
                    continue
                elif started and line.startswith(end_marker):
                    return True, lines
                elif started:
                    lines.append(line)
            else:
                time.sleep(0.01)
        
        return False, lines
    
    def _read_response(self, timeout: int) -> Optional[str]:
        start_time = time.time()
        response = ""
        
        while time.time() - start_time < timeout:
            if self.connection.in_waiting > 0:
                data = self.connection.read(self.connection.in_waiting).decode('utf-8', errors='ignore')
                response += data
                if '\n' in response:
                    return response.strip()
            else:
                time.sleep(0.01)
        
        return response.strip() if response else None
    
    def read_line(self, timeout: Optional[float] = None) -> Optional[str]:
        if not self.is_connected:
            return None
        
        if timeout:
            original_timeout = self.connection.timeout
            self.connection.timeout = timeout
        
        try:
            line = self.connection.readline().decode('utf-8', errors='ignore').strip()
            return line if line else None
        except Exception:
            return None
        finally:
            if timeout:
                self.connection.timeout = original_timeout