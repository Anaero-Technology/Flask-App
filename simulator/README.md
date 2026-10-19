# PLC simulator + pH controller demo

Run the whole app on a laptop with no hardware: a simulated Kittiwake PLC on a
virtual serial port, with the pH controller built in as a PLC module.

```bash
./demo.sh            # from the repo root
```

Open http://localhost:5173, sign in as **admin / demo1234**, wait ~15 s for the
PLC to be detected, then choose **PLC** in the sidebar. First run installs the
Python and Node dependencies. Needs Python 3.9+, Node 20+ and Redis
(`brew install python node redis` on macOS).

`./demo.sh --reset` starts from a blank database and an unconfigured PLC.
`./demo.sh --speed 20` runs the process faster.

## What is real and what is simulated

The Flask backend and React frontend are unchanged apart from the pH
integration below. The backend finds the simulator with its normal auto-connect
scanner and drives it through the normal `PlcHandler`, so everything on the PLC
page exercises real code: machine types, heaters/mixers/feeders/agitators,
maintenance mode, logging and download, SD config save and restore after a
power cycle, profiles, and attaching the PLC to a test.

`plc_simulator.py` implements the protocol in `PLC_Firmware/serial.md`,
including `nosystem` / `maintenance` rejections, framed replies, `datapoint` /
`lta` telemetry, EEPROM name and MAC, and the SD card (kept in `.state/`).

Process behaviour, accelerated ×10 by default:

- heaters warm their reactor towards target; no sensors → heating inhibited
  (`--no-sensors` to see that path);
- timed mixers, feeders with agitator lead-in, grouped per machine as the
  firmware does;
- a feed adds VFA load and pulls the fed reactor's pH down; buffering pulls it
  back towards ~7.2 over ~45 process-minutes; reactor 2 slowly sours so there is
  always something for the controller to do;
- alkaline/acid doses shift pH by 0.12 per ml in the reactor on that valve port
  (ports 1–8 = reactors 1–8).

## pH controller

Ported from `pHController/controller.py`: 8 channels (one per reactor), min/max
alarms, LOW → alkaline and HIGH → acid dose actions with valve port and repeat
interval, two 25 ml syringe pumps that refill from port 15, a serialized dose
queue that cancels a dose if pH recovers first, and the same ARMED / DRY-RUN
safety (comes up disarmed and dry-run after every power cycle). The Rika HMI is
replaced by the PLC's own probes, so limits live on the PLC.

Protocol: [`PH_PROTOCOL.md`](PH_PROTOCOL.md) — written so the same commands can
go into the real firmware without host changes.

In the app:

- **PLC page → pH control**: live pH and trend per reactor, alarm state, edit
  limits and dose actions, arm / dry-run, pump syringe levels, manual dose and
  refill, recent dose log and CSV download. On the simulator only, ±0.6 buttons
  knock a reactor's pH to show the controller respond.
- **Machine tree / reactor panel**: each reactor shows its pH; out-of-range
  reactors get a red outline.
- **Profiles** include pH limits and actions (never armed/dry-run).
- **Tests**: every pH change while a test is running is added to that test's
  PLC configuration history.
- **API**: `GET /api/v1/plc/<id>/ph`, `POST …/ph/controller`, `…/ph/channel`,
  `…/ph/dose`, `…/ph/refill`, `…/ph/disturb` (simulator only), `GET …/ph/log.csv`.
- **SSE**: `plc_ph` (readings) and `plc_ph_dose` (dose events).

### A two-minute walkthrough

1. Pick a machine (e.g. *Lobster*) when the PLC page asks.
2. Select Feeder 1 → 30 s every 10 min, Apply. Reactors 1–3 dip at each feed.
3. Under pH control, Edit reactor 2: LOW enabled, 2 ml, port 2, repeat 120 s.
4. Click **Disarmed** to arm (still dry-run): doses log as `simulated`.
5. Click **Dry run** to go live: the alkaline syringe drains and reactor 2 recovers.
6. Hit **−0.6** on a reactor with a LOW action to watch it get pulled back.

## Running pieces by hand

```bash
python3 simulator/plc_simulator.py -v          # prints the port and all traffic
cd backend && SIMULATED_SERIAL_PORTS=$PWD/../simulator/.state/ttySIMPLC \
  venv/bin/gunicorn --worker-class gevent -w 1 -b :6000 app:app
cd frontend && npm run dev
```

`SIMULATED_SERIAL_PORTS` (comma separated) is the only switch: unset, the
backend scans exactly as before. Options: `--machine ray` (come up configured),
`--no-sensors`, `--no-sd`, `--reset-state`, `--name`.

Note: the app still offers `max` for Lobster-I; firmware master has renamed it
`lobster-i` and added `ray-i`. The simulator accepts both names, but a real PLC
on current firmware will reject `systemset max`.
