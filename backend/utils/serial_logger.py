"""
Serial Logger Module
Logs all serial messages received from devices with timestamps.
"""

import os
import threading
from datetime import datetime
from typing import Optional

class SerialLogger:
    """Singleton logger for serial communication messages."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._initialized = True
        self._write_lock = threading.Lock()

        # Create logs directory in backend folder (one level up from utils)
        self._log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'logs')
        self._log_dir = os.path.normpath(self._log_dir)
        os.makedirs(self._log_dir, exist_ok=True)

        self._log_file = os.path.join(self._log_dir, 'serial_messages.log')
        self._enabled = True
        self._max_size = 25 * 1024 * 1024  # 25 MB

    @property
    def log_file_path(self) -> str:
        """Get the path to the log file."""
        return self._log_file

    @property
    def enabled(self) -> bool:
        """Check if logging is enabled."""
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool):
        """Enable or disable logging."""
        self._enabled = value

    def log_received(self, port: str, message: str):
        """Log a received message from a device."""
        if not self._enabled:
            return
        self._write_log('RX', port, message)

    def log_sent(self, port: str, message: str):
        """Log a message sent to a device."""
        if not self._enabled:
            return
        self._write_log('TX', port, message)

    def _write_log(self, direction: str, port: str, message: str):
        """Write a log entry to the file. Keeps the most recent half when the 25 MB limit is reached."""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        # Extract just the port name (e.g., /dev/ttyUSB0 -> ttyUSB0)
        port_name = os.path.basename(port) if port else 'unknown'
        log_entry = f"[{timestamp}] [{direction}] [{port_name}] {message}\n"

        with self._write_lock:
            try:
                # Rotate when file exceeds the size limit: keep the newest half
                if self.get_log_size() >= self._max_size:
                    with open(self._log_file, 'r', encoding='utf-8') as f:
                        f.seek(self._max_size // 2)
                        f.readline()  # skip partial line
                        recent_data = f.read()
                    with open(self._log_file, 'w', encoding='utf-8') as f:
                        f.write(recent_data)

                with open(self._log_file, 'a', encoding='utf-8') as f:
                    f.write(log_entry)
            except Exception as e:
                print(f"Failed to write to serial log: {e}")

    def clear_log(self):
        """Clear the log file."""
        with self._write_lock:
            try:
                with open(self._log_file, 'w', encoding='utf-8') as f:
                    f.write('')
                return True
            except Exception as e:
                print(f"Failed to clear serial log: {e}")
                return False

    def get_log_size(self) -> int:
        """Get the size of the log file in bytes."""
        try:
            return os.path.getsize(self._log_file)
        except OSError:
            return 0

    def log_exists(self) -> bool:
        """Check if the log file exists and has content."""
        return os.path.exists(self._log_file) and self.get_log_size() > 0


# Global instance for easy access
serial_logger = SerialLogger()
