import Modal from './Modal.jsx'

/**
 * Global confirmation shown while an active skilling/gathering action is paused
 * because the inventory is full. Two actions plus a dismiss (X):
 *   - Bank & continue: bank everything and resume immediately.
 *   - Take me there: open the inventory; the action stays paused and resumes on
 *     its own once a slot frees up.
 * The X (Modal's close) dismisses without banking — the action keeps silently
 * retrying until there is space, and the prompt does not re-appear.
 */
export default function InventoryFullPrompt({ open, onBank, onGoToInventory, onClose }) {
  if (!open) return null
  return (
    <Modal title="Inventory full" onClose={onClose} className="max-w-sm">
      <p class="text-[14px] leading-snug text-[var(--color-parchment)] opacity-80 mb-4">
        Your inventory is full. Would you like to bank and continue?
      </p>
      <div class="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onBank}
          class="w-full min-h-[44px] py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer bg-[rgba(212,160,23,0.12)] border-[1.5px] border-[var(--color-gold)] active:opacity-80"
        >
          <span class="text-[14px]">🏦</span>
          <span class="text-[15px] font-semibold text-[var(--color-gold)]">Bank &amp; continue</span>
        </button>
        <button
          type="button"
          onClick={onGoToInventory}
          class="w-full min-h-[44px] py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer bg-[var(--color-void-light)] border border-[var(--color-void-border)] active:bg-[var(--color-void-lighter)]"
        >
          <span class="text-[15px] font-semibold text-[var(--color-parchment)]">Take me there</span>
        </button>
      </div>
    </Modal>
  )
}
