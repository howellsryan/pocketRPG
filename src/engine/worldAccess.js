/** A preview flag must never grant world access on a live-game origin. */
export function isWorldPreviewUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return hostname !== 'pocketrpg.co.uk'
      && !hostname.endsWith('.pocketrpg.co.uk')
      && hostname !== 'pocketrpg-app.rlh.workers.dev'
      && hostname !== 'pocketrpg.pages.dev'
  } catch {
    return false
  }
}

/** Fail closed for missing flags/base URLs, including production version aliases.
 * @param {{WORLD_BETA_ENABLED?: unknown, APP_BASE_URL?: unknown}} env
 * @param {string} [requestUrl]
 */
export function worldAccessEnabled(env, requestUrl) {
  return env?.WORLD_BETA_ENABLED === 'true'
    && isWorldPreviewUrl(env.APP_BASE_URL)
    && (requestUrl === undefined || isWorldPreviewUrl(requestUrl))
}
