import { useState } from 'preact/hooks'
import { getToken, clearAuth, startGitHubLogin, startGoogleLogin } from '../cloud/api.js'
import { apiUrl } from '../cloud/apiBase.js'

// Consent screen for the OAuth authorization flow (see functions/api/oauth/**).
// Reached when /api/oauth/authorize redirects the browser to `/?oauth=<token>`.
// If the user isn't signed in yet we show the normal login first; the request
// token is held by App (in sessionStorage) so it survives the login round-trip.

function decodeJwtPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function decodeClientName(requestToken) {
  const payload = decodeJwtPayload(requestToken)
  return payload && typeof payload.client_name === 'string' ? payload.client_name : null
}

// Best-effort label for the currently signed-in account (the session JWT
// carries displayName/provider claims), so the user can tell which account
// they'd be linking before they approve.
function decodeAccount(token) {
  const payload = decodeJwtPayload(token)
  if (!payload) return null
  return { displayName: payload.displayName || null, provider: payload.provider || null }
}

export default function OAuthConsentScreen({ requestToken, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [signedIn, setSignedIn] = useState(!!getToken())
  const account = signedIn ? decodeAccount(getToken()) : null
  const clientName = decodeClientName(requestToken) || 'An AI assistant'

  // Log out of this browser session so the login buttons reappear and the user
  // can authorize with a different account. The request token is preserved by
  // App, so signing back in returns here to approve as the new account.
  function useDifferentAccount() {
    if (busy) return
    clearAuth()
    setError(null)
    setSignedIn(false)
  }

  async function decide(decision) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(apiUrl('/api/oauth/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ request_token: requestToken, decision }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.redirect) {
        throw new Error(data?.error_description || data?.error || 'Authorization failed. Please try again.')
      }
      onClose?.()
      window.location.href = data.redirect
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }

  return (
    <div class="min-h-screen flex items-center justify-center bg-[var(--color-void)] text-[var(--color-parchment)] p-4">
      <div class="w-full max-w-md rounded-2xl border border-[var(--color-void-border)] bg-[var(--color-void-light)] p-6">
        <h1 class="font-[var(--font-display)] text-xl text-[var(--color-gold)] text-center mb-2">Connect to PocketRPG</h1>
        <p class="text-sm text-center opacity-80 mb-5">
          <b class="text-[var(--color-parchment)]">{clientName}</b> wants to access your PocketRPG account
          to view your characters and run shop/credit actions on your behalf.
        </p>

        {error && (
          <div class="mb-4 rounded-lg border border-[var(--color-blood)] bg-[#2a1212] p-2 text-xs text-center">{error}</div>
        )}

        {signedIn ? (
          <div class="space-y-3">
            <div class="text-[11px] text-center opacity-60">
              Signed in as <b class="text-[var(--color-parchment)] opacity-100">{account?.displayName || 'your account'}</b>
              {account?.provider ? ` (${account.provider})` : ''}
            </div>
            <button
              class="fm-btn fm-btn--brass w-full"
              disabled={busy}
              onClick={() => decide('allow')}
            >
              {busy ? 'Connecting…' : 'Allow access'}
            </button>
            <button
              class="w-full rounded-lg px-4 py-3 bg-[#222] border border-[var(--color-void-border)] text-[var(--color-parchment)] font-semibold disabled:opacity-40"
              disabled={busy}
              onClick={() => decide('deny')}
            >
              Deny
            </button>
            <button
              class="w-full rounded-lg px-3 py-2 bg-transparent border-0 text-[var(--color-parchment)] opacity-60 hover:opacity-100 text-xs font-semibold disabled:opacity-40"
              disabled={busy}
              onClick={useDifferentAccount}
            >
              Use a different account
            </button>
            <p class="text-[11px] text-center opacity-50 pt-1">
              You can revoke access later by logging out, which expires the token within 30 days.
            </p>
          </div>
        ) : (
          <div class="space-y-3">
            <p class="text-xs text-center opacity-60 mb-1">Sign in to authorize this connection.</p>
            <button
              class="fm-btn fm-btn--iron w-full"
              onClick={() => startGitHubLogin()}
            >
              Sign in with GitHub
            </button>
            <button
              class="fm-btn w-full"
              onClick={() => startGoogleLogin()}
            >
              Sign in with Google
            </button>
            <p class="text-[11px] text-center opacity-50 pt-1">
              Tip: to switch between two accounts on the same provider, sign out of that provider (GitHub/Google)
              in this browser first.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
