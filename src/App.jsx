import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CContainer,
  CForm,
  CFormInput,
  CProgress,
  CProgressBar,
  CRow,
  CSpinner,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import {
  cilBell,
  cilBolt,
  cilChartLine,
  cilDrop,
  cilFire,
  cilShieldAlt,
  cilSpeedometer,
  cilWarning,
} from '@coreui/icons'
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { onValue, ref, set } from 'firebase/database'
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'
import './App.css'
import { auth, database, hasFirebaseConfig } from './firebase'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

const BRIDGE_SOCKET_URL = import.meta.env.VITE_BRIDGE_WS_URL || 'ws://127.0.0.1:3001'
const FIREBASE_TELEMETRY_PATH =
  (import.meta.env.VITE_FIREBASE_TELEMETRY_PATH || 'aqua/live_data').replace(
    /^\/+|\/+$/g,
    '',
  )
const FIREBASE_ALERTS_PATH =
  (import.meta.env.VITE_FIREBASE_ALERTS_PATH || 'aqua/alerts').replace(/^\/+|\/+$/g, '')
const FIREBASE_DEVICE_TOKENS_PATH =
  (import.meta.env.VITE_FIREBASE_DEVICE_TOKENS_PATH || 'aqua/device_tokens').replace(
    /^\/+|\/+$/g,
    '',
  )
const FIREBASE_HIGH_TDS_THRESHOLD = Number.parseInt(
  import.meta.env.VITE_FIREBASE_HIGH_TDS_THRESHOLD || '600',
  10,
)
const FIREBASE_WEB_PUSH_VAPID_KEY = import.meta.env.VITE_FIREBASE_WEB_PUSH_VAPID_KEY || ''
const FIREBASE_AUTH_DOMAIN = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || ''
const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY || ''
const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || ''
const FIREBASE_APP_ID = import.meta.env.VITE_FIREBASE_APP_ID || ''
const FIREBASE_MESSAGING_SENDER_ID = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''
const CHART_WINDOW_POINTS = 42
const ALERT_LOG_LIMIT = 24
const LEAK_WINDOW_MS = 5 * 60 * 1000
const STALE_STREAM_MS = 10_000
const STALE_CHECK_INTERVAL_MS = 1_000
const RECONNECT_MAX_MS = 10_000
const SERIAL_LOG_LIMIT = 120

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const firstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== '')

const toFiniteNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
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

const toTimeLabel = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const prependSerialLog = (logs, text, timestamp, kind = 'serial') => {
  if (!text || typeof text !== 'string') {
    return logs
  }

  const normalized = text.trim()
  if (!normalized) {
    return logs
  }

  const nextLogs = [
    {
      id: `${timestamp}-${kind}-${Math.round(Math.random() * 1_000_000)}`,
      text: normalized,
      timestamp,
      kind,
    },
    ...logs,
  ]

  return nextLogs.slice(0, SERIAL_LOG_LIMIT)
}

const qualityMetaFromTds = (tds) => {
  if (tds < 300) {
    return {
      state: 'Good',
      color: 'success',
      accentClass: 'quality-good',
      icon: 'GOOD',
      helper: 'Safe for use',
    }
  }

  if (tds <= 600) {
    return {
      state: 'Cautious',
      color: 'warning',
      accentClass: 'quality-caution',
      icon: 'WARN',
      helper: 'Contamination rising',
    }
  }

  return {
    state: 'Dangerous',
    color: 'danger',
    accentClass: 'quality-danger',
    icon: 'BIO',
    helper: 'Highly contaminated',
  }
}

const getSystemState = (liveData) => {
  if (
    liveData.leakDetected ||
    liveData.waterLevelPercent >= 100 ||
    liveData.tdsPpm > FIREBASE_HIGH_TDS_THRESHOLD
  ) {
    return 'Dangerous / Critical'
  }

  if (liveData.tdsPpm >= 300 || liveData.waterLevelPercent >= 90) {
    return 'Cautious'
  }

  return 'Perfect'
}

const statusMetaMap = {
  Perfect: {
    color: 'success',
    title: 'PERFECT',
    description: 'All subsystems are healthy and stable.',
  },
  Cautious: {
    color: 'warning',
    title: 'CAUTIOUS',
    description: 'Early warning thresholds have been reached.',
  },
  'Dangerous / Critical': {
    color: 'danger',
    title: 'DANGEROUS / CRITICAL',
    description: 'Immediate attention required for safety and integrity.',
  },
}

const prependAlert = (alerts, severity, message, timestamp) => {
  const latest = alerts[0]

  if (latest && latest.message === message && latest.severity === severity) {
    return alerts
  }

  const nextAlerts = [
    {
      id: `${timestamp}-${Math.round(Math.random() * 1_000_000)}`,
      severity,
      message,
      timestamp,
    },
    ...alerts,
  ]

  return nextAlerts.slice(0, ALERT_LOG_LIMIT)
}

