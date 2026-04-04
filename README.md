# Solve-a-thon

## AquaSentinel - Smart Water Management Dashboard

CoreUI-style React dashboard for a full-stack IoT water management system, now integrated with a live ESP32 serial bridge.

## What is implemented

- Dynamic system status banner with three health states:
  - PERFECT
  - CAUTIOUS
  - DANGEROUS / CRITICAL
- KPI cards for:
  - Water level with threshold-aware progress bar
  - Water quality (TDS)
  - Temperature
  - Actuator state (pump + leak)
- Real-time charts:
  - Water Level vs Time
  - TDS + Temperature trend (dual-axis)
- Live alert feed with severity tags and timestamps
- Live serial monitor panel (raw host serial lines)
- Firebase-ready payload preview block
- Live stream ingestion from `ESP32 -> USB Serial -> Node bridge -> WebSocket -> React`

## Live integration architecture

1. ESP32 prints sensor frames to serial.
2. Bridge server reads serial frames and parses JSON/CSV/key-value formats.
3. Bridge broadcasts normalized telemetry over WebSocket.
4. Dashboard consumes the stream and updates cards/charts/alerts in real time.

## Expected serial data format

Preferred (JSON per line):

```text
{"water_level_percent":85,"tds_ppm":210,"temperature_c":24.5,"pump_status":0,"leak_detected":0,"taps_open":0}
```

Supported fallback formats:

```text
85,210,24.5,0,0,0
WL:85|TDS:210|TEMP:24.5|PUMP:0|LEAK:0|TAPS:0
```

Current calibrated sketch format is also supported:

```text
Distance: 7.42 cm | Water Level: 88.10 %
Pump ON
Pump OFF
```

## Install

```bash
npm install
```

## Run frontend only

```bash
npm run dev
```

## Run serial bridge only

```bash
npm run server
```

## Run frontend + bridge together

```bash
npm run dev:full
```

## Bridge configuration

Optional environment variables:

- `SERIAL_PORT` (example: `/dev/ttyUSB0` or `/dev/ttyACM0`)
- `BAUD_RATE` (default: `115200`)
- `WS_PORT` (default: `3001`)
- `BRIDGE_HOST` (default: `127.0.0.1`)
- `RECONNECT_MIN_MS` (default: `1000`)
- `RECONNECT_MAX_MS` (default: `10000`)
- `STALE_STREAM_MS` (default: `10000`)

Example:

```bash
SERIAL_PORT=/dev/ttyUSB0 BAUD_RATE=115200 npm run server
```

## Verify quality

```bash
npm run lint
npm run build
```

## Linux serial permissions (if needed)

If serial open fails with permission errors:

```bash
sudo usermod -a -G dialout $USER
```

Then log out and back in.

## Firebase migration (next phase)

When you are ready to move from local serial bridge to cloud syncing:

1. Keep ESP32 logic but push normalized JSON to Firebase Realtime Database.
2. Replace WebSocket listener in dashboard with Firebase `onValue` listener.
3. Reuse the same payload fields already used in UI:
  - `water_level_percent`
  - `tds_ppm`
  - `temperature_c`
  - `pump_status`
  - `leak_detected`
