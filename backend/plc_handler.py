from serial_handler import SerialHandler
import datetime

class PlcHandler(SerialHandler):
    machine_info = {"Ray" : {"reactors" : 2, "mixers" : 2, "heaters" : 2, "agitators" : 2, "feeders" : 1},
                    "Ray-3" : {"reactors" : 3, "mixers" : 3, "heaters" : 3, "agitators" : 3, "feeders" : 1},
                    "Ray-I" : {"reactors" : 2, "mixers" : 2, "heaters" : 2, "agitators" : 2, "feeders" : 2},
                    "Caterpillar" : {"reactors" : 5, "mixers" : 5, "heaters" : 5, "agitators" : 5, "feeders" : 1},
                    "Lobster" : {"reactors" : 6, "mixers" : 6, "heaters" : 6, "agitators" : 6, "feeders" : 2},
                    "MAX-I" : {"reactors" : 4, "mixers" : 4, "heaters" : 4, "agitators" : 4, "feeders" : 4},
                    "Black Swan" : {"reactors" : 10, "mixers" : 8, "heaters" : 10, "agitators" : 4, "feeders" : 4},
                    "Medusa" : {"reactors" : 10, "mixers" : 1, "heaters" : 0, "agitators" : 10, "feeders" : 2}}
    machine_starts = {"Ray" : "_RAY", "Ray-3" : "_RAY", "Ray-I" : "_RAY", "Caterpillar" : "_CAT", "Lobster" : "_LOB", "MAX-I" : "_MAX", "Black Swan" : "_BS_S1S2", "Medusa" : "_MEDUSA"}
    def __init__(self, port : str):
        """Setup the the PLC object"""
        super().__init__(baudrate = 38400)
        self.port = port
        self.device_name = None
        self.device_type = "plc"
        self.machine_type = None
        self.machine_info_counts = None
        self.machine_started = False
        self.app = None
        self.test_id = None
        self.current_info = {"heaters" : None, "mixers" : None, "agitators" : None, "feeders" : None}
        self.maintenance_mode = False

    def connect(self) -> bool:
        """Start the connection to the PLC"""
        return super().connect(self.port)

    def start_machine(self, new_machine_type : str) -> bool:
        """Start running the machine by giving it a machine type"""
        #Check the machine type is valid and store
        if new_machine_type in PlcHandler.machine_info:
            self.machine_type = new_machine_type
            self.machine_parts = PlcHandler.machine_info[new_machine_type]
            return self._send_start_command()
        else:
            return False
    
    def _send_start_command(self) -> bool:
        """Send the initial startup sequence to the PLC"""
        if self.connection.is_open and self.machine_type in PlcHandler.machine_starts:
            started = False
            attempt_count = 5
            #Set the time before starting
            self._set_time()
            #Send appropriate continue message - this will be ignored if the machine is already running
            self.send_command_no_wait("CONTINUE{0}".format(PlcHandler.machine_starts[self.machine_type]))
            
            #Repeat until appropriate communication is established
            while not started:
                response = self.read_line(timeout = 5)
                #If a PING message is read, the machine has begun running
                if response and response.startswith("PING"):
                    started = True
                else:
                    #Wait for a few lines before trying again
                    attempt_count = attempt_count - 1
                    if attempt_count < 1:
                        attempt_count = 5
                        self.send_command_no_wait("CONTINUE{0}".format(PlcHandler.machine_starts[self.machine_type]))
            
            self.machine_started = True
            self.get_status()
            

    def get_status(self) -> bool:
        """Ask for PLC status and process response"""
        if self.connection.is_open and self.machine_info_counts != None:
            received_lines = []
            info = self.machine_info_counts
            #Calculate how many lines are needed for a complete status
            #7 for time and date, one for each heater, mixer, agitator and feeder and three for system info
            expected_lines = 7 + info["heaters"] + info["mixers"] + info["agitators"] + info["feeders"] + 3

            #Make the request
            self.send_command_no_wait("GET_STATUS")

            #Repeatedly ask for lines until number is reached
            while len(received_lines) < expected_lines:
                response = self.read_line(timeout = 5)
                #ignore empty or PING messages
                if response:
                    if "PING" not in response:
                        received_lines.append(response)
            
            #Start and end line positions based on number of machine parts
            starts = {"heaters" : 7, "mixers" : 7 + info["heaters"], "agitators" : 7 + info["heaters"] + info["mixers"], "feeders" : 7 + info["heaters"] + info["mixers"] + info["agitators"]}
            ends = {"heaters" : starts["heaters"] + info["heaters"], "mixers" : starts["mixers"] + info["mixers"], "agitators" : starts["agitators"] + info["agitators"], "feeders" : starts["feeders"] + info["feeders"]}
            
            valid_status = True
            heater_data = []
            mixer_data = []
            agitator_data = []
            feeder_data = []

            #Heaters
            #Target Temperature, Actual Temperature, Heater Status, Heater Enabled
            for heater_line in range(starts["heaters"], ends["heaters"]):
                line = received_lines[heater_line].split(" ")
                data_line = []
                if len(line) != 4:
                    valid_status = False
                else:
                    for part in range(0, 4):
                        try:
                            if part != 1:
                                data_line.append(int(line[part]))
                            else:
                                #Store temperature as a float not int
                                data_line.append(float(line[part]))
                        except:
                            valid_status = False
                            data_line.append(-1)
                #Add to heater information
                heater_data.append(data_line)
            
            #Mixers
            #Mixer Status, Mixer Enabled, Mixer Mode, On For, Off For
            for mixer_line in range(starts["mixers"], ends["mixers"]):
                line = received_lines[mixer_line].split(" ")
                data_line = []
                if len(line) != 5:
                    valid_status = False
                else:
                    for part in range(0, 5):
                        try:
                            data_line.append(int(line[part]))
                        except:
                            valid_status = False
                            data_line.append(-1)
                mixer_data.append(data_line)
            
            #Agitators
            #Agitator Status, Agitator Enabled, Pre Feed Time
            for agitator_line in range(starts["agitators"], ends["agitators"]):
                line = received_lines[agitator_line].split(" ")
                data_line = []
                if len(line) != 3:
                    valid_status = False
                else:
                    for part in range(0, 3):
                        try:
                            data_line.append(int(line[part]))
                        except:
                            valid_status = False
                            data_line.append(-1)
                agitator_data.append(data_line)
            
            #Feeders
            #Feeder Status, Feeder Enabled, Feeder On For, Feeder Off For, Feeder Off Until, Next Feed Time Hour, Next Feed Time Minute, Next Feed Time Second
            for feeder_line in range(starts["feeders"], ends["feeders"]):
                line = received_lines[feeder_line].split(" ")
                data_line = []
                if len(line) != 8:
                    valid_status = False
                else:
                    for part in range(0, 8):
                        try:
                            data_line.append(int(line[part]))
                        except:
                            valid_status = False
                            data_line.append(-1)
                feeder_data.append(data_line)

            #If no errors were found
            if valid_status:
                #Check maintenance mode and update (if it changed and was valid)
                if received_lines[ends["feeders"]][0] == "1":
                    self.maintenance_mode = True
                elif received_lines[ends["feeders"]][0] == "0":
                    self.maintenance_mode = False
                
                #Store values in arrays
                self.current_info["heaters"] = heater_data
                self.current_info["mixers"] = mixer_data
                self.current_info["agitators"] = agitator_data
                self.current_info["feeders"] = feeder_data
            
            return valid_status
        return False

    def set_heater(self, heater_number : int, enabled : bool, target : int) -> None:
        """Set heater configuration"""
        heater = heater_number + 1
        if enabled:
            self.send_command_no_wait("ENABLE_HEATER {0} 1".format(heater))
        else:
            self.send_command_no_wait("ENABLE_HEATER {0} 0".format(heater))
        self.send_command_no_wait("SET_TEMP {0} {1}".format(heater), int(target))

        self.get_status()

    def set_mixer(self, mixer_number : int, mode : int, enabled : bool, on_time : int, off_time : int) -> None:
        """Set mixer configuration"""
        mixer = mixer_number + 1
        self.send_command_no_wait("SET_MIX_MODE {0} {1}".format(mixer, mode))
        if enabled:
            self.send_command_no_wait("ENABLE_MIXER {0} 1".format(mixer))
        else:
            self.send_command_no_wait("ENABLE_MIXER {0} 0".format(mixer))
        self.send_command_no_wait("SET_MIX_TIME {0} {1} {2}".format(mixer, on_time, off_time))

        self.get_status()
    
    def set_agitator(self, agitator_number : int, enabled : bool, time_before_feed : int) -> None:
        """Set agitator configuration"""
        agitator = agitator_number + 1
        if enabled:
            self.send_command_no_wait("ENABLE_AGITATOR {0} 1".format(agitator))
        else:
            self.send_command_no_wait("ENABLE_AGITATOR {0} 0".format(agitator))
        self.send_command_no_wait("SET_AGITATOR {0} {1}".format(agitator, time_before_feed))

        self.get_status()

    def set_feeder(self, feeder_number : int, enabled : bool, feed_time : int, time_between : int, update_timing = False) -> None:
        """Set feeder configuration"""
        feeder = feeder_number + 1
        update = 0
        if update_timing:
            update = 1
        
        self.send_command_no_wait("SET_FEEDER {0} {1} {2}".format(feeder, feed_time, time_between))

        if enabled:
            self.send_command_no_wait("ENABLE_FEEDER {0} 1 {1}".format(feeder, update))
        else:
            self.send_command_no_wait("ENABLE_FEEDER {0} 0 0".format(feeder))
        
        self.get_status()

    def _set_time(self) -> None:
        """Set the date and time stored in the real time clock"""
        time_now = datetime.datetime.now()
        self.send_command_no_wait("SET_YEAR {0}".format(time_now.year))
        self.send_command_no_wait("SET_MONTH {0}".format(time_now.month))
        self.send_command_no_wait("SET_DAY {0}".format(time_now.day))
        self.send_command_no_wait("SET_HOUR {0}".format(time_now.hour))
        self.send_command_no_wait("SET_MINS {0}".format(time_now.minute))

    def maintenance_mode_set(self, enable : bool) -> bool:
        """Set the maintenance mode and check it changed correctly"""
        attempts = 5

        #Try 5 times or until request matches value
        while attempts > 0 and self.maintenance_mode != enable:
            if enable:
                self.send_command_no_wait("START_MAINTENANCE_MODE")
            else:
                self.send_command_no_wait("END_MAINTENANCE_MODE")
            attempts = attempts - 1
            self.get_status()
        
        #Check if set correctly
        if enable != self.maintenance_mode:
            return False
        
        return True
    
    def maintenance_mixer(self, mixer_number : int, state : bool) -> bool:
        """Change mixer state in maintenance mode"""
        if self.maintenance_mode:
            if state:
                self.send_command_no_wait("MIXER_ON {0}".format(mixer_number))
            else:
                self.send_command_no_wait("MIXER_OFF {0}".format(mixer_number))
            self.get_status()
            return True
        else:
            return False
    
    def maintenance_heater(self, heater_number : int, state : bool) -> bool:
        """Change heater state in maintenance mode"""
        if self.maintenance_mode:
            if state:
                self.send_command_no_wait("HEATER_ON {0}".format(heater_number))
            else:
                self.send_command_no_wait("HEATER_OFF {0}".format(heater_number))
            self.get_status()
            return True
        else:
            return False
    
    def maintenance_agitator(self, agitator_number : int, state : bool) -> bool:
        """Change agitator state in maintenance mode"""
        if self.maintenance_mode:
            if state:
                self.send_command_no_wait("AGITATOR_ON {0}".format(agitator_number))
            else:
                self.send_command_no_wait("AGITATOR_OFF {0}".format(agitator_number))
            self.get_status()
            return True
        else:
            return False
    
    def maintenance_feeder(self, feeder_number : int, state : bool) -> bool:
        """Change feeder state in maintenance mode"""
        if self.maintenance_mode:
            if state:
                self.send_command_no_wait("FEEDER_ON {0}".format(feeder_number))
            else:
                self.send_command_no_wait("FEEDER_OFF {0}".format(feeder_number))
            self.get_status()
            return True
        else:
            return False
    
    def restart(self) -> None:
        """Force PLC reset - recommended to reinitialise object once complete"""
        self.send_command_no_wait("RESET_PLC");
