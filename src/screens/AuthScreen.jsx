import { useState, useEffect } from 'preact/hooks'
import { api, startGitHubLogin, startGoogleLogin, setCharacter, getToken, clearAuth } from '../cloud/api.js'
import { resetSyncState } from '../cloud/sync.js'

// Two internal modes:
//   login      — no token, show GitHub/Google login + offline option
//   characters — token present, listing characters, picking or auto-creating
export default function AuthScreen({ onCloudReady, onPlayOffline }) {
  const [mode, setMode] = useState(getToken() ? 'characters' : 'login')
  const [identity, setIdentity] = useState(null)
  const [characters, setCharacters] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode === 'characters') refreshCharacters()
  }, [mode])

  async function refreshCharacters() {
    setBusy(true)
    setError(null)
    try {
      const [meRes, listRes] = await Promise.all([api.me(), api.listCharacters()])
      setIdentity(meRes.identity)
      const chars = listRes.characters || []
      setCharacters(chars)
      // No characters yet — auto-create one silently using the OAuth displayName
      // so signing in for the first time doesn't stall on a name-entry form.
      if (chars.length === 0) {
        await autoCreateAndSelect(meRes.identity?.displayName)
      }
    } catch (err) {
      if (err.status === 401) {
        clearAuth()
        setMode('login')
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  function selectCharacter(ch) {
    resetSyncState()
    setCharacter(ch.id, ch.username)
    onCloudReady(ch)
  }

  // Auto-create a character using the OAuth identity's display name, sanitised
  // to match the server's username rules (3–16 chars, [A-Za-z0-9_-]). On
  // collision (username taken/reserved) we retry with a random suffix.
  async function autoCreateAndSelect(displayName) {
    setError(null)
    const base = sanitizeUsername(displayName) || 'Adventurer'
    let attempt = base
    for (let i = 0; i < 6; i++) {
      try {
        const res = await api.createCharacter(attempt)
        selectCharacter(res.character)
        return
      } catch (err) {
        if (err.status === 409) {
          // Username taken/reserved — try a suffixed variant (truncate base to fit).
          const suffix = String(Math.floor(1000 + Math.random() * 9000))
          attempt = base.slice(0, 16 - suffix.length) + suffix
          continue
        }
        setError(err.message)
        return
      }
    }
    setError('Could not auto-create a character. Please try again.')
  }

  function handleSignOut() {
    clearAuth()
    resetSyncState()
    setMode('login')
    setCharacters(null)
    setIdentity(null)
  }

  // ── Render ──

  if (mode === 'login') {
    return (
      <Wrap>
        <Title />
        <p style={subtitle}>Log in to sync your save across browsers, or play offline on this device only.</p>
        <button onClick={startGitHubLogin} style={primaryBtn}>
          🐙 Login with GitHub
        </button>
        <button onClick={startGoogleLogin} style={googleBtn}>
          <span style={googleG}>G</span> Login with Google
        </button>
        <button onClick={onPlayOffline} style={ghostBtn}>
          Play Offline
        </button>
        <p style={{ ...subtitle, fontSize: '10px', marginTop: '20px', opacity: 0.4 }}>
          Offline saves stay on this browser only. Log in later from the save menu to migrate. GitHub and Google accounts are kept separate — signing in with a different provider gives you a different character roster.
        </p>
      </Wrap>
    )
  }

  // mode === 'characters'
  return (
    <Wrap>
      <Title />
      {identity && (
        <p style={subtitle}>
          Signed in as <strong style={{ color: '#d4af37' }}>{identity.displayName}</strong>
        </p>
      )}

      {busy && <p style={subtitle}>Loading…</p>}

      {!busy && characters && characters.length > 0 && (
        <>
          <SectionLabel>Choose a character</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {characters.map(ch => (
              <button key={ch.id} onClick={() => selectCharacter(ch)} style={charRowBtn}>
                <div style={{ fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '15px', color: '#d4af37' }}>{ch.username}</div>
                <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, marginTop: '2px' }}>
                  {ch.save_updated_at ? `Last saved ${new Date(ch.save_updated_at).toLocaleString()}` : 'No cloud save yet'}
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => { setBusy(true); autoCreateAndSelect(identity?.displayName).finally(() => setBusy(false)) }}
            style={secondaryBtn}
          >
            ➕ Create New Character
          </button>
          {identity && (
            <button onClick={handleSignOut} style={ghostBtn}>
              🚪 Log out{identity.provider ? ` of ${providerLabel(identity.provider)}` : ''}
            </button>
          )}
        </>
      )}

      {error && <p style={errorText}>{error}</p>}
    </Wrap>
  )
}

// Strip anything the server's username regex would reject and clamp length.
// Returns '' when there's nothing usable left; caller falls back to a default.
function sanitizeUsername(raw) {
  if (!raw) return ''
  const cleaned = String(raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16)
  if (cleaned.length < 3) return ''
  return cleaned
}

// ── Styled helpers (kept inline to avoid coupling to component library during boot) ──

function Wrap({ children }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#0f0f0f' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>{children}</div>
    </div>
  )
}

function Title() {
  return (
    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
      <h1 style={{ fontFamily: 'Cinzel, serif', fontSize: '28px', fontWeight: '900', color: '#d4af37', letterSpacing: '0.05em' }}>PocketRPG</h1>
      <p style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.35, marginTop: '4px', fontFamily: 'Nunito, sans-serif' }}>A mobile tick-based idle fantasy RPG</p>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '700', marginBottom: '8px' }}>{children}</div>
}

const subtitle = { fontSize: '12px', color: '#e8d5b0', opacity: 0.7, textAlign: 'center', marginBottom: '16px', lineHeight: 1.5 }
const primaryBtn = { width: '100%', padding: '14px', borderRadius: '12px', background: 'linear-gradient(135deg, #b8940e, #d4af37)', color: '#0f0f0f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', letterSpacing: '0.05em', border: 'none', cursor: 'pointer', marginBottom: '10px' }
const googleBtn = { width: '100%', padding: '13px', borderRadius: '12px', background: '#ffffff', color: '#1f1f1f', fontFamily: 'Cinzel, serif', fontWeight: 'bold', fontSize: '14px', letterSpacing: '0.05em', border: 'none', cursor: 'pointer', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }
const googleG = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '50%', background: 'conic-gradient(from -45deg, #ea4335 0 25%, #fbbc05 25% 50%, #34a853 50% 75%, #4285f4 75% 100%)', color: '#ffffff', fontFamily: 'Arial, sans-serif', fontWeight: 900, fontSize: '13px', lineHeight: 1 }

function providerLabel(provider) {
  if (provider === 'github') return 'GitHub'
  if (provider === 'google') return 'Google'
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}
const secondaryBtn = { width: '100%', padding: '13px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px' }
const ghostBtn = { width: '100%', padding: '12px', borderRadius: '12px', background: 'transparent', border: '1px solid #2a2a2a', color: '#e8d5b0', opacity: 0.7, fontSize: '13px', cursor: 'pointer' }
const charRowBtn = { width: '100%', padding: '12px 14px', borderRadius: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e8d5b0', textAlign: 'left', cursor: 'pointer' }
const errorText = { color: '#ff6b6b', fontSize: '12px', marginTop: '12px', textAlign: 'center' }
