#!/usr/bin/env python3
"""
Simulated Kittiwake PLC (M-Duino 57R+) with an integrated pH controller.

Runs on a virtual serial port (a pseudo-terminal) and speaks the PLC serial
protocol documented in PLC_Firmware/serial.md, so the Flask app's PlcHandler
detects and drives it exactly as it would the real board.

On top of the stock firmware it carries a demo of the pH controller
(Anaero-Technology/pHController) implemented as a PLC module: 8 pH channels with
min/max alarms, a LOW (alkaline) and HIGH (acid) dose action per channel, two
25 ml syringe pumps with automatic refill, ARMED / DRY-RUN safety and a
serialized dose queue that cancels a dose if the pH recovers before it runs.
The pH protocol extension is documented in simulator/PH_PROTOCOL.md.

The process side is simulated too: heaters warm their reactors, feeds push the
fed reactor's pH down (VFA load), and alkaline/acid doses move it back.

Usage:
    python3 plc_simulator.py [--speed 10] [--name Kittiwake-SIM]
                             [--machine ray] [--no-sensors]

The port path is printed on start and written to <state-dir>/port, and a stable
symlink is kept at <state-dir>/ttySIMPLC. Point the backend at it with
SIMULATED_SERIAL_PORTS=<path> (the demo launcher does this for you).
"""
import argparse
import json
import math
import os
import queue
import random
import select
import signal
import sys
import threading
import time
import tty

FIRMWARE_NAME = "Kittiwake_134"
SIM_VERSION = "1.0"

# ---------------------------------------------------------------------------
# Machine personalities (serial.md "Set System" table)
# name: (type, heaters, mixers, agitators, feeders)
# "max" is accepted as an alias of lobster-i: the current Flask app still sends
# the old name, while firmware master has renamed it.
# ---------------------------------------------------------------------------
MACHINES = {
    "lobster": (1, 6, 6, 6, 2),
    "ray": (2, 2, 2, 2, 1),
    "lobster-i": (3, 4, 4, 4, 4),
    "max": (3, 4, 4, 4, 4),
    "caterpillar": (4, 5, 5, 5, 1),
    "blackswan": (5, 10, 8, 4, 4),
    "medusa": (6, 0, 1, 10, 2),
    "ray-i": (7, 2, 2, 2, 2),
}

# Commands allowed before a machine type is set.
NO_SYSTEM_OK = {"info", "systemset", "systemget", "nameset", "macset", "timeget",
                "configload", "debugset", "reset", "simget"}
# Commands allowed in maintenance mode.
MAINTENANCE_OK = {"info", "systemget", "statusget", "timeget", "sensorget", "configget",
                  "nameset", "macset", "debugset", "reset", "maintenanceset",
                  "maintenanceheater", "maintenancemixer", "maintenancefeeder",
                  "maintenanceagitator", "phget", "pharmset", "phdryrunset", "simget", "simph"}

AMBIENT_C = 20.0

# pH module ---------------------------------------------------------------
PH_CHANNELS = 8
PH_VALVES = 15
SYRINGE_ML = 25.0
REFILL_MARGIN_ML = 1.0
DEFAULT_REFILL_VALVE = 15
ROLE_FOR_EDGE = {"low": "alkaline", "high": "acid"}
ROLES = ("acid", "alkaline")
PH_PER_ML = 0.12            # pH shift per ml of dose in a reactor (buffer capacity)
PUMP_ML_PER_S = 1.5         # real-time pump speed so doses are visible but quick
REFILL_SECONDS = 2.5
DOSE_EVAL_SECONDS = 2.0     # pHController TriggerEngine poll_s


def feeder_for_agitator(machine, j):
    """Which feeder (0-based) drives agitator j (0-based) - serial.md 'Set Agitator'."""
    if machine == "lobster":
        return j // 3
    if machine == "medusa":
        return j // 5
    if machine in ("ray", "caterpillar"):
        return 0
    return j  # lobster-i / max, blackswan, ray-i pair 1:1


class Unit:
    pass


