# Solve-a-thon

## AquaSentinel - Smart Water Management Dashboard

A polished CoreUI-style React dashboard for a full-stack IoT water management system.

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
- Firebase-ready payload preview block

## Logic included in the simulation loop

- Pump control hysteresis:
	- ON when water level >= 90%
	- OFF when water level <= 80%
- Water quality tiers:
	- Good: < 300 PPM
	- Cautious: 300 - 600 PPM
	- Dangerous: > 600 PPM
- Leakage detection:
	- Flags leak when level drops by >= 2% in a 5-minute window
	- Applies only when taps are closed and pump is OFF

## Run locally

```bash
npm install
npm run dev
```

## Verify quality

```bash
npm run lint
npm run build
```

## Next phase

Replace the mock loop in the app with Firebase Realtime Database listeners and ESP32 writes.
