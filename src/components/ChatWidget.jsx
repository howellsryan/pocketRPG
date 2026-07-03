import { useEffect, useRef, useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import Button from './Button.jsx'
import { api } from '../cloud/api.js'
import { pauseTicks, resumeTicks } from '../engine/tick.js'

const GREETING = {
  role: 'assistant',
  content: "Hi! I'm the PocketRPG helper. Ask me about game mechanics, items, monsters, quests — or your own character's progress.",
}

// Floating in-game help chatbot. Cloud accounts only (the /api/chat endpoint
// needs an authenticated character); renders nothing in demo mode.
export default function ChatWidget({ isCloudAccount = false }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [remaining, setRemaining] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy, open])

  // Pause ticks while the helper panel is open so combat cannot advance
  // in the background — same treatment as an idle boss fight.
  useEffect(() => {
    if (!open) return
    pauseTicks()
    return () => resumeTicks()
  }, [open])

  if (!isCloudAccount) return null

  const send = () => {
    const question = input.trim()
    if (!question || busy) return
    const history = messages
      .filter((m) => m !== GREETING)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setInput('')
    setBusy(true)
    api
      .chat(question, history)
      .then((res) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.answer }])
        if (typeof res.remaining === 'number') setRemaining(res.remaining)
      })
      .catch((err) => {
        // Timeouts mean the question ran long; anything else is a real
        // connection/server problem and shouldn't blame the question.
        const content = err?.message === 'request_timeout'
          ? 'Sorry, that question was a bit too much for me — try asking something shorter or simpler.'
          : 'Sorry, I could not reach the helper — check your connection and try again.'
        setMessages((prev) => [...prev, { role: 'assistant', content }])
      })
      .finally(() => setBusy(false))
  }

  return (
    <>
      <button
        type="button"
        aria-label="Game helper"
        onClick={() => setOpen(true)}
        class="fixed bottom-4 right-4 z-[140] w-12 h-12 rounded-full bg-[var(--color-gold)] text-[var(--color-void)] text-xl shadow-lg border border-[var(--color-void-border)] hover:bg-[var(--color-gold-light)] flex items-center justify-center"
      >
        💬
      </button>
      {open && (
        <Modal
          title="Game Helper"
          titleRight={
            remaining != null ? (
              <span class="text-xs text-[var(--color-parchment-dark)]">{remaining} questions left today</span>
            ) : null
          }
          onClose={() => setOpen(false)}
          fullHeight
          contentClassName="flex flex-col min-h-0"
        >
          <div ref={scrollRef} class="flex-1 overflow-y-auto flex flex-col gap-2 pb-2">
            {messages.map((m, i) => (
              <div
                key={i}
                class={
                  m.role === 'user'
                    ? 'self-end max-w-[85%] rounded-lg px-3 py-2 text-sm bg-[var(--color-gold)] text-[var(--color-void)]'
                    : 'self-start max-w-[85%] rounded-lg px-3 py-2 text-sm bg-[var(--color-void)] border border-[#1a1a1a] text-[var(--color-parchment)] whitespace-pre-wrap'
                }
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <div class="self-start rounded-lg px-3 py-2 text-sm bg-[var(--color-void)] border border-[#1a1a1a] text-[var(--color-parchment-dark)]">
                Thinking…
              </div>
            )}
          </div>
          <div class="flex gap-2 pt-2 border-t border-[#1a1a1a]">
            <input
              type="text"
              value={input}
              maxLength={500}
              placeholder="Ask about PocketRPG…"
              onInput={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
              class="flex-1 min-w-0 min-h-[44px] rounded-lg bg-[var(--color-void)] border border-[var(--color-void-border)] px-3 text-sm text-[var(--color-parchment)] placeholder:text-[var(--color-parchment-dark)] focus:outline-none focus:border-[var(--color-gold)]"
            />
            <Button variant="primary" size="lg" disabled={busy || !input.trim()} onClick={send}>
              Send
            </Button>
          </div>
          <div class="pt-1 text-[10px] text-[var(--color-parchment-dark)] text-center">
            Answers PocketRPG questions only. AI answers can be wrong — check in game.
          </div>
        </Modal>
      )}
    </>
  )
}
