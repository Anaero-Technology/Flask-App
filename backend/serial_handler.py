import serial
import threading
import time
from typing import Optional, Callable
import queue


class SerialHandler:
    def __init__(self, baudrate: int = 115200, timeout: float = 0.5):
        self.port = None
        self.baudrate = baudrate
        self.device_type = None 
        self.timeout = timeout
        self.connection = serial.Serial()
        self._write_lock = threading.Lock()
        self._reader_thread = None
        self._stop_reading = threading.Event()
        self._command_response_queue = queue.Queue()
        self._line_buffer = ""
        self._automatic_handlers = {}  # Dict of prefix -> handler function
        
    
    def __del__(self):
        """Destructor to ensure serial connection is closed when object is garbage collected"""
        try:
            if self.connection.is_open:
                self.disconnect()
        except:
            # Ignore errors during cleanup
            pass
    
    def __enter__(self):
        """Context manager support"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Ensure connection is closed when exiting context"""
        self.disconnect()
        return False
    
    def connect(self, port: str) -> bool:
        self.port = port
        try:
            self.connection = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.timeout,
                write_timeout=self.timeout
            )
            self.clear_buffer()
            self._start_reader_thread()
            # Small delay to let the connection stabilize
            time.sleep(0.05)
            return True
        except serial.SerialException as e:
            raise Exception(f"Failed to connect to {self.port}: {str(e)}")
        

    def get_type(self, port: str, timeout: float = 2.0) -> str:
        if self.connection.is_open:
            response = self.send_command("info", timeout)
        else:
            self.connect(port=port)
            response = self.send_command("info", timeout)

        if response is None:
            raise Exception("No response received from device")
        
        # Split the response and get the 5th element (index 4)
        parts = response.split()
        if len(parts) > 4:
            return parts[4]
        else:
            raise Exception(f"Invalid response format: {response}")

    
    def disconnect(self) -> bool:
        if self.connection.is_open:
            self._stop_reader_thread()
            self.connection.close()
            return True
        return False
    
    def register_automatic_handler(self, prefix: str, handler: Callable[[str], None]):
        """Register a handler for automatic messages that start with a specific prefix"""
        self._automatic_handlers[prefix] = handler
    
    def unregister_automatic_handler(self, prefix: str):
        """Unregister an automatic message handler"""
        if prefix in self._automatic_handlers:
            del self._automatic_handlers[prefix]
    
    def _start_reader_thread(self):
        """Start the background reader thread"""
        self._stop_reading.clear()
        self._reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
        self._reader_thread.start()
    
    def _stop_reader_thread(self):
        """Stop the background reader thread"""
        if self._reader_thread:
            self._stop_reading.set()
            self._reader_thread.join(timeout=2)
    
    def _reader_loop(self):
        """Main reader loop that continuously reads from serial port"""
        while not self._stop_reading.is_set() and self.connection.is_open:
            try:
                if self.connection and self.connection.in_waiting > 0:
                    data = self.connection.read(self.connection.in_waiting)
                    self._process_incoming_data(data)
                else:
                    time.sleep(0.01)
            except Exception:
                time.sleep(0.1)
    
    def _process_incoming_data(self, data: bytes):
        """Process incoming serial data byte by byte"""
        try:
            text = data.decode('utf-8', errors='ignore')
            self._line_buffer += text
            
            while '\n' in self._line_buffer:
                line, self._line_buffer = self._line_buffer.split('\n', 1)
                # Remove both \r and spaces, handle \r\n line endings
                line = line.rstrip('\r').strip()
                if line:
                    self._handle_line(line)
        except Exception:
            pass
    
    def _handle_line(self, line: str):
        """Handle a complete line of data"""
        # Check if line matches any automatic handler prefix
        handled = False
        for prefix, handler in self._automatic_handlers.items():
            if line.startswith(prefix):
                try:
                    handler(line)
                    handled = True
                    print(f"{line} not put in queue")
                    break
                except Exception:
                    pass
        # If not handled automatically, add to command response queue
        if not handled:
            print(f"{line} put in queue")
            self._command_response_queue.put(line)
    
    def send_command(self, command: str, timeout: float = 5.0) -> Optional[str]:
        """Send a command and wait for response"""
        import time
        if not self.connection.is_open:
            raise Exception("Device not connected")
        
        print(f"[{time.time():.2f}] send_command: clearing queue")
        # Clear the response queue before sending
        while not self._command_response_queue.empty():
            try:
                self._command_response_queue.get_nowait()
            except queue.Empty:
                break
        
        print(f"[{time.time():.2f}] send_command: writing '{command}' to {self.port}")
        # Send command
        with self._write_lock:
            self.connection.write(f"{command}\n".encode())
            self.connection.flush()
        
        print(f"[{time.time():.2f}] send_command: waiting for response with timeout={timeout}")
        # Wait for response
        try:
            response = self._command_response_queue.get(timeout=timeout)
            print(f"[{time.time():.2f}] send_command: got response: {response}")
            return response
        except queue.Empty:
            print(f"[{time.time():.2f}] send_command: timeout - no response received")
            return None
    
    def send_command_no_wait(self, command: str) -> None:
        """Send a command without waiting for response"""
        if not self.connection.is_open:
            raise Exception("Device not connected")
        
        with self._write_lock:
            self.connection.write(f"{command}\n".encode())
            self.connection.flush()
    
    def get_response(self, timeout: float = 5.0) -> Optional[str]:
        """Get a response from the command response queue"""
        try:
            return self._command_response_queue.get(timeout=timeout)
        except queue.Empty:
            return None
    
    def clear_buffer(self):
        """Clear all buffers"""
        if self.connection:
            self.connection.reset_input_buffer()
            self.connection.reset_output_buffer()
            self._line_buffer = ""
            while not self._command_response_queue.empty():
                try:
                    self._command_response_queue.get_nowait()
                except queue.Empty:
                    break
    
    def read_line(self, timeout: Optional[float] = None) -> Optional[str]:
        """Read a line from the command response queue"""
        if not self.connection.is_open:
            return None
        
        timeout = timeout if timeout is not None else 5.0
        return self.get_response(timeout)