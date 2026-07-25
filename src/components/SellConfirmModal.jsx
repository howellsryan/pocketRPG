import Modal from './Modal.jsx'

// Warns before a high-value sale commits, mirroring the item-drop confirmation.
export default function SellConfirmModal({ itemName, quantity, totalValue, onCancel, onConfirm, busy = false }) {
  return (
    <Modal title="Confirm high-value sale" onClose={onCancel}>
      <div class="space-y-4">
        <p class="text-sm text-[var(--color-parchment)] opacity-80">
          Sell <span class="font-bold text-[var(--color-gold)]">{quantity > 1 ? `${quantity} × ` : ''}{itemName}</span> for{' '}
          <span class="font-bold text-[var(--color-gold)]">{totalValue.toLocaleString()} gp</span>?
        </p>
        <div class="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            class="fm-btn fm-btn--sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            class="fm-btn fm-btn--blood fm-btn--sm"
          >
            Sell
          </button>
        </div>
      </div>
    </Modal>
  )
}
