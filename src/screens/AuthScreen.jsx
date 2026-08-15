import { useState, useEffect } from 'preact/hooks'
import { api, startGitHubLogin, startGoogleLogin, isEmbeddedBrowser, isHosted, setCharacter, getToken, clearAuth } from '../cloud/api.js'
import { resetSyncState } from '../cloud/sync.js'
import LandingScreen from './LandingScreen.jsx'
import IronFrame from '../components/IronFrame.jsx'
import OneLifeIcon from '../components/OneLifeIcon.jsx'
// Inline the iron full helm SVG so it renders on the auth screen before the
// game chunk (which carries gameIconsData) has loaded.
function IronHelmIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} style={{ color: 'var(--tier-iron, #aaaaaa)', flexShrink: 0 }} fill="currentColor" aria-label="Iron Full Helm">
      <path fill="currentColor" d="m207.47 18.875l35.968 162.25c.29 1.087.86 1.863 2.562 2.813c1.7.95 4.433 1.66 7.22 1.656c2.785-.003 5.543-.703 7.25-1.656c1.704-.954 2.276-1.75 2.56-2.813L299 18.875zm88.936 98.03l-15.22 68.657l-.06.22l-.032.187c-1.747 6.52-6.404 11.432-11.5 14.28s-10.738 4.026-16.344 4.03c-5.606.007-11.24-1.15-16.344-4c-5.104-2.847-9.782-7.784-11.53-14.31l-.032-.19l-.063-.218l-14.686-66.218C175 133.818 147.157 164.56 135.53 202.97a459 459 0 0 0 32.314 15.468c26.527 11.43 60.506 22.55 88.5 22.406c28.003-.145 61.81-11.56 88.156-23.22a449 449 0 0 0 32.938-16.25c-12.624-39.968-42.853-71.398-81.032-84.468zm88.97 101.376c-8.365 4.538-19.865 10.487-33.313 16.44c-27.522 12.18-62.797 24.673-95.625 24.843c-32.838.17-68.293-12-96-23.938c-13.614-5.866-25.276-11.744-33.72-16.22c-.51 70.485-3.647 138.64 9.626 188.376c7.135 26.737 18.683 47.874 37.375 62.595c12.092 9.525 27.443 16.584 47.25 20.375V330.125c-28.654 16.12-67.847 2.81-81.064-30.625c8.825-22.322 30.127-33.074 50.78-33c24.583.087 48.224 15.532 48.876 45.094h.094v89h36.03l.002-87.72q-.017-.013-.032-.03c0-.422.022-.834.03-1.25c.655-29.562 24.327-45.007 48.908-45.094c20.654-.074 41.926 10.678 50.75 33c-13.204 33.403-52.324 46.702-80.97 30.656v160.47c19.544-3.867 34.6-11 46.438-20.595c18.396-14.908 29.6-36.337 36.375-63.342c12.59-50.184 8.804-118.532 8.188-188.407z"/>
    </svg>
  )
}

// Inline coin-helm SVG for the same reason as IronHelmIcon above (no game chunk
// yet, so no bespoke icon set). A pared-back version of the bespoke art: at
// 16px only three shapes survive legibly, so it keeps the brow coin, the visor
// slot and one chin coin rather than the full six-coin face.
function CoinHelmIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} style={{ flexShrink: 0 }} aria-label="Grindman Full Helm">
      <path fill="#c99a17" d="M164 254 C 164 156 348 156 348 254 L348 320 C 348 372 304 398 256 398 C 208 398 164 372 164 320 Z"/>
      <circle cx="256" cy="214" r="42" fill="#ffe9a3"/>
      <circle cx="256" cy="214" r="19" fill="#c99a17"/>
      <rect x="194" y="288" width="124" height="34" rx="17" fill="#4a3a12"/>
      <circle cx="256" cy="356" r="28" fill="#ffe9a3"/>
      <circle cx="256" cy="356" r="12" fill="#c99a17"/>
    </svg>
  )
}

