import { SerialPort } from 'serialport'
import { WebSocketServer } from 'ws'
import {
  BAUD_RATE,
  BRIDGE_HOST,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  SERIAL_CANDIDATE_PATTERN,
  SERIAL_PORT,
  STALE_CHECK_INTERVAL_MS,
  STALE_STREAM_MS,
  WS_PORT,
} from './config.js'
import { parseTelemetryLine } from './serial-parser.js'

const WS_OPEN = 1
const SERIAL_HISTORY_LIMIT = 120
const SERIAL_HISTORY_BOOTSTRAP_COUNT = 40

let serialPort = null
let serialPathInUse = null
let lineBuffer = ''
let reconnectDelayMs = RECONNECT_MIN_MS
let reconnectTimer = null
let latestTelemetry = null
let lastTelemetryAt = 0
let staleStatusSent = false
let shuttingDown = false
let serialHistory = []

const toErrorMessage = (error) =>
  error instanceof Error ? error.message : String(error)

const bridgeLog = (message) => {
  console.log(`[bridge] ${message}`)
}

const wss = new WebSocketServer({
  host: BRIDGE_HOST,
  port: WS_PORT,
})

const broadcast = (payload) => {
  const encoded = JSON.stringify(payload)

  for (const client of wss.clients) {
    if (client.readyState === WS_OPEN) {
      client.send(encoded)
    }
  }
}

const publishStatus = (status, message, extra = {}) => {
  broadcast({
    type: 'status',
    status,
    message,
    timestamp: Date.now(),
    ...extra,
  })
}

const pushSerialHistory = (entry) => {
  serialHistory = [entry, ...serialHistory].slice(0, SERIAL_HISTORY_LIMIT)
}

const sendHelloPacket = (socket) => {
  socket.send(
    JSON.stringify({
      type: 'hello',
      message: `Bridge online at ws://${BRIDGE_HOST}:${WS_PORT}`,
      serialPort: serialPathInUse,
      baudRate: BAUD_RATE,
      serialHistory: serialHistory
        .slice(0, SERIAL_HISTORY_BOOTSTRAP_COUNT)
        .map((entry) => ({
          ...entry,
        }))
        .reverse(),
      timestamp: Date.now(),
    }),
  )

  if (latestTelemetry) {
    socket.send(
      JSON.stringify({
        type: 'telemetry',
        ...latestTelemetry,
      }),
    )
  }

  if (!serialPort || !serialPort.isOpen) {
    socket.send(
      JSON.stringify({
        type: 'status',
        status: 'serial_disconnected',
        message: 'Waiting for ESP32 serial feed.',
        timestamp: Date.now(),
      }),
    )
  }
}

const resolveSerialPortPath = async () => {
  if (SERIAL_PORT) {
    return SERIAL_PORT
  }

  const ports = await SerialPort.list()
  const candidates = ports.filter((entry) =>
    SERIAL_CANDIDATE_PATTERN.test(entry.path),
  )

  return candidates[0]?.path ?? null
}

const scheduleReconnect = (reason) => {
  if (shuttingDown || reconnectTimer) {
    return
  }

  const waitSeconds = Math.max(1, Math.round(reconnectDelayMs / 1000))
  const message = `${reason} Reconnecting in ${waitSeconds}s.`

  bridgeLog(message)
  publishStatus('reconnecting', message)

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void openSerialPort()
  }, reconnectDelayMs)

  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS)
}

const handleSerialLine = (line) => {
  const normalizedLine = line.trim()
  if (!normalizedLine) {
    return
  }

  const serialEntry = {
    line: normalizedLine,
    timestamp: Date.now(),
  }

  pushSerialHistory(serialEntry)
  broadcast({
    type: 'serial_line',
    ...serialEntry,
  })

  const parsed = parseTelemetryLine(normalizedLine)

  if (!parsed.ok) {
    if (parsed.reason !== 'empty-line') {
      bridgeLog(`Skipped frame (${parsed.reason}): ${normalizedLine.slice(0, 180)}`)
    }
    return
  }

  latestTelemetry = parsed.telemetry
  lastTelemetryAt = parsed.telemetry.timestamp
  staleStatusSent = false
  reconnectDelayMs = RECONNECT_MIN_MS

  broadcast({
    type: 'telemetry',
    ...parsed.telemetry,
  })
}

