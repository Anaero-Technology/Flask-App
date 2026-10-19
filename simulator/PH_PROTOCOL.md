# PLC pH Module — Serial Protocol Extension

An extension of the Kittiwake PLC protocol (`PLC_Firmware/serial.md`) that puts
the pH controller (`Anaero-Technology/pHController`) on the PLC as a module.
Implemented today by `simulator/plc_simulator.py`; written so the same commands
can be added to the real firmware without changing the host.

All the base conventions hold: 115200 baud, `\n` terminated, commands under 63
bytes with at most 7 arguments, `done` / `failed <reason>` / `already` acks,
framed multi-line replies, unsolicited telemetry under fixed prefixes.

A firmware build without the module answers `failed phget unknown`, which is how
the host tells the two apart. Every pH command needs a machine type
(`failed [command] nosystem` before `systemset`).

### Model

- **Channels** — one pH probe per reactor, channel *n* = reactor *n*, up to 8.
  A machine with fewer reactors has fewer channels (Ray: 2, Lobster: 6).
- **Alarm** — `low` when pH < min, `high` when pH > max, else `none`.
- **Actions** — each channel has a LOW and a HIGH action. LOW doses the
  **alkaline** pump (raise pH); HIGH doses the **acid** pump (lower pH).
  An action is "pump *volume_ml* through valve port *valve*", repeated every
  *interval_s* while the channel stays out of range (0 = once per excursion).
- **Pumps** — two 25 ml syringe pumps on 15-port valves. Each has a refill port
  (default 15) to its reagent bottle; a dose larger than what is left in the
  syringe refills first. Refill ports cannot be used as dose ports.
- **Safety** — after power-up the module is **disarmed** and in **dry-run**.
  Disarmed: alarms are reported, nothing is queued. Armed + dry-run: doses are
  queued and logged as `simulated`, no pump moves. Doses are serialized through
  one queue, and a queued dose is cancelled if the pH has recovered by the time
  it reaches the pump. Maintenance mode suspends automatic dosing.

Armed and dry-run are **not** written by `configsave` — a power cycle always
comes back safe.

---

#### Get pH state
Send:
```
phget\n
```
Receive:
```
ph start [uptime] [armed] [dry_run] [channel_count] [queue_depth]\n
ph channel [n] [ph] [min] [max] [alarm]\n          (per channel)
ph action [n] low [enabled] [volume_ml] [valve] [interval_s]\n
ph action [n] high [enabled] [volume_ml] [valve] [interval_s]\n
ph pump acid [syringe_ml] [refill_valve] [busy] [dosed_ml]\n
ph pump alkaline [syringe_ml] [refill_valve] [busy] [dosed_ml]\n
done ph\n
```
`alarm` is `none`, `low` or `high`. `dosed_ml` is the total since power-up.

#### Set alarm limits
```
phlimitset [n] [min] [max]\n
```
`done phlimitset`, or `failed phlimitset range` (unknown channel, or not
0 ≤ min < max ≤ 14). Permitted in maintenance mode: no.

#### Set a dose action
```
phactionset [n] [low|high] [enabled] [volume_ml] [valve] [interval_s]\n
```
`done phactionset`; `failed phactionset range`; `failed phactionset refillvalve`
when `valve` is a pump's refill port. Volume 0–24 ml, valve 1–15.
Changing an action resets its repeat timer.

#### Arm / dry-run
```
pharmset [0|1]\n
phdryrunset [0|1]\n
```
`done`, `already` if unchanged, `failed … range`. Both allowed in maintenance.

#### Refill port
```
phrefillset [acid|alkaline] [valve]\n
```

#### Manual dose
```
phdose [acid|alkaline] [valve] [volume_ml]\n
```
Queued like an automatic dose but bypasses armed/dry-run — it is an explicit
operator action. `failed phdose busy` while that pump is moving.

#### Refill now
```
phrefill [acid|alkaline]\n
```

---

## Automatic messages

#### pH data point (every few seconds)
```
phpoint [uptime] [n] [ph] [alarm] [n] [ph] [alarm] ...\n
```

#### Dose event (each dose, when it completes or is dropped)
```
phevent [uptime] [channel] [low|high] [acid|alkaline] [volume_ml] [valve] [status]\n
```
`channel` is 0 for a manual dose. `status` is one of `done`, `refilled`
(refilled then dosed), `simulated` (dry-run), `cancelled` (pH recovered while
queued), `skipped` (disarmed / maintenance while queued), `error:<reason>`.

---

## Config script

`configget` / `configsave` append, after `ltatimeset`:
```
phlimitset [n] [min] [max]
phactionset [n] low ...
phactionset [n] high ...
phrefillset acid [valve]
phrefillset alkaline [valve]
```
so `configload` restores pH settings with the rest of the machine.

---

## Simulator-only commands

Real firmware answers these with `failed [word] unknown`.

| command | reply | purpose |
|---|---|---|
| `simget` | `sim [speed] [version]` | lets the host know it is talking to the simulator |
| `simph [n] [delta]` | `done simph` | knock reactor *n*'s pH by *delta* for a demo |
