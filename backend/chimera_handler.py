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
        self.current_status = 'idle'  # 'idle', 'flushing', 'reading'
        self.seconds_elapsed = 0
        self.channel_times_ms = [0] * 15  # Open/read times for channels 0-14
        self.flush_time_ms = 0  # Flush time (channel 15)
        self.service_sequence = "111111111111111"  # 15 channels
        self.recirculation_mode = 0  # 0=disabled, 1=automatic, 2=manual
        self.recirculation_delay_seconds = None  # Seconds between periodic recirculation runs (must be set for periodic mode)
        self.sensor_types = {}
        self.past_data = {}
        self.app = None  # Flask app context for database operations
        self.test_id = None  # Current test ID for database logging

        # IP monitoring daemon thread
        self.ip_monitor_thread = None
        self.ip_monitor_running = False
        self.is_network_connected = False
        self.last_known_ip = None
        self.last_known_ssids = set()  # Track SSIDs we've already sent

        self.register_automatic_handler("datapoint", self._print_datapoint)
        self.register_automatic_handler("recirculate ", self._handle_recirculate)  # Note: trailing space to avoid matching "recirculateflag"
        self.register_automatic_handler("connect", self._handle_wifi_connect)
        self.register_automatic_handler("calibration", self._handle_calibration)
        self.register_automatic_handler("valve", self._handle_valve)
        
    def connect(self) -> bool:
        """Connect to device and get info. Returns True on success."""
        try:
            super().connect(self.port)
            # Get device info immediately after connection
            if not self._get_device_info():
                self.disconnect()
                return False
            # Start IP monitoring daemon
            self.start_ip_monitor()
            return True
        except Exception as e:
            print(f"[ChimeraHandler] Connection failed: {e}")
            return False

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
                if not (self.test_id and self.app and hasattr(self, 'id')):
                    print(f"[CHIMERA DATAPOINT] ERROR NOT SAVING - test_id={self.test_id}, app={self.app is not None}, has_id={hasattr(self, 'id')}, id={getattr(self, 'id', 'NO_ATTR')}")
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

    def _handle_recirculate(self, line: str):
        """Process automatic recirculate messages and save to database
        Format: recirculate [date_time] [seconds_elapsed] [channel_number_r] [sensor_num] [gas_name] [peak_value] [peak_part0-4] ...
        Each sensor has: sensor_num, gas_name, peak_value, and 5 peak_parts (8 values per sensor)
        Channel number has _r suffix that needs to be stripped
        """
        parts = line.split()
        if len(parts) < 6:
            print(f"[CHIMERA RECIRCULATE] Too few parts: {line}")
            return

        try:
            # Parse date format: YYYY.MM.DD.HH.MM.SS
            try:
                dt_str = parts[1]
                dt = datetime.strptime(dt_str, "%Y.%m.%d.%H.%M.%S")
                timestamp = int(dt.timestamp())
            except ValueError:
                print(f"[CHIMERA RECIRCULATE] Failed to parse date format: {parts[1]}")
                return

            seconds_elapsed = int(parts[2])
            # Channel number has _r suffix, strip it
            channel_str = parts[3].rstrip('_r')
            channel = int(channel_str)

            sensor_data = []
            i = 4  # Start after recirculate, date_time, seconds_elapsed, channel

            # Parse sensors: sensor_num, gas_name, peak_value, and 5 peak_parts (8 values per sensor)
            while i + 7 < len(parts):
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
                    i += 8  # Move to next sensor (sensor_num + gas_name + peak_value + 5 peak_parts)
                except (ValueError, IndexError):
                    break

            print(f"[CHIMERA RECIRCULATE] Channel {channel} - {len(sensor_data)} sensors")

            # Save to database if test_id is set
            if not (self.test_id and self.app and hasattr(self, 'id')):
                print(f"[CHIMERA RECIRCULATE]  ERROR NOT SAVING - test_id={self.test_id}, app={self.app is not None}, has_id={hasattr(self, 'id')}, id={getattr(self, 'id', 'NO_ATTR')}")
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
                        print(f"[CHIMERA RECIRCULATE] Saved {len(sensor_data)} sensor readings to database")
                except Exception as e:
                    print(f"[CHIMERA RECIRCULATE] Failed to save to database: {e}")
                    try:
                        db.session.rollback()
                    except:
                        pass

        except (ValueError, IndexError) as e:
            print(f"[CHIMERA RECIRCULATE] Failed to parse: {e} - Line: {line}")

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

    def _handle_valve(self, line: str):
        """Process valve status messages to track flushing/reading state
        Format: valve [0-15] opened/closed latch
        - Valve 0-14 = channels 1-15 (reading)
        - Valve 15 = flush valve (flushing)
        """
        print(f"[CHIMERA VALVE] Handler triggered with line: {line}")
        try:
            parts = line.split()
            if len(parts) >= 3:
                valve_num = int(parts[1])
                state = parts[2]  # 'opened' or 'closed'

                if state == 'opened':
                    if valve_num == 15:
                        # Flush valve opened
                        self.current_status = 'flushing'
                        print(f"[CHIMERA STATUS] Flushing started")
                    else:
                        # Channel valve opened (valve 0-14 = channel 1-15)
                        self.current_status = 'reading'
                        self.current_channel = valve_num + 1
                        print(f"[CHIMERA STATUS] Reading channel {self.current_channel}")
                elif state == 'closed':
                    if valve_num == 15:
                        # Flush valve closed - will transition to reading
                        print(f"[CHIMERA STATUS] Flushing completed")
                    else:
                        # Channel valve closed
                        print(f"[CHIMERA STATUS] Channel {valve_num + 1} closed")

                # Send SSE notification for status change
                if self.app and hasattr(self, 'id'):
                    try:
                        with self.app.app_context():
                            from flask_sse import sse
                            sse.publish(
                                {
                                    "device_id": self.id,
                                    "status": self.current_status,
                                    "channel": self.current_channel
                                },
                                type='chimera_status'
                            )
                    except Exception as e:
                        print(f"[CHIMERA STATUS] SSE publish failed: {e}")

        except (ValueError, IndexError) as e:
            print(f"[CHIMERA STATUS] Failed to parse valve message: {e} - Line: {line}")

    def set_name(self, name: str) -> bool:
        self.device_name = name
        return True
    
    def _get_device_info(self) -> bool:
        """Get device information using the info command. Returns True on success."""
        if not self.connection.is_open:
            return False

        response = self.send_command("info", timeout=2.0)

        if response and response.startswith("info"):
            try:
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
                    return True
                elif len(parts) >= 6:
                    # Handle format where channel is missing
                    self.is_logging = (parts[1] == "true")
                    self.current_log_file = parts[2] if parts[2] != "none" else None
                    self.current_channel = 0  # Unknown
                    self.seconds_elapsed = int(parts[3])
                    # parts[4] should be "chimera-max"
                    self.mac_address = parts[5]
                    return True
                else:
                    print(f"[ChimeraHandler] Info response too short: {response}")
                    return False
            except (IndexError, ValueError) as e:
                print(f"[ChimeraHandler] Failed to parse info response: {e}")
                return False

        print(f"[ChimeraHandler] No valid info response received")
        return False
    
    def get_info(self) -> Dict:
        """Get current device information"""
        self._get_device_info()

        # Get service sequence
        success, service_sequence, _ = self.get_service()

        return {
            "device_name": self.device_name,
            "mac_address": self.mac_address,
            "is_logging": self.is_logging,
            "current_status": self.current_status,
            "current_channel": self.current_channel,
            "seconds_elapsed": self.seconds_elapsed,
            "port": self.port,
            "service_sequence": service_sequence if success else '111111111111111'
        }
    
    def start_logging(self, filename: str) -> Tuple[bool, str]:
        """Start logging to a specific file"""
        
        self.set_time()
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
        try:
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
        except OSError as e:
            return False, f"Serial I/O error while stopping logging: {e}"
        except Exception as e:
            return False, f"Failed to stop logging: {e}"
    
    def get_files(self) -> Tuple[bool, Dict]:
        """Get list of files on SD card with memory info"""
        response = self.send_command("files")

        memory_info = None
        # First response might be memory info, need to look for "files start"
        if response and response.startswith("memory"):
            # Parse memory info: "memory [total] [used]"
            parts = response.split()
            if len(parts) >= 3:
                try:
                    memory_info = {
                        "total": int(parts[1]),
                        "used": int(parts[2])
                    }
                except ValueError:
                    pass
            # Read the next line which should be "files start"
            response = self.read_line(timeout=5)

        if not response or response != "files start":
            return False, {"memory": memory_info, "files": []}

        files = []
        while True:
            line = self.read_line(timeout=5)
            if not line:
                return False, {"memory": memory_info, "files": files}

            if line.startswith("file "):
                parts = line.split()
                if len(parts) >= 4:
                    # Format: file [filename] [size] [timestamp]
                    # Timestamp is last, size is second to last, filename is everything in between
                    try:
                        timestamp = int(parts[-1])
                        filesize = int(parts[-2])
                        filename = " ".join(parts[1:-2])
                        print(f"[ChimeraHandler] Parsed: name={filename}, size={filesize}, timestamp={timestamp}")
                        files.append({
                            "name": filename,
                            "size": filesize,
                            "created": timestamp
                        })
                    except ValueError:
                        print(f"[ChimeraHandler] Failed to parse file line: {line}")
                        continue
                elif len(parts) >= 3:
                    # Fallback for old format without timestamp: file [filename] [size]
                    try:
                        filesize = int(parts[-1])
                        filename = " ".join(parts[1:-1])
                        files.append({
                            "name": filename,
                            "size": filesize
                        })
                    except ValueError:
                        print(f"[ChimeraHandler] Failed to parse file line: {line}")
                        continue
            elif line == "done files":
                return True, {"memory": memory_info, "files": files}
    
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
    
    def get_time(self) -> Tuple[bool, Optional[datetime]]:
        """Get current datetime from RTC"""
        response = self.send_command("timeget")
        
        if response and response.startswith("time "):
            try:
                # Parse: time <unix_timestamp>
                timestamp = int(response[5:])  # Skip "time "
                dt = datetime.fromtimestamp(timestamp)
                return True, dt
            except (ValueError, IndexError):
                return False, None
        
        return False, None
    
    def set_time(self) -> Tuple[bool, str]:
        """Set time in RTC to UNIX timestamp."""
        response = self.send_command(f"timeset {time.time()}")
        
        if response == "done timeset":
            return True, "Time set successfully"
        elif response == "failed timeset invalidtime":
            return False, "Invalid time provided"
        elif response == "failed timeset logging":
            return False, "Cannot set time while logging"
        else:
            return False, f"Unexpected response: {response}"
    
    def calibrate(self, sensor_number: int, gas_percentage: float) -> Tuple[bool, str]:
        """Calibrate a specific sensor using manual calibration

        Uses event-driven architecture:
        - Sends command and returns immediately (non-blocking)
        - Calibration progress is sent to frontend via SSE updates
        - Frontend detects completion when progress events stop
        """
        try:
            self.send_command_no_wait(f"calibrate {sensor_number} {gas_percentage}")
            return True, "Calibration started successfully"
        except Exception as e:
            return False, f"Failed to send calibration command: {str(e)}"

    def calibrate_pump(self, sensor_number: int, gas_percentage: float) -> Tuple[bool, str]:
        """Calibrate a specific sensor using pump-based calibration (chimera-max only)

        Uses event-driven architecture:
        - Sends command and returns immediately (non-blocking)
        - Calibration progress is sent to frontend via SSE updates
        - Frontend detects completion when progress events stop
        """
        try:
            self.send_command_no_wait(f"calibratepump {sensor_number} {gas_percentage}")
            return True, "Pump calibration started successfully"
        except Exception as e:
            return False, f"Failed to send calibration command: {str(e)}"

    def get_timing(self) -> Tuple[bool, Dict, str]:
        """Get open and flush timing for all channels

        Response format: timing [ch0] [ch1] ... [ch14] [flush]
        - Channels 0-14: individual open/read times in ms
        - Channel 15 (flush): flush time in ms
        """
        response = self.send_command("timingget")

        if response and response.startswith("timing "):
            try:
                parts = response.split()
                if len(parts) == 17:  # "timing" + 15 channel times + 1 flush time
                    self.channel_times_ms = [int(parts[i]) for i in range(1, 16)]
                    self.flush_time_ms = int(parts[16])
                    return True, {
                        "channel_times_ms": self.channel_times_ms,
                        "flush_time_ms": self.flush_time_ms
                    }, "Timing retrieved successfully"
            except (ValueError, IndexError):
                return False, {}, "Failed to parse timing"

        return False, {}, f"Unexpected response: {response}"
    
    def set_all_timing(self, open_time_ms: int, flush_time_ms: int) -> Tuple[bool, str]:
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

        if response == "done channeltiming":
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
    
    def set_recirculation_delay(self, seconds: int) -> Tuple[bool, str]:
        """Set the time between periodic recirculation runs in automatic mode.

        Args:
            seconds: Time between recirculation runs (must be > 0)
        """
        if seconds <= 0:
            return False, "Seconds must be greater than 0"

        response = self.send_command(f"recirculatedelayset {seconds}")

        if response == "done recirculatedelayset":
            self.recirculation_delay_seconds = seconds
            return True, "Recirculation delay set successfully"
        elif response == "failed recirculatedelayset nofiles":
            return False, "SD card not working"
        elif response == "failed recirculatedelayset invalidtime":
            return False, "Invalid seconds value"
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
            # Parse: recirculateinfo [mode] [delay_seconds]
            parts = response.split()
            if len(parts) >= 3:
                mode = int(parts[1])
                delay_seconds = int(parts[2])

                # Update internal state
                self.recirculation_mode = mode
                self.recirculation_delay_seconds = delay_seconds

                mode_names = ['disabled', 'automatic', 'manual']
                info = {
                    "recirculation_mode": mode,
                    "recirculation_mode_name": mode_names[mode] if 0 <= mode <= 2 else 'unknown',
                    "delay_seconds": delay_seconds
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
                    timeout=5
                )

                if result.returncode == 0:
                    ssids = []
                    lines = result.stdout.strip().split('\n')
                    for line in lines:
                        ssid = line.strip()
                        if ssid and ssid != '--':
                            ssids.append(ssid)
                    return ssids

                # No WiFi adapter or nmcli error — fail silently
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

    def _sync_wifi_ssids_to_device(self, ssids: List[str]) -> None:
        """Send SSID list to the Chimera only when it has changed."""
        unique_ssids = [ssid for ssid in dict.fromkeys(ssids) if ssid]
        current_ssids = set(unique_ssids)

        if not current_ssids:
            print("[CHIMERA IP MONITOR] No WiFi networks found")
            return

        if current_ssids == self.last_known_ssids:
            return

        if not (self.connection and self.connection.is_open):
            print("[CHIMERA IP MONITOR] Connection not open, cannot sync ssidadd commands")
            return

        try:
            response = self.send_command("clearssids", timeout=2.0)
            if response != "done clearssids":
                print(f"[CHIMERA IP MONITOR] clearssids unexpected response: {response}")
                return
        except Exception as e:
            print(f"[CHIMERA IP MONITOR] Failed to clear SSIDs: {e}")
            return

        all_sent = True
        for ssid in unique_ssids:
            try:
                response = self.send_command(f"ssidadd {ssid}", timeout=2.0)
                if response != "done ssidadd":
                    print(f"[CHIMERA IP MONITOR] ssidadd unexpected response: {response}")
                    all_sent = False
            except Exception as e:
                print(f"[CHIMERA IP MONITOR] Failed to send ssidadd: {e}")
                all_sent = False

        if all_sent:
            self.last_known_ssids = current_ssids
            print(f"[CHIMERA IP MONITOR] Synced {len(unique_ssids)} WiFi networks")
        else:
            print("[CHIMERA IP MONITOR] SSID sync incomplete; will retry")

    @staticmethod
    def _get_interface_addresses():
        """Detect active IPv4 addresses grouped by interface type."""
        try:
            result = subprocess.run(
                ["ip", "-4", "-j", "addr", "show"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode != 0:
                return {}
            interfaces = json.loads(result.stdout)
        except Exception:
            return {}

        addrs = {}
        for iface in interfaces:
            name = iface.get("ifname", "")
            addr_info = iface.get("addr_info", [])
            if not addr_info or name == "lo":
                continue
            ip = addr_info[0].get("local", "")
            if not ip or ip.startswith("127."):
                continue
            if name.startswith(("wlan", "wlp")) and "wifi" not in addrs:
                addrs["wifi"] = {"iface": name, "ip": ip}
            elif name.startswith(("eth", "enp")) and "eth" not in addrs:
                addrs["eth"] = {"iface": name, "ip": ip}
        return addrs

    def _ip_monitor_daemon(self):
        """Background daemon that monitors network and sends ipset."""
        print(f"[CHIMERA IP MONITOR] Started monitoring thread for {self.device_name}")
        ipset_sent = False
        last_addrs = {}

        while self.ip_monitor_running:
            try:
                addrs = self._get_interface_addresses()
                network_up = bool(addrs)

                if network_up:
                    just_reconnected = not self.is_network_connected
                    self.is_network_connected = True

                    # Re-send ipset when addresses change
                    if addrs != last_addrs:
                        last_addrs = addrs.copy()
                        ipset_sent = False

                    # Send ipset once on connect (prefers wifi URL for QR display)
                    if not ipset_sent and self.connection and self.connection.is_open:
                        display_url = f"http://{socket.gethostname()}.local:5173"
                        try:
                            response = self.send_command(f"ipset {display_url}", timeout=2.0)
                            if response == "done ipset":
                                ipset_sent = True
                                print(f"[CHIMERA IP MONITOR] ipset sent: {display_url}")
                            else:
                                print(f"[CHIMERA IP MONITOR] ipset unexpected response: {response}")
                        except Exception as e:
                            print(f"[CHIMERA IP MONITOR] Failed to send ipset command: {e}")

                    # Scan/sync SSIDs only when reconnected or when we have no cache yet.
                    if just_reconnected or not self.last_known_ssids:
                        ssids = self._get_wifi_ssids()
                        self._sync_wifi_ssids_to_device(ssids)

                else:
                    if self.is_network_connected:
                        print(f"[CHIMERA IP MONITOR] No connection detected")
                        self.is_network_connected = False
                        self.last_known_ssids.clear()
                        ipset_sent = False
                        last_addrs = {}

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
            self.is_network_connected = False
            self.last_known_ip = None
            self.last_known_ssids.clear()
            print(f"[CHIMERA IP MONITOR] IP monitoring stopped for {self.device_name}")