const shouldNotifyForAlert = (alert) => {
  if (!alert) {
    return false
  }

  const normalizedMessage = alert.message.toLowerCase()
  return (
    normalizedMessage.includes('leak') ||
    normalizedMessage.includes('toxicity threshold') ||
    normalizedMessage.includes('tds crossed critical threshold')
  )
}

const getStableTokenKey = (token) => {
  let hash = 0

  for (let index = 0; index < token.length; index += 1) {
    hash = (hash << 5) - hash + token.charCodeAt(index)
    hash |= 0
  }

  return `t_${Math.abs(hash)}`
}

const createInitialDashboardState = (mode = 'bridge') => {
  const now = Date.now()
  const liveData = {
    waterLevelPercent: 84,
    tdsPpm: 248,
    temperatureC: 24.4,
    pumpStatus: false,
    leakDetected: false,
    tapsOpen: false,
  }

  return {
    liveData,
    systemState: getSystemState(liveData),
    samples: [
      {
        time: now,
        label: toTimeLabel(now),
        waterLevelPercent: liveData.waterLevelPercent,
        tdsPpm: liveData.tdsPpm,
        temperatureC: liveData.temperatureC,
      },
    ],
    levelWindow: [{ time: now, level: liveData.waterLevelPercent }],
    alerts: [
      {
        id: `init-${now}`,
        severity: 'Info',
        message: 'Dashboard initialized. Waiting for serial bridge telemetry.',
        timestamp: now,
      },
    ],
    lastUpdated: now,
    lastTelemetryAt: null,
    framesReceived: 0,
    serialMonitorLogs: [
      {
        id: `serial-init-${now}`,
        text: 'Waiting for serial lines from bridge...',
        timestamp: now,
        kind: 'status',
      },
    ],
    streamStatus: 'connecting',
    streamMessage:
      mode === 'firebase'
        ? `Waiting for Firebase data at ${FIREBASE_TELEMETRY_PATH}...`
        : `Connecting to bridge at ${BRIDGE_SOCKET_URL}...`,
  }
}

const normalizeTelemetryPayload = (incoming, previousLiveData) => {
  if (!incoming || typeof incoming !== 'object') {
    return null
  }

  const payload =
    incoming.liveData ||
    incoming.live_data ||
    incoming.data ||
    incoming.payload ||
    incoming

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const waterLevelPercent = toFiniteNumber(
    firstDefined(
      payload.waterLevelPercent,
      payload.water_level_percent,
      payload.level,
      payload['water level'],
      payload.waterlevel,
      payload.wl,
    ),
  )

  const tdsPpm = toFiniteNumber(
    firstDefined(payload.tdsPpm, payload.tds_ppm, payload.tds),
  )

  const temperatureC = toFiniteNumber(
    firstDefined(
      payload.temperatureC,
      payload.temperature_c,
      payload.temperature,
      payload['temp c'],
      payload.temp,
    ),
  )

  const pumpStatus =
    toBoolean(
      firstDefined(
        payload.pumpStatus,
        payload.pump_status,
        payload['pump state'],
        payload.pump,
      ),
    ) ?? previousLiveData.pumpStatus

  const tapsOpen =
    toBoolean(firstDefined(payload.tapsOpen, payload.taps_open, payload.taps)) ??
    previousLiveData.tapsOpen

  const leakDetected = toBoolean(
    firstDefined(payload.leakDetected, payload.leak_detected, payload.leak),
  )

  const timestamp =
    toFiniteNumber(firstDefined(incoming.timestamp, payload.timestamp, Date.now())) ??
    Date.now()

  const hasKnownSignal =
    waterLevelPercent !== undefined ||
    tdsPpm !== undefined ||
    temperatureC !== undefined ||
    toBoolean(firstDefined(payload.pumpStatus, payload.pump_status, payload['pump state'], payload.pump)) !==
      undefined ||
    toBoolean(firstDefined(payload.tapsOpen, payload.taps_open, payload.taps)) !== undefined ||
    leakDetected !== undefined

  if (!hasKnownSignal) {
    return null
  }

  return {
    waterLevelPercent: clamp(
      waterLevelPercent ?? previousLiveData.waterLevelPercent,
      0,
      100,
    ),
    tdsPpm: clamp(tdsPpm ?? previousLiveData.tdsPpm, 0, 5000),
    temperatureC: clamp(
      temperatureC ?? previousLiveData.temperatureC,
      -20,
      120,
    ),
    pumpStatus,
    tapsOpen,
    leakDetected,
    timestamp,
  }
}

