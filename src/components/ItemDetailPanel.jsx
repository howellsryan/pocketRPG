import Panel from './Panel.jsx'
import BonusDisplay from './BonusDisplay.jsx'
import GameIcon from './GameIcon.jsx'
import { useGame } from '../state/gameState.jsx'
import { getIronmanShopValue } from '../utils/itemValue.js'
import { poweredStaffDamageSummary } from '../engine/combatPrimitives.js'
import { getLevelFromXP } from '../engine/experience.js'

export default function ItemDetailPanel({ item, children, quantity, noted, extraInfo, hideSlot }) {
  const { isIronman, stats } = useGame()
  if (!item) return null
  const hasAttackBonus = item.attackBonus && Object.values(item.attackBonus).some(v => v !== 0)
  const hasDefenceBonus = item.defenceBonus && Object.values(item.defenceBonus).some(v => v !== 0)
  const hasOtherBonus = item.otherBonus && Object.values(item.otherBonus).some(v => v !== 0)
  const hasBonuses = hasAttackBonus || hasDefenceBonus || hasOtherBonus
  // Ironman vendor value (explicit ironmanShopValue, else 0.4 × shopValue,
  // capped at 1m). Shown alongside the shop value for Ironman accounts only.
  const ironValue = isIronman ? getIronmanShopValue(item) : 0
  const poweredStaff = poweredStaffDamageSummary(item, getLevelFromXP(stats?.magic?.xp || 0))

  return (
    <div class="space-y-3">
      <Panel className="flex items-center gap-3 min-w-0">
        <GameIcon item={item} size={30} class="shrink-0" />
        <div class="min-w-0">
          <div class="text-[13px] font-semibold text-[var(--color-parchment)] break-words">{item.name}</div>
          <div class="text-[11px] text-[#888] mt-[2px] break-words">{item.type}</div>
        </div>
      </Panel>

      <Panel className="text-[12px] text-[var(--color-parchment)] opacity-80 space-y-2">
        {noted && <p class="text-[var(--color-gold)] font-semibold">📜 Noted — cannot be used</p>}
        {item.slot && !hideSlot && <p>Slot: {item.slot}</p>}
        {item.slot === 'weapon' && <p>Attack speed: {item.attackSpeed || 4} ticks</p>}
        {item.attackStyle && <p>Style: {item.attackStyle}</p>}
        {poweredStaff && (
          <p>
            Max hit: <span class="text-[var(--color-gold)]">{poweredStaff.maxHit}</span>{' '}
            at your Magic {poweredStaff.magicLevel} — casts with no runes, +1 damage per 3 Magic levels
          </p>
        )}
        {item.type === 'food' && <p>Heals {item.heals} HP</p>}
        {item.requirements && Object.entries(item.requirements).length > 0 && (
          <p>Requires: {Object.entries(item.requirements).map(([s, l]) => `${s} ${l}`).join(', ')}</p>
        )}
        {quantity > 1 && <p>Quantity: {quantity}</p>}
        {item.shopValue > 0 && <p>Value: <span class="text-[var(--color-gold)]">{item.shopValue.toLocaleString()} gp</span></p>}
        {ironValue > 0 && <p>Ironman value: <span class="text-[var(--color-gold)]">{ironValue.toLocaleString()} gp</span></p>}
        {item.description && <p class="text-[var(--color-gold)]">{item.description}</p>}
        {extraInfo}
        {hasBonuses && (
          <div class="pt-2 border-t border-[var(--color-void-border)]">
            <BonusDisplay item={item} />
          </div>
        )}
      </Panel>

      {children}
    </div>
  )
}
