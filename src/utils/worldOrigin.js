// Which open-world deployment the Settings entry button hands off to. The two
// world Workers are bound to different D1 databases (production `pocketrpg`,
// preview `pocketrpg-preview`), so sending a production character at the
// preview world means "Character not found" — the host mapping below is the
// reverse of world/client/src/auth.ts's PocketRPG-origin mapping and must stay
// in sync with it.
const PROD_WORLD_ORIGIN = 'https://world.pocketrpg.co.uk'
const PREVIEW_WORLD_ORIGIN = 'https://pocketrpg-world-preview.rlh.workers.dev'

const PROD_HOSTNAMES = ['pocketrpg.co.uk', 'www.pocketrpg.co.uk']

/** Pure resolver — `isNative` is the Capacitor shell, which talks to the
 * production API from capacitor://localhost (see cloud/apiBase.js) and so
 * must reach the production world too. */
export function resolveWorldOrigin(hostname, isNative = false) {
  if (isNative) return PROD_WORLD_ORIGIN
  return PROD_HOSTNAMES.includes(String(hostname || '').toLowerCase())
    ? PROD_WORLD_ORIGIN
    : PREVIEW_WORLD_ORIGIN
}

export function worldOrigin() {
  const isNative = typeof globalThis !== 'undefined'
    && globalThis.Capacitor != null
    && typeof globalThis.Capacitor.isNativePlatform === 'function'
    && globalThis.Capacitor.isNativePlatform() === true
  return resolveWorldOrigin(typeof location !== 'undefined' ? location.hostname : '', isNative)
}