const applyTelemetryState = (prev, telemetry) => {
  const previous = prev.liveData
  const now = telemetry.timestamp

  const levelWindow = [
    ...prev.levelWindow,
    { time: now, level: telemetry.waterLevelPercent },
  ].filter((entry) => now - entry.time <= LEAK_WINDOW_MS)

  const oldestWindowPoint = levelWindow[0]
  const dropWithinWindow = oldestWindowPoint
    ? oldestWindowPoint.level - telemetry.waterLevelPercent
    : 0

  const leakDetected =
    telemetry.leakDetected ??
    (!telemetry.tapsOpen && !telemetry.pumpStatus && dropWithinWindow >= 2)

  const liveData = {
    waterLevelPercent: telemetry.waterLevelPercent,
    tdsPpm: telemetry.tdsPpm,
    temperatureC: telemetry.temperatureC,
    pumpStatus: telemetry.pumpStatus,
    leakDetected,
    tapsOpen: telemetry.tapsOpen,
  }

  const systemState = getSystemState(liveData)

  let alerts = prev.alerts

  if (!previous.pumpStatus && liveData.pumpStatus) {
    alerts = prependAlert(
      alerts,
      'Info',
      `Pump activated automatically (${Math.round(liveData.waterLevelPercent)}% level).`,
      now,
    )
  }

  if (previous.pumpStatus && !liveData.pumpStatus) {
    alerts = prependAlert(
      alerts,
      'Info',
      `Pump deactivated (${Math.round(liveData.waterLevelPercent)}% level reached safe zone).`,
      now,
    )
  }

  if (previous.tdsPpm <= 300 && liveData.tdsPpm > 300) {
    alerts = prependAlert(
      alerts,
      'Warning',
      `TDS crossed 300 PPM (${Math.round(liveData.tdsPpm)} PPM).`,
      now,
    )
  }

  if (
    previous.tdsPpm <= FIREBASE_HIGH_TDS_THRESHOLD &&
    liveData.tdsPpm > FIREBASE_HIGH_TDS_THRESHOLD
  ) {
    alerts = prependAlert(
      alerts,
      'Critical',
      `Toxicity threshold breached (${Math.round(liveData.tdsPpm)} PPM).`,
      now,
    )
  }

  if (!previous.leakDetected && leakDetected) {
    alerts = prependAlert(
      alerts,
      'Alert',
      `Leak pattern detected (${dropWithinWindow.toFixed(1)}% unexplained drop in 5 min).`,
      now,
    )
  }

  if (previous.waterLevelPercent < 100 && liveData.waterLevelPercent >= 100) {
    alerts = prependAlert(
      alerts,
      'Critical',
      'Tank reached 100% while drain response is insufficient.',
      now,
    )
  }

  if (prev.systemState !== systemState) {
    alerts = prependAlert(alerts, 'Info', `System state changed to ${systemState}.`, now)
  }

  const samples = [
    ...prev.samples,
    {
      time: now,
      label: toTimeLabel(now),
      waterLevelPercent: liveData.waterLevelPercent,
      tdsPpm: liveData.tdsPpm,
      temperatureC: liveData.temperatureC,
    },
  ].slice(-CHART_WINDOW_POINTS)

  return {
    ...prev,
    liveData,
    systemState,
    samples,
    levelWindow,
    alerts,
    lastUpdated: now,
    lastTelemetryAt: now,
    framesReceived: prev.framesReceived + 1,
    streamStatus: 'connected',
    streamMessage: 'Live stream active (calibrated sketch currently sends water level + pump events).',
  }
}

const severityClassMap = {
  Info: 'severity-info',
  Warning: 'severity-warning',
  Alert: 'severity-alert',
  Critical: 'severity-critical',
}

const streamStatusMetaMap = {
  connected: {
    label: 'Connected',
    color: 'success',
  },
  connecting: {
    label: 'Connecting',
    color: 'info',
  },
  reconnecting: {
    label: 'Reconnecting',
    color: 'warning',
  },
  stale: {
    label: 'Stale',
    color: 'warning',
  },
  disconnected: {
    label: 'Disconnected',
    color: 'danger',
  },
}

const bridgeStatusToStreamStatus = {
  serial_connected: 'connected',
  serial_disconnected: 'reconnecting',
  serial_missing: 'disconnected',
  serial_error: 'reconnecting',
  reconnecting: 'reconnecting',
  stale: 'stale',
}

