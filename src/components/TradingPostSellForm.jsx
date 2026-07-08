import Button from './Button.jsx'
import Panel from './Panel.jsx'

export default function TradingPostSellForm({
  qty,
  setQty,
  price,
  setPrice,
  maxQty,
  busy,
  onCancel,
  onSubmit,
}) {
  const safeQty = Math.max(1, Math.floor(Number(qty) || 1))
  const safePrice = Math.max(1, Math.floor(Number(price) || 1))
  const total = safeQty * safePrice

  return (
    <div class="space-y-3">
      <div class="flex flex-col gap-2">
        <div class="text-[12px] text-[#888]">Price per item (gp)</div>
        <input
          type="number"
          min="1"
          value={safePrice}
          onInput={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          class="h-9 rounded-md bg-[var(--color-void-light)] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center px-2 outline-none"
        />
      </div>

      <div class="flex flex-col gap-2">
        <div class="text-[12px] text-[#888]">Quantity</div>
        <div class="flex gap-2 items-center">
          <Button variant="secondary" size="md" onClick={() => setQty(Math.max(1, safeQty - 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">−</Button>
          <input
            type="number"
            min="1"
            max={maxQty}
            value={safeQty}
            onInput={(e) => setQty(Math.max(1, Math.min(maxQty, Math.floor(Number(e.target.value) || 1))))}
            class="flex-1 h-9 rounded-md bg-[var(--color-void-light)] border border-[var(--color-void-border)] text-[var(--color-parchment)] text-[13px] font-[var(--font-mono)] text-center outline-none"
          />
          <Button variant="secondary" size="md" onClick={() => setQty(Math.min(maxQty, safeQty + 1))} className="w-8 h-8 p-0 flex items-center justify-center text-base">+</Button>
        </div>
        <button class="text-[10px] text-[#888] underline self-start" onClick={() => setQty(Math.max(1, maxQty))}>Use max ({maxQty})</button>
      </div>

      <Panel className="text-[12px] flex justify-between">
        <span class="text-[#888]">Total payout</span>
        <span class="text-[var(--color-gold)] font-[var(--font-mono)] font-bold">{total.toLocaleString()} gp</span>
      </Panel>

      <div class="flex gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button variant="primary" size="lg" onClick={onSubmit} disabled={busy} className="flex-1">{busy ? '…' : 'Place Sell'}</Button>
      </div>
    </div>
  )
}
