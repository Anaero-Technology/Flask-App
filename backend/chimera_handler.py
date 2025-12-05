import time
import json
import socket
import threading
import subprocess
import platform
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
        self.recirculation_mode = 0  # 0=disabled, 1=automatic, 2=manual
        self.recirculation_days = 1
        self.recirculation_hour = 0
        self.recirculation_minute = 0
        self.sensor_types = {}
        self.past_data = {}
        self.app = None  # Flask app context for database operations
        self.test_id = None  # Current test ID for database logging

        # IP monitoring daemon thread
        self.ip_monitor_thread = None
        self.ip_monitor_running = False
        self.last_known_ip = None
        self.last_known_ssids = set()  # Track SSIDs we've already sent

        self.register_automatic_handler("datapoint", self._print_datapoint)
        self.register_automatic_handler("connect", self._handle_wifi_connect)
        self.register_automatic_handler("calibration", self._handle_calibration)
        
    def connect(self):
        super().connect(self.port)
        # Get device info immediately after connection
        self._get_device_info()
        # Start IP monitoring daemon
        self.start_ip_monitor()

    def disconnect(self):
        # Stop IP monitoring daemon
        self.stop_ip_monitor()
        super().disconnect()
    
    
    def _print_datapoint(self, line: str):
        """Process automatic datapoint messages and send SSE notification"""
        parts = line.split()
        # Format: datapoint [date_time] [seconds_elapsed] [channel_number] [each_sensor_data]
        # Minimum parts: datapoint + date + seconds_elapsed + channel + 1 sensor (8 parts) = 12 parts
        if len(parts) >= 12:
            try:
                # Parse date format: YYYY.MM.DD.HH.MM.SS
                try:
                    dt_str = parts[1]
                    dt = datetime.strptime(dt_str, "%Y.%m.%d.%H.%M.%S")
                    timestamp = int(dt.timestamp())
                except ValueError:
                    print(f"[CHIMERA] Failed to parse date format: {parts[1]}")
                    return

                seconds_elapsed = int(parts[2])
                channel = int(parts[3])
                sensor_data = []

                # Parse all sensors (each sensor has 8 parts: num, name, 6 values)
                i = 4  # Start after seconds_elapsed and channel number
                while i + 7 < len(parts):  # Need at least 8 parts for a sensor
                    try:
                        sensor_num = int(parts[i])
                        gas_name = parts[i + 1]
                        peak_value = float(parts[i + 2])
                        peak_parts = [
                            float(parts[i + 3]),
                            float(parts[i + 4]),
                            float(parts[i + 5]),
                            float(parts[i + 6]),
                            float(parts[i + 7])
                        ]

                        sensor_data.append({
                            "sensor_number": sensor_num,
                            "gas_name": gas_name,
                            "peak_value": peak_value,
                            "peak_parts": peak_parts
                        })

                        i += 8  # Move to next sensor
                    except (ValueError, IndexError):
                        break

                print(f"[CHIMERA DATAPOINT] Channel {channel} - {len(sensor_data)} sensors")

                # Send SSE notification with all sensors grouped
                if self.app and sensor_data:
                    try:
                        with self.app.app_context():
                            from flask_sse import sse
                            # Group all gases into one event
                            sse_data = {
                                "type": "gas_analysis",
                                "device_name": self.device_name,
                                "channel": channel,
                                "timestamp": timestamp,
                                "details": {
                                    "gases": [
                                        {
                                            "gas": sensor["gas_name"],
                                            "peak": sensor["peak_value"],
                                            "sensor": sensor["sensor_number"]
                                        }
                                        for sensor in sensor_data
                                    ]
                                }
                            }
                            sse.publish(sse_data, type='gas_analysis')
                    except Exception as e:
                        print(f"SSE publish failed: {e}")

                # Save to database if test_id is set
                if self.test_id and self.app and hasattr(self, 'id'):
                    try:
                        with self.app.app_context():
                            from database.models import ChimeraRawData, db

                            for sensor in sensor_data:
                                raw_data = ChimeraRawData(
                                    test_id=self.test_id,
                                    device_id=self.id,
                                    channel_number=channel,
                                    timestamp=timestamp,
                                    seconds_elapsed=seconds_elapsed,
                                    sensor_number=sensor["sensor_number"],
                                    gas_name=sensor["gas_name"],
                                    peak_value=sensor["peak_value"],
                                    peak_parts=json.dumps(sensor["peak_parts"])
                                )
                                db.session.add(raw_data)

                            db.session.commit()
                            print(f"Saved {len(sensor_data)} sensor readings to database")
                    except Exception as e:
                        print(f"Failed to save datapoint to database: {e}")
                        try:
                            db.session.rollback()
                        except:
                            pass

            except (ValueError, IndexError) as e:
                print(f"Failed to parse datapoint: {e}")
                pass

    def _handle_calibration(self, line: str):
        """Process automatic calibration messages and send SSE updates"""
        try:
            parts = line.split()
            if len(parts) >= 2:
                stage = parts[1]

                # Ignore calibration info messages
                if stage == 'info':
                    return

                time_ms = int(parts[2]) if len(parts) >= 3 else 0

                # Send SSE notification
                if self.app:
                    with self.app.app_context():
                        from flask_sse import sse
                        sse.publish(
                            {
                                "device_id": self.id,
                                "stage": stage,
                                "time_ms": time_ms
                            },
                            type='calibration_progress'
                        )

        except (ValueError, IndexError) as e:
            print(f"Failed to parse calibration message: {e}")
            pass

    def set_name(self, name: str) -> bool:
        self.device_name = name
        return True
    
    def _get_device_info(self):
        """Get device information using the info command"""
        if self.connection.is_open:
            response = self.send_command("info")
            if response and response.startswith("info"):
                # Parse: info [logging_state] [filename] [current_channel] [seconds_elapsed] chimera-max [mac_address]
                # OR: info [logging_state] [filename] [seconds_elapsed] chimera-max [mac_address] (missing channel)
                parts = response.split()
                
                if len(parts) >= 7:
                    self.is_logging = (parts[1] == "true")
                    self.current_log_file = parts[2] if parts[2] != "none" else None
                    self.current_channel = int(parts[3])
                    self.seconds_elapsed = int(parts[4])
                    # parts[5] should be "chimera-max"
                    self.mac_address = parts[6]
                    print(f"[DEBUG] Parsed info (7 parts): logging={self.is_logging}, file={self.current_log_file}")
                elif len(parts) >= 6:
                    # Handle format where channel is missing
                    self.is_logging = (parts[1] == "true")
                    self.current_log_file = parts[2] if parts[2] != "none" else None
                    self.current_channel = 0 # Unknown
                    self.seconds_elapsed = int(parts[3])
                    # parts[4] should be "chimera-max"
                    self.mac_address = parts[5]
                    print(f"[DEBUG] Parsed info (6 parts): logging={self.is_logging}, file={self.current_log_file}")
                else:
                    print(f"[DEBUG] Info response too short: {response}")
            else:
                print(f"[DEBUG] Invalid info response: {response}")
    
    def get_info(self) -> Dict:
        """Get current device information"""
        self._get_device_info()

        # Get service sequence
        success, service_sequence, _ = self.get_service()

        return {
            "device_name": self.device_name,
            "mac_address": self.mac_address,
            "is_logging": self.is_logging,
            "current_channel": self.current_channel,
            "seconds_elapsed": self.seconds_elapsed,
            "port": self.port,
            "service_sequence": service_sequence if success else '111111111111111'
        }
    
    def start_logging(self, filename: str) -> Tuple[bool, str]:
        """Start logging to a specific file"""
        
        self.set_time(datetime.now())
        self.send_command_no_wait(f"startlogging {filename}")
        
        # Read through all queued responses until we find the final result
        while True:
            response = self.get_response(timeout=5.0)
            if response:
                print(f"[DEBUG] start_logging received: {response}")
            
            if not response:
                return False, "Timeout waiting for start logging response"
                
            if response == "done startlogging":
                self.is_logging = True
                self.current_log_file = filename
                return True, "Logging started successfully"
            elif response == "failed startlogging logging":
                return False, "Device is already logging"
            elif response.startswith("failed startlogging"):
                return False, f"Start logging failed: {response}"
            # Continue reading other queued messages like "valve all closed latch put in queue"
    
    def stop_logging(self) -> Tuple[bool, str]:
        """Stop logging"""
        self.send_command_no_wait("stoplogging")
        
        # Read through all queued responses until we find the final result
        while True:
            response = self.get_response(timeout=5.0)
            if not response:
                return False, "Timeout waiting for stop logging response"
                
            if response == "done stoplogging":
                self.is_logging = False
                return True, "Logging stopped successfully"
            elif response == "failed stoplogging notlogging":
                return False, "Device is already not logging"
            elif response.startswith("failed stoplogging"):
                return False, f"Stop logging failed: {response}"
            # Continue reading other queued messages
    
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

    def set_channel_timing(self, channel: int, open_time_seconds: int) -> Tuple[bool, str]:
        """Set the open time for a specific channel

        Args:
            channel: Channel number (1-15)
            open_time_seconds: Open time in seconds
        """
        if not (1 <= channel <= 15):
            return False, "Channel must be between 1 and 15"

        if open_time_seconds <= 0:
            return False, "Open time must be greater than 0"

        response = self.send_command(f"channeltiming {channel} {open_time_seconds}")

        if response == "done timeset":
            return True, f"Channel {channel} timing set to {open_time_seconds}s"
        else:
            return False, f"Unexpected response: {response}"
        """
        elif response == "failed timeset invalidchannel":
            return False, "Invalid channel number"
        elif response == "failed timeset invalidtime":
            return False, "Invalid time value"
        elif response == "failed timeset logging":
            return False, "Cannot change channel timing while logging"
        """
        

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
    
    def set_recirculate(self, mode: int) -> Tuple[bool, str]:
        """Set recirculation mode: 0=disabled, 1=automatic, 2=manual"""
        if mode not in [0, 1, 2]:
            return False, "Invalid mode. Must be 0, 1, or 2"

        response = self.send_command(f"recirculateset {mode}")

        if response == "done recirculateset":
            self.recirculation_mode = mode
            return True, f"Recirculation mode set to {mode}"
        elif response == "failed recirculateset nofiles":
            return False, "Files not working"
        elif response == "failed recirculateset invalidmode":
            return False, "Invalid mode"
        else:
            return False, f"Unexpected response: {response}"
    
    def enable_recirculation(self) -> Tuple[bool, str]:
        """Enable recirculation (backward compatibility - sets to automatic mode)"""
        return self.set_recirculate(1)
    
    def disable_recirculation(self) -> Tuple[bool, str]:
        """Disable recirculation (backward compatibility - sets to disabled mode)"""
        return self.set_recirculate(0)
    
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
    
    def recirculate_flag(self, channel: int, duration: int, pump_power: int) -> Tuple[bool, str]:
        """Flag a channel for recirculation (manual mode only)
        
        Args:
            channel: Gas channel number (1-15)
            duration: Number of seconds to pump the gas
            pump_power: Percentage of pump power to use (1-100)
        """
        # Validate parameters
        if not (1 <= channel <= 15):
            return False, "Channel must be between 1 and 15"
        
        if duration <= 0:
            return False, "Duration must be greater than 0"
        
        if not (1 <= pump_power <= 100):
            return False, "Pump power must be between 1 and 100"
        
        response = self.send_command(f"recirculateflag {channel} {duration} {pump_power}")
        
        if response == "done recirculateflag":
            return True, f"Channel {channel} flagged for recirculation successfully"
        elif response == "failed recirculateflag invalidvalues":
            return False, "Invalid values entered"
        elif response == "failed recirculateflag wrongmode":
            return False, "Not in manual mode"
        else:
            return False, f"Unexpected response: {response}"

    def get_recirculation_info(self) -> Tuple[bool, Dict]:
        """Get recirculation information from device"""
        response = self.send_command("recirculateinfo")

        if response and response.startswith("recirculateinfo "):
            # Parse: recirculateinfo [recirculating] [days_between] [hour] [minute] [last_year] [last_month] [last_day]
            parts = response.split()
            if len(parts) >= 8:
                recirculating = parts[1] == "1"
                days_between = int(parts[2])
                hour = int(parts[3])
                minute = int(parts[4])
                last_year = int(parts[5])
                last_month = int(parts[6])
                last_day = int(parts[7])

                # Update internal state
                # recirculating is 0=disabled, 1=automatic, 2=manual
                self.recirculation_mode = recirculating
                self.recirculation_days = days_between
                self.recirculation_hour = hour
                self.recirculation_minute = minute

                mode_names = ['disabled', 'automatic', 'manual']
                info = {
                    "recirculation_mode": recirculating,
                    "recirculation_mode_name": mode_names[recirculating] if 0 <= recirculating <= 2 else 'unknown',
                    "days_between": days_between,
                    "hour": hour,
                    "minute": minute,
                    "last_recirculation_date": {
                        "year": last_year,
                        "month": last_month,
                        "day": last_day
                    }
                }

                return True, info

        return False, {}

    def set_test_id(self, test_id):
        """Set the current test ID for database logging"""
        self.test_id = test_id
    
    def send_raw_command(self, command: str) -> str:
        """Send a raw command to the device"""
        return self.send_command(command)

    def _handle_wifi_connect(self, line: str):
        """Handle WiFi connection request: connect [SSID] [Password]
        SSID may contain spaces. Last space separates SSID from password.
        """
        try:
            # Remove "connect " prefix and split on last space
            remainder = line[8:]  # Remove "connect "
            parts = remainder.rsplit(' ', 1)  # Split from right, max 1 split

            ssid = parts[0]
            password = parts[1] if len(parts) > 1 else ""

            print(f"[CHIMERA WIFI] Connecting to '{ssid}'")

            # Connect to WiFi
            success, message = self._connect_to_wifi(ssid, password)

            # Send response to chimera
            if self.connection and self.connection.is_open:
                response = b"wificonnected\n" if success else b"wififailed\n"
                self.connection.write(response)
                print(f"[CHIMERA WIFI] {'Connected' if success else 'Failed'}: {message}")

        except Exception as e:
            print(f"[CHIMERA WIFI] Error: {e}")

    def _connect_to_wifi(self, ssid: str, password: str) -> tuple[bool, str]:
        """Connect to WiFi network"""
        try:
            system = platform.system()

            if system == 'Darwin':  # macOS
                result = subprocess.run(
                    ['networksetup', '-setairportnetwork', 'en0', ssid, password],
                    capture_output=True, text=True, timeout=30
                )
                return (result.returncode == 0, result.stderr.strip() if result.stderr else "Success")
            
            elif system == 'Linux':
                # First, try to delete any existing connection with this SSID
                # This avoids conflicts with stale connection profiles
                subprocess.run(
                    ['nmcli', 'connection', 'delete', ssid],
                    capture_output=True, text=True, timeout=10
                )
                
                # Now connect with fresh credentials
                # Use --ask=no to prevent interactive prompts
                result = subprocess.run(
                    ['nmcli', 'device', 'wifi', 'connect', ssid, 'password', password],
                    capture_output=True, text=True, timeout=30
                )
                
                if result.returncode == 0:
                    return True, "Connected successfully"
                
                # If that fails, try creating a new connection profile explicitly
                if result.returncode != 0:
                    # Try with explicit connection creation
                    result2 = subprocess.run(
                        ['nmcli', 'connection', 'add',
                         'type', 'wifi',
                         'con-name', ssid,
                         'ssid', ssid,
                         'wifi-sec.key-mgmt', 'wpa-psk',
                         'wifi-sec.psk', password],
                        capture_output=True, text=True, timeout=30
                    )
                    
                    if result2.returncode == 0:
                        # Activate the connection
                        result3 = subprocess.run(
                            ['nmcli', 'connection', 'up', ssid],
                            capture_output=True, text=True, timeout=30
                        )
                        if result3.returncode == 0:
                            return True, "Connected successfully"
                        return False, result3.stderr.strip() if result3.stderr else "Failed to activate connection"
                    
                return False, result.stderr.strip() if result.stderr else "Connection failed"
            else:
                return False, "Unsupported OS"

        except Exception as e:
            return False, str(e)

    def _get_local_ip(self) -> Optional[str]:
        """Get the local IP address by attempting to connect to an external server"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except Exception:
            return None

    def _get_wifi_ssids(self) -> List[str]:
        """Get list of available WiFi SSIDs"""
        try:
            system = platform.system()

            if system == 'Darwin':  # macOS
                result = subprocess.run(
                    ['system_profiler', 'SPAirPortDataType'],
                    capture_output=True,
                    text=True,
                    timeout=15
                )

                if result.returncode != 0:
                    return []

                ssids = []
                lines = result.stdout.split('\n')
                in_other_networks = False

                for line in lines:
                    stripped = line.strip()

                    if 'Other Local Wi-Fi Networks:' in line:
                        in_other_networks = True
                        continue

                    if not in_other_networks:
                        continue

                    # New network entry (ends with :)
                    if stripped.endswith(':') and not any(x in stripped for x in ['PHY Mode', 'Channel', 'Network Type', 'Security', 'Signal']):
                        ssid = stripped[:-1]  # Remove trailing ':'
                        # Filter out system entries
                        if ssid not in ['awdl0', 'llw0', 'Current Network Information'] and not ssid.startswith('en'):
                            if ssid and ssid.strip():
                                ssids.append(ssid)

                return ssids

            elif system == 'Linux':
                # Use nmcli (NetworkManager)
                result = subprocess.run(
                    ['nmcli', '-t', '-f', 'SSID', 'dev', 'wifi', 'list'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                if result.returncode == 0:
                    ssids = []
                    lines = result.stdout.strip().split('\n')
                    for line in lines:
                        ssid = line.strip()
                        if ssid and ssid != '--':
                            ssids.append(ssid)
                    return ssids

                return []

            else:
                return []

        except Exception as e:
            print(f"[CHIMERA IP MONITOR] Error scanning WiFi SSIDs: {e}")
            return []

    def clear_ssids(self) -> Tuple[bool, str]:
        """Clear all WiFi SSIDs from the Chimera's stored list"""
        response = self.send_command("clearssids")
        
        if response == "done clearssids":
            self.last_known_ssids.clear()  # Also clear our local tracking
            return True, "SSID list cleared"
        else:
            return False, f"Unexpected response: {response}"

    def _ip_monitor_daemon(self):
        """Background daemon that monitors IP connection and sends ipset command to chimera"""
        print(f"[CHIMERA IP MONITOR] Started monitoring thread for {self.device_name}")

        while self.ip_monitor_running:
            try:
                # Check for IP connection
                current_ip = self._get_local_ip()

                if current_ip:
                    # Only send ipset command if IP has changed or this is the first check
                    if current_ip != self.last_known_ip:
                        print(f"[CHIMERA IP MONITOR] IP detected: {current_ip}")

                        # Send ipset command to chimera
                        if self.connection and self.connection.is_open:
                            command = f"ipset {current_ip}:5173\n"
                            try:
                                self.connection.write(command.encode())
                                print(f"[CHIMERA IP MONITOR] Sent: ipset {current_ip}")
                                self.last_known_ip = current_ip
                            except Exception as e:
                                print(f"[CHIMERA IP MONITOR] Failed to send ipset command: {e}")
                        else:
                            print(f"[CHIMERA IP MONITOR] Connection not open, cannot send ipset command")

                    # Clear and resend all WiFi SSIDs every cycle
                    ssids = self._get_wifi_ssids()
                    if ssids:
                        print(f"[CHIMERA IP MONITOR] Found {len(ssids)} WiFi networks")

                        if self.connection and self.connection.is_open:
                            # Clear old SSIDs first
                            try:
                                self.connection.write(b"clearssids\n")
                                time.sleep(0.1)
                            except Exception as e:
                                print(f"[CHIMERA IP MONITOR] Failed to clear SSIDs: {e}")
                            
                            # Send all current SSIDs
                            for ssid in ssids:
                                command = f"ssidadd {ssid}\n"
                                try:
                                    self.connection.write(command.encode())
                                    time.sleep(0.1)
                                except Exception as e:
                                    print(f"[CHIMERA IP MONITOR] Failed to send ssidadd: {e}")
                        else:
                            print(f"[CHIMERA IP MONITOR] Connection not open, cannot send ssidadd commands")
                    else:
                        print(f"[CHIMERA IP MONITOR] No WiFi networks found")

                else:
                    if self.last_known_ip is not None:
                        print(f"[CHIMERA IP MONITOR] No connection detected")
                        self.last_known_ip = None

            except Exception as e:
                print(f"[CHIMERA IP MONITOR] Error in monitoring loop: {e}")

            # Wait 30 seconds before next check
            time.sleep(30)

        print(f"[CHIMERA IP MONITOR] Stopped monitoring thread for {self.device_name}")

    def start_ip_monitor(self) :
        """Start the IP monitoring daemon thread"""
        if not self.ip_monitor_running:
            self.ip_monitor_running = True
            self.ip_monitor_thread = threading.Thread(
                target=self._ip_monitor_daemon,
                daemon=True,
                name=f"ChimeraIPMonitor-{self.port}"
            )
            self.ip_monitor_thread.start()
            print(f"[CHIMERA IP MONITOR] IP monitoring started for {self.device_name}")

    def stop_ip_monitor(self):
        """Stop the IP monitoring daemon thread"""
        if self.ip_monitor_running:
            self.ip_monitor_running = False
            if self.ip_monitor_thread:
                self.ip_monitor_thread.join(timeout=2)
            # Reset tracking when stopping
            self.last_known_ip = None
            self.last_known_ssids.clear()
            print(f"[CHIMERA IP MONITOR] IP monitoring stopped for {self.device_name}")