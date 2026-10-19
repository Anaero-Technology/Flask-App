import queue
import threading
import time
from collections import deque
from typing import Dict, List, Optional, Tuple

from serial_handler import SerialHandler
from utils.serial_logger import serial_logger


class PlcHandler(SerialHandler):
    """Driver for the Kittiwake M-Duino PLC.

    Speaks the same protocol as the black box and chimera: lower case compound
    commands, a "done <command>" / "failed <command> <reason>" ack for anything
    that changes state, "<noun> start" ... "done <noun>" framing for multi line
    replies, and unsolicited telemetry under a fixed prefix.

    Machine part counts are read back from the device with systemget rather than
    held in a table here, so the two can never disagree.
    """

    # The six personalities the firmware implements. The old "hungry" slot is
    # deliberately absent - it never configured anything, so selecting it left
    # the PLC with no personality and every later command rejected.
    machine_types = ["lobster", "ray", "max", "caterpillar", "blackswan", "medusa"]

    def __init__(self, port: str):
        super().__init__(baudrate=115200)
        self.port = port
        self.device_type = "plc"
        self.device_name = None
        self.mac_address = None
        self.app = None
        self.id = None
        self.test_id = None

        # Mirrors the black box/chimera attributes DeviceManager reads
        self.is_logging = False
        self.current_log_file = None

        self.machine_type = None
        self.machine_counts = {"heaters": 0, "mixers": 0, "agitators": 0, "feeders": 0}
        # Which saved profile was last applied, so attaching the PLC to a test
        # can record it without the caller having to remember.
        self.active_profile_name = None
        self.maintenance_mode = False
        self.seconds_elapsed = 0
        self.latest_temperatures = {}

        # pH module (see simulator/PH_PROTOCOL.md). None until asked: firmware
        # without the module answers "failed phget unknown".
        self.has_ph = None
        self.is_simulated = False
        self.sim_speed = None
        self.latest_ph = {}
        self._ph_lock = threading.Lock()
        self.ph_history = deque(maxlen=600)   # (wall time, uptime, {channel: pH})
        self.ph_events = deque(maxlen=200)    # dose events, newest last

        self.register_automatic_handler("datapoint ", self._handle_datapoint)
        self.register_automatic_handler("lta ", self._handle_lta)
        self.register_automatic_handler("phpoint ", self._handle_phpoint)
        self.register_automatic_handler("phevent ", self._handle_phevent)

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------
    # Opening the port resets the board, which then sits in its bootloader.
    # Traffic arriving during that window keeps the bootloader listening rather
    # than handing over to the sketch, so the port is left quiet until it has
    # passed.
    boot_settle_seconds = 2.5

    def connect(self) -> bool:
        try:
            super().connect(self.port)
            time.sleep(self.boot_settle_seconds)
            self.clear_buffer()
            if not self._get_device_info():
                self.disconnect()
                return False
            self._get_system()
            self._detect_simulator()
            self._restore_saved_config()
            return True
        except Exception as e:
            print(f"[PlcHandler] Connection failed: {e}")
            return False

    def _restore_saved_config(self):
        """Reload the config the PLC saved to its own SD card.

        Only attempted when the PLC has come up with no machine set - after a
        power cycle its settings are gone and the saved file is a script that
        puts them back. A configured PLC is left alone so a reconnect never
        overwrites live settings.

        This is best effort: replay from a completely unconfigured PLC has not
        proved reliable, so restore_settings() is the dependable path once a
        machine type is known.
        """
        if self.machine_type is not None:
            return
        try:
            success, reason = self.load_config()
            if success:
                self._get_system()
                if self.machine_type:
                    print(f"[PlcHandler] Restored saved configuration ({self.machine_type})")
            elif reason != "nocard":
                print(f"[PlcHandler] No saved configuration restored: {reason}")
        except Exception as e:
            print(f"[PlcHandler] Could not restore saved configuration: {e}")

    def restore_settings(self) -> bool:
        """Replay the saved settings onto an already configured PLC.

        Run after a machine type is chosen, so the reactor, mixer, feeder and
        agitator values come back without the operator re-entering them. If the
        saved file turns out to be for a different machine its systemset would
        change the personality, so that is detected and put back.
        """
        wanted = self.machine_type
        if not wanted:
            return False
        try:
            success, _ = self.load_config()
            if not success:
                return False

            self._get_system()
            if self.machine_type != wanted:
                # Saved config belonged to another machine - restore the choice
                # that was actually asked for and overwrite the stale file.
                self.set_machine_type(wanted)
                self.auto_save()
                return False
            return True
        except Exception as e:
            print(f"[PlcHandler] Could not restore settings: {e}")
            return False

    def auto_save(self):
        """Persist current settings to the SD card, best effort.

        Called after anything that changes configuration so the machine can
        restore itself on the next power up. Failures are not surfaced - a unit
        without an SD card still runs perfectly well, it just cannot remember.
        """
        try:
            success, reason = self.save_config()
            if not success and reason != "nocard":
                print(f"[PlcHandler] Auto-save failed: {reason}")
            return success
        except Exception as e:
            print(f"[PlcHandler] Auto-save failed: {e}")
            return False

    def set_test_id(self, test_id):
        self.test_id = test_id

    # ------------------------------------------------------------------
    # Command helpers
    # ------------------------------------------------------------------
    def _command_lines(self, command: str, terminators: Tuple[str, ...],
                       timeout: float = 10.0) -> List[str]:
        """Send a command and collect reply lines up to and including the first
        one starting with a terminator.

        Most commands answer in a single line, but some are framed across
        several (statusget) and some emit progress first - systemset runs sensor
        discovery before it acks. Taking only the first queued line, as
        send_command does, would pick up the progress instead of the result.
        """
        if not self.connection.is_open:
            raise Exception("Device not connected")

        with self._command_lock:
            while not self._command_response_queue.empty():
                try:
                    self._command_response_queue.get_nowait()
                except queue.Empty:
                    break

            with self._write_lock:
                self.connection.write(f"{command}\n".encode())
                self.connection.flush()
                serial_logger.log_sent(self.port, command)

            lines = []
            deadline = time.time() + timeout
            while True:
                remaining = deadline - time.time()
                if remaining <= 0:
                    return lines
                try:
                    line = self._command_response_queue.get(timeout=remaining)
                except queue.Empty:
                    return lines
                lines.append(line)
                if line.startswith(terminators):
                    return lines

    def _acked(self, command: str, timeout: float = 10.0) -> Tuple[bool, str]:
        """Run a command whose reply is done/failed/already and report which."""
        root = command.split()[0]
        lines = self._command_lines(
            command, (f"done {root}", f"failed {root}", f"already {root}"), timeout)

        for line in lines:
            if line.startswith(f"done {root}"):
                return True, "ok"
            if line.startswith(f"already {root}"):
                return True, "already"
            if line.startswith(f"failed {root}"):
                parts = line.split()
                return False, parts[2] if len(parts) > 2 else "failed"

        return False, "timeout"

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------
    def _get_device_info(self, attempts: int = 6) -> bool:
        # Opening the port pulls DTR and resets the board, which then spends a
        # couple of seconds in its bootloader. Anything sent during that window
        # is lost, and the firmware only replies when asked, so the request is
        # repeated rather than simply waited on.
        for _ in range(attempts):
            lines = self._command_lines("info", ("info ",), timeout=1.5)

            for line in lines:
                if not line.startswith("info "):
                    continue
                # info <logging> <logfile> <name> plc <mac>
                parts = line.split()
                if len(parts) < 6:
                    print(f"[PlcHandler] Info response too short: {line}")
                    return False
                self.is_logging = (parts[1] == "1")
                self.current_log_file = parts[2] if parts[2] != "none" else None
                self.device_name = parts[3]
                self.mac_address = parts[5]
                return True

        print("[PlcHandler] No valid info response received")
        return False

    def _detect_simulator(self):
        """Ask whether this is the PLC simulator. Real firmware answers
        "failed simget unknown", which leaves is_simulated False."""
        try:
            lines = self._command_lines("simget", ("sim ", "failed simget"), timeout=1.5)
            for line in lines:
                if line.startswith("sim "):
                    parts = line.split()
                    self.is_simulated = True
                    self.sim_speed = float(parts[1]) if len(parts) > 1 else None
        except Exception:
            self.is_simulated = False

    def get_info(self) -> Dict:
        self._get_device_info()
        return {
            "device_name": self.device_name,
            "mac_address": self.mac_address,
            "is_logging": self.is_logging,
            "current_log_file": self.current_log_file,
            "machine_type": self.machine_type,
            "machine_counts": self.machine_counts,
            "maintenance_mode": self.maintenance_mode,
            "port": self.port,
            "simulated": self.is_simulated,
            "sim_speed": self.sim_speed,
            "has_ph": self.has_ph,
        }

    def set_name(self, name: str) -> bool:
        if not name:
            return False
        # Names travel in a space delimited protocol, so the firmware rejects
        # anything containing whitespace - normalise rather than fail.
        safe_name = "-".join(str(name).split())[:24]
        success, _ = self._acked(f"nameset {safe_name}")
        if success:
            self.device_name = safe_name
        return success

    def set_mac(self, mac_address: str) -> Tuple[bool, str]:
        success, reason = self._acked(f"macset {mac_address}")
        if success:
            self.mac_address = mac_address
        return success, reason

    # ------------------------------------------------------------------
    # Machine personality
    # ------------------------------------------------------------------
    def _get_system(self) -> bool:
        lines = self._command_lines("systemget", ("system ",), timeout=5.0)

        for line in lines:
            if not line.startswith("system "):
                continue
            # system <name> <type> <heaters> <mixers> <agitators> <feeders>
            parts = line.split()
            if len(parts) < 7:
                return False
            self.machine_type = None if parts[1] == "none" else parts[1]
            try:
                self.machine_counts = {
                    "heaters": int(parts[3]),
                    "mixers": int(parts[4]),
                    "agitators": int(parts[5]),
                    "feeders": int(parts[6]),
                }
            except ValueError:
                return False
            return True
        return False

    def set_machine_type(self, machine_type: str) -> Tuple[bool, str]:
        """Choose the machine personality. Nothing else works until this is set.

        Sensor discovery runs as part of this, so it is slow and emits progress
        lines before the ack - hence the long timeout.
        """
        if machine_type not in PlcHandler.machine_types:
            return False, f"Unknown machine type: {machine_type}"

        success, reason = self._acked(f"systemset {machine_type}", timeout=45.0)
        if not success:
            return False, f"Failed to set machine type: {reason}"

        self._get_system()
        return True, f"Machine type set to {machine_type}"

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------
    def get_status(self) -> Optional[Dict]:
        """Read the whole machine state in one framed reply."""
        lines = self._command_lines("statusget", ("done status",), timeout=10.0)
        if not lines or not any(l.startswith("done status") for l in lines):
            return None

        status = {
            "uptime": 0,
            "maintenance_mode": False,
            "heaters": [],
            "mixers": [],
            "feeders": [],
            "agitators": [],
        }

        for line in lines:
            parts = line.split()
            try:
                if line.startswith("status start"):
                    status["uptime"] = int(parts[2])
                    status["maintenance_mode"] = (parts[3] == "1")
                elif line.startswith("status heater"):
                    status["heaters"].append({
                        "number": int(parts[2]),
                        "enabled": parts[3] == "1",
                        "target": float(parts[4]),
                        "actual": float(parts[5]),
                        "on": parts[6] == "1",
                    })
                elif line.startswith("status mixer"):
                    status["mixers"].append({
                        "number": int(parts[2]),
                        "enabled": parts[3] == "1",
                        "mode": int(parts[4]),
                        "on_for": int(parts[5]),
                        "off_for": int(parts[6]),
                        "on": parts[7] == "1",
                    })
                elif line.startswith("status feeder"):
                    # The firmware holds the off time in seconds but feederset
                    # takes minutes, so it is reported in minutes here to keep
                    # what the UI reads and what it writes in the same unit.
                    status["feeders"].append({
                        "number": int(parts[2]),
                        "enabled": parts[3] == "1",
                        "on_for": int(parts[4]),
                        "off_for_minutes": int(parts[5]) // 60,
                        "on": parts[6] == "1",
                    })
                elif line.startswith("status agitator"):
                    status["agitators"].append({
                        "number": int(parts[2]),
                        "enabled": parts[3] == "1",
                        "pre_feed": int(parts[4]),
                        "on": parts[5] == "1",
                    })
            except (IndexError, ValueError):
                print(f"[PlcHandler] Could not parse status line: {line}")
                continue

        self.maintenance_mode = status["maintenance_mode"]
        self.seconds_elapsed = status["uptime"]
        return status

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------
    def _settings_edited(self):
        """A hand edit means the PLC no longer matches the profile it came from."""
        self.active_profile_name = None

    def set_heater(self, heater_number: int, target: int) -> Tuple[bool, str]:
        """Set a reactor target temperature. A target of 0 disables the heater."""
        result = self._acked(f"heaterset {heater_number} {int(target)}")
        if result[0]:
            self._settings_edited()
        return result

    def set_mixer(self, mixer_number: int, mode: int,
                  on_for: int = 0, off_for: int = 0) -> Tuple[bool, str]:
        """mode 0 = always off, 1 = always on, 2 = timed. Times are seconds."""
        result = self._acked(f"mixerset {mixer_number} {int(mode)} {int(on_for)} {int(off_for)}")
        if result[0]:
            self._settings_edited()
        return result

    def set_feeder(self, feeder_number: int, on_for: int, off_for: int) -> Tuple[bool, str]:
        """on_for is seconds (minimum 5), off_for is minutes.

        An on time below 5 or an off time of 0 pauses the feeder.
        """
        result = self._acked(f"feederset {feeder_number} {int(on_for)} {int(off_for)}")
        if result[0]:
            self._settings_edited()
        return result

    def set_agitator(self, agitator_number: int, pre_feed: int) -> Tuple[bool, str]:
        """Seconds of agitation before a feed. 0 pauses the agitator."""
        result = self._acked(f"agitatorset {agitator_number} {int(pre_feed)}")
        if result[0]:
            self._settings_edited()
        return result

    def set_lta_time(self, minutes: int) -> Tuple[bool, str]:
        return self._acked(f"ltatimeset {int(minutes)}")

    # ------------------------------------------------------------------
    # Maintenance mode
    # ------------------------------------------------------------------
    def set_maintenance_mode(self, enable: bool) -> Tuple[bool, str]:
        success, reason = self._acked(f"maintenanceset {1 if enable else 0}")
        if success:
            self.maintenance_mode = enable
        return success, reason

    def maintenance_unit(self, unit_type: str, unit_number: int, state: bool) -> Tuple[bool, str]:
        """Drive one output by hand while in maintenance mode.

        unit_type is heater/mixer/feeder/agitator; unit_number 0 means all of them.
        """
        if unit_type not in ("heater", "mixer", "feeder", "agitator"):
            return False, f"Unknown unit type: {unit_type}"
        return self._acked(
            f"maintenance{unit_type} {int(unit_number)} {1 if state else 0}")

    # ------------------------------------------------------------------
    # Sensors, logging and config
    # ------------------------------------------------------------------
    def get_sensors(self) -> Optional[Dict]:
        """sensor <uptime> <count> <bus>

        A count of 0 is normal on a bench unit. Heater control is inhibited
        while there are no sensors, but the machine otherwise runs.
        """
        lines = self._command_lines("sensorget", ("sensor ",), timeout=5.0)
        for line in lines:
            if line.startswith("sensor "):
                parts = line.split()
                if len(parts) >= 3:
                    try:
                        count = int(parts[2])
                    except ValueError:
                        return None
                    return {
                        "count": count,
                        "bus": parts[3] if len(parts) > 3 else "unknown",
                        "heating_available": count > 0,
                    }
        return None

    def get_sensor_count(self) -> Optional[int]:
        sensors = self.get_sensors()
        return None if sensors is None else sensors["count"]

    def reset_sensors(self) -> Tuple[bool, str]:
        return self._acked("sensorreset", timeout=30.0)

    def start_logging(self) -> Tuple[bool, str]:
        success, reason = self._acked("startlogging")
        if success:
            self.is_logging = True
            self.current_log_file = "TEMPLOG.TXT"
        return success, reason

    def stop_logging(self) -> Tuple[bool, str]:
        success, reason = self._acked("stoplogging")
        if success:
            self.is_logging = False
            self.current_log_file = None
        return success, reason

    def download_temp_log(self, timeout: float = 120.0) -> Tuple[bool, List[str]]:
        """Stream the SD temperature log.

        Framed "download start" / "download <line>" / "download stop" - the
        firmware used to end the transfer by simply going quiet.
        """
        lines = self._command_lines(
            "download", ("download stop", "download failed", "failed download"), timeout)

        if not lines:
            return False, ["No response to download"]
        if any(l.startswith("download failed") or l.startswith("failed download") for l in lines):
            return False, ["Device could not open the log file"]
        if not any(l.startswith("download stop") for l in lines):
            return False, ["Timeout during download"]

        data = [l[len("download "):] for l in lines
                if l.startswith("download ") and l != "download start"]
        return True, data

    def save_config(self) -> Tuple[bool, str]:
        return self._acked("configsave", timeout=30.0)

    def load_config(self) -> Tuple[bool, str]:
        """Replay the saved config. The device acks once, after the whole file."""
        success, reason = self._acked("configload", timeout=60.0)
        if success:
            self._get_system()
        return success, reason

    def get_config(self) -> Tuple[bool, List[str]]:
        lines = self._command_lines("configget", ("done config",), timeout=15.0)
        if not any(l.startswith("done config") for l in lines):
            return False, []
        # "config start" is the frame marker, not one of the commands
        return True, [l[len("config "):] for l in lines
                      if l.startswith("config ") and l != "config start"]

    # ------------------------------------------------------------------
    # Whole-configuration capture and replay (profiles, test snapshots)
    # ------------------------------------------------------------------
    def capture_settings(self) -> Optional[Dict]:
        """Snapshot every unit setting currently on the PLC.

        Read back from the device rather than from anything cached, so a profile
        or a test record always reflects what the machine was actually doing.
        """
        status = self.get_status()
        if status is None:
            return None

        settings = {
            "machine_type": self.machine_type,
            "heaters": [
                {"number": u["number"], "target": u["target"]} for u in status["heaters"]
            ],
            "mixers": [
                {"number": u["number"], "mode": u["mode"],
                 "on_for": u["on_for"], "off_for": u["off_for"]} for u in status["mixers"]
            ],
            "feeders": [
                {"number": u["number"], "on_for": u["on_for"],
                 "off_for_minutes": u["off_for_minutes"]} for u in status["feeders"]
            ],
            "agitators": [
                {"number": u["number"], "pre_feed": u["pre_feed"]} for u in status["agitators"]
            ],
        }

        # pH limits and dose actions travel with the machine settings so a
        # profile or a test record captures how pH was being controlled. Armed
        # and dry-run are deliberately left out: applying a profile must never
        # be what starts a pump.
        ph = self.get_ph() if self.has_ph is not False else None
        if ph:
            settings["ph"] = {
                "channels": [{
                    "number": c["number"], "min": c["min"], "max": c["max"],
                    "low": c["low"], "high": c["high"],
                } for c in ph["channels"]],
                "refill_valves": {r: p["refill_valve"] for r, p in ph["pumps"].items()},
            }
        return settings

    def apply_settings(self, settings: Dict, machine_type: Optional[str] = None) -> Tuple[bool, str]:
        """Push a captured configuration back onto the PLC.

        The machine type is set first when it differs, since unit numbers only
        mean anything once the personality is known. Individual units that the
        current machine does not have are skipped rather than failing the lot.
        """
        wanted = machine_type or settings.get("machine_type")
        if wanted and wanted != self.machine_type:
            success, message = self.set_machine_type(wanted)
            if not success:
                return False, message

        applied, skipped = 0, 0

        def run(ok):
            nonlocal applied, skipped
            applied, skipped = (applied + 1, skipped) if ok else (applied, skipped + 1)

        for u in settings.get("heaters", []):
            run(self.set_heater(u["number"], u["target"])[0])
        for u in settings.get("mixers", []):
            run(self.set_mixer(u["number"], u["mode"], u.get("on_for", 0), u.get("off_for", 0))[0])
        for u in settings.get("feeders", []):
            run(self.set_feeder(u["number"], u.get("on_for", 0), u.get("off_for_minutes", 0))[0])
        for u in settings.get("agitators", []):
            run(self.set_agitator(u["number"], u.get("pre_feed", 0))[0])

        ph = settings.get("ph")
        if ph and self.get_ph() is not None:
            for role, valve in (ph.get("refill_valves") or {}).items():
                self.set_ph_refill_valve(role, valve)
            for c in ph.get("channels", []):
                run(self.set_ph_limits(c["number"], c["min"], c["max"])[0])
                for edge in ("low", "high"):
                    if c.get(edge):
                        run(self.set_ph_action(c["number"], edge, c[edge])[0])

        self.auto_save()

        if applied == 0:
            return False, "Nothing could be applied to this machine"
        if skipped:
            return True, f"Applied {applied} settings, {skipped} did not fit this machine"
        return True, f"Applied {applied} settings"

    def set_debug(self, enable: bool) -> Tuple[bool, str]:
        return self._acked(f"debugset {1 if enable else 0}")

    def reset(self) -> Tuple[bool, str]:
        """Watchdog reset. The port drops, so the handler should be rebuilt after.

        On bootloaders that do not clear WDRF this can loop until the unit is
        power cycled, so it is not something to call casually.
        """
        try:
            return self._acked("reset", timeout=5.0)
        except Exception as e:
            return False, str(e)

    # ------------------------------------------------------------------
    # pH module
    #
    # The pH controller (probes, LOW/HIGH dose actions, acid and alkaline
    # syringe pumps) runs on the PLC itself; these are thin wrappers over its
    # serial commands. Channel n is the probe in reactor n.
    # ------------------------------------------------------------------
    def get_ph(self) -> Optional[Dict]:
        """Whole pH module state in one framed reply, or None if the PLC has no
        pH module (or no machine type yet)."""
        lines = self._command_lines("phget", ("done ph", "failed phget"), timeout=5.0)
        if any(l.startswith("failed phget unknown") for l in lines):
            self.has_ph = False
            return None
        if not any(l.startswith("done ph") for l in lines):
            return None
        self.has_ph = True

        out = {"uptime": 0, "armed": False, "dry_run": True, "queue_depth": 0,
               "channels": [], "pumps": {}}
        channels = {}
        for line in lines:
            p = line.split()
            try:
                if line.startswith("ph start"):
                    out["uptime"] = int(p[2])
                    out["armed"] = p[3] == "1"
                    out["dry_run"] = p[4] == "1"
                    out["queue_depth"] = int(p[6]) if len(p) > 6 else 0
                elif line.startswith("ph channel"):
                    n = int(p[2])
                    channels[n] = {
                        "number": n,
                        "ph": None if p[3] == "nan" else float(p[3]),
                        "min": float(p[4]), "max": float(p[5]),
                        "alarm": None if p[6] == "none" else p[6].upper(),
                    }
                elif line.startswith("ph action"):
                    n, edge = int(p[2]), p[3]
                    channels.setdefault(n, {"number": n})[edge] = {
                        "enabled": p[4] == "1",
                        "volume_ml": float(p[5]),
                        "valve": int(p[6]),
                        "interval_s": float(p[7]),
                    }
                elif line.startswith("ph pump"):
                    out["pumps"][p[2]] = {
                        "syringe_ml": float(p[3]),
                        "refill_valve": int(p[4]),
                        "busy": p[5] == "1",
                        "dosed_ml": float(p[6]),
                    }
            except (IndexError, ValueError):
                print(f"[PlcHandler] Could not parse pH line: {line}")
        out["channels"] = [channels[n] for n in sorted(channels)]
        return out

    def _ph_changed(self, result):
        if result[0]:
            self._settings_edited()
        return result

    def set_ph_limits(self, channel: int, ph_min: float, ph_max: float) -> Tuple[bool, str]:
        return self._ph_changed(self._acked(f"phlimitset {int(channel)} {float(ph_min):g} {float(ph_max):g}"))

    def set_ph_action(self, channel: int, edge: str, action: Dict) -> Tuple[bool, str]:
        """edge 'low' doses alkaline, 'high' doses acid. interval_s 0 doses once
        per excursion; above 0 repeats while the pH stays out of range."""
        if edge not in ("low", "high"):
            return False, "edge must be low or high"
        cmd = (f"phactionset {int(channel)} {edge} {1 if action.get('enabled') else 0} "
               f"{float(action.get('volume_ml', 0)):g} {int(action.get('valve', channel))} "
               f"{float(action.get('interval_s', 0)):g}")
        return self._ph_changed(self._acked(cmd))

    def set_ph_refill_valve(self, role: str, valve: int) -> Tuple[bool, str]:
        return self._acked(f"phrefillset {role} {int(valve)}")

    def set_ph_armed(self, armed: bool) -> Tuple[bool, str]:
        return self._acked(f"pharmset {1 if armed else 0}")

    def set_ph_dry_run(self, dry_run: bool) -> Tuple[bool, str]:
        return self._acked(f"phdryrunset {1 if dry_run else 0}")

    def ph_dose(self, role: str, valve: int, volume_ml: float) -> Tuple[bool, str]:
        """Manual dose. Bypasses ARMED/DRY-RUN - it is an explicit operator action."""
        return self._acked(f"phdose {role} {int(valve)} {float(volume_ml):g}")

    def ph_refill(self, role: str) -> Tuple[bool, str]:
        return self._acked(f"phrefill {role}")

    def sim_disturb_ph(self, channel: int, delta: float) -> Tuple[bool, str]:
        """Simulator only: knock a reactor's pH to show the controller respond."""
        return self._acked(f"simph {int(channel)} {float(delta):g}")

    def ph_snapshot(self) -> Dict:
        with self._ph_lock:
            return {
                "history": [{"t": t, "uptime": u, "values": v} for t, u, v in self.ph_history],
                "events": list(self.ph_events),
            }

    # ------------------------------------------------------------------
    # Unsolicited telemetry
    # ------------------------------------------------------------------
    def _handle_phpoint(self, line: str):
        """phpoint <uptime> [<n> <ph> <alarm>] ..."""
        parts = line.split()
        try:
            uptime = int(parts[1])
        except (IndexError, ValueError):
            return
        values, alarms = {}, {}
        i = 2
        while i + 2 < len(parts):
            try:
                n = int(parts[i])
                values[n] = float(parts[i + 1])
                alarms[n] = None if parts[i + 2] == "none" else parts[i + 2].upper()
            except ValueError:
                break
            i += 3
        if not values:
            return
        self.has_ph = True
        with self._ph_lock:
            self.latest_ph = values
            self.ph_history.append((time.time(), uptime, values))
        self._publish({
            "type": "plc_ph",
            "device_name": self.device_name,
            "device_id": self.id,
            "uptime": uptime,
            "channels": [{"number": n, "ph": values[n], "alarm": alarms[n]} for n in sorted(values)],
        }, "plc_ph")

    def _handle_phevent(self, line: str):
        """phevent <uptime> <channel> <edge> <role> <volume_ml> <valve> <status>"""
        parts = line.split()
        if len(parts) < 8:
            return
        try:
            event = {
                "ts": time.time(),
                "time": time.strftime("%H:%M:%S"),
                "uptime": int(parts[1]),
                "channel": int(parts[2]),
                "edge": parts[3],
                "role": parts[4],
                "volume_ml": float(parts[5]),
                "valve": int(parts[6]),
                "status": parts[7],
            }
        except ValueError:
            return
        with self._ph_lock:
            self.ph_events.append(event)
        self._publish({"type": "plc_ph_dose", "device_id": self.id, **event}, "plc_ph_dose")
    def _handle_datapoint(self, line: str):
        """datapoint <uptime> [<n> <target> <actual> <on>] ..."""
        parts = line.split()
        if len(parts) < 6:
            return
        try:
            uptime = int(parts[1])
        except ValueError:
            return

        readings = []
        i = 2
        while i + 3 < len(parts):
            try:
                readings.append({
                    "number": int(parts[i]),
                    "target": float(parts[i + 1]),
                    "actual": float(parts[i + 2]),
                    "on": parts[i + 3] == "1",
                })
            except ValueError:
                break
            i += 4

        if not readings:
            return

        self.seconds_elapsed = uptime
        self.latest_temperatures = {r["number"]: r["actual"] for r in readings}
        self._publish({
            "type": "plc_datapoint",
            "device_name": self.device_name,
            "device_id": self.id,
            "uptime": uptime,
            "heaters": readings,
        }, "plc_datapoint")

    def _handle_lta(self, line: str):
        """lta <uptime> [<n> <target> <lta>] ..."""
        parts = line.split()
        if len(parts) < 5:
            return
        try:
            uptime = int(parts[1])
        except ValueError:
            return

        averages = []
        i = 2
        while i + 2 < len(parts):
            try:
                averages.append({
                    "number": int(parts[i]),
                    "target": float(parts[i + 1]),
                    "long_term_average": float(parts[i + 2]),
                })
            except ValueError:
                break
            i += 3

        if not averages:
            return

        self._publish({
            "type": "plc_lta",
            "device_name": self.device_name,
            "device_id": self.id,
            "uptime": uptime,
            "heaters": averages,
        }, "plc_lta")

    def _publish(self, payload: Dict, event_type: str):
        if not self.app:
            return
        try:
            with self.app.app_context():
                from flask_sse import sse
                sse.publish(payload, type=event_type)
        except Exception as e:
            print(f"[PlcHandler] SSE publish failed: {e}")
