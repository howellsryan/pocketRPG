import { useState, useEffect } from 'preact/hooks'
import { api, startGitHubLogin, setCharacter, getToken, clearAuth } from '../cloud/api.js'
import { resetSyncState } from '../cloud/sync.js'

// Three internal modes:
//   login      — no token, show GitHub login + offline option
//   characters — token present, listing characters, picking or creating
//   create     — submitting a new character username
export default function AuthScreen({ onCloudReady, onPlayOffline }) {
  const [mode, setMode] = useState(getToken() ? 'characters' : 'login')
  const [identity, setIdentity] = useState(null)
  const [characters, setCharacters] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')

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
    setCharacter(ch.id, ch.username)
    onCloudReady(ch)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await api.createCharacter(name)
      selectCharacter(res.character)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
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
        <p style={subtitle}>Log in with GitHub to sync your save across browsers, or play offline on this device only.</p>
        <button onClick={startGitHubLogin} style={primaryBtn}>
          🐙 Login with GitHub
        </button>
        <button onClick={onPlayOffline} style={ghostBtn}>
          Play Offline
        </button>
        <p style={{ ...subtitle, fontSize: '10px', marginTop: '20px', opacity: 0.4 }}>
          Offline saves stay on this browser only. Log in later from the save menu to migrate.
        </p>
      </Wrap>
    )
  }

  // mode === 'characters' or 'create'
  const showCreate = mode === 'create' || (characters && characters.length === 0)

  return (
    <Wrap>
      <Title />
      {identity && (
        <p style={subtitle}>
          Signed in as <strong style={{ color: '#d4af37' }}>{identity.displayName}</strong>{' '}
          <button onClick={handleSignOut} style={linkBtn}>(sign out)</button>
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
        </>
      )}

      {showCreate && (
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
          <button type="submit" disabled={busy || newName.trim().length < 3} style={primaryBtn}>
            {busy ? 'Creating…' : 'Create Character'}
          </button>
          {characters && characters.length > 0 && (
            <button type="button" onClick={() => setMode('characters')} style={ghostBtn}>
              Back
            </button>
          )}
        </form>
      )}

      {error && <p style={errorText}>{error}</p>}
    </Wrap>
  )
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
const secondaryBtn = { width: '100%', padding: '13px', borderRadius: '12px', background: '#2a2a2a', border: '1px solid #3a3a3a', color: '#e8d5b0', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px' }
const ghostBtn = { width: '100%', padding: '12px', borderRadius: '12px', background: 'transparent', border: '1px solid #2a2a2a', color: '#e8d5b0', opacity: 0.7, fontSize: '13px', cursor: 'pointer' }
const linkBtn = { background: 'transparent', border: 'none', color: '#7bb3f0', fontSize: '11px', cursor: 'pointer', padding: 0 }
const charRowBtn = { width: '100%', padding: '12px 14px', borderRadius: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e8d5b0', textAlign: 'left', cursor: 'pointer' }
const input = { width: '100%', padding: '12px 16px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #333', color: '#e8d5b0', fontSize: '14px', fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none' }
const errorText = { color: '#ff6b6b', fontSize: '12px', marginTop: '12px', textAlign: 'center' }
