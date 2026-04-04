const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const toBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return fallback
  }

  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
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

export const FIREBASE_SYNC_ENABLED = toBoolean(
  process.env.FIREBASE_SYNC_ENABLED,
  false,
)
export const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL?.trim() ?? ''
export const FIREBASE_SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ?? ''
export const FIREBASE_SERVICE_ACCOUNT_JSON =
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ?? ''
export const FIREBASE_TELEMETRY_PATH =
  process.env.FIREBASE_TELEMETRY_PATH?.trim() ?? 'aqua/live_data'
export const FIREBASE_ALERTS_PATH =
  process.env.FIREBASE_ALERTS_PATH?.trim() ?? 'aqua/alerts'
export const FIREBASE_DEVICE_TOKENS_PATH =
  process.env.FIREBASE_DEVICE_TOKENS_PATH?.trim() ?? 'aqua/device_tokens'
export const FIREBASE_HIGH_TDS_THRESHOLD = toPositiveInteger(
  process.env.FIREBASE_HIGH_TDS_THRESHOLD,
  600,
)