const attachSerialListeners = (port) => {
  lineBuffer = ''

  port.on('data', (chunk) => {
    lineBuffer += chunk.toString('utf8')

    while (lineBuffer.includes('\n')) {
      const newlineIndex = lineBuffer.indexOf('\n')
      const rawLine = lineBuffer.slice(0, newlineIndex).replace(/\r/g, '')
      lineBuffer = lineBuffer.slice(newlineIndex + 1)
      handleSerialLine(rawLine)
    }

    if (lineBuffer.length > 4096) {
      lineBuffer = lineBuffer.slice(-2048)
    }
  })

  port.on('error', (error) => {
    const message = `Serial error: ${toErrorMessage(error)}`
    bridgeLog(message)
    publishStatus('serial_error', message)
  })

  port.on('close', () => {
    if (shuttingDown) {
      return
    }

    bridgeLog('Serial port closed.')
    publishStatus('serial_disconnected', 'Serial link closed.')
    serialPort = null
    scheduleReconnect('Serial link lost.')
  })
}

const openSerialPort = async () => {
  if (shuttingDown) {
    return
  }

  try {
    const resolvedPath = await resolveSerialPortPath()

    if (!resolvedPath) {
      bridgeLog('No serial device found.')
      publishStatus('serial_missing', 'No serial device found. Connect ESP32 via USB.')
      scheduleReconnect('No serial device found.')
      return
    }

    serialPathInUse = resolvedPath
    bridgeLog(`Opening serial port ${resolvedPath} @ ${BAUD_RATE} baud.`)

    const port = new SerialPort({
      path: resolvedPath,
      baudRate: BAUD_RATE,
      autoOpen: false,
    })

    attachSerialListeners(port)

    port.open((error) => {
      if (error) {
        const message = `Failed to open ${resolvedPath}: ${toErrorMessage(error)}`
        bridgeLog(message)
        publishStatus('serial_error', message)
        serialPort = null
        scheduleReconnect('Serial open failed.')
        return
      }

      serialPort = port
      reconnectDelayMs = RECONNECT_MIN_MS
      publishStatus('serial_connected', `Reading ${resolvedPath} at ${BAUD_RATE} baud.`, {
        serialPort: resolvedPath,
        baudRate: BAUD_RATE,
      })
      bridgeLog(`Serial connected on ${resolvedPath}.`)
    })
  } catch (error) {
    const message = `Unexpected serial setup error: ${toErrorMessage(error)}`
    bridgeLog(message)
    publishStatus('serial_error', message)
    scheduleReconnect('Unexpected serial setup error.')
  }
}

wss.on('listening', () => {
  bridgeLog(`WebSocket server listening on ws://${BRIDGE_HOST}:${WS_PORT}`)
})

wss.on('connection', (socket) => {
  bridgeLog(`Dashboard connected (${wss.clients.size} active client(s)).`)
  sendHelloPacket(socket)

  socket.on('close', () => {
    const activeCount = Math.max(0, wss.clients.size - 1)
    bridgeLog(`Dashboard disconnected (${activeCount} active client(s)).`)
  })
})

wss.on('error', (error) => {
  bridgeLog(`WebSocket error: ${toErrorMessage(error)}`)
})

const staleWatchTimer = setInterval(() => {
  if (!lastTelemetryAt || staleStatusSent) {
    return
  }

  const ageMs = Date.now() - lastTelemetryAt
  if (ageMs < STALE_STREAM_MS) {
    return
  }

  staleStatusSent = true
  publishStatus('stale', `No serial frame for ${Math.round(ageMs / 1000)}s.`, { ageMs })
}, STALE_CHECK_INTERVAL_MS)

const shutdown = () => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  bridgeLog('Shutting down bridge service...')

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  clearInterval(staleWatchTimer)

  for (const client of wss.clients) {
    if (client.readyState === WS_OPEN) {
      client.close(1001, 'Bridge shutting down')
    }
  }

  wss.close()

  const exitProcess = () => process.exit(0)

  if (serialPort && serialPort.isOpen) {
    serialPort.close((error) => {
      if (error) {
        bridgeLog(`Error while closing serial port: ${toErrorMessage(error)}`)
      }
      exitProcess()
    })
    return
  }

  exitProcess()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

void openSerialPort()