// Three internal modes:
//   login      — no token, show OAuth login options
//   characters — token present, listing characters, picking or creating
//   create     — submitting a new character username
export default function AuthScreen({ onCloudReady, onPlayDemo }) {
  const [mode, setMode] = useState(getToken() ? 'characters' : 'login')
  const [identity, setIdentity] = useState(null)
  const [characters, setCharacters] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [isIronman, setIsIronman] = useState(false)
  const [isOneLife, setIsOneLife] = useState(false)
  const [isGrindman, setIsGrindman] = useState(false)
  const [oneLifeAck, setOneLifeAck] = useState(false)
  const [embedded] = useState(() => isEmbeddedBrowser())
  const [hosted] = useState(() => isHosted())
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
    setCharacter(ch.id, ch.username, ch.is_ironman, ch.is_one_life, ch.is_grindman)
    onCloudReady(ch)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await api.createCharacter(name, isIronman, isOneLife, isGrindman)
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
        onPlayDemo={onPlayDemo}
        embedded={embedded}
        hosted={hosted}
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
      <div class="fm-divider my-4" aria-hidden="true" />
      <button type="button" onClick={handleSignOut} class="fm-btn fm-btn--ghost fm-btn--sm w-full mb-2">
        Log out{identity?.provider ? ` of ${providerLabel(identity.provider)}` : ''}
      </button>
      <button
        type="button"
        onClick={handleDeleteAccount}
        disabled={busy}
        class="fm-btn fm-btn--ghost fm-btn--sm w-full text-[var(--fm-blood)]! border-[var(--fm-blood)]! disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Delete account
      </button>
    </>
  )

  return (
    <Wrap>
      <Title />
      <IronFrame class="w-full" parchStyle={{ padding: '20px 16px' }}>
        {identity && (
          <p class="text-center text-[12px] text-[var(--fm-ink-soft)] mb-4">
            Signed in as <b class="text-[var(--fm-ink)]">{identity.displayName}</b>
          </p>
        )}

        {busy && !characters && <p class="fm-lore text-center text-sm py-6">Fetching your characters…</p>}

        {!showCreate && characters && characters.length > 0 && (
          <>
            <SectionLabel>Choose a character</SectionLabel>
            <div class="fm-ledger mb-4">
              {characters.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => selectCharacter(ch)}
                  class="fm-row w-full min-h-[56px] text-left bg-transparent cursor-pointer hover:bg-[var(--fm-parch-hi)] active:opacity-80"
                >
                  <div class="flex-1 min-w-0">
                    <div class="font-[var(--fm-display)] font-bold text-[15px] text-[var(--fm-ink)]">{ch.username}</div>
                    <div class="fm-num text-[11px] text-[var(--fm-ink-faint)] mt-0.5">
                      {ch.save_updated_at ? `Last saved ${new Date(ch.save_updated_at).toLocaleString()}` : 'No cloud save yet'}
                    </div>
                  </div>
                  <span class="text-[var(--fm-ink-faint)] text-lg leading-none" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
            <button onClick={() => { setMode('create'); setNewName('') }} class="fm-btn fm-btn--ember w-full">
              Create New Character
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
              class="w-full box-border rounded-[var(--fm-r-sm)] border border-[var(--fm-rule)] bg-[var(--fm-parch-hi)] px-4 py-3 text-[14px] text-[var(--fm-ink)] placeholder:text-[var(--fm-ink-faint)] outline-none focus:border-[var(--fm-brass)]"
            />
            <p class="text-[11px] text-[var(--fm-ink-faint)] mt-1.5 mb-4">
              Letters, numbers, _ and - only. Names are unique forever and cannot be changed.
            </p>

            {/* Ironman Mode Toggle */}
            <div class="rounded-[var(--fm-r-sm)] border border-[var(--fm-rule)] bg-[var(--fm-parch-lo)] p-3 mb-3">
              <label class="flex items-start gap-2.5 cursor-pointer m-0">
                <input
                  type="checkbox"
                  checked={isIronman}
                  disabled={isGrindman}
                  onChange={(e) => { setIsIronman(e.target.checked); if (e.target.checked) setIsGrindman(false) }}
                  class="w-[18px] h-[18px] mt-0.5 flex-shrink-0 cursor-pointer accent-[var(--fm-ember)]"
                />
                <div>
                  <div class="flex items-center gap-1.5 text-[13px] font-bold text-[var(--fm-ink)]">
                    <IronHelmIcon size={16} /> Ironman Mode
                  </div>
                  <div class="text-[11px] text-[var(--fm-ink-soft)] mt-0.5 leading-snug">
                    Fully self-sufficient: no PvP and no trading post offers with other players. You can still use the general store. Permanent once set.
                  </div>
                </div>
              </label>
            </div>

            {/* One Life Mode Toggle */}
            <div class="rounded-[var(--fm-r-sm)] border border-[var(--fm-rule)] bg-[var(--fm-parch-lo)] p-3 mb-3">
              <label class="flex items-start gap-2.5 cursor-pointer m-0">
                <input
                  type="checkbox"
                  checked={isOneLife}
                  disabled={isGrindman}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setIsOneLife(checked)
                    if (checked) setIsGrindman(false)
                    if (!checked) setOneLifeAck(false)
                  }}
                  class="w-[18px] h-[18px] mt-0.5 flex-shrink-0 cursor-pointer accent-[var(--fm-ember)]"
                />
                <div>
                  <div class="flex items-center gap-1.5 text-[13px] font-bold text-[var(--fm-ink)]">
                    <OneLifeIcon size={15} title="" /> One Life Mode
                  </div>
                  <div class="text-[11px] text-[var(--fm-ink-soft)] mt-0.5 leading-snug">
                    Die once and your account is permanently deleted.
                  </div>
                </div>
              </label>
            </div>

            {/* Grindman Mode Toggle — stands alone (accountModeConflict) */}
            <div class="rounded-[var(--fm-r-sm)] border border-[var(--fm-rule)] bg-[var(--fm-parch-lo)] p-3 mb-3">
              <label class="flex items-start gap-2.5 cursor-pointer m-0">
                <input
                  type="checkbox"
                  checked={isGrindman}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setIsGrindman(checked)
                    if (checked) { setIsIronman(false); setIsOneLife(false); setOneLifeAck(false) }
                  }}
                  class="w-[18px] h-[18px] mt-0.5 flex-shrink-0 cursor-pointer accent-[var(--fm-ember)]"
                />
                <div>
                  <div class="flex items-center gap-1.5 text-[13px] font-bold text-[var(--fm-ink)]">
                    <CoinHelmIcon size={16} /> Grindman Mode
                  </div>
                  <div class="text-[11px] text-[var(--fm-ink-soft)] mt-0.5 leading-snug">
                    Half XP and triple drop rates. Collection log uniques — and the gear built from them — have to drop for you, not be bought. Credits cannot be bought — you keep what you start with and earn one a day from daily tasks. Cannot be combined with Ironman or One Life. Permanent once set.
                  </div>
                </div>
              </label>
            </div>
            {isOneLife && (
              <div class="rounded-[var(--fm-r-sm)] border border-[var(--fm-blood)] bg-[var(--fm-parch-lo)] p-3 mb-3">
                <div class="text-[12px] font-bold text-[var(--fm-blood)] mb-1.5">⚠️ One Life Warning</div>
                <div class="text-[11px] text-[var(--fm-ink-soft)] leading-relaxed mb-2">
                  Death permanently deletes this character. Not recommended for first-time players.
                </div>
                <label class="flex items-start gap-2 cursor-pointer text-[11px] text-[var(--fm-ink)]">
                  <input
                    type="checkbox"
                    checked={oneLifeAck}
                    onChange={(e) => setOneLifeAck(e.target.checked)}
                    class="w-3.5 h-3.5 mt-px flex-shrink-0 cursor-pointer accent-[var(--fm-blood)]"
                  />
                  I understand this character is permanently deleted on death.
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || newName.trim().length < 3 || (isOneLife && !oneLifeAck)}
              class="fm-btn fm-btn--ember w-full disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Creating…' : 'Create Character'}
            </button>
            {characters && characters.length > 0 && (
              <button type="button" onClick={() => setMode('characters')} class="fm-btn fm-btn--ghost fm-btn--sm w-full mt-2.5">
                Back
              </button>
            )}
          </form>
          {accountActions}
          </>
        )}

        {error && <p class="text-[12px] font-semibold text-[var(--fm-blood)] text-center mt-3">{error}</p>}
      </IronFrame>
    </Wrap>
  )
}

// ── Styled helpers — Forgemark (DESIGN.md): soot backdrop + gilt brand,
// matching the landing page this screen follows. ──

function Wrap({ children }) {
  // Scroll container with margin:auto centering — vertically centers short
  // content without clipping the top when the character list is taller than
  // the viewport.
  return (
    <div class="h-full overflow-y-auto flex flex-col p-6 box-border bg-[var(--fm-soot)]">
      <div class="w-full max-w-[380px] m-auto">{children}</div>
    </div>
  )
}

function Title() {
  return (
    <div class="text-center mb-5">
      <h1 class="fm-banner fm-banner--gilt text-[38px]">PocketRPG</h1>
      <div class="fm-eyebrow fm-eyebrow--light text-[10px] mt-2">A Medieval Idle RPG</div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div class="fm-rule-head mb-3">
      <span class="fm-eyebrow text-[10px]">{children}</span>
    </div>
  )
}

function providerLabel(provider) {
  if (provider === 'github') return 'GitHub'
  if (provider === 'google') return 'Google'
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}
