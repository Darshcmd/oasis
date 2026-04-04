import { useEffect, useMemo, useState } from 'react'
import {
  CAlert,
  CBadge,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CContainer,
  CProgress,
  CProgressBar,
  CRow,
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
import './App.css'

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

const TICK_MS = 2000
const CHART_WINDOW_POINTS = 42
const ALERT_LOG_LIMIT = 24
const LEAK_WINDOW_MS = 5 * 60 * 1000

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const randomInRange = (min, max) => Math.random() * (max - min) + min

const toTimeLabel = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

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
    liveData.tdsPpm > 600
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

const createInitialDashboardState = () => {
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
        message: 'System initialized in monitor mode.',
        timestamp: now,
      },
    ],
    lastUpdated: now,
  }
}

const evolveDashboardState = (prev) => {
  const now = Date.now()
  const previous = prev.liveData

  const tapsOpen = Math.random() < 0.09 ? !previous.tapsOpen : previous.tapsOpen

  let pumpStatus = previous.pumpStatus
  if (previous.waterLevelPercent >= 90) pumpStatus = true
  if (previous.waterLevelPercent <= 80) pumpStatus = false

  const inflow = randomInRange(0.2, 1.35)
  const consumerDrain = tapsOpen ? randomInRange(0.35, 1.1) : 0
  const pumpDrain = pumpStatus ? randomInRange(1.7, 2.7) : 0
  const anomalyDrop =
    !tapsOpen && !pumpStatus && Math.random() < 0.14
      ? randomInRange(0.45, 1.35)
      : 0

  const waterLevelPercent = clamp(
    previous.waterLevelPercent + inflow - consumerDrain - pumpDrain - anomalyDrop,
    0,
    100,
  )

  const tdsSpike = anomalyDrop > 0.9 ? randomInRange(18, 44) : 0
  const tdsPpm = clamp(
    previous.tdsPpm + randomInRange(-20, 25) + tdsSpike,
    110,
    920,
  )

  const temperatureC = clamp(
    previous.temperatureC + randomInRange(-0.35, 0.4) + (pumpStatus ? 0.05 : 0),
    18,
    39,
  )

  const levelWindow = [
    ...prev.levelWindow,
    { time: now, level: waterLevelPercent },
  ].filter((entry) => now - entry.time <= LEAK_WINDOW_MS)

  const oldestWindowPoint = levelWindow[0]
  const dropWithinWindow = oldestWindowPoint
    ? oldestWindowPoint.level - waterLevelPercent
    : 0

  const leakDetected = !tapsOpen && !pumpStatus && dropWithinWindow >= 2

  const liveData = {
    waterLevelPercent,
    tdsPpm,
    temperatureC,
    pumpStatus,
    leakDetected,
    tapsOpen,
  }

  const systemState = getSystemState(liveData)

  let alerts = prev.alerts

  if (!previous.pumpStatus && pumpStatus) {
    alerts = prependAlert(
      alerts,
      'Info',
      `Pump activated automatically (${Math.round(waterLevelPercent)}% level).`,
      now,
    )
  }

  if (previous.pumpStatus && !pumpStatus) {
    alerts = prependAlert(
      alerts,
      'Info',
      `Pump deactivated (${Math.round(waterLevelPercent)}% level reached safe zone).`,
      now,
    )
  }

  if (previous.tdsPpm <= 300 && tdsPpm > 300) {
    alerts = prependAlert(
      alerts,
      'Warning',
      `TDS crossed 300 PPM (${Math.round(tdsPpm)} PPM).`,
      now,
    )
  }

  if (previous.tdsPpm <= 600 && tdsPpm > 600) {
    alerts = prependAlert(
      alerts,
      'Critical',
      `Toxicity threshold breached (${Math.round(tdsPpm)} PPM).`,
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

  if (previous.waterLevelPercent < 100 && waterLevelPercent >= 100) {
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
      waterLevelPercent,
      tdsPpm,
      temperatureC,
    },
  ].slice(-CHART_WINDOW_POINTS)

  return {
    liveData,
    systemState,
    samples,
    levelWindow,
    alerts,
    lastUpdated: now,
  }
}

const severityClassMap = {
  Info: 'severity-info',
  Warning: 'severity-warning',
  Alert: 'severity-alert',
  Critical: 'severity-critical',
}

function App() {
  const [state, setState] = useState(createInitialDashboardState)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((prev) => evolveDashboardState(prev))
    }, TICK_MS)

    return () => window.clearInterval(timer)
  }, [])

  const statusMeta = statusMetaMap[state.systemState]
  const qualityMeta = qualityMetaFromTds(state.liveData.tdsPpm)

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
                  <span>Loop Interval</span>
                  <strong>2s Sync</strong>
                </li>
                <li>
                  <span>Data Stream</span>
                  <strong>Realtime Mock</strong>
                </li>
                <li>
                  <span>Mode</span>
                  <strong>Auto Control</strong>
                </li>
              </ul>
            </div>

            <div className="side-block">
              <div className="side-block-title">Risk Index</div>
              <div className="risk-meter">
                <div className={`risk-fill risk-${statusMeta.color}`}></div>
              </div>
              <p className="risk-copy">{statusMeta.title}</p>
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
                <CBadge color={state.liveData.pumpStatus ? 'success' : 'danger'}>
                  Pump {state.liveData.pumpStatus ? 'ON' : 'OFF'}
                </CBadge>
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
                        },
                        null,
                        2,
                      )}
                    </pre>
                    <div className="json-note">
                      <CIcon icon={cilWarning} />
                      <span>Replace mock loop with Firebase listener in step 2.</span>
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
