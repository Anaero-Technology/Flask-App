import time
import threading
from contextlib import nullcontext
from datetime import datetime
from typing import Optional, Dict, List, Tuple
from flask import has_app_context, current_app
from serial_handler import SerialHandler
from database.models import ChannelConfiguration, db

class BlackBoxHandler(SerialHandler):
    _db_write_lock = threading.RLock()

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
        self._tip_processing_lock = threading.Lock()  # Prevent race conditions with recovery thread

        # Handle automatic messages from the blackbox
        self.register_automatic_handler("tip ", self._print_tips)
        self.register_automatic_handler("counts ", lambda : None)

    def connect(self) -> bool:
        """Connect to device and get info. Returns True on success."""
        try:
            super().connect(self.port)
            # Get device info immediately after connection
            if not self._get_device_info():
                self.disconnect()
                return False
            return True
        except Exception as e:
            print(f"[BlackBoxHandler] Connection failed: {e}")
            return False
    
    def _print_tips(self, line: str):
        """Prints automatic tip messages and sends SSE notification"""
        try:
            # Extract the file line after "tip "
            file_line = line[4:]  # Skip "tip "
            
            # Parse the CSV line: Tip Number, Datetime, Seconds Elapsed, Channel Number, Temperature, Pressure
            parts = file_line.split()

            # Parse timestamp: YYYY.MM.DD.HH.MM.SS
            try:
                dt_str = parts[1].strip()
                dt = datetime.strptime(dt_str, "%Y.%m.%d.%H.%M.%S")
                timestamp = int(dt.timestamp())
            except ValueError:
                print(f"[BLACKBOX] Failed to parse timestamp: {parts[1]}")
                return

            tip_data = {
                "tip_number": int(parts[0]),
                "timestamp": timestamp,
                "seconds_elapsed": int(parts[2]),
                "channel_number": int(parts[3]),
                "temperature" : "N/A" if parts[4] == "-" else float(parts[4]),
                "pressure": float(parts[5])
             }
            

            # Calculate event log data (returns CSV string)
            result_str = self.calculateEventLogTip(tip_data)
            print("Processed Data:", result_str)
            
            print(f"[AUTOMATIC TIP] Tip #{tip_data['tip_number']} - "
                f"Channel: {tip_data['channel_number']}, "
                f"Temp: {tip_data['temperature']}°C, "
                f"Pressure: {tip_data['pressure']} PSI")
            
            # Extract volume and cumulative tips from result string if successful
            volume = 0.0
            cumulative_tips = 0
            if result_str:
                try:
                    res_parts = result_str.split(',')
                    if len(res_parts) >= 11:
                        cumulative_tips = int(res_parts[9])
                        volume = float(res_parts[10])
                except:
                    pass

            # Send SSE notification directly
            if self.app:
                try:
                    with self.app.app_context():
                        from flask_sse import sse
                        sse_data = {
                            "type": "tip",
                            "device_name": self.device_name,
                            "channel": tip_data['channel_number'],
                            "timestamp": tip_data['timestamp'],
                            "details": {
                                "volume": volume,
                                "cumulative_tips": cumulative_tips,
                                "pressure": tip_data['pressure'],
                                "temperature": tip_data['temperature']
                            }
                        }
                        sse.publish(sse_data, type='tip')
                        print(f"Published SSE notification: {sse_data}")
                except Exception as e:
                    print(f"SSE publish failed: {e}")
            # Save tip data to database if test_id is set and app context is available
            if self.test_id and self.app and hasattr(self, 'id'):
                try:
                    with BlackBoxHandler._db_write_lock, self.app.app_context():
                        from database.models import BlackboxRawData, db

                        # Check if tips were missed (gap in tip numbers)
                        latest_tip = db.session.query(BlackboxRawData)\
                            .filter_by(test_id=self.test_id, device_id=self.id)\
                            .order_by(BlackboxRawData.tip_number.desc())\
                            .first()

                        if latest_tip:
                            expected_tip = latest_tip.tip_number + 1
                            if tip_data['tip_number'] > expected_tip:
                                # Missed tips detected!
                                missed_count = tip_data['tip_number'] - expected_tip
                                print(f"⚠️  MISSED TIPS DETECTED: Expected tip {expected_tip}, got {tip_data['tip_number']}")
                                print(f"   Missing {missed_count} tip(s). Scheduling recovery in background thread...")

                                # Recover missed tips in a separate thread to avoid blocking serial reader
                                # Recover from expected_tip to current_tip - 1 (exclude current tip, it's being processed now)
                                recovery_thread = threading.Thread(
                                    target=self._recover_missed_tips_background,
                                    args=(expected_tip, tip_data['tip_number'] - 1),
                                    daemon=True
                                )
                                recovery_thread.start() 

                        # Create new BlackboxRawData entry for the current tip
                        raw_data = BlackboxRawData(
                            test_id=self.test_id,
                            device_id=self.id,
                            tip_number=tip_data['tip_number'],
                            channel_number=tip_data['channel_number'],
                            timestamp=tip_data['timestamp'], 
                            seconds_elapsed=tip_data['seconds_elapsed'],
                            temperature=tip_data['temperature'] if tip_data['temperature'] != 'N/A' else None,
                            pressure=tip_data['pressure']
                        )

                        db.session.add(raw_data)
                        db.session.commit()
                        print(f"Saved tip data to database: Test {self.test_id}, Tip #{tip_data['tip_number']}, Channel {tip_data['channel_number']}")

                except Exception as e:
                    print(f"Failed to save tip data to database: {e}")
                    try:
                        db.session.rollback()
                    except:
                        pass
            
      
    
        except (ValueError, IndexError):
            import traceback
            traceback.print_exc()
            pass
  
    def _get_device_info(self) -> bool:
        """Get device information using the info command. Returns True on success."""
        if not self.connection.is_open:
            return False

        self.clear_buffer()
        self.send_command_no_wait("info")

        # Keep reading until we get the info response (may receive other messages first)
        start_time = time.time()
        response = None
        while time.time() - start_time < 5.0:
            resp = self.read_line(timeout=0.5)
            if resp and resp.startswith("info"):
                response = resp
                break

        if response and response.startswith("info"):
            try:
                # Parse: info [logging_state] [logging_file] [device_name] black-box [mac_address]
                parts = response.split()
                if len(parts) >= 6:
                    self.is_logging = (parts[1] == "1")
                    self.current_log_file = parts[2] if parts[2] != "none" else None
                    self.device_name = parts[3]
                    # parts[4] should be "black-box"
                    self.mac_address = parts[5]
                    return True
            except (IndexError, ValueError) as e:
                print(f"[BlackBoxHandler] Failed to parse info response: {e}")
                return False

        print(f"[BlackBoxHandler] No valid info response received")
        return False

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

        self.set_time()
        self.send_command_no_wait(f"start /{filename}.txt")

        # Read responses until we get the final result
        # The device sends intermediate messages like "Setup successfully updated",
        # "Testing Reset", etc. before the final "done start" or "failed start ..."
        start_time = time.time()
        while time.time() - start_time < 30.0:  # 30 second timeout for Arduino init
            response = self.read_line(timeout=2.0)
            if not response:
                continue

            print(f"[start_logging] Received: {response}")

            # Final success responses
            if response == "done start":
                self.is_logging = True
                self.current_log_file = filename
                return True, "Successfully started logging"

            # Final failure responses
            elif response == "failed start nofiles":
                return False, "SD card not working"
            elif response == "failed start alreadyexists":
                return False, "File already exists"
            elif response == "failed start noarduino":
                return False, "Arduino not responding - check hardware connection"
            elif response == "already start":
                return False, "Device already logging"
            elif response.startswith("failed start"):
                return False, f"Start failed: {response}"

            # Intermediate messages - continue waiting
            # "Setup successfully updated", "Testing Reset", "Waiting for clear response...", etc.

        return False, "Timeout waiting for start logging response"
    
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

        memory_info = {"total": 0, "used": 0}
        files = []
        files_started = False

        # Allow a generous wait for the first response from firmware (can be slow),
        # but once file listing has started, stop after a short idle period.
        started_at = time.time()
        last_activity = started_at
        max_total_wait_seconds = 12.0
        post_start_idle_seconds = 1.2

        while (time.time() - started_at) < max_total_wait_seconds:
            line = self.read_line(timeout=0.5)
            if not line:
                if files_started and (time.time() - last_activity) >= post_start_idle_seconds:
                    break
                continue

            last_activity = time.time()
            if line.startswith("memory"):
                parts = line.split()
                if len(parts) >= 3:
                    try:
                        memory_info["total"] = int(parts[1])
                        memory_info["used"] = int(parts[2])
                    except ValueError:
                        pass
            elif line == "file start":
                files_started = True
            elif line == "done files":
                break
            elif files_started and line.startswith("file"):
                parts = line.split()
                if len(parts) >= 3:
                    try:
                        files.append({
                            "name": parts[1],
                            "size": int(parts[2])
                        })
                    except ValueError:
                        continue
        
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

        # Wait for download start, skipping automatic messages
        response = None
        start_time = time.time()
        while time.time() - start_time < 5.0:
            line = self.read_line(timeout=0.5)
            if line is None:
                continue

            # Check for error responses
            if line == "failed download nofile":
                return False, ["File does not exist"]

            # Found the download start message
            if line.startswith("download start"):
                response = line
                break

            # Skip automatic messages
            print(f"Skipping automatic message during download: {line}")

        if not response:
            return False, ["Timeout waiting for download start"]
        elif not response.startswith("download start"):
            return False, [f"Failed to start download: {response}"]
        
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
    
    def download_file_from(self, filename: str, event_number: int) -> Tuple[bool, List[str]]:
        """Download a file from a specific event position number"""

        self.clear_buffer()
        self.send_command_no_wait(f"downloadFrom {filename} {event_number}")


        # Wait for download start, skipping automatic messages
        response = None
        start_time = time.time()
        while time.time() - start_time < 50.0:
            line = self.read_line(timeout=0.5)
            if not line:
                continue

            # Check for error responses
            if line == "failed download nofile":
                return False, ["File does not exist"]

            # Found the download start message
            if line.startswith("download start"):
                response = line
                break

            # Skip automatic messages (DATA_PAUSED, tip, counts, etc)
            print(f"Skipping automatic message during download: {line}")

        if not response:
            return False, ["Timeout waiting for download start"]
        elif not response.startswith("download start"):
            return False, [f"Failed to start download: {response}"]
        
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
    
    def get_time(self) -> Tuple[bool, Optional[datetime]]:
        """Get current datetime from RTC"""
        response = self.send_command("getTime")
        if response and response.startswith("time "):
            time_str = int(response[5:])
            return True, datetime.fromtimestamp(time_str)  # Return timestamp after "time "
        return False, None
    
    def set_time(self) -> Tuple[bool, str]:
        """Set time in RTC to UNIX timestamp. """
        response = self.send_command(f"setTime {time.time()}")
        
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
    
    def _recover_missed_tips_background(self, from_tip: int, to_tip: int):
        """Background thread to recover missed tips without blocking reader thread"""
        try:
            print(f"[Recovery Thread] Recovering tips {from_tip} to {to_tip}...")

            if not self.current_log_file:
                print("[Recovery Thread] No log file")
                return

            success, lines = self.download_file_from(self.current_log_file, from_tip)

            if not success:
                print(f"[Recovery Thread] Download failed: {lines}")
                return

            print(f"[Recovery Thread] Downloaded {len(lines)} line(s)")

            # Parse and save recovered tips
            if self.app and hasattr(self, 'id'):
                with self.app.app_context():
                    from database.models import BlackboxRawData, db
                    recovered = 0

                    for line in lines:
                        try:
                            parts = line.split()
                            if len(parts) >= 6:
                                recovered_tip = int(parts[0])

                                # Only save tips in the recovery range (from_tip to to_tip inclusive)
                                if from_tip <= recovered_tip <= to_tip:
                                    # Parse timestamp
                                    try:
                                        dt_str = parts[1].strip()
                                        dt = datetime.strptime(dt_str, "%Y.%m.%d.%H.%M.%S")
                                        timestamp = int(dt.timestamp())
                                    except ValueError:
                                        print(f"[Recovery Thread] Failed to parse timestamp: {parts[1]}")
                                        continue

                                    # Create tip_data dict for calculateEventLogTip
                                    tip_data = {
                                        "tip_number": recovered_tip,
                                        "timestamp": timestamp,
                                        "seconds_elapsed": int(parts[2]),
                                        "channel_number": int(parts[3]),
                                        "temperature": "N/A" if parts[4] == "-" else float(parts[4]),
                                        "pressure": float(parts[5])
                                    }

                                    # Save raw data
                                    recovered_data = BlackboxRawData(
                                        test_id=self.test_id,
                                        device_id=self.id,
                                        tip_number=recovered_tip,
                                        channel_number=int(parts[3]),
                                        timestamp=timestamp,
                                        seconds_elapsed=int(parts[2]),
                                        temperature=None if parts[4] == "-" else float(parts[4]),
                                        pressure=float(parts[5])
                                    )
                                    db.session.add(recovered_data)

                                    # Calculate and save event log data
                                    self.calculateEventLogTip(tip_data)

                                    recovered += 1
                        except (ValueError, IndexError) as e:
                            print(f"[Recovery Thread] Failed to parse line: {e}")
                            continue

                    db.session.commit()
                    print(f"[Recovery Thread] Recovered {recovered} missed tip(s)")

        except Exception as e:
            print(f"[Recovery Thread] Error: {e}")

    def set_test_id(self, test_id):
        """Set the current test ID for database logging"""
        self.test_id = test_id

    def convertSeconds(self, seconds) -> tuple:
        '''Converts timestamp in seconds to number of days, hours minutes and seconds'''
        #Calculate number of seconds in a minute, hour and day
        secondsInMinute = 60
        secondsInHour = secondsInMinute * 60
        secondsInDay = secondsInHour * 24
        #Take the days off first
        d = seconds // secondsInDay
        seconds = seconds - (d * secondsInDay)
        #Take the hours off
        h = seconds // secondsInHour
        seconds = seconds - (h * secondsInHour)
        #Take the minutes off
        m = seconds // secondsInMinute
        seconds = seconds - (m * secondsInMinute)
        return d, h, m, seconds

    def calculateEventLogTip(self, tipData, reprocess_mode=False, commit_changes=True):
        '''Convert from setup information and events to a fully processed event, day and hour logs with net volumes'''

        debug_log = not reprocess_mode

        if not self.app:
            if debug_log:
                print("[DEBUG calculateEventLogTip] No app found - returning early")
            return

        autoflush_context = db.session.no_autoflush if (reprocess_mode and not commit_changes) else nullcontext()
        app_context_manager = nullcontext()
        if (not has_app_context()) or (current_app._get_current_object() is not self.app):
            app_context_manager = self.app.app_context()

        with BlackBoxHandler._db_write_lock, self._tip_processing_lock, app_context_manager, autoflush_context:
            try:
                tableData = db.session.query(ChannelConfiguration).filter_by(
                    test_id=self.test_id,
                    device_id=self.id
                ).all()
            except Exception as e:
                print(f" Error loading channel configurations: {type(e).__name__}: {e}")
                return ""

            result = "{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14},{15},{16}"
            eventData = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

            setup = {"names" : [""] * 15,
                     "inUse" : [False] * 15,
                     "inoculumOnly" : [False] * 15,
                     "inoculumMass" : [0.0] * 15,
                     "sampleMass" : [0.0] * 15,
                     "tumblerVolume" : [0.0] * 15,
                     "gasConstants" : [0.0] * 15,
                     "chimeraChannel" : [None] * 15}

            #Dicionary to store overall running information for all channels
            overall = {"tips" : [0] * 15, "volumeSTP" : [0.0] * 15, "volumeNet" : [0.0] * 15, "volumeRecirculation" : [0.0] * 15, "inoculumVolume" : 0.0, "inoculumMass" : 0.0}

            hourlyTips = 0
            dailyTips = 0
            hourlyVolume = 0.0
            dailyVolume = 0.0
            lastTipTime = None

            for row in tableData:
                channelIdx = row.channel_number - 1  # DB stores 1-15, convert to 0-14 for array access
                if channelIdx >= 0 and channelIdx < 15:
                    setup["inUse"][channelIdx] = True if row.in_service is None else bool(row.in_service)
                    setup["names"][channelIdx] = row.notes
                    setup["chimeraChannel"][channelIdx] = row.chimera_channel
                    sample = False
                    setup["tumblerVolume"][channelIdx] = row.tumbler_volume
                    overall["tips"][channelIdx] = row.tip_count
                    overall["volumeSTP"][channelIdx] = row.total_stp_volume
                    overall["volumeNet"][channelIdx] = row.total_net_volume

                    # Get volume_since_last_recirculation from ChimeraChannelConfiguration if mapped
                    overall["volumeRecirculation"][channelIdx] = 0.0  # Default
                    if row.chimera_channel and not reprocess_mode:
                        from database.models import ChimeraConfiguration, ChimeraChannelConfiguration
                        # Find the chimera config for this test
                        chimera_config = ChimeraConfiguration.query.filter_by(test_id=self.test_id).first()
                        if chimera_config:
                            chimera_channel_config = ChimeraChannelConfiguration.query.filter_by(
                                chimera_config_id=chimera_config.id,
                                channel_number=row.chimera_channel
                            ).first()
                            if chimera_channel_config:
                                overall["volumeRecirculation"][channelIdx] = chimera_channel_config.volume_since_last_recirculation

                    setup["gasConstants"][channelIdx] = (273 * setup["tumblerVolume"][channelIdx]) / 1013.25

                    if row.substrate_weight_grams > 0:
                        setup["sampleMass"][channelIdx] = row.substrate_weight_grams
                        sample = True
                    if row.inoculum_weight_grams > 0:
                        setup["inoculumMass"][channelIdx] = row.inoculum_weight_grams
                        if not sample:
                            setup["inoculumOnly"][channelIdx] = True
                            overall["inoculumVolume"] = overall["inoculumVolume"] + overall["volumeSTP"][channelIdx]
                            overall["inoculumMass"] = overall["inoculumMass"] + overall["tips"][channelIdx] * setup["inoculumMass"][channelIdx]

                    hourlyTips = row.hourly_tips
                    dailyTips = row.daily_tips
                    lastTipTime = row.last_tip_time
                    hourlyVolume = row.hourly_volume
                    dailyVolume = row.daily_volume

            try:
                    #Get the channel number (device sends 1-15, convert to 0-14 for array access)
                    channelNum = tipData["channel_number"]  # 1-15 for database
                    channelIdx = channelNum - 1  # 0-14 for array access
                    if debug_log:
                        print(f"[DEBUG calculateEventLogTip] channelNum: {channelNum} (DB), channelIdx: {channelIdx} (array)")
                        print(f"[DEBUG calculateEventLogTip] setup['inUse'] = {setup['inUse']}")
                        print(f"[DEBUG calculateEventLogTip] Checking if channel {channelIdx} is in use: {setup['inUse'][channelIdx] if channelIdx < len(setup['inUse']) else 'INDEX OUT OF BOUNDS'}")
                    #If this channel should be logging
                    if setup["inUse"][channelIdx]:
                        if debug_log:
                            print(f"[DEBUG calculateEventLogTip] Channel {channelNum} IS in use - processing tip")
                        #Get the time, temperature and pressure
                        eventTime = tipData["seconds_elapsed"]
                        timestamp = tipData["timestamp"]
                        temperatureC = tipData["temperature"]
                        # Handle N/A temperature - use a default of 25°C (298K) for volume calculation
                        if temperatureC == "N/A" or temperatureC is None:
                            temperatureK = 298  # Default to 25°C
                            temperatureC = None  # Store as None in database
                        else:
                            temperatureK = temperatureC + 273
                        pressure = tipData["pressure"]

                        #Find the time as parts
                        day, hour, min, sec = self.convertSeconds(eventTime)
                        
                        if lastTipTime != None:
                            lastTimeParts = lastTipTime.split(".")
                            lastDay = int(lastTimeParts[0])
                            lastHour = int(lastTimeParts[1])
                            if hour > lastHour:
                                hourlyTips = 0
                                hourlyVolume = 0.0
                            if day > lastDay:
                                dailyTips = 0
                                dailyVolume = 0.0


                        #Calculate the volume for the tip
                        eventVolume = setup["gasConstants"][channelIdx] * (pressure / temperatureK)

                        #Add tip to overall, day and hour as well as the volume for each
                        overall["tips"][channelIdx] = overall["tips"][channelIdx] + 1
                        overall["volumeSTP"][channelIdx] = overall["volumeSTP"][channelIdx] + eventVolume

                        if not reprocess_mode:
                            # Only add to recirculation volume if chimera is not currently reading this channel
                            # (gas does not go to gas bags when reading so does add to recirculation value)
                            chimera_channel = setup["chimeraChannel"][channelIdx]
                            if chimera_channel:
                                from device_manager import DeviceManager
                                reading_channel = DeviceManager().get_chimera_reading_channel(self.test_id)
                                if reading_channel != chimera_channel:
                                    overall["volumeRecirculation"][channelIdx] = overall["volumeRecirculation"][channelIdx] + eventVolume
                            else:
                                overall["volumeRecirculation"][channelIdx] = overall["volumeRecirculation"][channelIdx] + eventVolume

                        hourlyTips = hourlyTips + 1
                        dailyTips = dailyTips + 1

                        hourlyVolume = hourlyVolume + eventVolume
                        dailyVolume = dailyVolume + eventVolume

                        #thisNetVolume = eventVolume
                        totalNetVolume = overall["volumeSTP"][channelIdx]
                        #If this is an inoculum only channel
                        if setup["inoculumOnly"][channelIdx]:
                            #If there is inoculum mass
                            if setup["inoculumMass"][channelIdx] != 0:
                                #Net volume is the total volume divided by the inoculum mass
                                #thisNetVolume = eventVolume / setup["inoculumMass"][channelIdx]
                                totalNetVolume = overall["volumeSTP"][channelIdx] / setup["inoculumMass"][channelIdx]
                                #Add the mass and volume to overall running total
                                overall["inoculumVolume"] = overall["inoculumVolume"] + eventVolume
                                overall["inoculumMass"] = overall["inoculumMass"] + setup["inoculumMass"][channelIdx]
                        else:
                            #If there is sample mass
                            if setup["sampleMass"][channelIdx] != 0:
                                if overall["inoculumMass"] != 0:
                                    inoculumAdjust = 0
                                    inoculumCount = 0
                                    for channel in range(0, 15):
                                        if setup["inoculumOnly"][channel] and setup["inoculumMass"][channel] != 0:
                                            inoculumAdjust = inoculumAdjust + (overall["volumeSTP"][channel] / setup["inoculumMass"][channel])
                                            inoculumCount = inoculumCount + 1
                                    inoculumAdjust = inoculumAdjust / inoculumCount
                                    totalNetVolume = (overall["volumeSTP"][channelIdx] - (inoculumAdjust * setup["inoculumMass"][channelIdx])) / setup["sampleMass"][channelIdx]
                                else:
                                    totalNetVolume = overall["volumeSTP"][channelIdx] / setup["sampleMass"][channelIdx]

                        #Add the net volume for this tip to the hourly and daily information for this channel
                        overall["volumeNet"][channelIdx] = totalNetVolume

                        #Channel Number, Name, Timestamp, Days, Hours, Minutes, Tumbler Volume (ml), Temperature (C), Pressure (hPA), Cumulative Total Tips, Volume This Tip (STP), Total Volume (STP), Tips This Day, Volume This Day (STP), Tips This Hour, Volume This Hour (STP), Net Volume Per Gram (ml/g)
                        eventData = [channelNum, setup["names"][channelIdx], timestamp, day, hour, min, setup["tumblerVolume"][channelIdx], temperatureC, pressure, overall["tips"][channelIdx], eventVolume, overall["volumeSTP"][channelIdx], dailyTips, dailyVolume, hourlyTips, hourlyVolume, overall["volumeNet"][channelIdx]]

                        # Update channel configuration
                        databaseRow = ChannelConfiguration.query.filter_by(test_id = self.test_id, device_id = self.id, channel_number = channelNum).first()
                        if debug_log:
                            print(f"[DEBUG calculateEventLogTip] Query for config: test_id={self.test_id}, device_id={self.id}, channel_number={channelNum}")
                            print(f"[DEBUG calculateEventLogTip] databaseRow found: {databaseRow is not None}")
                        if not databaseRow:
                            if debug_log:
                                print(f"[DEBUG calculateEventLogTip] Warning: No channel configuration found for test {self.test_id}, device {self.id}, channel {channelNum}")
                            return ""

                        databaseRow.hourly_tips = hourlyTips
                        databaseRow.daily_tips = dailyTips
                        databaseRow.last_tip_time = "{0}.{1}.{2}.{3}".format(day, hour, min, sec)
                        databaseRow.hourly_volume = hourlyVolume
                        databaseRow.daily_volume = dailyVolume
                        databaseRow.tip_count = overall["tips"][channelIdx]
                        databaseRow.total_stp_volume = overall["volumeSTP"][channelIdx]
                        databaseRow.total_net_volume = overall["volumeNet"][channelIdx]

                        # Update volume_since_last_recirculation in ChimeraChannelConfiguration if mapped
                        chimera_channel_config = None
                        chimera_config = None
                        if databaseRow.chimera_channel and not reprocess_mode:
                            from database.models import ChimeraConfiguration, ChimeraChannelConfiguration
                            chimera_config = ChimeraConfiguration.query.filter_by(test_id=self.test_id).first()
                            if chimera_config:
                                chimera_channel_config = ChimeraChannelConfiguration.query.filter_by(
                                    chimera_config_id=chimera_config.id,
                                    channel_number=databaseRow.chimera_channel
                                ).first()
                                if chimera_channel_config:
                                    chimera_channel_config.volume_since_last_recirculation = overall["volumeRecirculation"][channelIdx]

                        # Create event log entry
                        from database.models import BlackBoxEventLogData
                        event_log = BlackBoxEventLogData(
                            test_id=self.test_id,
                            device_id=self.id,
                            channel_number=channelNum,
                            channel_name=setup["names"][channelIdx],
                            timestamp=timestamp,
                            days=day,
                            hours=hour,
                            minutes=min,
                            tumbler_volume=setup["tumblerVolume"][channelIdx],
                            temperature=temperatureC,
                            pressure=pressure,
                            cumulative_tips=overall["tips"][channelIdx],
                            volume_this_tip_stp=eventVolume,
                            total_volume_stp=overall["volumeSTP"][channelIdx],
                            tips_this_day=dailyTips,
                            volume_this_day_stp=dailyVolume,
                            tips_this_hour=hourlyTips,
                            volume_this_hour_stp=hourlyVolume,
                            net_volume_per_gram=overall["volumeNet"][channelIdx]
                        )
                        db.session.add(event_log)

                        if commit_changes:
                            db.session.commit()
                        if debug_log:
                            print(f"[DEBUG calculateEventLogTip] SUCCESS: Event log saved! event_log.id={event_log.id}")

                        # Check for volume-based recirculation trigger using ChimeraConfiguration
                        if (not reprocess_mode) and chimera_config and chimera_channel_config and databaseRow.chimera_channel:
                            print(f"[DEBUG Recirculation] Checking recirculation: mode={chimera_config.recirculation_mode}, threshold={chimera_channel_config.volume_threshold_ml}, chimera_channel={databaseRow.chimera_channel}")
                            print(f"[DEBUG Recirculation] Current volume since last recirculation: {overall['volumeRecirculation'][channelIdx]:.2f}")

                            if (chimera_config.recirculation_mode == 'volume' and
                                chimera_channel_config.volume_threshold_ml):

                                # Check if volume threshold has been exceeded
                                if overall["volumeRecirculation"][channelIdx] >= chimera_channel_config.volume_threshold_ml:
                                    print(f"🔄 Volume threshold reached for BlackBox channel {channelNum}: {overall['volumeRecirculation'][channelIdx]:.2f} >= {chimera_channel_config.volume_threshold_ml}")
                                    print(f"   Triggering recirculation for Chimera channel {databaseRow.chimera_channel}")

                                    # Get the Chimera device handler for this test
                                    from device_manager import DeviceManager
                                    dm = DeviceManager()  # Get singleton instance
                                    chimera_handler = None
                                    print(f"[DEBUG Recirculation] Looking for Chimera handler in {len(dm._active_handlers)} active handlers")
                                    for port, handler in dm._active_handlers.items():
                                        print(f"[DEBUG Recirculation]   Checking handler: port={port}, type={handler.device_type}, test_id={getattr(handler, 'test_id', 'N/A')}")
                                        if (handler.device_type in ['chimera', 'chimera-max'] and
                                            getattr(handler, 'test_id', None) == self.test_id):
                                            chimera_handler = handler
                                            print(f"[DEBUG Recirculation]   Found matching Chimera handler!")
                                            break

                                    if chimera_handler:
                                        try:
                                            # Recirculation pumps at 2.5ml/s
                                            recirculation_duration = int(chimera_channel_config.volume_since_last_recirculation / 2.5)
                                            recirculation_pump_power = 100

                                            print(f"[DEBUG Recirculation] Calling recirculate_flag(channel={databaseRow.chimera_channel}, duration={recirculation_duration}, pump_power={recirculation_pump_power})")
                                            success, message = chimera_handler.recirculate_flag(
                                                databaseRow.chimera_channel,
                                                recirculation_duration,
                                                recirculation_pump_power
                                            )

                                            if success:
                                                print(f"   ✓ Recirculation command sent: {message}")
                                                # Reset the volume counter to 0 for this channel
                                                overall["volumeRecirculation"][channelIdx] = 0.0
                                                chimera_channel_config.volume_since_last_recirculation = 0.0
                                                db.session.commit()
                                                print(f"   ✓ Reset recirculation volume counter to 0 for Chimera channel {databaseRow.chimera_channel}")
                                            else:
                                                print(f"   ✗ Recirculation command failed: {message}")
                                        except Exception as e:
                                            print(f"   ✗ Failed to send recirculation command: {e}")
                                            import traceback
                                            traceback.print_exc()
                                    else:
                                        print(f"   ✗ No Chimera device found for test {self.test_id}")

                        return result.format(*eventData)
                    else:
                        if debug_log:
                            print(f"[DEBUG calculateEventLogTip] Channel {channelNum} is NOT in use - skipping tip processing")
            except:
                import traceback
                print("[DEBUG calculateEventLogTip] EXCEPTION occurred:")
                traceback.print_exc()
                return ""

            #Return correct information
            return result
    
    def disconnect(self):
        """Disconnect from device"""
        super().disconnect()