function App() {
  const dataSourceMode = hasFirebaseConfig ? 'firebase' : 'bridge'
  const [state, setState] = useState(() => createInitialDashboardState(dataSourceMode))
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(hasFirebaseConfig)
  const [authError, setAuthError] = useState('')
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
  })
  const [signingIn, setSigningIn] = useState(false)
  const [googleSigningIn, setGoogleSigningIn] = useState(false)
  const [pushStatus, setPushStatus] = useState('idle')
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const lastNotifiedAlertIdRef = useRef(null)

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      setAuthLoading(false)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user)
      setAuthLoading(false)
      setAuthError('')
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (dataSourceMode !== 'bridge') {
      return undefined
    }

    let socket = null
    let reconnectTimer = null
    let reconnectDelayMs = 1000
    let isCancelled = false

    const setStreamStatus = (streamStatus, streamMessage) => {
      setState((prev) => ({
        ...prev,
        streamStatus,
        streamMessage,
      }))
    }

    const connect = () => {
      if (isCancelled) {
        return
      }

      setStreamStatus(
        reconnectDelayMs > 1000 ? 'reconnecting' : 'connecting',
        `Connecting to bridge at ${BRIDGE_SOCKET_URL}...`,
      )

      socket = new WebSocket(BRIDGE_SOCKET_URL)

      socket.addEventListener('open', () => {
        reconnectDelayMs = 1000
        setStreamStatus('connected', 'Bridge connected. Waiting for ESP32 frames...')
      })

      socket.addEventListener('message', (event) => {
        let incoming = null

        try {
          incoming = JSON.parse(event.data)
        } catch {
          return
        }

        if (incoming.type === 'status') {
          const mappedStatus = bridgeStatusToStreamStatus[incoming.status] || 'reconnecting'
          setState((prev) => ({
            ...prev,
            streamStatus: mappedStatus,
            streamMessage: incoming.message || prev.streamMessage,
            serialMonitorLogs: prependSerialLog(
              prev.serialMonitorLogs,
              `[bridge] ${incoming.message || incoming.status || 'status update'}`,
              incoming.timestamp || Date.now(),
              'status',
            ),
          }))
          return
        }

        if (incoming.type === 'hello') {
          setState((prev) => ({
            ...prev,
            serialMonitorLogs:
              prev.serialMonitorLogs.length <= 1 &&
              Array.isArray(incoming.serialHistory)
                ? incoming.serialHistory.reduce(
                    (logs, entry) =>
                      prependSerialLog(
                        logs,
                        entry?.line,
                        entry?.timestamp || Date.now(),
                        'serial',
                      ),
                    [],
                  )
                : prev.serialMonitorLogs,
            streamStatus: 'connected',
            streamMessage: incoming.message || prev.streamMessage,
          }))
          return
        }

        if (incoming.type === 'serial_line') {
          setState((prev) => ({
            ...prev,
            serialMonitorLogs: prependSerialLog(
              prev.serialMonitorLogs,
              incoming.line,
              incoming.timestamp || Date.now(),
              'serial',
            ),
          }))
          return
        }

        setState((prev) => {
          const telemetry = normalizeTelemetryPayload(incoming, prev.liveData)
          if (!telemetry) {
            return prev
          }

          return applyTelemetryState(prev, telemetry)
        })
      })

      socket.addEventListener('error', () => {
        const waitSeconds = Math.max(1, Math.round(reconnectDelayMs / 1000))
        setStreamStatus(
          'reconnecting',
          `Bridge error detected. Retrying in ${waitSeconds}s...`,
        )
      })

      socket.addEventListener('close', () => {
        if (isCancelled) {
          return
        }

        const waitSeconds = Math.max(1, Math.round(reconnectDelayMs / 1000))
        setStreamStatus(
          'reconnecting',
          `Bridge disconnected. Reconnecting in ${waitSeconds}s...`,
        )

        reconnectTimer = window.setTimeout(() => {
          connect()
        }, reconnectDelayMs)

        reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS)
      })
    }

    connect()

    return () => {
      isCancelled = true
      window.clearTimeout(reconnectTimer)

      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close()
      }
    }
  }, [dataSourceMode])

  useEffect(() => {
    if (dataSourceMode !== 'firebase' || !database || !authUser) {
      return undefined
    }

    setState((prev) => ({
      ...prev,
      streamStatus: 'connecting',
      streamMessage: `Connecting to Firebase path ${FIREBASE_TELEMETRY_PATH}...`,
    }))

    const telemetryRef = ref(database, FIREBASE_TELEMETRY_PATH)
    const alertsRef = ref(database, FIREBASE_ALERTS_PATH)

    const unsubscribeTelemetry = onValue(telemetryRef, (snapshot) => {
      const incoming = snapshot.val()

      if (!incoming) {
        setState((prev) => ({
          ...prev,
          streamStatus: 'connecting',
          streamMessage: `Waiting for telemetry in ${FIREBASE_TELEMETRY_PATH}...`,
        }))
        return
      }

      setState((prev) => {
        const telemetry = normalizeTelemetryPayload(incoming, prev.liveData)
        if (!telemetry) {
          return prev
        }

        const next = applyTelemetryState(prev, telemetry)
        return {
          ...next,
          streamStatus: 'connected',
          streamMessage: `Live Firebase stream active (${FIREBASE_TELEMETRY_PATH}).`,
        }
      })
    })

    const unsubscribeAlerts = onValue(alertsRef, (snapshot) => {
      const value = snapshot.val()
      if (!value || typeof value !== 'object') {
        return
      }

      const entries = Object.entries(value)
      if (entries.length === 0) {
        return
      }

      const latestAlert = entries
        .map(([id, payload]) => ({
          id: `firebase-${id}`,
          severity: payload?.severity || 'Alert',
          message: payload?.message || 'Firebase alert raised.',
          timestamp: Number(payload?.timestamp) || Date.now(),
        }))
        .sort((a, b) => b.timestamp - a.timestamp)[0]

      setState((prev) => ({
        ...prev,
        alerts: prependAlert(
          prev.alerts,
          latestAlert.severity,
          latestAlert.message,
          latestAlert.timestamp,
        ),
      }))
    })

    return () => {
      unsubscribeTelemetry()
      unsubscribeAlerts()
    }
  }, [authUser, dataSourceMode])

  useEffect(() => {
    const staleTimer = window.setInterval(() => {
      setState((prev) => {
        if (prev.streamStatus !== 'connected' || !prev.lastTelemetryAt) {
          return prev
        }

        const ageMs = Date.now() - prev.lastTelemetryAt
        if (ageMs < STALE_STREAM_MS) {
          return prev
        }

        return {
          ...prev,
          streamStatus: 'stale',
          streamMessage: `No telemetry received for ${Math.round(ageMs / 1000)}s.`,
        }
      })
    }, STALE_CHECK_INTERVAL_MS)

    return () => window.clearInterval(staleTimer)
  }, [])

  useEffect(() => {
    const latestAlert = state.alerts[0]
    if (!latestAlert || latestAlert.id === lastNotifiedAlertIdRef.current) {
      return
    }

    if (!shouldNotifyForAlert(latestAlert)) {
      lastNotifiedAlertIdRef.current = latestAlert.id
      return
    }

    if (
      dataSourceMode === 'firebase' ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    ) {
      return
    }

    new Notification(`AquaSentinel ${latestAlert.severity}`, {
      body: latestAlert.message,
      tag: `aqua-${latestAlert.severity.toLowerCase()}`,
    })

    lastNotifiedAlertIdRef.current = latestAlert.id
  }, [dataSourceMode, state.alerts])

  useEffect(() => {
    if (dataSourceMode !== 'firebase' || !authUser) {
      return undefined
    }

    let unsubscribe = () => {}
    let isCancelled = false

    const bindForegroundNotifications = async () => {
      if (!(await isSupported())) {
        return
      }

      const messaging = getMessaging()
      unsubscribe = onMessage(messaging, (payload) => {
        if (isCancelled || typeof Notification === 'undefined') {
          return
        }

        if (Notification.permission !== 'granted') {
          return
        }

        const title = payload.notification?.title || 'AquaSentinel Alert'
        const body = payload.notification?.body || 'Water safety event detected.'
        new Notification(title, {
          body,
          tag: 'aqua-fcm-foreground',
        })
      })
    }

    void bindForegroundNotifications()

    return () => {
      isCancelled = true
      unsubscribe()
    }
  }, [authUser, dataSourceMode])

  const enablePushNotifications = async () => {
    if (dataSourceMode !== 'firebase' || !database || !authUser) {
      return
    }

    if (!FIREBASE_WEB_PUSH_VAPID_KEY) {
      setAuthError('Missing VAPID key: set VITE_FIREBASE_WEB_PUSH_VAPID_KEY in .env.local')
      return
    }

    if (typeof Notification === 'undefined') {
      setPushStatus('unsupported')
      return
    }

    setPushStatus('enabling')
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)

    if (permission !== 'granted') {
      setPushStatus('denied')
      return
    }

    if (!(await isSupported())) {
      setPushStatus('unsupported')
      return
    }

    try {
      const query = new URLSearchParams({
        apiKey: FIREBASE_API_KEY,
        authDomain: FIREBASE_AUTH_DOMAIN,
        projectId: FIREBASE_PROJECT_ID,
        appId: FIREBASE_APP_ID,
        messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
      })

      const serviceWorkerRegistration = await navigator.serviceWorker.register(
        `/firebase-messaging-sw.js?${query.toString()}`,
      )

      const messaging = getMessaging()
      const token = await getToken(messaging, {
        vapidKey: FIREBASE_WEB_PUSH_VAPID_KEY,
        serviceWorkerRegistration,
      })

      if (!token) {
        setPushStatus('token-missing')
        return
      }

      const tokenKey = getStableTokenKey(token)

      await set(
        ref(database, `${FIREBASE_DEVICE_TOKENS_PATH}/${authUser.uid}/${tokenKey}`),
        {
          token,
          updated_at: Date.now(),
          platform: 'web',
          email: authUser.email || null,
          display_name: authUser.displayName || null,
        },
      )

      setPushStatus('enabled')
      setAuthError('')
    } catch (error) {
      setPushStatus('error')
      setAuthError(
        error instanceof Error
          ? `Push setup failed: ${error.message}`
          : 'Push setup failed. Please try again.',
      )
    }
  }

  const handleAuthFormChange = (field, value) => {
    setAuthForm((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleSignIn = async (event) => {
    event.preventDefault()
    if (!auth) {
      return
    }

    setAuthError('')
    setSigningIn(true)

    try {
      await signInWithEmailAndPassword(auth, authForm.email.trim(), authForm.password)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Login failed. Please try again.')
    } finally {
      setSigningIn(false)
    }
  }

  const handleGoogleSignIn = async () => {
    if (!auth) {
      return
    }

    setAuthError('')
    setGoogleSigningIn(true)

    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Google sign in failed. Please try again.',
      )
    } finally {
      setGoogleSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    if (!auth) {
      return
    }

    await signOut(auth)
  }

  const statusMeta = statusMetaMap[state.systemState]
  const qualityMeta = qualityMetaFromTds(state.liveData.tdsPpm)
  const streamStatusMeta =
    streamStatusMetaMap[state.streamStatus] || streamStatusMetaMap.disconnected

  const waterLevelChartData = useMemo(
    () => ({
      labels: state.samples.map((sample) => sample.label),
      datasets: [
        {
          label: 'Water Level (%)',
          data: state.samples.map((sample) => sample.waterLevelPercent),
          borderColor: '#0b8aa3',
          backgroundColor: 'rgba(11, 138, 163, 0.16)',
          tension: 0.34,
          borderWidth: 3,
          pointRadius: 1.75,
          fill: true,
        },
      ],
    }),
    [state.samples],
  )

  const waterLevelChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          mode: 'index',
          intersect: false,
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 7,
            color: '#2a4550',
          },
          grid: {
            color: 'rgba(30, 80, 92, 0.1)',
          },
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: '#2a4550',
          },
          grid: {
            color: 'rgba(30, 80, 92, 0.15)',
          },
        },
      },
    }),
    [],
  )

  const tdsTempChartData = useMemo(
    () => ({
      labels: state.samples.map((sample) => sample.label),
      datasets: [
        {
          label: 'TDS (PPM)',
          data: state.samples.map((sample) => sample.tdsPpm),
          borderColor: '#ff7a1a',
          backgroundColor: 'rgba(255, 122, 26, 0.15)',
          yAxisID: 'yTds',
          borderWidth: 3,
          tension: 0.35,
          pointRadius: 1.7,
        },
        {
          label: 'Temperature (deg C)',
          data: state.samples.map((sample) => sample.temperatureC),
          borderColor: '#ed3f49',
          backgroundColor: 'rgba(237, 63, 73, 0.12)',
          yAxisID: 'yTemp',
          borderWidth: 2.4,
          tension: 0.32,
          pointRadius: 1.2,
        },
      ],
    }),
    [state.samples],
  )

  const tdsTempChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#2a4550',
            usePointStyle: true,
            boxWidth: 8,
          },
        },
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 7,
            color: '#2a4550',
          },
          grid: {
            color: 'rgba(30, 80, 92, 0.1)',
          },
        },
        yTds: {
          type: 'linear',
          position: 'left',
          min: 0,
          max: 1000,
          ticks: {
            color: '#2a4550',
          },
          grid: {
            color: 'rgba(30, 80, 92, 0.15)',
          },
        },
        yTemp: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 50,
          ticks: {
            color: '#2a4550',
          },
          grid: {
            drawOnChartArea: false,
          },
        },
      },
    }),
    [],
  )

  if (dataSourceMode === 'firebase' && (authLoading || !authUser)) {
    return (
      <div className="dashboard-root">
        <div className="ambient-shape ambient-shape-1"></div>
        <div className="ambient-shape ambient-shape-2"></div>
        <div className="ambient-shape ambient-shape-3"></div>
        <CContainer fluid className="dashboard-shell py-4 py-xl-5">
          <div className="login-shell">
            <CCard className="login-card">
              <CCardHeader>
                <div className="card-title-row">
                  <span>Firebase Login</span>
                  {authLoading ? <CSpinner size="sm" /> : null}
                </div>
              </CCardHeader>
              <CCardBody>
                <p className="login-copy">
                  Sign in to access the AquaSentinel dashboard and live telemetry.
                </p>
                {!authLoading ? (
                  <CForm className="login-form" onSubmit={handleSignIn}>
                    <CButton
                      type="button"
                      color="light"
                      variant="outline"
                      onClick={handleGoogleSignIn}
                      disabled={googleSigningIn || signingIn}
                    >
                      {googleSigningIn ? 'Signing in with Google...' : 'Continue with Google'}
                    </CButton>
                    <div className="login-divider">or use email/password</div>
                    <CFormInput
                      type="email"
                      label="Email"
                      placeholder="you@example.com"
                      value={authForm.email}
                      onChange={(event) =>
                        handleAuthFormChange('email', event.target.value)
                      }
                      required
                    />
                    <CFormInput
                      type="password"
                      label="Password"
                      placeholder="••••••••"
                      value={authForm.password}
                      onChange={(event) =>
                        handleAuthFormChange('password', event.target.value)
                      }
                      required
                    />
                    {authError ? <CAlert color="danger">{authError}</CAlert> : null}
                    <CButton type="submit" color="primary" disabled={signingIn}>
                      {signingIn ? 'Signing in...' : 'Sign In'}
                    </CButton>
                  </CForm>
                ) : (
                  <div className="login-copy">Checking your Firebase session...</div>
                )}
              </CCardBody>
            </CCard>
          </div>
        </CContainer>
      </div>
    )
  }

  return (
    <div className="dashboard-root">
      <div className="ambient-shape ambient-shape-1"></div>
      <div className="ambient-shape ambient-shape-2"></div>
      <div className="ambient-shape ambient-shape-3"></div>

      <CContainer fluid className="dashboard-shell py-4 py-xl-5">
        <div className="dashboard-grid">
          <aside className="glass-panel sidebar-panel reveal reveal-1">
            <div className="brand-eyebrow">CoreUI Smart Ops</div>
            <h1 className="brand-title">AquaSentinel</h1>
            <p className="brand-subtitle">Enterprise Water Command Center</p>

            <div className="side-block">
              <div className="side-block-title">Live Signals</div>
              <ul className="signal-list">
                <li>
                  <span>Source</span>
                  <strong>{dataSourceMode === 'firebase' ? 'Firebase RTDB' : 'ESP32 Serial'}</strong>
                </li>
                <li>
                  <span>Data Stream</span>
                  <strong>{streamStatusMeta.label}</strong>
                </li>
                <li>
                  <span>{dataSourceMode === 'firebase' ? 'DB Path' : 'Bridge URL'}</span>
                  <strong>
                    {dataSourceMode === 'firebase'
                      ? FIREBASE_TELEMETRY_PATH
                      : BRIDGE_SOCKET_URL.replace('ws://', '')}
                  </strong>
                </li>
                <li>
                  <span>Frames Received</span>
                  <strong>{state.framesReceived}</strong>
                </li>
              </ul>
            </div>

            <div className="side-block">
              <div className="side-block-title">Risk Index</div>
              <div className="risk-meter">
                <div className={`risk-fill risk-${statusMeta.color}`}></div>
              </div>
              <p className="risk-copy">{statusMeta.title}</p>
              {dataSourceMode === 'firebase' ? (
                <div className="auth-actions">
                  <CButton
                    color="light"
                    size="sm"
                    onClick={enablePushNotifications}
                    disabled={pushStatus === 'enabling' || pushStatus === 'enabled'}
                  >
                    {pushStatus === 'enabled'
                      ? 'Push Enabled'
                      : pushStatus === 'enabling'
                        ? 'Enabling Push...'
                        : 'Enable Push Alerts'}
                  </CButton>
                  <CButton color="dark" size="sm" variant="outline" onClick={handleSignOut}>
                    Log Out
                  </CButton>
                </div>
              ) : null}
              {dataSourceMode === 'firebase' ? (
                <div className="push-status-note">
                  Permission: {notificationPermission}
                </div>
              ) : null}
            </div>
          </aside>

          <main className="content-panel">
            <CAlert color={statusMeta.color} className="status-banner reveal reveal-2">
              <div className="status-main">
                <span className="status-tag">System Status</span>
                <h2>{statusMeta.title}</h2>
                <p>{statusMeta.description}</p>
              </div>
              <div className="status-meta">
                <div>Updated {toTimeLabel(state.lastUpdated)}</div>
                <CBadge color={streamStatusMeta.color}>
                  Stream {streamStatusMeta.label}
                </CBadge>
                <CBadge color={state.liveData.pumpStatus ? 'success' : 'danger'}>
                  Pump {state.liveData.pumpStatus ? 'ON' : 'OFF'}
                </CBadge>
                <div className="stream-message">{state.streamMessage}</div>
              </div>
            </CAlert>

            <CRow className="g-4 mb-4">
              <CCol sm={6} xl={3} className="reveal reveal-2">
                <CCard className="kpi-card card-water">
                  <CCardBody>
                    <div className="kpi-header">
                      <span>Water Level</span>
                      <CIcon icon={cilDrop} size="lg" />
                    </div>
                    <div className="kpi-value">{Math.round(state.liveData.waterLevelPercent)}%</div>
                    <div className="kpi-sub">Auto-drain trigger at 90%</div>
                    <CProgress className="kpi-progress" height={6}>
                      <CProgressBar
                        value={state.liveData.waterLevelPercent}
                        color={state.liveData.waterLevelPercent >= 100 ? 'danger' : 'info'}
                      />
                    </CProgress>
                  </CCardBody>
                </CCard>
              </CCol>

              <CCol sm={6} xl={3} className="reveal reveal-3">
                <CCard className={`kpi-card ${qualityMeta.accentClass}`}>
                  <CCardBody>
                    <div className="kpi-header">
                      <span>Water Quality</span>
                      <div className="quality-token">{qualityMeta.icon}</div>
                    </div>
                    <div className="kpi-value">{Math.round(state.liveData.tdsPpm)} PPM</div>
                    <div className="kpi-sub">{qualityMeta.helper}</div>
                    <CBadge color={qualityMeta.color}>{qualityMeta.state}</CBadge>
                  </CCardBody>
                </CCard>
              </CCol>

              <CCol sm={6} xl={3} className="reveal reveal-4">
                <CCard className="kpi-card card-temp">
                  <CCardBody>
                    <div className="kpi-header">
                      <span>Temperature</span>
                      <CIcon icon={cilFire} size="lg" />
                    </div>
                    <div className="kpi-value">
                      {state.liveData.temperatureC.toFixed(1)} deg C
                    </div>
                    <div className="kpi-sub">Thermal stability monitor</div>
                    <CBadge color="danger">Live Thermal Feed</CBadge>
                  </CCardBody>
                </CCard>
              </CCol>

              <CCol sm={6} xl={3} className="reveal reveal-5">
                <CCard className="kpi-card card-logic">
                  <CCardBody>
                    <div className="kpi-header">
                      <span>Active Actuators</span>
                      <CIcon icon={cilBolt} size="lg" />
                    </div>
                    <div className="status-inline">
                      <CBadge color={state.liveData.pumpStatus ? 'success' : 'danger'}>
                        Pump: {state.liveData.pumpStatus ? 'ON' : 'OFF'}
                      </CBadge>
                      <CBadge color={state.liveData.leakDetected ? 'danger' : 'success'}>
                        Leak: {state.liveData.leakDetected ? 'Detected' : 'Safe'}
                      </CBadge>
                    </div>
                    <div className="kpi-sub">Tap state: {state.liveData.tapsOpen ? 'Open' : 'Closed'}</div>
                  </CCardBody>
                </CCard>
              </CCol>
            </CRow>

            <CRow className="g-4 mb-4">
              <CCol xl={7} className="reveal reveal-3">
                <CCard className="chart-card">
                  <CCardHeader>
                    <div className="card-title-row">
                      <span>Water Level vs Time</span>
                      <CIcon icon={cilSpeedometer} />
                    </div>
                  </CCardHeader>
                  <CCardBody>
                    <div className="chart-wrap">
                      <Line data={waterLevelChartData} options={waterLevelChartOptions} />
                    </div>
                  </CCardBody>
                </CCard>
              </CCol>

              <CCol xl={5} className="reveal reveal-4">
                <CCard className="chart-card">
                  <CCardHeader>
                    <div className="card-title-row">
                      <span>TDS + Temperature Trend</span>
                      <CIcon icon={cilChartLine} />
                    </div>
                  </CCardHeader>
                  <CCardBody>
                    <div className="chart-wrap">
                      <Line data={tdsTempChartData} options={tdsTempChartOptions} />
                    </div>
                  </CCardBody>
                </CCard>
              </CCol>
            </CRow>

            <CRow className="g-4">
              <CCol xl={8} className="reveal reveal-4">
                <CCard className="alerts-card">
                  <CCardHeader>
                    <div className="card-title-row">
                      <span>Alerts & Notifications</span>
                      <CIcon icon={cilBell} />
                    </div>
                  </CCardHeader>
                  <CCardBody className="alerts-body">
                    {state.alerts.map((alert) => (
                      <div key={alert.id} className="alert-row">
                        <span className={`severity-pill ${severityClassMap[alert.severity]}`}>
                          {alert.severity}
                        </span>
                        <div className="alert-message">{alert.message}</div>
                        <div className="alert-time">{toTimeLabel(alert.timestamp)}</div>
                      </div>
                    ))}
                  </CCardBody>
                </CCard>
              </CCol>

              <CCol xl={4} className="reveal reveal-5">
                <CCard className="json-card">
                  <CCardHeader>
                    <div className="card-title-row">
                      <span>Firebase Payload</span>
                      <CIcon icon={cilShieldAlt} />
                    </div>
                  </CCardHeader>
                  <CCardBody>
                    <pre className="json-preview">
                      {JSON.stringify(
                        {
                          live_data: {
                            water_level_percent: Math.round(state.liveData.waterLevelPercent),
                            tds_ppm: Math.round(state.liveData.tdsPpm),
                            temperature_c: Number(state.liveData.temperatureC.toFixed(1)),
                            pump_status: state.liveData.pumpStatus,
                            leak_detected: state.liveData.leakDetected,
                          },
                          system_state: state.systemState,
                          source_mode: dataSourceMode,
                          high_tds_threshold: FIREBASE_HIGH_TDS_THRESHOLD,
                        },
                        null,
                        2,
                      )}
                    </pre>
                    <div className="json-note">
                      <CIcon icon={cilWarning} />
                      <span>
                        {dataSourceMode === 'firebase'
                          ? 'Live payload mirrored from Firebase Realtime Database.'
                          : 'Live payload mirrored from serial bridge telemetry.'}
                      </span>
                    </div>
                  </CCardBody>
                </CCard>
              </CCol>
            </CRow>

            <CRow className="g-4 mt-1">
              <CCol xl={12} className="reveal reveal-5">
                <CCard className="serial-card">
                  <CCardHeader>
                    <div className="card-title-row">
                      <span>
                        {dataSourceMode === 'firebase'
                          ? 'Firebase Stream Monitor'
                          : 'Serial Monitor Output'}
                      </span>
                      <CIcon icon={cilBolt} />
                    </div>
                  </CCardHeader>
                  <CCardBody className="serial-body">
                    <div className="serial-monitor">
                      {state.serialMonitorLogs.map((entry) => (
                        <div key={entry.id} className={`serial-line serial-line-${entry.kind}`}>
                          <span className="serial-time">{toTimeLabel(entry.timestamp)}</span>
                          <span className="serial-text">{entry.text}</span>
                        </div>
                      ))}
                    </div>
                  </CCardBody>
                </CCard>
              </CCol>
            </CRow>
          </main>
        </div>
      </CContainer>
    </div>
  )
}

export default App
