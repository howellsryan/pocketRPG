import { useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import { api } from '../cloud/api.js'

export default function BuyCreditsModal({ onClose, characterId }) {
  const [busySku, setBusySku] = useState(null)
  const [error, setError] = useState(null)

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

  return (
    <Modal title="Buy Credits" onClose={onClose}>
      <div class="space-y-3">
        <p class="text-[var(--color-parchment)] text-sm opacity-70 text-center">
          Get more credits to unlock premium features
        </p>
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
