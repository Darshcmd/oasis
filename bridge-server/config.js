const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const BRIDGE_HOST = process.env.BRIDGE_HOST ?? '127.0.0.1'
export const WS_PORT = toPositiveInteger(process.env.WS_PORT, 3001)
export const BAUD_RATE = toPositiveInteger(process.env.BAUD_RATE, 115200)
export const SERIAL_PORT = process.env.SERIAL_PORT?.trim() ?? ''
export const RECONNECT_MIN_MS = toPositiveInteger(process.env.RECONNECT_MIN_MS, 1000)
export const RECONNECT_MAX_MS = toPositiveInteger(process.env.RECONNECT_MAX_MS, 10000)
export const STALE_STREAM_MS = toPositiveInteger(process.env.STALE_STREAM_MS, 10000)
export const STALE_CHECK_INTERVAL_MS = toPositiveInteger(
  process.env.STALE_CHECK_INTERVAL_MS,
  1000,
)
export const SERIAL_CANDIDATE_PATTERN = /(ttyUSB|ttyACM|cu\.usb|COM\d+)/i
