// Native-only Capacitor integration. Imported by the app build (www/) but never
// by the web single-file build, so the browser app ships zero Capacitor code.
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { StatusBar, Style } from '@capacitor/status-bar'
import { setToken } from '../src/cloud/api.js'
import { apiUrl } from '../src/cloud/apiBase.js'

function initNative() {
  if (!Capacitor.isNativePlatform()) return

  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})

  // OAuth returns to the app via the pocketrpg:// deep link (minted by
  // functions/_lib/authRedirect.js). Capture the token, close the in-app
  // browser, then reload so the boot sequence picks up the session.
  CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    if (!url || !url.startsWith('pocketrpg://auth/callback')) return
    const match = url.match(/[#&]token=([^&]+)/)
    if (match) setToken(decodeURIComponent(match[1]))
    Browser.close().catch(() => {})
    window.location.reload()
  })

  // Web login is a full-page redirect, but Google blocks embedded WebViews, so
  // the app must use the system browser and return via the deep link. api.js
  // calls this hook when present instead of redirecting in-place.
  window.__pocketrpgNativeLogin = (provider) =>
    Browser.open({ url: apiUrl(`/api/auth/${provider}?platform=native`) })
}

initNative()
