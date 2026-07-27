import { useEffect, useRef, useState } from 'preact/hooks'
import GameIcon from './GameIcon.jsx'
import { CHAT_MAX_CHARS } from '../engine/playerChat.js'

/**
 * Group-fight chat. Open or shut it occupies the same one-line band at the foot
 * of the fight, because a boss fight on a phone has no vertical room to spare —
 * the loot-share bar learned that lesson first (CLAUDE.md §20). Shut, the band
 * IS the newest line, so a purple drop announcement lands in front of a player
 * who never opens the log.
 *
 * Every message is player-authored text from the server: it goes through JSX
 * text children only, never dangerouslySetInnerHTML.
 */
export default function CoopChatPanel({ messages = [], onSend }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const logRef = useRef(null)
  const seenRef = useRef(messages.length)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (open) {
      seenRef.current = messages.length
      setUnread(0)
      const log = logRef.current
      if (log) log.scrollTop = log.scrollHeight
    } else {
      setUnread(Math.max(0, messages.length - seenRef.current))
    }
  }, [messages.length, open])

  const latest = messages.length > 0 ? messages[messages.length - 1] : null

  const submit = (e) => {
    e?.preventDefault?.()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    onSend?.(text)
  }

  return (
    <div class="cb-chat">
      {open && (
        <div class="cb-chat__log" ref={logRef}>
          {messages.length === 0 && (
            <div class="cb-chat__empty">No one has said anything yet.</div>
          )}
          {messages.map((m) => (
            <div key={m.id} class={'cb-chat__line' + (m.kind === 'drop' ? ' is-drop' : '')}>
              {m.kind === 'drop'
                ? <span>{m.text}</span>
                : <><span class="cb-chat__who">{m.username}</span><span>{m.text}</span></>}
            </div>
          ))}
        </div>
      )}

      <div class="cb-chat__bar">
        <button
          type="button"
          class="cb-chat__toggle"
          aria-expanded={open}
          aria-label={open ? 'Hide chat' : 'Show chat'}
          onClick={() => setOpen((v) => !v)}
        >
          <GameIcon iconKey="feather" color="currentColor" size={16} />
          {unread > 0 && !open && <span class="cb-chat__badge">{unread > 9 ? '9+' : unread}</span>}
        </button>

        {open ? (
          <form class="cb-chat__form" onSubmit={submit}>
            <input
              class="cb-chat__input"
              type="text"
              value={draft}
              maxLength={CHAT_MAX_CHARS}
              placeholder="Say something…"
              autocomplete="off"
              onInput={(e) => setDraft(e.currentTarget.value)}
            />
            <button type="submit" class="cb-chat__send" disabled={!draft.trim()}>Send</button>
          </form>
        ) : (
          <button type="button" class="cb-chat__latest" onClick={() => setOpen(true)}>
            {latest
              ? (latest.kind === 'drop' ? latest.text : `${latest.username}: ${latest.text}`)
              : 'Say something…'}
          </button>
        )}
      </div>
    </div>
  )
}
