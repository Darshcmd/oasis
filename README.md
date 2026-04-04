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
- Firebase Realtime Database sync (bridge writes telemetry + alert events)
- Firebase login (Email/Password + Google)
- FCM push notifications for leakage and critical TDS spikes
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

## Steps To Start Project

### 1) Firebase setup (one-time)

1. Create Firebase project.
2. Enable Realtime Database.
3. Enable Authentication providers:
   - Email/Password
   - Google
4. Generate a service account key JSON from Firebase Console and keep it locally.
5. In Firebase Console -> Cloud Messaging, generate a **Web Push certificate key pair** and copy the VAPID public key.

### 2) Frontend env

Create `.env.local` in project root (already scaffolded in this repo with placeholders):

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_STORAGE_BUCKET=<project-id>.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_WEB_PUSH_VAPID_KEY=...
VITE_FIREBASE_TELEMETRY_PATH=aqua/live_data
VITE_FIREBASE_ALERTS_PATH=aqua/alerts
VITE_FIREBASE_DEVICE_TOKENS_PATH=aqua/device_tokens
VITE_FIREBASE_HIGH_TDS_THRESHOLD=600
```

### 3) Start bridge server with Firebase sync

`bridge-server/index.js` now auto-loads `.env.server` (already scaffolded with placeholders), so you can just run:

```bash
npm run server
```

If you prefer one-off env inline, this still works:

```bash
FIREBASE_SYNC_ENABLED=true \
FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com \
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/serviceAccountKey.json \
npm run server
```

### 4) Start frontend

In a second terminal:

```bash
npm run dev
```

Open the shown local URL (usually `http://localhost:5173`), then:
1. Sign in with Google or Email/Password.
2. Click `Enable Push Alerts` once to register this browser device.
3. Keep bridge running so telemetry continues.

### 5) Optional: run frontend + bridge together (without Firebase env inline)

```bash
npm run dev:full
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
- `FIREBASE_SYNC_ENABLED` (`true` or `false`, default: `false`)
- `FIREBASE_DATABASE_URL` (example: `https://<project-id>-default-rtdb.firebaseio.com`)
- `FIREBASE_SERVICE_ACCOUNT_PATH` (absolute path to service-account JSON)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (raw JSON string, alternative to path)
- `FIREBASE_TELEMETRY_PATH` (default: `aqua/live_data`)
- `FIREBASE_ALERTS_PATH` (default: `aqua/alerts`)
- `FIREBASE_DEVICE_TOKENS_PATH` (default: `aqua/device_tokens`)
- `FIREBASE_HIGH_TDS_THRESHOLD` (default: `600`)

Example:

```bash
SERIAL_PORT=/dev/ttyUSB0 BAUD_RATE=115200 npm run server
```

Firebase-enabled bridge example:

```bash
FIREBASE_SYNC_ENABLED=true \
FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com \
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/serviceAccountKey.json \
npm run server
```

## Frontend Firebase configuration (Login + Realtime read)

Create `.env.local`:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_STORAGE_BUCKET=<project-id>.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_WEB_PUSH_VAPID_KEY=...
VITE_FIREBASE_TELEMETRY_PATH=aqua/live_data
VITE_FIREBASE_ALERTS_PATH=aqua/alerts
VITE_FIREBASE_DEVICE_TOKENS_PATH=aqua/device_tokens
VITE_FIREBASE_HIGH_TDS_THRESHOLD=600
```

When these variables are present:

1. Dashboard shows Firebase login (Google + email/password).
2. After login, telemetry is read from Realtime Database path `aqua/live_data` (or your custom path).
3. `Enable Push Alerts` stores FCM token under `aqua/device_tokens/<uid>/...`.
4. Bridge sends FCM notifications on:
   - leakage detection
   - very high TDS (threshold breach)

If variables are missing, app automatically falls back to local WebSocket bridge mode.

Firebase console checklist:

1. Enable `Authentication -> Sign-in method -> Email/Password`.
2. Enable `Authentication -> Sign-in method -> Google`.
3. Create at least one user in `Authentication -> Users` (for email/password mode).
4. Set Realtime Database rules so authenticated users can read telemetry and alerts.
5. Generate Cloud Messaging Web Push VAPID key.

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

## Firebase Realtime payload

Bridge writes live data to:

```json
{
  "water_level_percent": 85,
  "tds_ppm": 210,
  "temperature_c": 24.5,
  "pump_status": false,
  "leak_detected": false,
  "taps_open": false,
  "timestamp": 1760000000000,
  "system_state": "Perfect"
}
```

Alert events are appended under `aqua/alerts`.
# oasis
