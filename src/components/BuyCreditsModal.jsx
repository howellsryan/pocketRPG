import Modal from './Modal.jsx'

export default function BuyCreditsModal({ onClose, identityId, characterId, stripeLinks }) {
  const creditOptions = [
    { label: '10 Credits', key: 'credits_10', amount: 10, color: '#a78bfa' },
    { label: '100 Credits', key: 'credits_100', amount: 100, color: '#a78bfa' },
    { label: '1,000 Credits', key: 'credits_1000', amount: 1000, color: '#e879f9' },
  ]

  return (
    <Modal title="Buy Credits" onClose={onClose}>
      <div class="space-y-3">
        <p class="text-[var(--color-parchment)] text-sm opacity-70 text-center">
          Get more credits to unlock premium features
        </p>
        <div class="grid grid-cols-1 gap-2">
          {creditOptions.map((opt) => {
            const href = stripeLinks?.[opt.key]
            const clientRefId = opt.key === 'credits_10' || opt.key === 'credits_100' || opt.key === 'credits_1000' ? characterId : identityId

            return href ? (
              <a
                key={opt.key}
                href={`${href}?client_reference_id=${clientRefId}`}
                class="block p-3 rounded-lg border border-[#2a2a5a] bg-gradient-to-br from-[#0f0f1f] to-[#1a1a2f] hover:border-[#4a4a7a] transition-colors text-center no-underline"
              >
                <div class="font-bold text-lg" style={{ color: opt.color }}>
                  {opt.amount.toLocaleString()}
                </div>
                <div class="text-[11px] opacity-70" style={{ color: opt.color }}>
                  {opt.label}
                </div>
              </a>
            ) : null
          })}
        </div>
        <button
          onClick={onClose}
          class="w-full py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] font-semibold text-sm border border-[#333] mt-4"
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
