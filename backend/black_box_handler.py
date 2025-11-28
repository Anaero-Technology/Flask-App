import time
from datetime import datetime
from typing import Optional, Dict, List, Tuple
from serial_handler import SerialHandler
from database.models import ChannelConfiguration, db

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
            

            print("Processed Data:", self.calculateEventLogTip(tip_data))
            
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
                                import threading
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
  
    def _get_device_info(self):
        """Get device information using the info command (auto appends \n at end of command)"""
        if self.connection.is_open:
            self.clear_buffer()
            self.send_command_no_wait("info")

            # Keep reading until we get the info response (may receive other messages first)
            start_time = time.time()
            response = None
            while time.time() - start_time < 2.0:
                resp = self.read_line(timeout=0.5)
                if resp and resp.startswith("info"):
                    response = resp
                    break

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

        self.set_time(time.strftime("%Y,%m,%d,%H,%M,%S"))
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

        # Wait for download start, skipping automatic messages
        response = None
        start_time = time.time()
        while time.time() - start_time < 5.0:
            line = self.read_line(timeout=0.5)
            
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

    def calculateEventLogTip(self, tipData):
        '''Convert from setup information and events to a fully processed event, day and hour logs with net volumes'''

        if not self.app:
            print("No app found")
            return 

        with self.app.app_context():
            try:
                tableData = db.session.query(ChannelConfiguration).filter_by(test_id = self.test_id).all()
                print(f"Loaded {len(tableData)} channel configurations for test_id {self.test_id}")
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
                     "gasConstants" : [0.0] * 15}

            #Dicionary to store overall running information for all channels
            overall = {"tips" : [0] * 15, "volumeSTP" : [0.0] * 15, "volumeNet" : [0.0] * 15, "inoculumVolume" : 0.0, "inoculumMass" : 0.0}

            hourlyTips = 0
            dailyTips = 0
            hourlyVolume = 0.0
            dailyVolume = 0.0
            lastTipTime = None

            for row in tableData:
                channel = row.channel_number
                if channel >= 0 and channel < 15:
                    setup["inUse"][channel] = True
                    setup["names"][channel] = row.notes
                    sample = False
                    setup["tumblerVolume"][channel] = row.tumbler_volume
                    overall["tips"][channel] = row.tip_count
                    overall["volumeSTP"][channel] = row.total_stp_volume
                    overall["volumeNet"][channel] = row.total_net_volume
                    setup["gasConstants"][channel] = (273 * setup["tumblerVolume"][channel]) / 1013.25

                    if row.substrate_weight_grams > 0:
                        setup["sampleMass"][channel] = row.substrate_weight_grams
                        sample = True
                    if row.inoculum_weight_grams > 0:
                        setup["inoculumMass"][channel] = row.inoculum_weight_grams
                        if not sample:
                            setup["inoculumOnly"][channel] = True
                            overall["inoculumVolume"] = overall["inoculumVolume"] + overall["volumeSTP"][channel]
                            overall["inoculumMass"] = overall["inoculumMass"] + overall["tips"][channel] * setup["inoculumMass"][channel]

                    hourlyTips = row.hourly_tips
                    dailyTips = row.daily_tips
                    lastTipTime = row.last_tip_time
                    hourlyVolume = row.hourly_volume
                    dailyVolume = row.daily_volume

            try:
                    #Get the channel number
                    channelId = tipData["channel_number"]
                    #If this channel should be logging
                    if setup["inUse"][channelId]:
                        #Get the time, temperature and pressure
                        eventTime = tipData["seconds_elapsed"]
                        timestamp = tipData["timestamp"]
                        temperatureC = tipData["temperature"]
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
                        eventVolume = setup["gasConstants"][channelId] * (pressure / temperatureK)

                        #Add tip to overall, day and hour as well as the volume for each
                        overall["tips"][channelId] = overall["tips"][channelId] + 1
                        overall["volumeSTP"][channelId] = overall["volumeSTP"][channelId] + eventVolume

                        hourlyTips = hourlyTips + 1
                        dailyTips = dailyTips + 1

                        hourlyVolume = hourlyVolume + eventVolume
                        dailyVolume = dailyVolume + eventVolume

                        #thisNetVolume = eventVolume
                        totalNetVolume = overall["volumeSTP"][channelId]
                        #If this is an inoculum only channel
                        if setup["inoculumOnly"][channelId]:
                            #If there is inoculum mass
                            if setup["inoculumMass"][channelId] != 0:
                                #Net volume is the total volume divided by the inoculum mass
                                #thisNetVolume = eventVolume / setup["inoculumMass"][channelId]
                                totalNetVolume = overall["volumeSTP"][channelId] / setup["inoculumMass"][channelId]
                                #Add the mass and volume to overall running total
                                overall["inoculumVolume"] = overall["inoculumVolume"] + eventVolume
                                overall["inoculumMass"] = overall["inoculumMass"] + setup["inoculumMass"][channelId]
                        else:
                            #If there is sample mass
                            if setup["sampleMass"][channelId] != 0:
                                if overall["inoculumMass"] != 0:
                                    inoculumAdjust = 0
                                    inoculumCount = 0
                                    for channel in range(0, 15):
                                        if setup["inoculumOnly"][channel] and setup["inoculumMass"][channel] != 0:
                                            inoculumAdjust = inoculumAdjust + (overall["volumeSTP"][channel] / setup["inoculumMass"][channel])
                                            inoculumCount = inoculumCount + 1
                                    inoculumAdjust = inoculumAdjust / inoculumCount
                                    totalNetVolume = (overall["volumeSTP"][channelId] - (inoculumAdjust * setup["inoculumMass"][channelId])) / setup["sampleMass"][channelId]
                                else:
                                    totalNetVolume = overall["volumeSTP"][channelId] / setup["sampleMass"][channelId]
                        
                        #Add the net volume for this tip to the hourly and daily information for this channel
                        overall["volumeNet"][channelId] = totalNetVolume

                        #Channel Number, Name, Timestamp, Days, Hours, Minutes, Tumbler Volume (ml), Temperature (C), Pressure (hPA), Cumulative Total Tips, Volume This Tip (STP), Total Volume (STP), Tips This Day, Volume This Day (STP), Tips This Hour, Volume This Hour (STP), Net Volume Per Gram (ml/g)
                        eventData = [channelId + 1, setup["names"][channelId], timestamp, day, hour, min, setup["tumblerVolume"][channelId], temperatureC, pressure, overall["tips"][channelId], eventVolume, overall["volumeSTP"][channelId], dailyTips, dailyVolume, hourlyTips, hourlyVolume, overall["volumeNet"][channelId]]

                        # Update channel configuration
                        databaseRow = ChannelConfiguration.query.filter_by(test_id = self.test_id, channel_number = channelId).first()
                        databaseRow.hourly_tips = hourlyTips
                        databaseRow.daily_tips = dailyTips
                        databaseRow.last_tip_time = "{0}.{1}.{2}.{3}".format(day, hour, min, sec)
                        databaseRow.hourly_volume = hourlyVolume
                        databaseRow.daily_volume = dailyVolume
                        databaseRow.tip_count = overall["tips"][channelId]
                        databaseRow.total_stp_volume = overall["volumeSTP"][channelId]
                        databaseRow.total_net_volume = overall["volumeNet"][channelId]

                        # Create event log entry
                        from database.models import BlackBoxEventLogData
                        event_log = BlackBoxEventLogData(
                            test_id=self.test_id,
                            device_id=self.id,
                            channel_number=channelId,
                            channel_name=setup["names"][channelId],
                            timestamp=timestamp,
                            days=day,
                            hours=hour,
                            minutes=min,
                            tumbler_volume=setup["tumblerVolume"][channelId],
                            temperature=temperatureC,
                            pressure=pressure,
                            cumulative_tips=overall["tips"][channelId],
                            volume_this_tip_stp=eventVolume,
                            total_volume_stp=overall["volumeSTP"][channelId],
                            tips_this_day=dailyTips,
                            volume_this_day_stp=dailyVolume,
                            tips_this_hour=hourlyTips,
                            volume_this_hour_stp=hourlyVolume,
                            net_volume_per_gram=overall["volumeNet"][channelId]
                        )
                        db.session.add(event_log)

                        db.session.commit()

                        return result.format(*eventData)
            except:
                import traceback
                traceback.print_exc()
                return ""

            #Return correct information
            return result
    
    def disconnect(self):
        """Disconnect from device"""
        super().disconnect()