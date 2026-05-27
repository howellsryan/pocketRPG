// Single source of truth for the API origin.
//
// In the browser the app is served from the same origin as the API
// (pocketrpg.co.uk), so relative '/api/...' paths are correct and we return
// them unchanged. Inside a native Capacitor shell the app is served from
// capacitor://localhost, where a relative '/api/...' would hit the bundled
// assets instead of the server — so we must target the live origin.
//
// Native detection uses the Capacitor global injected by the native runtime,
// so this file has no build dependency on @capacitor/core and behaves
// identically in the existing web bundles.
const PROD_API_ORIGIN = 'https://pocketrpg.co.uk'

function isNativeApp() {
  return typeof globalThis !== 'undefined'
    && globalThis.Capacitor != null
    && typeof globalThis.Capacitor.isNativePlatform === 'function'
    && globalThis.Capacitor.isNativePlatform() === true
}

export function apiUrl(path) {
  return isNativeApp() ? `${PROD_API_ORIGIN}${path}` : path
}
