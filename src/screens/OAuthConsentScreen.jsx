import { useState } from 'preact/hooks'
import { getToken, startGitHubLogin, startGoogleLogin } from '../cloud/api.js'
import { apiUrl } from '../cloud/apiBase.js'

// Consent screen for the OAuth authorization flow (see functions/api/oauth/**).
// Reached when /api/oauth/authorize redirects the browser to `/?oauth=<token>`.
// If the user isn't signed in yet we show the normal login first; the request
// token is held by App (in sessionStorage) so it survives the login round-trip.

function decodeClientName(requestToken) {
  try {
    const payload = JSON.parse(atob(requestToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.client_name === 'string' ? payload.client_name : null
  } catch {
    return null
  }
}

export default function OAuthConsentScreen({ requestToken, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const signedIn = !!getToken()
  const clientName = decodeClientName(requestToken) || 'An AI assistant'

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
            <button
              class="w-full rounded-lg px-4 py-3 bg-[var(--color-gold)] text-[var(--color-void)] font-bold disabled:opacity-40"
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
            <p class="text-[11px] text-center opacity-50 pt-1">
              You can revoke access later by logging out, which expires the token within 30 days.
            </p>
          </div>
        ) : (
          <div class="space-y-3">
            <p class="text-xs text-center opacity-60 mb-1">Sign in to authorize this connection.</p>
            <button
              class="w-full rounded-lg px-4 py-3 bg-[#24292f] text-white font-semibold"
              onClick={() => startGitHubLogin()}
            >
              Sign in with GitHub
            </button>
            <button
              class="w-full rounded-lg px-4 py-3 bg-white text-[#1f1f1f] font-semibold"
              onClick={() => startGoogleLogin()}
            >
              Sign in with Google
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
