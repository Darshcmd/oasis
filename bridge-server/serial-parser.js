const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const firstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== '')

const toFiniteNumber = (value) => {
  if (value === undefined || value === null) {
    return undefined
  }

  const parsed = Number(value)
  if (Number.isFinite(parsed)) {
    return parsed
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const match = value.match(/[-+]?\d*\.?\d+/)
  if (!match) {
    return undefined
  }

  const fromText = Number(match[0])
  return Number.isFinite(fromText) ? fromText : undefined
}

const toBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false

  return undefined
}

const parseCsvPayload = (line) => {
  const parts = line.split(',').map((part) => part.trim())
  if (parts.length === 0 || !parts[0]) {
    return null
  }

  return {
    water_level_percent: parts[0],
    tds_ppm: parts[1],
    temperature_c: parts[2],
    pump_status: parts[3],
    leak_detected: parts[4],
    taps_open: parts[5],
  }
}

const parseKeyValuePayload = (line) => {
  const tokens = line
    .split(/[|,;]/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    return null
  }

  const payload = {}

  for (const token of tokens) {
    const separator = token.includes(':') ? ':' : token.includes('=') ? '=' : null
    if (!separator) {
      continue
    }

    const [rawKey, ...rawValueParts] = token.split(separator)
    const key = rawKey.trim().toLowerCase()
    const value = rawValueParts.join(separator).trim()

    if (!key || !value) {
      continue
    }

    payload[key] = value
  }

  return Object.keys(payload).length > 0 ? payload : null
}

const parsePumpStateLine = (line) => {
  const normalized = line.trim().toLowerCase()
  if (normalized === 'pump on') {
    return { pump_status: 1 }
  }

  if (normalized === 'pump off') {
    return { pump_status: 0 }
  }

  return null
}

const asObject = (value) => (value && typeof value === 'object' ? value : null)

const normalizePayload = (rawPayload) => {
  const payload =
    asObject(rawPayload?.live_data) ?? asObject(rawPayload?.liveData) ?? asObject(rawPayload)

  if (!payload) {
    return null
  }

  const waterLevelPercent = toFiniteNumber(
    firstDefined(
      payload.waterLevelPercent,
      payload.water_level_percent,
      payload.level_percent,
      payload.level,
      payload['water level'],
      payload.waterlevel,
      payload.wl,
      payload.water,
    ),
  )

  const tdsPpm = toFiniteNumber(
    firstDefined(payload.tdsPpm, payload.tds_ppm, payload.tds, payload.quality),
  )

  const temperatureC = toFiniteNumber(
    firstDefined(
      payload.temperatureC,
      payload.temperature_c,
      payload.temperature,
      payload.temp,
      payload.tc,
      payload['temp c'],
    ),
  )

  const pumpStatus = toBoolean(
    firstDefined(
      payload.pumpStatus,
      payload.pump_status,
      payload['pump state'],
      payload.pump,
    ),
  )

  const leakDetected =
    toBoolean(firstDefined(payload.leakDetected, payload.leak_detected, payload.leak))

  const tapsOpen =
    toBoolean(firstDefined(payload.tapsOpen, payload.taps_open, payload.tap_open, payload.taps))

  const timestamp =
    toFiniteNumber(firstDefined(rawPayload?.timestamp, payload.timestamp, Date.now())) ??
    Date.now()

  const hasKnownSignal =
    waterLevelPercent !== undefined ||
    tdsPpm !== undefined ||
    temperatureC !== undefined ||
    pumpStatus !== undefined ||
    leakDetected !== undefined ||
    tapsOpen !== undefined

  if (!hasKnownSignal) {
    return null
  }

  return {
    waterLevelPercent:
      waterLevelPercent !== undefined ? clamp(waterLevelPercent, 0, 100) : undefined,
    tdsPpm: tdsPpm !== undefined ? clamp(tdsPpm, 0, 5000) : undefined,
    temperatureC:
      temperatureC !== undefined ? clamp(temperatureC, -20, 120) : undefined,
    pumpStatus,
    leakDetected,
    tapsOpen,
    timestamp,
  }
}

export const parseTelemetryLine = (rawLine) => {
  const line = rawLine.trim()
  if (!line) {
    return { ok: false, reason: 'empty-line' }
  }

  let payload = null

  if (line.startsWith('{')) {
    try {
      payload = JSON.parse(line)
    } catch {
      return { ok: false, reason: 'invalid-json' }
    }
  }

  if (!payload && line.includes(',')) {
    payload = parseCsvPayload(line)
  }

  if (!payload && (line.includes(':') || line.includes('='))) {
    payload = parseKeyValuePayload(line)
  }

  if (!payload) {
    payload = parsePumpStateLine(line)
  }

  if (!payload) {
    return { ok: false, reason: 'unsupported-format' }
  }

  const telemetry = normalizePayload(payload)
  if (!telemetry) {
    return { ok: false, reason: 'missing-known-fields' }
  }

  return { ok: true, telemetry }
}
