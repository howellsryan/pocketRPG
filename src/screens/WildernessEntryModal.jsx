import { useState, useEffect } from 'preact/hooks'
import Modal from '../components/Modal.jsx'
import Button from '../components/Button.jsx'
import { useGame } from '../state/gameState.jsx'
import { api } from '../cloud/api.js'
import { openWorld, fetchWildernessCount } from '../utils/helpers.js'

const PVP_ZONE = 'wilderness'
const COUNT_POLL_MS = 15000

/**
 * The only door into PvP. There is no lobby and no matchmaking any more: you
 * walk into the Wilderness and take your chances with whoever is out there.
 *
 * Two screens on purpose. The first explains the place; the second is the
 * warning, and it is deliberately the last thing between the player and the
 * gate — the loss on death is total, and a single button that says "Enter"
 * under a paragraph nobody reads is not consent.
 */
export default function WildernessEntryModal({ onClose }) {
  const { isIronman, addToast } = useGame()
  const [count, setCount] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [entering, setEntering] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      const next = await fetchWildernessCount()
      if (!cancelled) setCount(next)
    }
    poll()
    const timer = setInterval(poll, COUNT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const enter = async () => {
    setEntering(true)
    try {
      await openWorld(api, PVP_ZONE)
      onClose()
    } catch {
      addToast('Could not reach the Wilderness.', 'error')
      setEntering(false)
    }
  }

  return (
    <Modal onClose={onClose} title="The Wilderness">
      <div class="flex flex-col gap-3">
        <div class="text-center">
          <div class="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Currently in the Wilderness</div>
          <div class="text-3xl font-bold text-[var(--accent)] leading-tight">
            {count === null ? '—' : count}
          </div>
          <div class="text-[10px] text-[var(--text-muted)]">
            {count === 0
              ? 'Nobody is out there — the roaming outlaws will have to do.'
              : 'Bots roam the wastes when the map is quiet.'}
          </div>
        </div>

        {!confirming && (
          <>
            <ul class="text-[11px] leading-relaxed text-[var(--text-secondary)] flex flex-col gap-1.5">
              <li>You arrive in a walled border camp with a bank chest. Nothing can touch you there.</li>
              <li>North through the gate is open PvP. You will be asked to confirm before you cross.</li>
              <li>Anyone within <strong>10 combat levels</strong> of you can attack you out there.</li>
              <li>Single combat: one fight at a time, and nobody can jump in on it.</li>
              <li>Eat, drink, pray and spec exactly as you would anywhere else — protection prayers included.</li>
              <li>Kill an outlaw for a shot at the <strong>Zesta</strong> longsword, vest and skirt. They drop nowhere else.</li>
            </ul>
            {isIronman && (
              <div class="text-[10px] leading-relaxed text-[var(--text-muted)] border border-[var(--hairline)] rounded p-2">
                <strong>Ironman:</strong> you can fight and you keep every outlaw drop. You cannot pick up loot
                dropped by another player — that is somebody else's account, and it stays on the ground.
              </div>
            )}
            <Button variant="danger" className="w-full" onClick={() => setConfirming(true)}>Travel to the Wilderness</Button>
          </>
        )}

        {confirming && (
          <>
            <div class="border border-[var(--accent)] rounded p-3 text-center flex flex-col gap-2">
              <div class="text-sm font-bold text-[var(--accent)]">You will lose everything.</div>
              <div class="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                If you die in the Wilderness, every item in your inventory <em>and</em> every item you are
                wearing drops on the ground for your killer. Bank what you cannot afford to lose — there is a
                chest in the camp.
              </div>
              {/* One-life is the one status the death also ends, so it is named
                  rather than left to the general warning above. */}
              <div class="text-[10px] text-[var(--text-muted)]">
                A One Life run ends here like it ends anywhere else.
              </div>
            </div>
            <Button variant="danger" className="w-full" onClick={enter} disabled={entering}>
              {entering ? 'Opening…' : 'I understand — take me there'}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setConfirming(false)}>Back</Button>
          </>
        )}
      </div>
    </Modal>
  )
}
