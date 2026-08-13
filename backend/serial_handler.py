import errno
import serial
import threading
import time
from typing import Optional, Callable
import queue
from utils.serial_logger import serial_logger

try:
    import termios
except ImportError:  # non-POSIX: pyserial uses a backend without tcdrain
    termios = None

# serial.Serial.flush() raises termios.error on POSIX, OSError elsewhere.
_DRAIN_ERRORS = (OSError,) if termios is None else (OSError, termios.error)


class SerialHandler:
    def __init__(self, baudrate: int = 115200, timeout: float = 0.5):
        self.id = None
        self.port = None
        self.baudrate = baudrate
        self.device_type = None 
        self.timeout = timeout
        self.connection = serial.Serial()
        self._write_lock = threading.Lock()
        # Serializes whole send->receive cycles so concurrent callers (e.g.
        # the chimera IP-monitor thread and Flask request threads) cannot
        # swallow or cross-attribute each other's responses.
        self._command_lock = threading.Lock()
        self._reader_thread = None
        self._stop_reading = threading.Event()
        self._command_response_queue = queue.Queue()
        self._line_buffer = ""
        self._automatic_handlers = {}  # Dict of prefix -> handler function
        self.on_disconnect = None  # Callback for when connection is lost
        # While a firmware update streams raw bytes, other callers must fail
        # fast instead of blocking minutes on _command_lock.
        self.firmware_update_in_progress = False
        
    
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
        

    def get_type(self, port: str, timeout: float = 6.0) -> str:
        if not self.connection.is_open:
            self.connect(port=port)

        self.clear_buffer()
        # Opening the port resets boards that auto-reset on DTR. The ESP32 based
        # devices are back within a fraction of a second, but the AVR based PLC
        # sits in its bootloader for around two seconds - and traffic arriving
        # during that window keeps the bootloader listening instead of handing
        # over to the sketch, so the board would stay silent indefinitely.
        #
        # Ask once for anything already running, then leave a deliberate quiet
        # gap for the bootloader to time out before asking again.
        request_times = [0.0, 2.2, 3.0, 3.8, 4.6, 5.4]
        start_time = time.time()
        response = None
        while time.time() - start_time < timeout:
            elapsed = time.time() - start_time
            if request_times and elapsed >= request_times[0]:
                request_times.pop(0)
                try:
                    self.send_command_no_wait("info")
                except Exception:
                    pass
            resp = self.read_line(timeout=0.2)
            if resp and resp.startswith("info"):
                response = resp
                break
        if response is None:
            raise Exception(f"No info response received from {port}")
        # Split the response and get the device name
        parts = response.split()
        if len(parts) > 4:
            # Check if parts[4] is a number, if so use parts[5] (chimera)
            index = 5 if parts[4].isdigit() else 4
            return parts[index] # device_name
        else:
            raise Exception(f"Invalid response format: {response}")

    def disconnect(self) -> bool:
        self._stop_reader_thread()
        try:
            self.connection.close()
        except Exception:
            pass
        return True
    
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
        while self.connection.is_open:
            try:
                if self.connection and self.connection.in_waiting > 0:
                    data = self.connection.read(self.connection.in_waiting)
                    self._process_incoming_data(data)
                else:
                    time.sleep(0.01)
            except (serial.SerialException, OSError):
                # Device disconnected - exit the loop
                break
            except Exception:
                time.sleep(0.1)

        # Connection has broken - close the FD to prevent leaking
        try:
            self.connection.close()
        except Exception:
            pass

        # Connection has stopped - call the disconnect callback
        if self.on_disconnect and callable(self.on_disconnect):
            try:
                self.on_disconnect()
            except Exception as e:
                print(f"Error in disconnect callback: {e}")
      
          
    
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
        # Log the received message
        serial_logger.log_received(self.port, line)

        # Check if line matches any automatic handler prefix
        handled = False
        for prefix, handler in self._automatic_handlers.items():
            if line.startswith(prefix):
                try:
                    handler(line)
                    handled = True
                except Exception:
                    pass
        # If not handled automatically, add to command response queue
        if not handled:
            self._command_response_queue.put(line)
    
    def send_command(self, command: str, timeout: float = 5.0) -> Optional[str]:
        """Send a command and wait for response"""
        if not self.connection.is_open:
            raise Exception("Device not connected")
        if self.firmware_update_in_progress:
            raise Exception("Device is busy with a firmware update")

        with self._command_lock:
            # Clear the response queue before sending
            while not self._command_response_queue.empty():
                try:
                    self._command_response_queue.get_nowait()
                except queue.Empty:
                    break

            # Send command
            with self._write_lock:
                self.connection.write(f"{command}\n".encode())
                self.connection.flush()
                serial_logger.log_sent(self.port, command)

            # Wait for response
            try:
                response = self._command_response_queue.get(timeout=timeout)
                return response
            except queue.Empty:
                return None
    
    def _send_command_locked(self, command: str, timeout: float = 5.0,
                             expect_prefix: Optional[str] = None) -> Optional[str]:
        """Send a command and wait for a response while the caller already
        holds _command_lock (send_command would deadlock). Used by long
        operations (e.g. firmware update) that must keep the lock across
        several exchanges. If expect_prefix is given, lines that don't match
        are skipped (e.g. boot noise after a device reset).
        """
        while not self._command_response_queue.empty():
            try:
                self._command_response_queue.get_nowait()
            except queue.Empty:
                break

        with self._write_lock:
            self.connection.write(f"{command}\n".encode())
            self.connection.flush()
            serial_logger.log_sent(self.port, command)

        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return None
            try:
                line = self._command_response_queue.get(timeout=remaining)
            except queue.Empty:
                return None
            if expect_prefix is None or line.startswith(expect_prefix):
                return line

    def drain_write_buffer(self) -> None:
        """Block until everything written has physically left the UART.

        This is serial.Serial.flush(), which on POSIX is a bare
        termios.tcdrain(). PEP 475 does not make tcdrain retry on EINTR the
        way it does for most syscalls, and pyserial does not retry it either
        - though its write() does explicitly tolerate EINTR. So a signal
        arriving while draining raises termios.error(4, 'Interrupted system
        call'). Over a single command that is unlikely; over the thousands of
        drains in a multi-minute firmware transfer it is close to certain,
        and it used to abort the flash. Retrying is the standard EINTR
        response and is what PEP 475 does for the calls it covers.
        """
        while True:
            try:
                self.connection.flush()
                return
            except _DRAIN_ERRORS as e:
                if e.args and e.args[0] == errno.EINTR:
                    continue
                raise

    def send_command_no_wait(self, command: str) -> None:
        """Send a command without waiting for response"""
        if not self.connection.is_open:
            raise Exception("Device not connected")
        if self.firmware_update_in_progress:
            raise Exception("Device is busy with a firmware update")

        with self._write_lock:
            self.connection.write(f"{command}\n".encode())
            self.connection.flush()
            serial_logger.log_sent(self.port, command)
    
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