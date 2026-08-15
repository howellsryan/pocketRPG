import { useEffect, useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import { api } from '../cloud/api.js'
import { pauseTicks, resumeTicks } from '../engine/tick.js'

export default function BuyCreditsModal({ onClose, characterId, credits = 0, isGrindman = false }) {
  const [busySku, setBusySku] = useState(null)
  const [error, setError] = useState(null)

  // Pause ticks while this modal is open so combat cannot advance in the
  // background — same treatment as an idle boss fight.
  useEffect(() => {
    pauseTicks()
    return () => resumeTicks()
  }, [])

  const creditOptions = [
    { label: '10 Credits',    sku: 'credits_10',   amount: 10,   color: '#a78bfa' },
    { label: '100 Credits',   sku: 'credits_100',  amount: 100,  color: '#a78bfa' },
    { label: '1,000 Credits', sku: 'credits_1000', amount: 1000, color: '#e879f9' },
  ]

  async function startCheckout(sku) {
    if (busySku) return
    setBusySku(sku)
    setError(null)
    try {
      // Server-issued Checkout Session: the API authenticates the buyer,
      // resolves the price ID, and writes server-trusted metadata onto
      // the session. The webhook handler then verifies that metadata
      // matches the session's client_reference_id before crediting.
      const res = await api.createStripeSession(sku, characterId)
      if (!res?.url) throw new Error('No URL returned')
      window.location.href = res.url
    } catch (err) {
      setError(err?.message || 'Could not start checkout')
      setBusySku(null)
    }
  }

  // A Grindman still opens this from the credits pill — it just answers the
  // question the pill raises (where do more come from?) instead of selling any.
  // The server refuses the checkout regardless; this is the explanation.
  return (
    <Modal title={isGrindman ? 'Credits' : 'Buy Credits'} onClose={onClose}>
      <div class="space-y-3">
        <p class="text-[var(--color-parchment)] text-sm opacity-70 text-center">
          {isGrindman
            ? 'Grindman credits are earned, never bought. You keep what your account started with, plus one credit for every daily task you finish.'
            : 'Get more credits to unlock premium features'}
        </p>
        <p class="text-[var(--color-gold)] text-sm font-semibold text-center">
          Current Credits: {credits.toLocaleString()}
        </p>
        {!isGrindman && (
        <div class="grid grid-cols-1 gap-2">
          {creditOptions.map((opt) => (
            <button
              key={opt.sku}
              type="button"
              disabled={busySku !== null}
              onClick={() => startCheckout(opt.sku)}
              class="block w-full p-3 rounded-lg border border-[var(--color-void-border)] bg-[var(--color-void-light)] hover:border-[var(--color-gold-dim)] transition-colors text-center disabled:opacity-50"
            >
              <div class="font-bold text-lg" style={{ color: opt.color }}>
                {opt.amount.toLocaleString()}
              </div>
              <div class="text-[11px] opacity-70" style={{ color: opt.color }}>
                {busySku === opt.sku ? 'Opening checkout…' : opt.label}
              </div>
            </button>
          ))}
        </div>
        )}
        {error && (
          <div class="text-[12px] text-red-400 text-center" role="alert">{error}</div>
        )}
        <button
          onClick={onClose}
          disabled={busySku !== null}
          class="w-full py-2.5 rounded-lg bg-[var(--color-void-light)] text-[var(--color-parchment)] font-semibold text-sm border border-[var(--color-void-border)] mt-4 disabled:opacity-50"
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
