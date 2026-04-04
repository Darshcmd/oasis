/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js')

const params = new URL(self.location.href).searchParams

const firebaseConfig = {
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  appId: params.get('appId') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
}

const hasConfig =
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  firebaseConfig.messagingSenderId

if (hasConfig) {
  firebase.initializeApp(firebaseConfig)
  const messaging = firebase.messaging()

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'AquaSentinel Alert'
    const options = {
      body: payload.notification?.body || 'Water safety event detected.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: payload.data || {},
    }

    self.registration.showNotification(title, options)
  })
}
