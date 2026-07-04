import { useEffect, useRef, useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import Button from './Button.jsx'
import { api } from '../cloud/api.js'

const GREETING = {
  role: 'assistant',
  content:
    "Hi! I'm the PocketRPG helper. Ask me about game mechanics, items, monsters, quests — or your own character's progress. I can also do things for you (sell an item, get a slayer task, buy gear…) — just ask, and I'll confirm before anything changes.",
}

// One-line credit cost for a pending action's confirm card.
function costLine(cost) {
  if (!cost) return `Costs 1 credit`
  const fee = cost.fee ?? 1
  const total = cost.total ?? fee
  if (cost.skip > 0) {
    return `Costs ${total} credit${total === 1 ? '' : 's'} — ${fee} action fee + ${cost.skip} for the skip`
  }
  return `Costs ${fee} credit${fee === 1 ? '' : 's'}`
}

// Floating in-game help chatbot. Cloud accounts only (the /api/chat endpoint
// needs an authenticated character); renders nothing in demo mode.
export default function ChatWidget({ isCloudAccount = false }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy, open])

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
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: res.answer, pendingAction: res.pendingAction || null },
        ])
      })
      .catch((err) => {
        const content = err?.message === 'request_timeout'
          ? 'Sorry, that question was a bit too much for me — try asking something shorter or simpler.'
          : 'Sorry, I could not reach the helper — check your connection and try again.'
        setMessages((prev) => [...prev, { role: 'assistant', content }])
      })
      .finally(() => setBusy(false))
  }

  // Mark the pending action on message `idx` resolved so its buttons disappear.
  const resolvePending = (idx) =>
    setMessages((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, pendingAction: { ...m.pendingAction, resolved: true } } : m)),
    )

  const confirmAction = (idx, token) => {
    if (busy) return
    resolvePending(idx)
    setBusy(true)
    api
      .chat(null, [], token)
      .then((res) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.answer }])
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Sorry, I could not complete that — check your connection and try again.' },
        ])
      })
      .finally(() => setBusy(false))
  }

  const cancelAction = (idx) => {
    resolvePending(idx)
    setMessages((prev) => [...prev, { role: 'assistant', content: "Okay, I won't do that. Anything else?" }])
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
          onClose={() => setOpen(false)}
          fullHeight
          contentClassName="flex flex-col min-h-0"
        >
          <div ref={scrollRef} class="flex-1 overflow-y-auto flex flex-col gap-2 pb-2">
            {messages.map((m, i) => {
              const pending = m.pendingAction && !m.pendingAction.resolved ? m.pendingAction : null
              return (
                <div key={i} class="flex flex-col gap-1.5">
                  <div
                    class={
                      m.role === 'user'
                        ? 'self-end max-w-[85%] rounded-lg px-3 py-2 text-sm bg-[var(--color-gold)] text-[var(--color-void)]'
                        : 'self-start max-w-[85%] rounded-lg px-3 py-2 text-sm bg-[var(--color-void)] border border-[#1a1a1a] text-[var(--color-parchment)] whitespace-pre-wrap'
                    }
                  >
                    {m.content}
                  </div>
                  {pending && (
                    <div class="self-start max-w-[85%] rounded-lg border border-[var(--color-gold)] bg-[var(--color-void)] p-2.5 flex flex-col gap-2">
                      {pending.label && (
                        <div class="text-xs font-semibold text-[var(--color-parchment)]">{pending.label}</div>
                      )}
                      <div class="text-xs text-[var(--color-gold)]">💳 {costLine(pending.cost)}</div>
                      <div class="flex gap-2">
                        <Button
                          variant="success"
                          size="md"
                          disabled={busy}
                          onClick={() => confirmAction(i, pending.token)}
                        >
                          ✓ Confirm
                        </Button>
                        <Button variant="secondary" size="md" disabled={busy} onClick={() => cancelAction(i)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
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
            Answers PocketRPG questions and can act on your account. AI can be wrong — actions always ask first.
          </div>
        </Modal>
      )}
    </>
  )
}
