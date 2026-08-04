# Codebase Map (AI navigation)

Dense, symbol-anchored map for fast navigation. Prose rationale and an update log live in `AGENTS.md`; endpoint details in `backend/API_DOCUMENTATION.md`. When these disagree with the code, the code wins — verify a named symbol still exists before relying on it.

## 1. What this is

Full-stack control + data app for Anaero anaerobic-digestion lab hardware, deployed on a Raspberry Pi. Three device types speak over serial: **BlackBox** (gas-flow meter, ESP32), **Chimera** (gas monitor, ESP32), **PLC** (reactor controller, Industrial Shields M-Duino 57R+ / ATmega2560). The app discovers them, drives them, records test data, and exports it.

- **backend/** — Flask API + serial device control + SSE. Entry `backend/app.py`. Runs under gunicorn (gevent) on `:6000`, behind nginx in prod.
- **frontend/** — React 19 + Vite + Tailwind. Entry `frontend/src/App.jsx`. Dev server `:5173` (proxies `/api`, `/stream` → `:6000`). No router lib: a `currentView` string switch in `App.jsx`; navigation via `onNavigate` or `window.dispatchEvent(new CustomEvent('app:navigate', {detail:{view, params}}))`.
- **firmware/** — device firmware. `firmware/plc/Kittiwake_134/` (Arduino/AVR, this session's rework), `firmware/chimera/firmware.bin` (bundled ESP32 image). PLC firmware source is **git-excluded by convention** (kept in the tree, not committed).
- SSE uses `flask_sse` over Redis (one global channel; events carry `device_id`, clients filter). DB is SQLite (`backend/app.db`) via Flask-SQLAlchemy; prod uses `sqlite:///app.db` (Postgres URI is present but commented in `.env`).

### Run / build / test
```bash
# backend (creates venv, installs deps, starts redis + gunicorn)
cd backend && ./start.sh
# frontend
cd frontend && npm run dev        # or: npx vite build
npx eslint src/view/PLC.jsx        # lint one file
python3 -m py_compile routes/plc.py
flask create-admin                 # first admin user
```
System deps (from the image / provisioning, not pip): `redis-server`, `avrdude` (only for PLC firmware flashing) — README step 6.

## 2. Device subsystem (the core abstraction)

Everything device-related flows through these three layers. Learn them first.

| File | Role |
|---|---|
| `backend/serial_handler.py` | `SerialHandler` base: pyserial connection, background reader thread, line buffering, `send_command`/`send_command_no_wait`, `_command_lock`/`_write_lock`, automatic-message handlers (prefix→callback), `get_type()` device identification. |
| `backend/device_manager.py` | `DeviceManager` singleton: `_active_handlers` (keyed by `device_id`), `connect(port)`, `disconnect_device`, `get_device`/`get_black_box`/`get_chimera`/`get_plc`, `list_devices()`, `_reserved_ports` + `reserve_port`/`release_port` (exclusive port hold for firmware flashing). Keyed on **MAC**, not port — a device that re-enumerates to a new port is still recognized. |
| `backend/{black_box,chimera,plc}_handler.py` | Per-device protocol subclasses of `SerialHandler`. |
| `backend/app.py` `auto_connect_devices()` / `auto_connect_sweep()` | Background daemon thread; continuously scans serial ports and connects Anaero devices. |

Key `SerialHandler` mechanics:
- **Reader thread** decodes bytes → lines; a line matching a registered prefix (`register_automatic_handler`) is dispatched to its callback (used for unsolicited telemetry: BlackBox `tip `, Chimera `datapoint `, PLC `datapoint `/`lta `), otherwise queued for `send_command` to consume.
- `get_type()` sends `info`, parses device type from the reply. It **repeats the request across a delay schedule** because AVR/ESP boards auto-reset on port-open and sit in a bootloader for ~1–2 s, dropping the first request.
- `firmware_update_in_progress` flag makes other callers fail fast during a flash.

`auto_connect_sweep(manager, ports, port_state, probe_attempts=5)` (pure, unit-tested in-line): **edge-triggered** scanning — a connected port is skipped (never re-probed → live devices not disturbed), a reserved port is skipped, an unidentified port is tried a few times then dropped until it re-enumerates, a vanished port is forgotten. The loop **never exits** (fixed a bug where it stopped after the first Chimera, so USB hot-plugs after boot were never seen).

## 3. PLC subsystem (deepest area)

The PLC is an ATmega2560; unlike the ESP32 devices it **cannot self-flash** and has no unique chip ID. Its firmware was reworked to speak the same protocol as BlackBox/Chimera.

### 3.1 Serial protocol (`firmware/plc/Kittiwake_134/protocol.cpp`)
- 115200 baud, `\n`-terminated, ≤63 bytes. Lower-case compound commands.
- **Acks**: `done <cmd>` / `failed <cmd> <reason>` / `already <cmd>`. Reasons: `range invalid nosystem maintenance notmaintenance nocard mode`.
- **Framed multi-line**: `<noun> start` … `done <noun>` (e.g. `statusget`, `configget`, `download`).
- **Telemetry** (unsolicited, prefixed): `datapoint <uptime> [<n> <target> <actual> <on>]…`, `lta <uptime> [<n> <target> <lta>]…`.
- **Nothing else is printed** — critical: the pre-rework firmware printed `New command received:` before each reply, which a line reader consumed as the reply. Diagnostics are gated behind `debugset 1`.
- Commands: `info nameset macset systemset systemget statusget timeget heaterset mixerset feederset agitatorset ltatimeset maintenanceset maintenance{heater,mixer,feeder,agitator} sensorget sensorreset startlogging stoplogging download configsave configload configget debugset reset`.
- Machine personalities (`systemset <x>`): `lobster ray lobster-i caterpillar blackswan medusa ray-i` (systemType 1-7 in that order). Nothing but a few identity/config commands work until a personality is set (`nosystem` otherwise). `max` was **renamed to `lobster-i`** (same machine, still systemType 3) when `ray-i` was added, so `ray-i` is systemType 7 rather than slotting in next to `ray` — appending kept every existing number stable.
- Identity in EEPROM (`identity.cpp`): auto-generates a locally-administered MAC (`02:…`) on first boot; name defaults to `unset`. `info` reports `info <logging> <logfile> <name> plc <mac>` — `plc` at index 4 so `SerialHandler.get_type()` identifies it.
- Config persistence: `configsave`/`configload` write/replay a **script of protocol commands** to the SD card (`configget` prints the same script framed). SD is brought up at boot and re-init'd on `configload` retry.

### 3.2 Handler (`backend/plc_handler.py`)
`PlcHandler(SerialHandler)`. Key methods: `connect` (2.5 s boot-settle then `_get_device_info` with retries), `get_status()` (parses the `statusget` frame into `{heaters,mixers,feeders,agitators, maintenance_mode, uptime}`; feeder off-time converted **seconds→minutes** as `off_for_minutes`), `set_{heater,mixer,feeder,agitator}`, `set_machine_type` (slow — runs sensor discovery), `capture_settings`/`apply_settings` (whole-config snapshot/replay), `set_name` (normalizes: no spaces, ≤24 chars), `auto_save`, `restore_settings`, calibration is applied in the route not here. `machine_types` class list drives `/machine_types`. `_command_lines()` collects a framed reply up to a terminator (plain `send_command` returns only the first line, wrong for framed/slow replies).

### 3.3 Routes (`backend/routes/plc.py`, blueprint `plc_bp`)
`GET connected · machine_types` · per-device: `connect disconnect name info status calibration(GET/POST) machine_type heater mixer feeder agitator lta_time maintenance maintenance/unit sensors start_logging stop_logging download config configuration(POST batch) test/<id>(POST start, DELETE stop) pending stream firmware_check firmware_update` · profiles: `GET profiles · POST <id>/profiles · POST <id>/profiles/<pid>/apply · DELETE profiles/<pid>` · `GET test/<id>/configuration`.
- **`get_status` folds in calibration** (`_apply_calibration`): each heater gets `actual` (raw+offset), `actual_raw`, `offset`.
- **`configuration` (POST)** = batch apply of `{changes:[{unit_type,number,…}]}`; on an active test appends one timeline entry for the whole batch.
- Setters go through `_apply_and_log` — apply to the machine, and if a test is running append a `PlcConfiguration` version.
- **Firmware**: `firmware_update` disconnects the handler, `reserve_port`s it, flashes via `plc_firmware.flash`, streams `plc_firmware_progress`/`plc_firmware_complete` SSE, then reconnects (retries).

### 3.4 Firmware flashing (`backend/plc_firmware.py`)
Host runs **avrdude** (`-c wiring -p atmega2560`) over the bootloader. `locate_avrdude()` (system `avrdude`, else Arduino-bundled). `is_intel_hex()` validates. `flash()` runs avrdude **under a pseudo-terminal (`pty`)** — avrdude block-buffers its progress bars when stdout is a pipe, so a PTY is required to stream live `Writing/Reading …%` progress. Parses `(Reading|Writing) … (\d+)%` → `progress_cb(phase, percent)`.

### 3.5 Data model (PLC) — `backend/database/models.py`
| Table | Purpose |
|---|---|
| `plc_profiles` | Reusable named configs (machine_type, model_id, settings JSON). Save from / apply to any compatible PLC. |
| `plc_configurations` | **Append-only per-test timeline**: `sequence`, `settings` JSON, `change_note`, `profile_name`. Snapshotted on test start and on every change; never rewritten. Exported with test data. |
| `plc_calibrations` | Per-device, per-heater temperature `offset` (°C). Added to the raw sensor reading. Independent of machine/test. |

### 3.6 Frontend (PLC)
| File | Role |
|---|---|
| `frontend/src/view/PLC.jsx` | Main page. Connected-only device list, machine feed-tree, per-reactor control panel, **staged batch edits** (`draft` state) applied together via `/configuration`, full-config overlay, telemetry polling. |
| `frontend/src/view/PlcTree.jsx` | Feed-tree diagram (`d3-hierarchy`, plain SVG). machine→feeders→reactors→units, with Black Swan two-stage overflow. Filters feeders to those the model defines. |
| `frontend/src/view/plcLayouts.js` | **Machine models**, now 1:1 with firmware personalities. Each model has `firmware`, optional `legacyFirmware` (tokens older firmware used — `max` for Lobster-I, `ray` for Ray-I), `feeders:[[n,[reactors]]]` and optional `downstream:{}`. `modelsAvailable`, `resolveModel`, `feederForReactor`. |
| `frontend/src/view/PlcSettings.jsx` | Settings→PLC container: device picker + machine-type change (password-confirmed) + `PlcMaintenance` + `PlcCalibration` + `PlcFirmware`. |
| `PlcMaintenance.jsx` | Manual per-output control overlay (grouped by feeder), enter/leave maintenance mode. |
| `PlcCalibration.jsx` | Overlay: per-heater offset via measured external temp. |
| `PlcFirmware.jsx` | Upload `.hex`, flash with SSE progress bar. Upload-only (bundled not offered in UI). |
| `PlcConfigView.jsx` | Read-only full-config overlay + copy-as-text. |
| `PlcConfigTooltip.jsx` | Hover on a PLC card's test name → config summary (matches Database view markup). |

Model choice (Ray vs Ray-I etc.) is remembered in `localStorage` keyed `plc-model:<mac>`; the firmware can't distinguish them.

## 4. Other subsystems (map)

| Area | Backend | Frontend |
|---|---|---|
| Auth/JWT | `routes/auth.py`, `utils/auth.py` (`require_role`, `check_stream_token`). `verify-password` returns **403** on wrong password (401 would log the user out). | `components/AuthContext.jsx` (`authFetch` refreshes on 401 then logs out). |
| Devices/tests | `routes/devices_tests.py` (CRUD, discovery, `/tests/<id>/stop`, `/tests/<id>/download`). | `view/TestForm.jsx`, `view/Database.jsx`, `components/deviceCard.jsx`. |
| Test data / export | `routes/data.py`, `routes/devices_tests.py` download builder (ZIP of CSVs; PLC config as CSV via `plc_configurations_for_test`). | `view/Database.jsx`, `view/Plot.jsx`. |
| Chimera | `chimera_handler.py`, `routes/chimera.py` (calibration, recirculation, firmware flash, SSE stream). | `components/ChimeraContext.jsx`, `ChimeraTestConfig.jsx`. |
| BlackBox | `black_box_handler.py`, `routes/black_box.py`. | `BlackBoxTestConfig.jsx`. |
| WiFi | `routes/wifi.py`, `utils/wifi_manager.py` (nmcli; PSK + WPA-Enterprise). | `view/Settings.jsx` (network tab). |
| App settings | `routes/app_settings.py` (company name/logo in `.env`/`uploads/`). | `AppSettingsContext.jsx`. |
| Automation | `automation_engine.py` — `AutomationEngine` daemon plus the pure core it shares with the simulator: `condition_met`, `combine_conditions` (three-valued AND/OR), `gate_check`, `plan_action`, `next_value`, `simulate`, `scenario_series`, `rule_from_spec`, `validate_rule_fields`. `routes/automation.py` (`automation_bp`: rules CRUD, `dry_run`, `simulate`, `events`, `options`). Models `automation_rules` + `automation_conditions` (cascade) + append-only `automation_events`. Engine started in `app.py` behind `_should_start_auto_connect()`. Tests: `tests/test_automation.py`. | `view/Automation.jsx` (rule cards, multi-condition editor overlay, simulator overlay with a recharts timeline, activity log; sidebar entry gated on a connected PLC). |
| System / update | `routes/system.py`, `scripts/{system_update_orchestrator,safe_git_update}.sh`. | `view/Settings.jsx` (system tab). |
| Dashboard | — | `view/dashboard.jsx` (polls `/devices/connected`; hosts device cards). |
| i18n | — | `frontend/src/locales/*`, `react-i18next`. |

## 5. Landmines / non-obvious invariants

- **PLC speaks only when spoken to** — no unsolicited output except `datapoint`/`lta`. Waiting for a reply that isn't coming hangs; you must (re)send.
- **AVR boot window** — opening the port resets the board (~1.4 s bootloader). Traffic during that window keeps the bootloader listening instead of starting the sketch. Stay quiet first, then ask (`get_type` schedule; `PlcHandler.boot_settle_seconds`).
- **Port contention while flashing** — avrdude needs the port alone. The in-app flow `reserve_port`s it (scanner + user connects then refuse it). Manual avrdude while the backend runs → the scanner steals the port mid-flash → corruption. Stop the backend to flash by hand.
- **avrdude non-TTY buffering** — needs a PTY for live progress (see `plc_firmware.flash`).
- **Feeder timing units** — firmware stores feeder off-time in **seconds** but the setter/UI use **minutes**; `PlcHandler` converts both ways (`off_for_minutes`). The firmware's own `set_feeder` comment claims minutes but never multiplied — do not "fix" by removing the handler conversion.
- **Machine personalities are 1:1 with models now, but old units are not** — current firmware names every build exactly (`ray` = 1 feeder, `ray-i` = 2, `lobster-i` replaces `max`). A PLC that has not been reflashed still reports `max`, and its `ray` still means either Ray or Ray-I with 2 feeders. Both sides are handled: `PlcHandler.machine_type_aliases`/`legacy_machine_types` translate and retry the other spelling on `failed systemset invalid`, and `legacyFirmware` in `plcLayouts.js` keeps old tokens resolving. The per-MAC `plc-model:<mac>` choice still disambiguates Ray/Ray-I on pre-rename firmware only.
- **The bundled `.hex` is not rebuilt automatically** — `_bundled_plc_firmware()` serves whatever `.hex` sits in `firmware/plc/Kittiwake_134/`. That copy is a separate checkout of the firmware repo and can lag the source; flashing it downgrades the machine list. The compat layer above is what stops that breaking the app.
- **Black Swan** is two-stage: 4 fed reactors each overflow into a second-stage reactor (`downstream` in `plcLayouts.js`); reactors 9–10 are unmapped (open question).
- **`systemset` runs sensor discovery** and (in older firmware) could halt with no sensors — now degrades gracefully; heater control is inhibited (not fatal) when no sensor.
- **Stop-test ≠ stop-machine** for PLCs — stopping a test ends the config timeline but leaves outputs running. Machine control and recording are separate lifecycles.
- **Config edits: immediate + logged** — edits apply to the machine right away; if a test is running each change appends a `PlcConfiguration` version. (An earlier "stage until test start" model was removed.)
- **DeviceManager keys on MAC** — ports re-enumerate (esp. macOS `usbmodemXXXX`); code must not assume a stable port name.
- **SSE is one global channel** — every event carries `device_id`; publishers/consumers must filter. Stream endpoints auth via `?token=` (`check_stream_token`) since EventSource can't send headers.
- **`backend/app.py` is monolithic** — mixes direct `@app.route` handlers with blueprints; startup does lightweight ad-hoc schema patching (no formal migrations — new tables via `db.create_all()`).
- **Automation acts on real hardware** — every rule needs hard min/max clamps and a cooldown; the engine refuses to act in maintenance mode or during a flash, treats a stale "latest" reading (>30 min) as no-data, and one gunicorn worker (`-w 1`) is what guarantees a single engine instance. Rule changes to a PLC on a running test land on that test's `PlcConfiguration` timeline like hand edits.
- **Automation logic is three-valued** — an unreadable measurement is *unknown*, not false. It blocks an `all`/AND rule (never act on partly-observed evidence) but is ignored by an `any`/OR rule that measured something positive. A definitively-false condition still settles an AND immediately, so the message says which condition failed rather than "waiting for data".
- **The simulator must stay on the shared path** — `gate_check`/`plan_action` are the only decision logic, called by both the daemon and `simulate()`. Never fork a second implementation for simulation, or a rule that passes the simulator stops predicting the live one. A rule's parameter only moves one direction, so instability shows up as `crossings` (condition flips), never as reversals in the value trajectory.

## 6. Conventions

- New serial devices: subclass `SerialHandler`, add a `DeviceManager` branch (connect + `list_devices` + `get_*`), a `routes/<device>.py` blueprint registered in `app.py`, and a `view/<Device>.jsx`.
- Device protocols follow the house style: lower-case compound commands, `done/failed/already` acks, `<noun> start`/`done <noun>` framing, prefixed telemetry via `register_automatic_handler`.
- Frontend: Tailwind, dark-mode via `dark:` variants, toasts via `useToast`, auth requests via `authFetch`. Overlays follow the `PlcConfigView` pattern (backdrop click + Escape close).
- Firmware changes need M-Duino hardware to validate (reconnect timing, SD restore, sensor discovery, output mapping) — backend/web tests can't cover them.
- Commits: no `Co-Authored-By` trailer (repo owner preference). `firmware/plc/` is kept out of commits by convention.