class SimPLC:
    def __init__(self, args):
        self.args = args
        self.speed = max(0.1, float(args.speed))
        self.state_dir = os.path.abspath(args.state_dir)
        os.makedirs(os.path.join(self.state_dir, "sd"), exist_ok=True)
        self.eeprom_path = os.path.join(self.state_dir, "eeprom.json")
        self.sd_dir = os.path.join(self.state_dir, "sd")

        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self.master_fd = None
        self.rng = random.Random()

        self._load_eeprom()
        self.sd_present = not args.no_sd
        self.sensor_bus = "none" if args.no_sensors else "mcp"
        self.boot()

    # ------------------------------------------------------------------
    # Persistence (EEPROM: name + mac, SD card: config.txt + tempLog.txt)
    # ------------------------------------------------------------------
    def _load_eeprom(self):
        data = {}
        if os.path.exists(self.eeprom_path):
            try:
                with open(self.eeprom_path) as f:
                    data = json.load(f)
            except Exception:
                data = {}
        if "mac" not in data:
            octets = [0x02] + [self.rng.randint(0, 255) for _ in range(5)]
            data["mac"] = ":".join(f"{o:02X}" for o in octets)
        if "name" not in data:
            data["name"] = self.args.name or "unset"
        self.eeprom = data
        self._save_eeprom()

    def _save_eeprom(self):
        with open(self.eeprom_path, "w") as f:
            json.dump(self.eeprom, f, indent=2)

    def _sd(self, name):
        return os.path.join(self.sd_dir, name)

    # ------------------------------------------------------------------
    # Power-up: everything volatile goes back to defaults
    # ------------------------------------------------------------------
    def boot(self):
        with self._lock:
            self.boot_time = time.time()
            self.machine = None
            self.maintenance = False
            self.debug = False
            self.logging = False
            self.lta_minutes = 10
            self.heaters, self.mixers, self.feeders, self.agitators = [], [], [], []
            self.sensor_count = 0
            self.lta_acc = []
            self.lta_window_start = 0.0
            self._last_sim_t = 0.0
            self._init_ph()

    def uptime(self):
        return (time.time() - self.boot_time) * self.speed

    # ------------------------------------------------------------------
    # Serial output
    # ------------------------------------------------------------------
    def send(self, line):
        if self.master_fd is None:
            return
        data = (line + "\n").encode()
        with self._write_lock:
            try:
                os.write(self.master_fd, data)
            except (BlockingIOError, OSError):
                # Nobody is reading and the pty buffer is full - drop it, just as
                # a UART with no host attached would.
                pass
        if self.args.verbose:
            print(f"  -> {line}")

    def debug_line(self, text):
        if self.debug:
            self.send(f"# {text}")

    # ------------------------------------------------------------------
    # Machine personality
    # ------------------------------------------------------------------
    def set_system(self, machine):
        _, nh, nm, na, nf = MACHINES[machine]
        self.machine = machine
        self.heaters = []
        for i in range(nh):
            h = Unit()
            h.number, h.target, h.on = i + 1, 0.0, False
            h.temp = AMBIENT_C + self.rng.uniform(-0.8, 0.8)
            h.lta_err = 0.0
            self.heaters.append(h)
        self.mixers = []
        for i in range(nm):
            m = Unit()
            m.number, m.enabled, m.mode, m.on_for, m.off_for, m.on = i + 1, False, 0, 0, 0, False
            m.cycle_start = 0.0
            self.mixers.append(m)
        self.feeders = []
        for i in range(nf):
            f = Unit()
            f.number, f.enabled, f.on_for, f.off_for_s, f.on = i + 1, False, 0, 0, False
            f.next_feed = 0.0
            self.feeders.append(f)
        self.agitators = []
        for i in range(na):
            a = Unit()
            a.number, a.enabled, a.pre_feed, a.on = i + 1, False, 0, False
            self.agitators.append(a)
        # sensor discovery: one MCP9808 per heater on a populated bench rig
        self.sensor_count = 0 if (self.sensor_bus == "none" or machine == "medusa") else nh
        self.lta_acc = []
        self.lta_window_start = self.uptime()
        self._configure_ph_for_machine()

    def n_reactors(self):
        return max(len(self.heaters), len(self.mixers), len(self.agitators))

    def feeder_for_reactor(self, r):
        """(feeder index, strength) feeding reactor r (1-based), or (None, 0)."""
        if self.machine == "blackswan" and 5 <= r <= 8:
            return r - 5, 0.4  # second stage: overflow from reactor r-4, diluted
        j = r - 1
        if j < len(self.agitators):
            fi = feeder_for_agitator(self.machine, j)
            if fi < len(self.feeders):
                return fi, 1.0
        return None, 0.0

    # ------------------------------------------------------------------
    # pH module state
    # ------------------------------------------------------------------
    def _init_ph(self):
        self.ph_armed = False         # pHController safety: starts DISARMED + DRY-RUN
        self.ph_dry_run = True
        self.ph = []
        for n in range(1, PH_CHANNELS + 1):
            c = Unit()
            c.number = n
            c.probe = False
            c.eq = 7.15 + self.rng.uniform(-0.15, 0.15)
            c.offset = self.rng.uniform(-0.1, 0.1)
            c.drift = 0.0
            c.min, c.max = 6.8, 7.8
            c.actions = {e: {"enabled": False, "volume_ml": 0.0, "valve": n, "interval_s": 0.0}
                         for e in ("low", "high")}
            self.ph.append(c)
        self.pumps = {r: {"syringe_ml": SYRINGE_ML - REFILL_MARGIN_ML, "refill_valve": DEFAULT_REFILL_VALVE,
                          "busy": False, "dosed_ml": 0.0} for r in ROLES}
        self.ph_queue = queue.Queue()
        self.ph_pending = set()
        self.ph_last_dose = {}

    def _configure_ph_for_machine(self):
        n = min(PH_CHANNELS, self.n_reactors())
        for c in self.ph:
            c.probe = c.number <= n
        # one reactor on each machine is "souring" so there is something to control
        if n >= 2:
            self.ph[1].drift = -0.00012   # pH per simulated second

    def ph_value(self, c):
        return c.eq + c.offset

    def alarm(self, c):
        if not c.probe:
            return "none"
        v = self.ph_value(c)
        if v < c.min:
            return "low"
        if v > c.max:
            return "high"
        return "none"

    # ------------------------------------------------------------------
    # Process + control loop
    # ------------------------------------------------------------------
    def tick(self):
        with self._lock:
            now = self.uptime()
            dt = now - self._last_sim_t
            self._last_sim_t = now
            if dt <= 0 or self.machine is None:
                return
            dt = min(dt, 60.0)
            self._run_heaters(dt)
            self._run_mixers(now)
            self._run_feeders(now)
            self._run_agitators(now)
            self._run_ph_process(dt)

    def _run_heaters(self, dt):
        for h in self.heaters:
            control = self.sensor_count > 0 and not self.maintenance
            if control:
                h.on = h.target > 0 and h.temp <= h.target + h.lta_err
            power = 0.02 if h.on else 0.0
            h.temp += (power - 0.0005 * (h.temp - AMBIENT_C)) * dt
            h.temp += self.rng.gauss(0, 0.01) * math.sqrt(dt)

    def _run_mixers(self, now):
        if self.maintenance:
            return
        for m in self.mixers:
            if m.mode == 0:
                m.on = False
            elif m.mode == 1:
                m.on = m.enabled
            else:
                period = m.on_for + m.off_for
                m.on = period > 0 and ((now - m.cycle_start) % period) < m.on_for

    def _run_feeders(self, now):
        for f in self.feeders:
            if not f.enabled:
                if not self.maintenance:
                    f.on = False
                continue
            if self.maintenance and f.number > 1:
                continue  # serial.md: feeders 2+ freeze in maintenance mode
            if now >= f.next_feed:
                f.feed_until = now + f.on_for
                f.next_feed = now + f.on_for + f.off_for_s
                self.debug_line(f"Feeder, {f.number}, {int(now)}, turned on")
            if not self.maintenance:
                f.on = now < getattr(f, "feed_until", -1)

    def _run_agitators(self, now):
        if self.maintenance:
            return
        for j, a in enumerate(self.agitators):
            fi = feeder_for_agitator(self.machine, j)
            f = self.feeders[fi] if fi < len(self.feeders) else None
            if not a.enabled or f is None or not f.enabled:
                a.on = False
                continue
            lead_in = f.next_feed - a.pre_feed
            a.on = f.on or (lead_in <= now < f.next_feed)

    def _run_ph_process(self, dt):
        for c in self.ph:
            if not c.probe:
                continue
            r = c.number
            # buffering pulls the reactor back towards equilibrium (~45 min)
            c.offset += (-c.offset / 2700.0) * dt
            c.offset += c.drift * dt
            c.offset += self.rng.gauss(0, 0.0015) * math.sqrt(dt)
            fi, strength = self.feeder_for_reactor(r)
            if fi is not None and self.feeders[fi].on:
                c.offset -= 0.012 * strength * dt   # VFA load from a feed
            # a running mixer homogenises - damp the noise slightly
            c.offset = max(-3.0, min(3.0, c.offset))

    # ------------------------------------------------------------------
    # pH dosing engine (ported from pHController/controller.py TriggerEngine)
    # ------------------------------------------------------------------
    def ph_evaluate(self):
        with self._lock:
            if self.machine is None:
                return
            now = time.time()
            for c in self.ph:
                for edge in ("low", "high"):
                    key = (c.number, edge)
                    breached = self.alarm(c) == edge
                    if not breached:
                        self.ph_last_dose.pop(key, None)
                        continue
                    if not self.ph_armed or self.maintenance or key in self.ph_pending:
                        continue
                    act = c.actions[edge]
                    if not act["enabled"] or act["volume_ml"] <= 0:
                        continue
                    # interval is in process time, so scale it to real time
                    interval = act["interval_s"] / self.speed
                    last = self.ph_last_dose.get(key)
                    if last is None or (interval > 0 and now - last >= interval):
                        self.ph_last_dose[key] = now
                        self.ph_pending.add(key)
                        self.ph_queue.put((c.number, edge, ROLE_FOR_EDGE[edge],
                                           act["valve"], act["volume_ml"], False))

    def ph_worker(self):
        while True:
            ch, edge, role, valve, vol, manual = self.ph_queue.get()
            try:
                status = self._process_dose(ch, edge, role, valve, vol, manual)
            except Exception as e:  # noqa: BLE001
                status = f"error:{type(e).__name__}"
            finally:
                self.ph_pending.discard((ch, edge))
            self.send(f"phevent {int(self.uptime())} {ch} {edge} {role} {vol:g} {valve} {status}")

    def _process_dose(self, ch, edge, role, valve, vol, manual):
        if not manual:
            with self._lock:
                c = self.ph[ch - 1]
                if self.alarm(c) != edge:
                    return "cancelled"
                if not self.ph_armed:
                    return "skipped"
                if self.maintenance:
                    return "skipped"
                dry = self.ph_dry_run
        else:
            dry = False
        if dry:
            return "simulated"

        pump = self.pumps[role]
        pump["busy"] = True
        try:
            refilled = False
            if pump["syringe_ml"] < vol:
                time.sleep(REFILL_SECONDS)
                pump["syringe_ml"] = SYRINGE_ML - REFILL_MARGIN_ML
                refilled = True
            time.sleep(vol / PUMP_ML_PER_S)
            with self._lock:
                pump["syringe_ml"] = max(0.0, pump["syringe_ml"] - vol)
                pump["dosed_ml"] += vol
                # valve ports 1..8 are plumbed to reactors 1..8
                if 1 <= valve <= PH_CHANNELS and self.ph[valve - 1].probe:
                    sign = 1.0 if role == "alkaline" else -1.0
                    self.ph[valve - 1].offset += sign * PH_PER_ML * vol
        finally:
            pump["busy"] = False
        return "refilled" if refilled else "done"

    # ------------------------------------------------------------------
    # Telemetry
    # ------------------------------------------------------------------
    def emit_datapoint(self):
        with self._lock:
            if not self.heaters or self.sensor_count == 0:
                return
            parts = [f"datapoint {int(self.uptime())}"]
            for h in self.heaters:
                parts.append(f"{h.number} {h.target:.2f} {h.temp:.2f} {1 if h.on else 0}")
                self.lta_acc.append((h.number, h.temp))
            self.send(" ".join(parts))

    def emit_lta(self):
        with self._lock:
            if not self.heaters or self.sensor_count == 0:
                return
            now = self.uptime()
            if now - self.lta_window_start < self.lta_minutes * 60:
                return
            self.lta_window_start = now
            parts = [f"lta {int(now)}"]
            log_cells = [str(int(now))]
            for h in self.heaters:
                vals = [t for n, t in self.lta_acc if n == h.number] or [h.temp]
                avg = sum(vals) / len(vals)
                if h.target > 0:
                    h.lta_err = max(-1.0, min(1.0, h.lta_err + (h.target - avg) * 0.5))
                parts.append(f"{h.number} {h.target:.2f} {avg:.2f}")
                log_cells.append(f"{avg:.2f}")
            self.lta_acc = []
            self.send(" ".join(parts))
            if self.logging and self.sd_present:
                with open(self._sd("tempLog.txt"), "a") as f:
                    f.write(",".join(log_cells) + "\n")

    def emit_ph(self):
        with self._lock:
            if self.machine is None:
                return
            parts = [f"phpoint {int(self.uptime())}"]
            for c in self.ph:
                if c.probe:
                    parts.append(f"{c.number} {self.ph_value(c):.2f} {self.alarm(c)}")
            if len(parts) > 1:
                self.send(" ".join(parts))

    # ------------------------------------------------------------------
    # Config script (shared by configsave / configget / configload)
    # ------------------------------------------------------------------
    def config_script(self):
        lines = [f"systemset {self.machine}"]
        for h in self.heaters:
            lines.append(f"heaterset {h.number} {int(h.target)}")
        for f in self.feeders:
            lines.append(f"feederset {f.number} {f.on_for} {f.off_for_s // 60}")
        for a in self.agitators:
            lines.append(f"agitatorset {a.number} {a.pre_feed}")
        for m in self.mixers:
            lines.append(f"mixerset {m.number} {m.mode} {m.on_for} {m.off_for}")
        lines.append(f"ltatimeset {self.lta_minutes}")
        for c in self.ph:
            if not c.probe:
                continue
            lines.append(f"phlimitset {c.number} {c.min:g} {c.max:g}")
            for edge in ("low", "high"):
                a = c.actions[edge]
                lines.append(f"phactionset {c.number} {edge} {1 if a['enabled'] else 0} "
                             f"{a['volume_ml']:g} {a['valve']} {a['interval_s']:g}")
        for role in ROLES:
            lines.append(f"phrefillset {role} {self.pumps[role]['refill_valve']}")
        return lines

    # ------------------------------------------------------------------
    # Command dispatch
    # ------------------------------------------------------------------
    def handle(self, line, silent=False):
        """Run one command. Returns the reply lines (also sent unless silent)."""
        out = []

        def reply(text):
            out.append(text)
            if not silent:
                self.send(text)

        tokens = line.strip().split()
        if not tokens:
            return out
        if len(line) > 63:
            reply("Command not properly terminated")
            return out
        cmd, args = tokens[0], tokens[1:8]
        self.debug_line(f"received {line.strip()}")

        handler = getattr(self, f"cmd_{cmd}", None)
        if handler is None:
            reply(f"failed {cmd} unknown")
            return out
        with self._lock:
            if self.machine is None and cmd not in NO_SYSTEM_OK:
                reply(f"failed {cmd} nosystem")
                return out
            if self.maintenance and cmd not in MAINTENANCE_OK:
                reply(f"failed {cmd} maintenance")
                return out
            handler(args, reply)
        return out

    # -- identity --------------------------------------------------------
    def cmd_info(self, a, reply):
        logging = "1" if self.logging else "0"
        fname = "TEMPLOG.TXT" if self.logging else "none"
        reply(f"info {logging} {fname} {self.eeprom['name']} plc {self.eeprom['mac']}")

    def cmd_nameset(self, a, reply):
        name = a[0] if a else ""
        if not (1 <= len(name) <= 24) or any(ord(ch) < 33 for ch in name):
            reply("failed nameset invalid")
            return
        self.eeprom["name"] = name
        self._save_eeprom()
        reply("done nameset")

    def cmd_macset(self, a, reply):
        mac = a[0] if a else ""
        ok = len(mac) == 17 and mac[2] in ":-"
        if ok:
            try:
                octets = [int(p, 16) for p in mac.replace("-", ":").split(":")]
                ok = len(octets) == 6 and not (octets[0] & 1)
            except ValueError:
                ok = False
        if not ok:
            reply("failed macset invalid")
            return
        self.eeprom["mac"] = mac.replace("-", ":").upper()
        self._save_eeprom()
        reply("done macset")

    def cmd_timeget(self, a, reply):
        reply(f"time {int(self.uptime())}")

    def cmd_simget(self, a, reply):
        reply(f"sim {self.speed:g} {SIM_VERSION}")

    # -- personality -----------------------------------------------------
    def cmd_systemset(self, a, reply):
        machine = a[0] if a else ""
        if machine not in MACHINES:
            reply("failed systemset invalid")
            return
        self.set_system(machine)
        reply("done systemset")

    def cmd_systemget(self, a, reply):
        if self.machine is None:
            reply("system none 0 0 0 0 0")
            return
        t, nh, nm, na, nf = MACHINES[self.machine]
        reply(f"system {self.machine} {t} {nh} {nm} {na} {nf}")

    # -- state -----------------------------------------------------------
    def cmd_statusget(self, a, reply):
        now = self.uptime()
        reply(f"status start {int(now)} {1 if self.maintenance else 0}")
        for h in self.heaters:
            reply(f"status heater {h.number} {1 if h.target > 0 else 0} {h.target:.2f} "
                  f"{h.temp:.2f} {1 if h.on else 0}")
        for m in self.mixers:
            reply(f"status mixer {m.number} {1 if m.enabled else 0} {m.mode} {m.on_for} "
                  f"{m.off_for} {1 if m.on else 0}")
        for f in self.feeders:
            to_next = max(0, int(f.next_feed - now)) if f.enabled else 0
            reply(f"status feeder {f.number} {1 if f.enabled else 0} {f.on_for} {f.off_for_s} "
                  f"{1 if f.on else 0} {to_next}")
        for ag in self.agitators:
            reply(f"status agitator {ag.number} {1 if ag.enabled else 0} {ag.pre_feed} "
                  f"{1 if ag.on else 0}")
        reply("done status")

    def cmd_sensorget(self, a, reply):
        reply(f"sensor {int(self.uptime())} {self.sensor_count} "
              f"{self.sensor_bus if self.sensor_count else 'none'}")

    def cmd_sensorreset(self, a, reply):
        if self.machine:
            nh = MACHINES[self.machine][1]
            self.sensor_count = 0 if (self.sensor_bus == "none" or self.machine == "medusa") else nh
        reply("done sensorreset")

    # -- configuration ---------------------------------------------------
    @staticmethod
    def _int(v, default=None):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _float(v, default=None):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    def cmd_heaterset(self, a, reply):
        n, t = self._int(a[0] if a else None), self._int(a[1] if len(a) > 1 else None)
        if n is None or t is None or not (1 <= n <= len(self.heaters)) or not (0 <= t <= 120):
            reply("failed heaterset range")
            return
        h = self.heaters[n - 1]
        h.target, h.lta_err = float(t), 0.0
        reply("done heaterset")

    def cmd_mixerset(self, a, reply):
        n = self._int(a[0] if a else None)
        mode = self._int(a[1] if len(a) > 1 else None)
        on_for = self._int(a[2] if len(a) > 2 else 0, 0)
        off_for = self._int(a[3] if len(a) > 3 else 0, 0)
        if n is None or not (1 <= n <= len(self.mixers)):
            reply("failed mixerset range")
            return
        if mode not in (0, 1, 2):
            reply("failed mixerset mode")
            return
        if mode == 2 and (on_for <= 0 or off_for <= 0):
            reply("failed mixerset range")
            return
        m = self.mixers[n - 1]
        m.enabled, m.mode, m.on_for, m.off_for = True, mode, on_for, off_for
        m.cycle_start = self.uptime()
        reply("done mixerset")

    def cmd_feederset(self, a, reply):
        n = self._int(a[0] if a else None)
        on_for = self._int(a[1] if len(a) > 1 else 0, 0)
        off_min = self._int(a[2] if len(a) > 2 else 0, 0)
        if n is None or not (1 <= n <= len(self.feeders)):
            reply("failed feederset range")
            return
        f = self.feeders[n - 1]
        f.on_for, f.off_for_s = on_for, off_min * 60
        f.enabled = on_for >= 5 and off_min > 0
        f.on = False
        # starts in its off phase
        f.next_feed = self.uptime() + f.off_for_s if f.enabled else 0
        reply("done feederset")

    def cmd_agitatorset(self, a, reply):
        n = self._int(a[0] if a else None)
        pre = self._int(a[1] if len(a) > 1 else 0, 0)
        if n is None or not (1 <= n <= len(self.agitators)):
            reply("failed agitatorset range")
            return
        ag = self.agitators[n - 1]
        ag.pre_feed, ag.enabled = max(0, pre), pre > 0
        reply("done agitatorset")

    def cmd_ltatimeset(self, a, reply):
        m = self._int(a[0] if a else None)
        if m is None or not (1 <= m <= 120):
            reply("failed ltatimeset range")
            return
        self.lta_minutes = m
        self.lta_acc, self.lta_window_start = [], self.uptime()
        reply("done ltatimeset")

    # -- maintenance -----------------------------------------------------
    def cmd_maintenanceset(self, a, reply):
        s = a[0] if a else ""
        if s not in ("0", "1"):
            reply("failed maintenanceset range")
            return
        want = s == "1"
        if want == self.maintenance:
            reply("already maintenanceset")
            return
        self.maintenance = want
        if want:
            for u in self.heaters + self.mixers + self.feeders + self.agitators:
                u.on = False
        reply("done maintenanceset")

    def _maintenance_unit(self, cmd, units, a, reply):
        if not self.maintenance:
            reply(f"failed {cmd} notmaintenance")
            return
        n, s = self._int(a[0] if a else None), a[1] if len(a) > 1 else ""
        if n is None or s not in ("0", "1") or not (0 <= n <= len(units)):
            reply(f"failed {cmd} range")
            return
        for u in (units if n == 0 else [units[n - 1]]):
            u.on = s == "1"
        reply(f"done {cmd}")

    def cmd_maintenanceheater(self, a, reply):
        self._maintenance_unit("maintenanceheater", self.heaters, a, reply)

    def cmd_maintenancemixer(self, a, reply):
        self._maintenance_unit("maintenancemixer", self.mixers, a, reply)

    def cmd_maintenancefeeder(self, a, reply):
        self._maintenance_unit("maintenancefeeder", self.feeders, a, reply)

    def cmd_maintenanceagitator(self, a, reply):
        self._maintenance_unit("maintenanceagitator", self.agitators, a, reply)

    # -- logging / SD ----------------------------------------------------
    def cmd_startlogging(self, a, reply):
        if self.logging:
            reply("already startlogging")
            return
        if not self.sd_present:
            reply("failed startlogging nocard")
            return
        open(self._sd("tempLog.txt"), "w").close()
        self.logging = True
        reply("done startlogging")

    def cmd_stoplogging(self, a, reply):
        if not self.logging:
            reply("already stoplogging")
            return
        self.logging = False
        reply("done stoplogging")

    def cmd_download(self, a, reply):
        if not self.sd_present:
            reply("failed download nocard")
            return
        self.logging = False
        reply("download start")
        path = self._sd("tempLog.txt")
        if not os.path.exists(path):
            reply("download failed")
            return
        with open(path) as f:
            for row in f:
                reply(f"download {row.rstrip()}")
        reply("download stop")

    def cmd_configsave(self, a, reply):
        if not self.sd_present:
            reply("failed configsave nocard")
            return
        with open(self._sd("config.txt"), "w") as f:
            f.write("\n".join(self.config_script()) + "\n")
        reply("done configsave")

    def cmd_configload(self, a, reply):
        if not self.sd_present:
            reply("failed configload nocard")
            return
        path = self._sd("config.txt")
        if not os.path.exists(path):
            reply("failed configload nofile")
            return
        with open(path) as f:
            for row in f:
                row = row.strip()
                if row and len(row) <= 63 and not row.startswith("config"):
                    self.handle(row, silent=True)
        reply("done configload")

    def cmd_configget(self, a, reply):
        reply("config start")
        for row in self.config_script():
            reply(f"config {row}")
        reply("done config")

    # -- diagnostics -----------------------------------------------------
    def cmd_debugset(self, a, reply):
        s = a[0] if a else ""
        if s not in ("0", "1"):
            reply("failed debugset range")
            return
        self.debug = s == "1"
        reply("done debugset")

    def cmd_reset(self, a, reply):
        reply("done reset")
        threading.Timer(0.2, self._reboot).start()

    def _reboot(self):
        self.boot()
        self.send(f"Running {FIRMWARE_NAME}")

    # -- pH module (PH_PROTOCOL.md) ----------------------------------------
    def _ph_channel(self, v):
        n = self._int(v)
        if n is None or not (1 <= n <= PH_CHANNELS) or not self.ph[n - 1].probe:
            return None
        return self.ph[n - 1]

    def cmd_phget(self, a, reply):
        reply(f"ph start {int(self.uptime())} {1 if self.ph_armed else 0} "
              f"{1 if self.ph_dry_run else 0} {sum(1 for c in self.ph if c.probe)} {self.ph_queue.qsize()}")
        for c in self.ph:
            if not c.probe:
                continue
            reply(f"ph channel {c.number} {self.ph_value(c):.2f} {c.min:g} {c.max:g} {self.alarm(c)}")
            for edge in ("low", "high"):
                act = c.actions[edge]
                reply(f"ph action {c.number} {edge} {1 if act['enabled'] else 0} "
                      f"{act['volume_ml']:g} {act['valve']} {act['interval_s']:g}")
        for role in ROLES:
            p = self.pumps[role]
            reply(f"ph pump {role} {p['syringe_ml']:.2f} {p['refill_valve']} "
                  f"{1 if p['busy'] else 0} {p['dosed_ml']:.2f}")
        reply("done ph")

    def cmd_phlimitset(self, a, reply):
        c = self._ph_channel(a[0] if a else None)
        lo = self._float(a[1] if len(a) > 1 else None)
        hi = self._float(a[2] if len(a) > 2 else None)
        if c is None or lo is None or hi is None or not (0 <= lo < hi <= 14):
            reply("failed phlimitset range")
            return
        c.min, c.max = round(lo, 2), round(hi, 2)
        reply("done phlimitset")

    def cmd_phactionset(self, a, reply):
        c = self._ph_channel(a[0] if a else None)
        edge = a[1] if len(a) > 1 else ""
        en = a[2] if len(a) > 2 else ""
        vol = self._float(a[3] if len(a) > 3 else None)
        valve = self._int(a[4] if len(a) > 4 else None)
        interval = self._float(a[5] if len(a) > 5 else 0, 0.0)
        if (c is None or edge not in ("low", "high") or en not in ("0", "1") or vol is None
                or not (0 <= vol <= SYRINGE_ML - REFILL_MARGIN_ML) or valve is None
                or not (1 <= valve <= PH_VALVES) or interval is None or interval < 0):
            reply("failed phactionset range")
            return
        if valve in {p["refill_valve"] for p in self.pumps.values()}:
            reply("failed phactionset refillvalve")
            return
        c.actions[edge] = {"enabled": en == "1", "volume_ml": round(vol, 2),
                           "valve": valve, "interval_s": interval}
        self.ph_last_dose.pop((c.number, edge), None)
        reply("done phactionset")

    def _flag(self, cmd, attr, a, reply):
        s = a[0] if a else ""
        if s not in ("0", "1"):
            reply(f"failed {cmd} range")
            return
        want = s == "1"
        if getattr(self, attr) == want:
            reply(f"already {cmd}")
            return
        setattr(self, attr, want)
        self.ph_last_dose.clear()
        reply(f"done {cmd}")

    def cmd_pharmset(self, a, reply):
        self._flag("pharmset", "ph_armed", a, reply)

    def cmd_phdryrunset(self, a, reply):
        self._flag("phdryrunset", "ph_dry_run", a, reply)

    def cmd_phrefillset(self, a, reply):
        role = a[0] if a else ""
        v = self._int(a[1] if len(a) > 1 else None)
        if role not in ROLES or v is None or not (1 <= v <= PH_VALVES):
            reply("failed phrefillset range")
            return
        self.pumps[role]["refill_valve"] = v
        reply("done phrefillset")

    def cmd_phdose(self, a, reply):
        """Manual dose: phdose <role> <valve> <volume_ml>. Bypasses ARMED/DRY-RUN."""
        role = a[0] if a else ""
        valve = self._int(a[1] if len(a) > 1 else None)
        vol = self._float(a[2] if len(a) > 2 else None)
        if (role not in ROLES or valve is None or not (1 <= valve <= PH_VALVES)
                or vol is None or not (0 < vol <= SYRINGE_ML - REFILL_MARGIN_ML)):
            reply("failed phdose range")
            return
        if self.pumps[role]["busy"]:
            reply("failed phdose busy")
            return
        edge = "low" if role == "alkaline" else "high"
        self.ph_queue.put((0, edge, role, valve, vol, True))   # channel 0 = manual
        reply("done phdose")

    def cmd_phrefill(self, a, reply):
        role = a[0] if a else ""
        if role not in ROLES:
            reply("failed phrefill range")
            return
        if self.pumps[role]["busy"]:
            reply("failed phrefill busy")
            return
        self.pumps[role]["syringe_ml"] = SYRINGE_ML - REFILL_MARGIN_ML
        reply("done phrefill")

    def cmd_simph(self, a, reply):
        """Demo only: nudge a reactor's pH by <delta> to show the controller react."""
        c = self._ph_channel(a[0] if a else None)
        d = self._float(a[1] if len(a) > 1 else None)
        if c is None or d is None or abs(d) > 3:
            reply("failed simph range")
            return
        c.offset += d
        reply("done simph")

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------
    def open_port(self):
        master, slave = os.openpty()
        tty.setraw(slave)
        tty.setraw(master)
        os.set_blocking(master, False)
        self.master_fd = master
        # Hold the slave end open ourselves so the pty survives the host closing
        # and reopening it (otherwise reads on the master hit EIO).
        self._slave_keepalive = slave
        path = os.ttyname(slave)
        link = os.path.join(self.state_dir, "ttySIMPLC")
        try:
            if os.path.islink(link) or os.path.exists(link):
                os.remove(link)
            os.symlink(path, link)
        except OSError:
            link = path
        with open(os.path.join(self.state_dir, "port"), "w") as f:
            f.write(link + "\n")
        return path, link

    def run(self):
        path, link = self.open_port()
        print(f"[sim-plc] {FIRMWARE_NAME} simulator v{SIM_VERSION} with pH module")
        print(f"[sim-plc] serial port: {path}")
        print(f"[sim-plc] stable link: {link}")
        print(f"[sim-plc] name={self.eeprom['name']} mac={self.eeprom['mac']} speed=x{self.speed:g}")
        sys.stdout.flush()
        self.send(f"Running {FIRMWARE_NAME}")

        if self.args.machine:
            self.handle(f"systemset {self.args.machine}", silent=True)

        threading.Thread(target=self.ph_worker, daemon=True).start()

        def periodic():
            last_dp = last_ph = last_eval = 0.0
            while True:
                time.sleep(0.25)
                now = time.time()
                try:
                    self.tick()
                    if now - last_dp >= 5.0:
                        last_dp = now
                        self.emit_datapoint()
                        self.emit_lta()
                    if now - last_ph >= 3.0:
                        last_ph = now
                        self.emit_ph()
                    if now - last_eval >= DOSE_EVAL_SECONDS:
                        last_eval = now
                        self.ph_evaluate()
                except Exception as e:  # noqa: BLE001
                    print(f"[sim-plc] loop error: {e}")

        threading.Thread(target=periodic, daemon=True).start()

        buf = b""
        while True:
            r, _, _ = select.select([self.master_fd], [], [], 0.5)
            if not r:
                continue
            try:
                chunk = os.read(self.master_fd, 1024)
            except BlockingIOError:
                continue
            except OSError:
                time.sleep(0.2)
                continue
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", "ignore").strip("\r ").strip()
                if not line:
                    continue
                if self.args.verbose:
                    print(f"<-  {line}")
                try:
                    self.handle(line)
                except Exception as e:  # noqa: BLE001
                    print(f"[sim-plc] error handling '{line}': {e}")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--speed", type=float, default=10.0,
                   help="process time multiplier (default 10: a 10 min feed cycle takes 1 min)")
    p.add_argument("--name", default="Kittiwake-SIM", help="device name on first start (EEPROM)")
    p.add_argument("--machine", choices=sorted(MACHINES), help="come up already configured as this machine")
    p.add_argument("--no-sensors", action="store_true", help="simulate a bench unit with no temperature sensors")
    p.add_argument("--no-sd", action="store_true", help="simulate a unit with no SD card")
    p.add_argument("--state-dir", default=os.path.join(here, ".state"),
                   help="where EEPROM/SD contents and the port link are kept")
    p.add_argument("--reset-state", action="store_true", help="wipe EEPROM and SD card first")
    p.add_argument("-v", "--verbose", action="store_true", help="print all serial traffic")
    args = p.parse_args()

    if args.reset_state and os.path.isdir(args.state_dir):
        import shutil
        shutil.rmtree(args.state_dir)

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        SimPLC(args).run()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
