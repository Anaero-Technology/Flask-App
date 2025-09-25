import time
from typing import Optional, Dict, List, Tuple
from serial_handler import SerialHandler


class BlackBoxHandler(SerialHandler):
    def __init__(self, port: str):
        super().__init__()
        self.port = port
        self.device_name = None
        self.device_type = "black-box"
        self.mac_address = None
        self.is_logging = False
        self.current_log_file = None
        self.app = None  # Flask app context for database operations
        self.test_id = None  # Current test ID for database logging
        
        # Handle automatic messages from the blackbox
        self.register_automatic_handler("tip ", self._print_tips)
        self.register_automatic_handler("counts ", lambda : None)

    def connect(self):
        super().connect(self.port)
        # Get device info immediately after connection
        self._get_device_info()
    
    
    def _print_tips(self, line: str):
        """Prints automatic tip messages and sends SSE notification"""
        try:
            # Extract the file line after "tip "
            file_line = line[4:]  # Skip "tip "

            # Parse the CSV line: Tip Number, Time Stamp, Seconds Elapsed, Channel Number, Temperature, Pressure
            parts = file_line.split()

            tip_data = {
                "tip_number": int(parts[0]),
                "timestamp": parts[1].strip(),
                "seconds_elapsed": int(parts[2]),
                "channel_number": int(parts[3]),
                "temperature" : "N/A" if parts[4] == "-" else float(parts[4]),
                "pressure": float(parts[5])
             }
            
            print(f"[AUTOMATIC TIP] Tip #{tip_data['tip_number']} - "
                f"Channel: {tip_data['channel_number']}, "
                f"Temp: {tip_data['temperature']}°C, "
                f"Pressure: {tip_data['pressure']} PSI")
            
            # Send SSE notification directly
            if self.app:
                try:
                    with self.app.app_context():
                        from flask_sse import sse
                        sse_data = {
                            "type": "tip_event",
                            "device_name": self.device_name,
                            "port": self.port,
                            "tip_data": tip_data
                        }
                        sse.publish(sse_data, type='tip')
                        print(f"Published SSE notification: {sse_data}")
                except Exception as e:
                    print(f"SSE publish failed: {e}")
            # Save tip data to database if test_id is set and app context is available
            if self.test_id and self.app and hasattr(self, 'id'):
                try:
                    with self.app.app_context():
                        from database.models import BlackboxRawData, db
                        # Create new BlackboxRawData entry
                        raw_data = BlackboxRawData(
                            test_id=self.test_id,
                            device_id=self.id,
                            channel_number=tip_data['channel_number'],
                            timestamp=int(time.time()),  # Current Unix timestamp
                            seconds_elapsed=tip_data['seconds_elapsed'],
                            temperature=tip_data['temperature'] if tip_data['temperature'] != 'N/A' else None,
                            pressure=tip_data['pressure']
                        )
                        
                        db.session.add(raw_data)
                        db.session.commit()
                        print(f"Saved tip data to database: Test {self.test_id}, Channel {tip_data['channel_number']}")
                        
                except Exception as e:
                    print(f"Failed to save tip data to database: {e}")
                    try:
                        db.session.rollback()
                    except:
                        pass
    
        except (ValueError, IndexError):
            pass
  
    def _get_device_info(self):
        """Get device information using the info command (auto appends \n at end of command)"""
        if self.connection.is_open:
            response = self.send_command("info", 1.0)

            if response and response.startswith("info"):
                # Parse: info [logging_state] [logging_file] [device_name] black-box [mac_address]
                parts = response.split()
                
                self.is_logging = (parts[1] == "1")
                self.current_log_file = parts[2] if parts[2] != "none" else None
                self.device_name = parts[3]
                # parts[4] should be "black-box"
                self.mac_address = parts[5]

    def get_info(self) -> Dict:
        """Get current device information"""
        self._get_device_info()
        return {
            "device_name": self.device_name,
            "mac_address": self.mac_address,
            "is_logging": self.is_logging,
            "current_log_file": self.current_log_file,
            "port": self.port
        }
    
    def start_logging(self, filename: str) -> Tuple[bool, str]:
        """Start logging to a specific file"""
        response = self.send_command(f"start /{filename}.txt")
        
        if response == "done start" or response == "Setup successfully updated":
            self.is_logging = True
            self.current_log_file = filename
            return True, "Successfully started logging"
        elif response == "failed start nofiles":
            return False, "SD card not working"
        elif response == "failed start alreadyexists":
            return False, "File already exists"
        elif response == "already start":
            return False, "Device already logging"
        else:
            return False, "Unknown error"
    
    def stop_logging(self) -> Tuple[bool, str]:
        """Stop logging"""
        response = self.send_command("stop")

        parts = response.split()
        for x in parts:
            print(x)
        if response == "done stop" or response == "Setup successfully updated":
            self.is_logging = False
            self.current_log_file = None
            return True, "Successfully stopped logging"
        elif response == "failed stop nofiles":
            return False, "SD card not working"
        elif response == "already stop":
            return False, "Device is already not logging"
        else:
            return False, "Unknown error"
    
    def get_files(self) -> Dict:
        """Get SD card memory info and list of files"""
        self.clear_buffer()
        self.send_command_no_wait("files")
        
        # Read memory info
        memory_line = self.read_line(timeout=5)
        memory_info = {"total": 0, "used": 0}
        if memory_line and memory_line.startswith("memory"):
            parts = memory_line.split()
            if len(parts) >= 3:
                memory_info["total"] = int(parts[1])
                memory_info["used"] = int(parts[2])
        
        # Read files
        files = []
        files_started = False
        
        start_time = time.time()
        while time.time() - start_time < 10:  # 10 second timeout
            line = self.read_line(timeout=1)
            if not line:
                continue
                
            if line == "file start":
                files_started = True
            elif line == "done files":
                break
            elif files_started and line.startswith("file"):
                parts = line.split()
                if len(parts) >= 3:
                    files.append({
                        "name": parts[1],
                        "size": int(parts[2])
                    })
        
        return {
            "memory": memory_info,
            "files": files
        }
    
    def download_file(self, filename: str, max_bytes: Optional[int] = None) -> Tuple[bool, List[str]]:
        """Download a file from the SD card"""
        if max_bytes:
            command = f"download /{filename} {max_bytes}"
        else:
            # If no max_bytes specified, download entire file
            command = f"download /{filename} 999999999"
        
        self.clear_buffer()
        self.send_command_no_wait(command)
        
        # Wait for download to start
        response = self.read_line(timeout=5)
        if response == "failed download nofile":
            return False, ["File does not exist"]
        elif not response.startswith("download start"):
            return False, ["Failed to start download"]
        
        # Read file lines
        lines = []
        while True:
            line = self.read_line(timeout=5)
            if not line:
                return False, ["Timeout during download"]
            
            if line == "download stop":
                return True, lines
            elif line == "download failed":
                return False, ["Download failed - response sequence not kept"]
            elif line.startswith("download "):
                # Extract the actual data after "download "
                data = line[9:]  # Skip "download "
                lines.append(data)
                # Send acknowledgment
                self.send_command_no_wait("next")
    
    def download_file_from(self, filename: str, byte_from: int) -> Tuple[bool, List[str]]:
        """Download a file from a specific byte position"""
        command = f"downloadFrom /{filename} {byte_from}"
        
        self.clear_buffer()
        self.send_command_no_wait(command)
        
        # Same response handling as download_file
        response = self.read_line(timeout=5)
        if response == "failed download nofile":
            return False, ["File does not exist"]
        elif not response.startswith("download start"):
            return False, ["Failed to start download"]
        
        lines = []
        while True:
            line = self.read_line(timeout=5)
            if not line:
                return False, ["Timeout during download"]
            
            if line == "download stop":
                return True, lines
            elif line == "download failed":
                return False, ["Download failed - response sequence not kept"]
            elif line.startswith("download "):
                data = line[9:]
                lines.append(data)
                self.send_command_no_wait("next")
    
    def delete_file(self, filename: str) -> Tuple[bool, str]:
        """Delete a file from the SD card"""
        response = self.send_command(f"delete /{filename}")
        
        if response == "done delete":
            return True, "File deleted successfully"
        elif response == "failed delete nofile":
            return False, "File does not exist"
        elif response == "already start":
            return False, "Cannot delete while logging"
        else:
            return False, "Unknown error"
    
    def get_time(self) -> Optional[str]:
        """Get current time from RTC"""
        response = self.send_command("getTime")
        if response and response.startswith("time "):
            return response[5:]  # Return timestamp after "time "
        return None
    
    def set_time(self, timestamp: str) -> Tuple[bool, str]:
        """Set time in RTC. Format: year,month,day,hour,minute,second"""
        response = self.send_command(f"setTime {timestamp}")
        
        if response == "done setTime":
            return True, "Time set successfully"
        elif response == "already start":
            return False, "Cannot set time while logging"
        else:
            return False, "Failed to set time"
    
    def set_name(self, name: str) -> bool:
        """Set device name"""
        response = self.send_command(f"setName {name}")
        if response == "done setName":
            self.device_name = name
            return True
        return False
    
    def get_hourly_tips(self) -> Tuple[bool, List[str]]:
        """Get hourly tip count information"""
        self.clear_buffer()
        self.send_command_no_wait("getHourly")
        
        # Wait for start
        response = self.read_line(timeout=5)
        if response == "getHourly failed nofiles":
            return False, ["SD card not working"]
        elif response != "tipfile start":
            return False, ["Failed to start hourly data transfer"]
        
        # Read tip file lines
        lines = []
        while True:
            line = self.read_line(timeout=5)
            if not line:
                return False, ["Timeout during hourly data transfer"]
            
            if line == "tipfile done":
                return True, lines
            elif line.startswith("tipfile "):
                # Extract data after "tipfile "
                data = line[8:]
                lines.append(data)
    
    def set_test_id(self, test_id):
        """Set the current test ID for database logging"""
        self.test_id = test_id
    
    def disconnect(self):
        """Disconnect from device"""
        super().disconnect()