import { useEffect, useRef, useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import Button from './Button.jsx'
import { api, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { pauseTicks, resumeTicks } from '../engine/tick.js'
import { applyCloudSave } from '../cloud/sync.js'
import { useGame } from '../state/gameState.jsx'
import { chatActionCostLine } from '../utils/helpers.js'

const GREETING = {
  role: 'assistant',
  content:
    "Hi! I'm the PocketRPG helper. Ask me about game mechanics, items, monsters, quests — or your own character's progress. I can also do things for you (sell an item, get a slayer task, buy gear…) — just ask, and I'll confirm before anything changes.",
}

// In-game help chatbot. Cloud accounts only (the /api/chat endpoint needs an
// authenticated character); renders nothing in demo mode. The trigger lives in
// the chrome, not here: GameFrameBar's bottom nav rail on mobile, SideNav's
// rail on desktop — both drive `open`/`onOpenChange`. This component only owns
// the panel itself.
export default function ChatWidget({ isCloudAccount = false, open = false, onOpenChange = () => {} }) {
  const { loadGame } = useGame()
  const setOpen = onOpenChange
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

  const trackRemaining = (res) => {
    if (res && typeof res.remaining === 'number') setRemaining(res.remaining)
    // A chatbot action or refill changed the credit balance — update the live
    // credits display everywhere (Header pill etc.) without a page refresh.
    if (res && typeof res.creditsRemaining === 'number') {
      window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: res.creditsRemaining } }))
    }
  }

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
        trackRemaining(res)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: res.answer,
            pendingAction: res.pendingAction || null,
            // The daily cap is spent — offer a paid refill inline.
            refill: res.mode === 'quota' ? { credits: res.refillCredits ?? 10 } : null,
          },
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

  // Mark a pending action / refill offer on message `idx` resolved so its
  // buttons disappear.
  const resolve = (idx, key) =>
    setMessages((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [key]: { ...m[key], resolved: true } } : m)),
    )

  const confirmAction = (idx, token) => {
    if (busy) return
    resolve(idx, 'pendingAction')
    setBusy(true)
    api
      .chat(null, [], { confirm: token })
      .then(async (res) => {
        trackRemaining(res)
        // A multi-step ask ("skip this and get me a new one") can chain
        // straight into the next confirmable action instead of making the
        // player ask again.
        setMessages((prev) => [...prev, { role: 'assistant', content: res.answer, pendingAction: res.pendingAction || null }])
        // The action just changed server-side state (skills, inventory, bank,
        // an idle task, credits…) — pull the fresh save and reload so the rest
        // of the app (and the live tick loop) picks it up without a manual reload.
        if (res.mode === 'action_done' || res.mode === 'action_chained') {
          try {
            const saveRes = await api.getSave()
            if (saveRes?.save?.save_data) {
              await applyCloudSave(JSON.parse(saveRes.save.save_data), saveRes.save.updatedAt, saveRes.save.save_revision)
            }
            await loadGame()
          } catch (err) {
            console.warn('[PocketRPG] post-action state refresh failed:', err?.message || err)
          }
        }
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
    resolve(idx, 'pendingAction')
    setMessages((prev) => [...prev, { role: 'assistant', content: "Okay, I won't do that. Anything else?" }])
  }

  const refill = (idx) => {
    if (busy) return
    resolve(idx, 'refill')
    setBusy(true)
    api
      .chat(null, [], { refill: true })
      .then((res) => {
        trackRemaining(res)
        setMessages((prev) => [...prev, { role: 'assistant', content: res.answer }])
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Sorry, I could not refill just now — check your connection and try again.' },
        ])
      })
      .finally(() => setBusy(false))
  }

  return (
    <>
      {open && (
        <Modal
          title="Game Helper"
          titleRight={
            remaining != null ? (
              <span class="text-xs text-[var(--color-parchment-dark)]">{remaining} messages left today</span>
            ) : null
          }
          onClose={() => setOpen(false)}
          fullHeight
          contentClassName="flex flex-col min-h-0"
        >
          <div ref={scrollRef} class="flex-1 overflow-y-auto flex flex-col gap-2 pb-2">
            {messages.map((m, i) => {
              const pending = m.pendingAction && !m.pendingAction.resolved ? m.pendingAction : null
              const refillOffer = m.refill && !m.refill.resolved ? m.refill : null
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
                      <div class="text-xs text-[var(--color-gold)]">💳 {chatActionCostLine(pending.cost)}</div>
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
                  {refillOffer && (
                    <div class="self-start flex gap-2 pl-1">
                      <Button variant="primary" size="md" disabled={busy} onClick={() => refill(i)}>
                        🔄 Refill for {refillOffer.credits} credits
                      </Button>
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
