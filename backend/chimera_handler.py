from datetime import datetime
from typing import Optional, Dict, List, Tuple
from serial_handler import SerialHandler


class ChimeraHandler(SerialHandler):
    def __init__(self, port: str):
        super().__init__()
        self.port = port
        self.device_name = "New Device"
        self.device_type = "chimera"
        self.mac_address = None
        self.is_logging = False
        self.current_channel = 0
        self.seconds_elapsed = 0
        self.open_time_ms = 0
        self.flush_time_ms = 0
        self.service_sequence = "111111111111111"  # 15 channels
        self.recirculation_enabled = False
        self.recirculation_days = 1
        self.recirculation_hour = 0
        self.recirculation_minute = 0
        self.sensor_types = {}
        self.past_data = {}

        self.register_automatic_handler("datapoint", self._print_datapoint)
        
    def connect(self):
        super().connect(self.port)
        # Get device info immediately after connection
        self._get_device_info()
    
    def disconnect(self):
        super().disconnect()
    
    def _print_datapoint(self, line: str):
        """Process automatic datapoint messages"""
        parts = line.split()
        if len(parts) >= 2:
            try:
                channel = int(parts[1])
                sensor_data = []
                
                # Parse sensor data (each sensor has 8 values)
                sensor_num = int(parts[2])
                gas_name = parts[3]
                peak_value = float(parts[4])
                peak_parts = [float(parts[5]), float(parts[6]), 
                             float(parts[7]), float(parts[8]), float(parts[9])]
                
                sensor_data.append({
                    "sensor_number": sensor_num,
                    "gas_name": gas_name,
                    "peak_value": peak_value,
                    "peak_parts": peak_parts
                })

                print(sensor_data)
        
                
                    
            except (ValueError, IndexError):
                pass
 
    def set_name(self, name: str) -> bool:
        self.device_name = name
        return True
    
    def _get_device_info(self):
        """Get device information using the info command"""
        if self.connection.is_open:
            response = self.send_command("info")
            if response and response.startswith("info"):
                # Parse: info [logging_state] [current_channel] [seconds_elapsed] chimera-max [mac_address]
                parts = response.split()
                if len(parts) >= 6:
                    self.is_logging = (parts[1] == "true")
                    self.current_channel = int(parts[2])
                    self.seconds_elapsed = int(parts[3])
                    # parts[4] should be "chimera-max"
                    self.mac_address = parts[5]
    
    def get_info(self) -> Dict:
        """Get current device information"""
        self._get_device_info()
        return {
            "device_name": self.device_name,
            "mac_address": self.mac_address,
            "is_logging": self.is_logging,
            "current_channel": self.current_channel,
            "seconds_elapsed": self.seconds_elapsed,
            "port": self.port
        }
    
    def start_logging(self) -> Tuple[bool, str]:
        """Start logging"""
        response = self.send_command("startlogging")
        
        if response == "done startlogging":
            self.is_logging = True
            return True, "Logging started successfully"
        elif response == "failed startlogging logging":
            return False, "Device is already logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def stop_logging(self) -> Tuple[bool, str]:
        """Stop logging"""
        response = self.send_command("stoplogging")
        
        if response == "done stoplogging":
            self.is_logging = False
            return True, "Logging stopped successfully"
        elif response == "failed stoplogging notlogging":
            return True, "Device is not currently logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def get_files(self) -> Tuple[bool, List[Dict]]:
        """Get list of files on SD card"""
        response = self.send_command("files")
        
        # First response might be memory info, need to look for "files start"
        if response and response.startswith("memory"):
            # Read the next line which should be "files start"
            response = self.read_line(timeout=5)
        
        if not response or response != "files start":
            return False, []
        
        files = []
        while True:
            line = self.read_line(timeout=5)
            if not line:
                return False, []
            
            if line.startswith("file "):
                parts = line.split()
                if len(parts) >= 3:
                    filename = parts[1]
                    filesize = int(parts[2])
                    files.append({
                        "name": filename,
                        "size": filesize
                    })
            elif line == "done files":
                return True, files
    
    def download_file(self, filename: str) -> Tuple[bool, List[str], str]:
        """Download a file from SD card"""
        response = self.send_command(f"download {filename}")
        
        if response == "download start":
            lines = []
            while True:
                line = self.read_line(timeout=5)
                if not line:
                    return False, lines, "Timeout reading file"
                
                if line == "download stop":
                    return True, lines, "Download completed"
                elif line == "download failed":
                    return False, lines, "Download failed"
                elif line.startswith("download "):
                    # Extract the actual line content after "download "
                    content = line[9:]  # Skip "download "
                    lines.append(content)
        elif response == "failed download nofile":
            return False, [], "File does not exist"
        else:
            return False, [], f"Unexpected response: {response}"
    
    def delete_file(self, filename: str) -> Tuple[bool, str]:
        """Delete a file from SD card"""
        response = self.send_command(f"delete {filename}")
        
        if response == "done delete":
            return True, "File deleted successfully"
        elif response == "failed delete nofile":
            return False, "File does not exist"
        else:
            return False, f"Unexpected response: {response}"
    
    def get_time(self) -> Tuple[bool, Optional[datetime], str]:
        """Get current time from RTC"""
        response = self.send_command("timeget")
        
        if response and response.startswith("time "):
            try:
                # Parse: time yyyy,mm,dd,hh,mm,ss
                time_str = response[5:]  # Skip "time "
                parts = time_str.split(',')
                if len(parts) == 6:
                    year = int(parts[0])
                    month = int(parts[1])
                    day = int(parts[2])
                    hour = int(parts[3])
                    minute = int(parts[4])
                    second = int(parts[5])
                    
                    dt = datetime(year, month, day, hour, minute, second)
                    return True, dt, "Time retrieved successfully"
            except (ValueError, IndexError):
                return False, None, "Failed to parse time"
        
        return False, None, f"Unexpected response: {response}"
    
    def set_time(self, dt: datetime) -> Tuple[bool, str]:
        """Set time in RTC"""
        cmd = f"timeset {dt.year} {dt.month} {dt.day} {dt.hour} {dt.minute} {dt.second}"
        response = self.send_command(cmd)
        
        if response == "done timeset":
            return True, "Time set successfully"
        elif response == "failed timeset invalidtime":
            return False, "Invalid time provided"
        elif response == "failed timeset logging":
            return False, "Cannot set time while logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def calibrate(self, sensor_number: int, gas_percentage: float) -> Tuple[bool, str]:
        """Calibrate a specific sensor"""
        response = self.send_command(f"calibrate {sensor_number} {gas_percentage}")
        
        if response == "done calibration":
            return True, "Calibration completed successfully"
        elif response == "failed calibrate logging":
            return False, "Cannot calibrate while logging"
        elif response == "failed calibrate invalidpercent":
            return False, "Invalid gas percentage"
        elif response == "failed calibrate invalidsensor":
            return False, "Invalid sensor number"
        else:
            return False, f"Unexpected response: {response}"
    
    def get_timing(self) -> Tuple[bool, Dict, str]:
        """Get open and flush timing"""
        response = self.send_command("timingget")
        
        if response and response.startswith("timing "):
            try:
                parts = response.split()
                if len(parts) == 3:
                    self.open_time_ms = int(parts[1])
                    self.flush_time_ms = int(parts[2])
                    return True, {
                        "open_time_ms": self.open_time_ms,
                        "flush_time_ms": self.flush_time_ms
                    }, "Timing retrieved successfully"
            except (ValueError, IndexError):
                return False, {}, "Failed to parse timing"
        
        return False, {}, f"Unexpected response: {response}"
    
    def set_timing(self, open_time_ms: int, flush_time_ms: int) -> Tuple[bool, str]:
        """Set open and flush timing"""
        response = self.send_command(f"timingset {open_time_ms} {flush_time_ms}")
        
        if response == "done timingset":
            self.open_time_ms = open_time_ms
            self.flush_time_ms = flush_time_ms
            return True, "Timing set successfully"
        elif response == "failed timingset nofiles":
            return False, "Files not working"
        elif response == "failed timingset nochange":
            return False, "Values are the same as current settings"
        elif response == "failed timingset novalue":
            return False, "Invalid values provided"
        elif response == "failed timingset logging":
            return False, "Cannot change timing while logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def get_service(self) -> Tuple[bool, str, str]:
        """Get service information for channels"""
        response = self.send_command("serviceget")
        
        if response and response.startswith("service "):
            self.service_sequence = response[8:]  # Skip "service "
            return True, self.service_sequence, "Service info retrieved successfully"
        
        return False, "", f"Unexpected response: {response}"
    
    def set_service(self, service_sequence: str) -> Tuple[bool, str]:
        """Set service information for channels"""
        if len(service_sequence) != 15 or not all(c in '01' for c in service_sequence):
            return False, "Invalid service sequence format"
        
        response = self.send_command(f"serviceset {service_sequence}")
        
        if response == "done serviceset":
            self.service_sequence = service_sequence
            return True, "Service states set successfully"
        elif response == "failed serviceset nofiles":
            return False, "Files not working"
        elif response == "failed serviceset invaliddata":
            return False, "Invalid data format"
        elif response == "failed serviceset logging":
            return False, "Cannot change service states while logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def get_past_values(self) -> Tuple[bool, Dict[int, List[float]], str]:
        """Get most recent values for each sensor for each channel"""
        response = self.send_command("getpast")
        
        if response and response.startswith("pastdata "):
            try:
                data_str = response[9:]  # Skip "pastdata "
                parts = data_str.split()
                
                past_data = {}
                for i in range(15):  # 15 channels
                    if i < len(parts):
                        # Each channel data is a comma-separated list of sensor values
                        channel_data = [float(v) for v in parts[i].split(',') if v]
                        past_data[i] = channel_data
                
                self.past_data = past_data
                return True, past_data, "Past data retrieved successfully"
            except (ValueError, IndexError):
                return False, {}, "Failed to parse past data"
        
        return False, {}, f"Unexpected response: {response}"
    
    def get_sensor_info(self) -> Tuple[bool, Dict[int, str], str]:
        """Get information about connected sensors"""
        response = self.send_command("sensorget")
        
        if response and response.startswith("sensortypes "):
            try:
                data_str = response[12:]  # Skip "sensortypes "
                parts = data_str.split()
                
                sensor_types = {}
                i = 0
                while i + 1 < len(parts):
                    sensor_num = int(parts[i])
                    sensor_type = parts[i+1]
                    sensor_types[sensor_num] = sensor_type
                    i += 2
                
                self.sensor_types = sensor_types
                return True, sensor_types, "Sensor info retrieved successfully"
            except (ValueError, IndexError):
                return False, {}, "Failed to parse sensor info"
        
        return False, {}, f"Unexpected response: {response}"
    
    def enable_recirculation(self) -> Tuple[bool, str]:
        """Enable recirculation"""
        response = self.send_command("recirculateenable")
        
        if response == "done recirculateenable":
            self.recirculation_enabled = True
            return True, "Recirculation enabled successfully"
        elif response == "failed recirculateenable nofiles":
            return False, "Files not working"
        elif response == "failed recirculateenable alreadyenabled":
            return False, "Recirculation already enabled"
        else:
            return False, f"Unexpected response: {response}"
    
    def disable_recirculation(self) -> Tuple[bool, str]:
        """Disable recirculation"""
        response = self.send_command("recirculatedisable")
        
        if response == "done recirculatedisable":
            self.recirculation_enabled = False
            return True, "Recirculation disabled successfully"
        elif response == "failed recirculatedisable nofiles":
            return False, "Files not working"
        elif response == "failed recirculatedisable alreadydisabled":
            return False, "Recirculation already disabled"
        else:
            return False, f"Unexpected response: {response}"
    
    def set_recirculation_days(self, days: int) -> Tuple[bool, str]:
        """Set number of days between recirculation runs"""
        if days <= 0:
            return False, "Days must be greater than 0"
        
        response = self.send_command(f"recirculatesetdays {days}")
        
        if response == "done recirculatesetdays":
            self.recirculation_days = days
            return True, "Recirculation days set successfully"
        elif response == "failed recirculatesetdays nofiles":
            return False, "Files not working"
        elif response == "failed recirculatesetdays invalidvalue":
            return False, "Invalid number of days"
        elif response == "failed recirculatesetdays logging":
            return False, "Cannot change recirculation days while logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def set_recirculation_time(self, hour: int, minute: int) -> Tuple[bool, str]:
        """Set recirculation time"""
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return False, "Invalid time values"
        
        response = self.send_command(f"recirculatesettime {hour} {minute}")
        
        if response == "done recirculatesettime":
            self.recirculation_hour = hour
            self.recirculation_minute = minute
            return True, "Recirculation time set successfully"
        elif response == "failed recirculatesettime nofiles":
            return False, "Files not working"
        elif response == "failed recirculatesettime invalidtime":
            return False, "Invalid time values"
        elif response == "failed recirculatesettime logging":
            return False, "Cannot change recirculation time while logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def send_raw_command(self, command: str) -> str:
        """Send a raw command to the device"""
        return self.send_command(command)