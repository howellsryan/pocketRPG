// Native apps begin OAuth in the system browser and expect the minted session
// token back via a custom-scheme deep link, not the web fragment redirect.
//
// The "native" intent must survive the round-trip to the provider and back. We
// piggyback on the CSRF `state` value (which the provider echoes verbatim and
// which the callback already compares against the oauth_state cookie) by
// suffixing it — so no extra round-tripping channel is needed and the existing
// cookie===state CSRF check keeps working unchanged.
const NATIVE_SCHEME_REDIRECT = 'pocketrpg://auth/callback'
const NATIVE_STATE_SUFFIX = '.native'

export function isNativeRequest(url) {
  return url.searchParams.get('platform') === 'native'
}

export function withNativeFlag(state, isNative) {
  return isNative ? `${state}${NATIVE_STATE_SUFFIX}` : state
}

export function stateIsNative(state) {
  return typeof state === 'string' && state.endsWith(NATIVE_STATE_SUFFIX)
}

export function tokenRedirectLocation(token, isNative) {
  const fragment = `#token=${encodeURIComponent(token)}`
  return isNative ? `${NATIVE_SCHEME_REDIRECT}${fragment}` : `/${fragment}`
}
