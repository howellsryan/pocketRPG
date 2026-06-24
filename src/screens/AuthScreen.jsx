import { useState, useEffect } from 'preact/hooks'
import { api, startGitHubLogin, startGoogleLogin, isEmbeddedBrowser, setCharacter, getToken, clearAuth } from '../cloud/api.js'
import { resetSyncState } from '../cloud/sync.js'
import LandingScreen from './LandingScreen.jsx'

// Three internal modes:
//   login      — no token, show OAuth login options
//   characters — token present, listing characters, picking or creating
//   create     — submitting a new character username
export default function AuthScreen({ onCloudReady }) {
  const [mode, setMode] = useState(getToken() ? 'characters' : 'login')
  const [identity, setIdentity] = useState(null)
  const [characters, setCharacters] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [isIronman, setIsIronman] = useState(false)
  const [isOneLife, setIsOneLife] = useState(false)
  const [oneLifeAck, setOneLifeAck] = useState(false)
  const [embedded] = useState(() => isEmbeddedBrowser())
  const [showBrowserHint, setShowBrowserHint] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (mode === 'characters') refreshCharacters()
  }, [mode])

  async function refreshCharacters() {
    setBusy(true)
    setError(null)
    try {
      const [meRes, listRes] = await Promise.all([api.me(), api.listCharacters()])
      setIdentity(meRes.identity)
      setCharacters(listRes.characters || [])
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
    setCharacter(ch.id, ch.username, ch.is_ironman, ch.is_one_life)
    onCloudReady(ch)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await api.createCharacter(name, isIronman, isOneLife)
      selectCharacter(res.character)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // Google blocks OAuth in embedded in-app browsers (Error 403:
  // disallowed_useragent), so redirecting there would dead-end. Steer the user
  // to a real browser instead.
  function handleGoogleLogin() {
    // In the native app the login opens the system browser (where Google works),
    // so skip the embedded-WebView hint even though the app shell reads as embedded.
    if (typeof window !== 'undefined' && window.__pocketrpgNativeLogin) {
      startGoogleLogin()
      return
    }
    if (embedded) {
      setShowBrowserHint(true)
      return
    }
    startGoogleLogin()
  }

  async function copyAppLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  function handleSignOut() {
    clearAuth()
    resetSyncState()
    setMode('login')
    setCharacters(null)
    setIdentity(null)
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Permanently delete your account and ALL characters, saves and progress? This cannot be undone.')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAccount()
      handleSignOut()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Render ──

  if (mode === 'login') {
    return (
      <LandingScreen
        onGitHubLogin={startGitHubLogin}
        onGoogleLogin={handleGoogleLogin}
        embedded={embedded}
        showBrowserHint={showBrowserHint}
        copied={copied}
        onCopyLink={copyAppLink}
      />
    )
  }

  // mode === 'characters' or 'create'
  const showCreate = mode === 'create' || (characters && characters.length === 0)

  // Account actions are shown in every signed-in view (character list AND the
  // create form) so a logged-in user can always log out or delete — even a
  // brand-new account with no characters, or one where /api/auth/me hasn't
  // populated `identity` (logout only needs the token, not the profile).
  // type="button" keeps them from submitting the create <form>.
  const accountActions = (
    <>
      <button type="button" onClick={handleSignOut} style={ghostBtn}>
        🚪 Log out{identity?.provider ? ` of ${providerLabel(identity.provider)}` : ''}
      </button>
      <button type="button" onClick={handleDeleteAccount} style={dangerBtn} disabled={busy}>
        🗑️ Delete account
      </button>
    </>
  )

  return (
    <Wrap>
      <Title />
      {identity && (
        <p style={subtitle}>
          Signed in as <strong style={{ color: '#d4af37' }}>{identity.displayName}</strong>
        </p>
      )}

      {busy && !characters && <p style={subtitle}>Loading…</p>}

      {!showCreate && characters && characters.length > 0 && (
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
          <button onClick={() => { setMode('create'); setNewName('') }} style={secondaryBtn}>
            ➕ Create New Character
          </button>
          {accountActions}
        </>
      )}

      {showCreate && (
        <>
        <form onSubmit={handleCreate}>
          <SectionLabel>Create a character</SectionLabel>
          <input
            type="text"
            value={newName}
            onInput={(e) => setNewName(e.target.value)}
            placeholder="Username (3–16 chars)"
            maxLength={16}
            autoFocus
            style={input}
          />
          <p style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.45, margin: '6px 0 14px' }}>
            Letters, numbers, _ and - only. Names are unique forever and cannot be changed.
          </p>

          {/* Ironman Mode Toggle */}
          <div style={{ marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={isIronman}
                onChange={(e) => setIsIronman(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '13px', color: '#d4af37', fontWeight: 'bold' }}>🛡️ Ironman Mode</div>
                <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.6, marginTop: '2px' }}>
                  Fully self-sufficient: no PvP and no trading post offers with other players. You can still use the general store. Permanent once set.
                </div>
              </div>
            </label>
          </div>

          {/* One Life Mode Toggle */}
          <div style={{ marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={isOneLife}
                onChange={(e) => {
                  const checked = e.target.checked
                  setIsOneLife(checked)
                  if (!checked) setOneLifeAck(false)
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '13px', color: '#d4af37', fontWeight: 'bold' }}>☠️ One Life Mode</div>
                <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.6, marginTop: '2px' }}>
                  Die once and your account is permanently deleted.
                </div>
              </div>
            </label>
          </div>
          {isOneLife && (
            <div style={{ marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#2a1616', border: '1px solid #7a2d2d' }}>
              <div style={{ fontSize: '12px', color: '#ff9b9b', fontWeight: 'bold', marginBottom: '6px' }}>
                ⚠️ One Life Warning
              </div>
              <div style={{ fontSize: '11px', color: '#ffd4d4', lineHeight: 1.45, marginBottom: '8px' }}>
                Death permanently deletes this character. Not recommended for first-time players.
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '11px', color: '#ffd4d4' }}>
                <input
                  type="checkbox"
                  checked={oneLifeAck}
                  onChange={(e) => setOneLifeAck(e.target.checked)}
                  style={{ marginTop: '1px', width: '14px', height: '14px', cursor: 'pointer' }}
                />
                I understand this character is permanently deleted on death.
              </label>
            </div>
          )}

          {showCreate && (
            <details style={{ marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333' }} open>
              <summary style={{ cursor: 'pointer', fontSize: '13px', color: '#d4af37', fontWeight: 'bold' }}>🧭 New to PocketRPG?</summary>

              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#d4af37', fontWeight: 'bold', marginBottom: '4px' }}>Recommended first character</div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '10px', color: '#e8d5b0', opacity: 0.9, lineHeight: 1.45 }}>
                    <li>Normal mode is recommended for your first character.</li>
                    <li>One Life is extreme: death permanently deletes that character.</li>
                  </ul>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#d4af37', fontWeight: 'bold', marginBottom: '4px' }}>Starter kit</div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '10px', color: '#e8d5b0', opacity: 0.9, lineHeight: 1.45 }}>
                    <li>Bronze dagger, bronze scimitar, and full bronze armor + kiteshield.</li>
                    <li>Shrimp for healing and a small amount of starting coins.</li>
                  </ul>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#d4af37', fontWeight: 'bold', marginBottom: '4px' }}>First steps</div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '10px', color: '#e8d5b0', opacity: 0.9, lineHeight: 1.45 }}>
                    <li>Create your character and equip your bronze gear from Items.</li>
                    <li>Open Combat and train on early monsters.</li>
                    <li>Eat shrimp when low HP, then bank or sell loot.</li>
                    <li>Upgrade gear, then try skilling and quests.</li>
                  </ul>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#d4af37', fontWeight: 'bold', marginBottom: '4px' }}>Need more help?</div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '10px', color: '#e8d5b0', opacity: 0.9, lineHeight: 1.45 }}>
                    <li>Please read the help and guides section for more information in the Settings screen once you have started your adventure.</li>
                  </ul>
                </div>
              </div>
            </details>
          )}

          <button type="submit" disabled={busy || newName.trim().length < 3 || (isOneLife && !oneLifeAck)} style={primaryBtn}>
            {busy ? 'Creating…' : 'Create Character'}
          </button>
          {characters && characters.length > 0 && (
            <button type="button" onClick={() => setMode('characters')} style={ghostBtn}>
              Back
            </button>
          )}
        </form>
        {accountActions}
        </>
      )}

      {error && <p style={errorText}>{error}</p>}
    </Wrap>
  )
}

// ── Styled helpers (kept inline to avoid coupling to component library during boot) ──

function Wrap({ children }) {
  // height:100% + overflowY:auto makes the panel a scroll container; margin:auto
  // (instead of justify-content:center) vertically centers short content without
  // clipping the top when the character list is taller than the viewport.
  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '24px', background: '#0f0f0f', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: '380px', margin: 'auto' }}>{children}</div>
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
function providerLabel(provider) {
  if (provider === 'github') return 'GitHub'
  if (provider === 'google') return 'Google'
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}
const secondaryBtn = { width: '100%', padding: '13px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px' }
const ghostBtn = { width: '100%', padding: '12px', borderRadius: '12px', background: 'transparent', border: '1px solid #2a2a2a', color: '#e8d5b0', opacity: 0.7, fontSize: '13px', cursor: 'pointer' }
const dangerBtn = { width: '100%', padding: '12px', borderRadius: '12px', background: 'transparent', border: '1px solid var(--color-blood)', color: 'var(--color-blood-light)', fontSize: '13px', cursor: 'pointer', marginTop: '8px' }
const charRowBtn = { width: '100%', padding: '12px 14px', borderRadius: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e8d5b0', textAlign: 'left', cursor: 'pointer' }
const input = { width: '100%', padding: '12px 16px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333', color: '#e8d5b0', fontSize: '14px', fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none' }
const errorText = { color: '#ff6b6b', fontSize: '12px', marginTop: '12px', textAlign: 'center' }
