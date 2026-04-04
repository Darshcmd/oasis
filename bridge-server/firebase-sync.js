import fs from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'
import { getMessaging } from 'firebase-admin/messaging'

const toErrorMessage = (error) =>
  error instanceof Error ? error.message : String(error)

const compactPath = (value, fallback) => {
  const normalized = value?.trim()
  if (!normalized) {
    return fallback
  }

  return normalized.replace(/^\/+|\/+$/g, '')
}

const buildSystemState = (liveData, highTdsThreshold) => {
  if (
    liveData.leak_detected ||
    liveData.water_level_percent >= 100 ||
    liveData.tds_ppm > highTdsThreshold
  ) {
    return 'Dangerous / Critical'
  }

  if (liveData.tds_ppm >= 300 || liveData.water_level_percent >= 90) {
    return 'Cautious'
  }

  return 'Perfect'
}

const readServiceAccount = (path, json) => {
  if (json) {
    return JSON.parse(json)
  }

  if (path) {
    const fileContent = fs.readFileSync(path, 'utf8')
    return JSON.parse(fileContent)
  }

  return null
}

const flattenDeviceTokens = (value) => {
  if (!value || typeof value !== 'object') {
    return []
  }

  const tokens = []

  for (const [uid, userTokens] of Object.entries(value)) {
    if (!userTokens || typeof userTokens !== 'object') {
      continue
    }

    for (const [tokenKey, tokenPayload] of Object.entries(userTokens)) {
      const token =
        typeof tokenPayload === 'string'
          ? tokenPayload
          : typeof tokenPayload?.token === 'string'
            ? tokenPayload.token
            : ''

      if (token) {
        tokens.push({ uid, tokenKey, token })
      }
    }
  }

  return tokens
}

export const createFirebaseSync = ({
  enabled,
  databaseUrl,
  serviceAccountPath,
  serviceAccountJson,
  telemetryPath,
  alertsPath,
  deviceTokensPath,
  highTdsThreshold,
  logger,
}) => {
  const log = (message) => {
    logger(`[firebase] ${message}`)
  }

  if (!enabled) {
    log('Firebase sync disabled (FIREBASE_SYNC_ENABLED=false).')
    return {
      enabled: false,
      pushTelemetry: async () => {},
    }
  }

  if (!databaseUrl) {
    log('Missing FIREBASE_DATABASE_URL. Firebase sync will stay disabled.')
    return {
      enabled: false,
      pushTelemetry: async () => {},
    }
  }

  try {
    const serviceAccount = readServiceAccount(serviceAccountPath, serviceAccountJson)

    if (!serviceAccount) {
      log(
        'Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON.',
      )
      return {
        enabled: false,
        pushTelemetry: async () => {},
      }
    }

    const app =
      getApps().find((existingApp) => existingApp.name === 'bridge-firebase-sync') ||
      initializeApp(
        {
          credential: cert(serviceAccount),
          databaseURL: databaseUrl,
        },
        'bridge-firebase-sync',
      )

    const database = getDatabase(app)
    const messaging = getMessaging(app)
    const livePath = compactPath(telemetryPath, 'aqua/live_data')
    const alertsRoot = compactPath(alertsPath, 'aqua/alerts')
    const deviceTokensRoot = compactPath(deviceTokensPath, 'aqua/device_tokens')
    const threshold = Number.isFinite(Number(highTdsThreshold))
      ? Number(highTdsThreshold)
      : 600

    let highTdsActive = false
    let leakActive = false

    const sendPushToRegisteredDevices = async ({ type, severity, message, payload }) => {
      try {
        const tokensSnapshot = await database.ref(deviceTokensRoot).get()
        const tokenEntries = flattenDeviceTokens(tokensSnapshot.val())

        if (tokenEntries.length === 0) {
          return
        }

        const response = await messaging.sendEachForMulticast({
          tokens: tokenEntries.map((entry) => entry.token),
          notification: {
            title: `AquaSentinel ${severity}`,
            body: message,
          },
          data: {
            type,
            severity,
            timestamp: String(payload.timestamp),
            tds_ppm: String(payload.tds_ppm),
            leak_detected: String(payload.leak_detected),
          },
        })

        if (response.failureCount > 0) {
          const staleRemovals = []

          response.responses.forEach((result, index) => {
            if (result.success) {
              return
            }

            const code = result.error?.code || ''
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              const tokenMeta = tokenEntries[index]
              if (tokenMeta) {
                staleRemovals.push(
                  database
                    .ref(`${deviceTokensRoot}/${tokenMeta.uid}/${tokenMeta.tokenKey}`)
                    .remove(),
                )
              }
            }
          })

          if (staleRemovals.length > 0) {
            await Promise.allSettled(staleRemovals)
          }
        }
      } catch (error) {
        log(`Push delivery failed: ${toErrorMessage(error)}`)
      }
    }

    const pushAlert = async (basePayload, type, severity, message) => {
      await database.ref(alertsRoot).push({
        type,
        severity,
        message,
        timestamp: basePayload.timestamp,
        water_level_percent: basePayload.water_level_percent,
        tds_ppm: basePayload.tds_ppm,
        temperature_c: basePayload.temperature_c,
        leak_detected: basePayload.leak_detected,
      })

      await sendPushToRegisteredDevices({
        type,
        severity,
        message,
        payload: basePayload,
      })
    }

    const pushTelemetry = async (telemetry) => {
      const timestamp = Number.isFinite(telemetry.timestamp)
        ? telemetry.timestamp
        : Date.now()

      const payload = {
        water_level_percent: Math.round(telemetry.waterLevelPercent),
        tds_ppm: Math.round(telemetry.tdsPpm),
        temperature_c: Number(telemetry.temperatureC.toFixed(1)),
        pump_status: Boolean(telemetry.pumpStatus),
        leak_detected: Boolean(telemetry.leakDetected),
        taps_open: Boolean(telemetry.tapsOpen),
        timestamp,
      }

      const systemState = buildSystemState(payload, threshold)

      await database.ref(livePath).set({
        ...payload,
        system_state: systemState,
      })

      const tdsHighNow = payload.tds_ppm > threshold
      const leakNow = payload.leak_detected

      if (!highTdsActive && tdsHighNow) {
        await pushAlert(
          payload,
          'tds_high',
          'Critical',
          `TDS crossed critical threshold: ${payload.tds_ppm} PPM (limit ${threshold} PPM).`,
        )
      }

      if (!leakActive && leakNow) {
        await pushAlert(payload, 'leakage', 'Alert', 'Leakage detected from tank pipeline.')
      }

      highTdsActive = tdsHighNow
      leakActive = leakNow
    }

    log(`Firebase sync enabled. Writing telemetry to "/${livePath}".`)

    return {
      enabled: true,
      pushTelemetry,
    }
  } catch (error) {
    log(`Failed to initialize Firebase sync: ${toErrorMessage(error)}`)

    return {
      enabled: false,
      pushTelemetry: async () => {},
    }
  }
}
