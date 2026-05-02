import Modal from './Modal.jsx'
import Panel from './Panel.jsx'
import BonusDisplay from './BonusDisplay.jsx'

export default function SharedItemModal({ item, title, onClose, children, quantity, noted, extraInfo }) {
  if (!item) return null

  return (
    <Modal title={title || item.name} onClose={onClose}>
      <div class="space-y-3">
        <Panel className="flex items-center gap-3 min-w-0">
          <span class="text-[30px] shrink-0">{item.icon || '📦'}</span>
          <div class="min-w-0">
            <div class="text-[13px] font-semibold text-[var(--color-parchment)] break-words">{item.name}</div>
            <div class="text-[11px] text-[#888] mt-[2px] break-words">{item.type}</div>
          </div>
        </Panel>

        <Panel className="text-[12px] text-[var(--color-parchment)] opacity-80 space-y-2">
          {noted && <p class="text-[var(--color-gold)] font-semibold">📜 Noted — cannot be used</p>}
          {item.slot && <p>Slot: {item.slot}</p>}
          {item.attackSpeed && <p>Attack speed: {item.attackSpeed} ticks</p>}
          {item.attackStyle && <p>Style: {item.attackStyle}</p>}
          {item.type === 'food' && <p>Heals {item.heals} HP</p>}
          {item.requirements && Object.entries(item.requirements).length > 0 && (
            <p>Requires: {Object.entries(item.requirements).map(([s, l]) => `${s} ${l}`).join(', ')}</p>
          )}
          {quantity > 1 && <p>Quantity: {quantity}</p>}
          {item.shopValue > 0 && <p>Value: <span class="text-[var(--color-gold)]">{item.shopValue.toLocaleString()} gp</span></p>}
          {extraInfo}
        </Panel>

        <Panel className="text-[12px] text-[var(--color-parchment)] opacity-80">
          <BonusDisplay item={item} />
        </Panel>

        {children}
      </div>
    </Modal>
  )
}
