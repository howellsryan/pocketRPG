import { useState, useRef } from 'preact/hooks'
import GameIcon from './GameIcon.jsx'
import SkillIcon from './SkillIcon.jsx'
import { prayerSkill } from '../utils/prayerIcons.js'
import { isConsumableFood, isConsumablePotion } from '../engine/consumables.js'

// Shared mobile combat quick-actions panel (a Prayers tab first, then Consume /
// Weapons / Armour). Used by BOTH the solo fight (CombatScreen) and the group
// fight (CoopBossScreen) so the layout lives in one place. Each screen supplies
// its own dispatch: solo acts immediately by itemId, the group fight files an
// intent by inventory slot index — both read the same resolved `entry`
// ({ itemId, item, qty, slotIdx }). Pass
// `isPotionActive` to light up the highlight ring on potions whose effect is
// currently active. The Prayers tab only renders when `onPrayer` is supplied (PvE);
// it lists the player's configured `quickPrayers` and toggles them exactly like the
// full prayer modal, with a pencil to (re)configure the list via `onEditPrayers`.
export default function CombatQuickActions({
  inventory,
  itemsData,
  onEat,
  onPotion,
  onEquip,
  isPotionActive,
  quickPrayers,
  prayersData,
  prayerLevel,
  onPrayer,
  onEditPrayers,
  isPrayerActive,
}) {
  // Open on Prayers when the player has some configured — landing on an empty
  // "pick your quick prayers" pane would be worse than opening on Consume.
  const [tab, setTab] = useState(
    typeof onPrayer === 'function' && Array.isArray(quickPrayers) && quickPrayers.length > 0
      ? 'prayer'
      : 'consumable'
  )

  // Tap-acknowledgement flash. PvP queues intents (no instant inventory change),
  // so blink the tapped slot to confirm the action registered — same feedback in
  // PvE for consistency. `n` is a nonce so re-tapping the same slot replays it.
  const [pinged, setPinged] = useState(null)
  const pingTimer = useRef(null)
  const pingNonce = useRef(0)
  const flash = (id) => {
    pingNonce.current += 1
    setPinged({ id, n: pingNonce.current })
    if (pingTimer.current) clearTimeout(pingTimer.current)
    pingTimer.current = setTimeout(() => setPinged(null), 300)
  }
  const handleEat = (entry) => { flash(entry.itemId); if (onEat) onEat(entry) }
  const handlePotion = (entry) => { flash(entry.itemId); if (onPotion) onPotion(entry) }
  const handleEquip = (entry) => { flash(entry.itemId); if (onEquip) onEquip(entry) }
  const handlePrayer = (prayer) => { flash(prayer.id); if (onPrayer) onPrayer(prayer.id) }
  const ping = (entry) => (pinged && pinged.id === entry.itemId
    ? <span key={pinged.n} class="cb-slot__ping" />
    : null)

  // Compact quantity formatter for slot badges (312 → 312, 5085 → 5.1k).
  const fmtQty = (n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
    return `${n}`
  }

  // Group the live inventory into distinct item cards (summing stacked qty),
  // filtered by a predicate over the resolved item definition. Retains the first
  // matching inventory slot index so slot-based callers (PvP) can target a slot.
  const groupInv = (predicate) => {
    const map = new Map()
    const inv = Array.isArray(inventory) ? inventory : []
    for (let i = 0; i < inv.length; i++) {
      const slot = inv[i]
      if (!slot || slot.noted) continue
      const item = itemsData[slot.itemId]
      if (!item || !predicate(item)) continue
      const cur = map.get(slot.itemId)
      if (cur) cur.qty += slot.quantity || 1
      else map.set(slot.itemId, { itemId: slot.itemId, item, qty: slot.quantity || 1, slotIdx: i })
    }
    return [...map.values()]
  }

  const POT_TAG = { hp: '+HP', attack: '+ATK', strength: '+STR', defence: '+DEF', ranged: '+RNG', magic: '+MAG', combat: '+ALL', super_restore: 'RESTORE' }
  // Stable name-sort so the grid doesn't reshuffle as items are equipped/consumed.
  const byName = (a, b) => a.item.name.localeCompare(b.item.name)

  // Food and potions share one tab: food first (sorted), then potions (sorted).
  // Each entry carries its `kind` so the grid can route eat vs. drink and pick
  // the right tag/active-highlight. A brew (e.g. Lumira) is both eat-able and a
  // potion, so exclude potions from the food group to show it once (as a potion).
  const foods = groupInv(it => isConsumableFood(it) && !isConsumablePotion(it)).sort(byName).map(e => ({ ...e, kind: 'food' }))
  const potions = groupInv(isConsumablePotion).sort(byName).map(e => ({ ...e, kind: 'potion' }))
  const consumables = [...foods, ...potions]
  const weapons = groupInv(it => it.slot === 'weapon').sort(byName)
  const armour = groupInv(it => it.slot && it.slot !== 'weapon').sort(byName)

  // Prayers tab is PvE-only — surfaced when the screen wires an onPrayer handler.
  // Resolve the configured quick-prayer ids to live prayer defs (dropping any that
  // no longer exist), preserving the player's configured order.
  const showPrayers = typeof onPrayer === 'function'
  const quickPrayerDefs = showPrayers
    ? (Array.isArray(quickPrayers) ? quickPrayers : [])
      .map(id => (prayersData ? prayersData[id] : null))
      .filter(Boolean)
    : []

  // Prayers lead: in PvE they are the most time-critical tap in a fight.
  const tabs = showPrayers ? [['prayer', 'Prayers', quickPrayerDefs.length]] : []
  tabs.push(['consumable', 'Consume', consumables.length], ['weapon', 'Weapons', weapons.length], ['armour', 'Armour', armour.length])

  return (
    <div class="cb-qa">
      <div class="cb-qa__tabs">
        {tabs.map(([id, label, n]) => (
          <button key={id} class={'cb-qa__tab' + (tab === id ? ' is-on' : '')} onClick={() => setTab(id)}>
            {label}<span class="cb-qa__tabn">{n}</span>
          </button>
        ))}
        {/* Only render the pencil when a screen can actually handle it —
            rendering it unconditionally is how it became a dead tap in the
            co-op fight, which passed onPrayer but not onEditPrayers. */}
        {tab === 'prayer' && showPrayers && typeof onEditPrayers === 'function' && (
          <button class="cb-qa__edit" onClick={onEditPrayers} aria-label="Configure quick prayers">✏️</button>
        )}
      </div>

      <div class="cb-qa__grid">
        {tab === 'consumable' && (consumables.length === 0
          ? <div class="cb-qa__empty">No food or potions in your inventory</div>
          : consumables.map((entry) => {
            const isPotion = entry.kind === 'potion'
            const active = isPotion && isPotionActive ? isPotionActive(entry.item) : false
            return (
              <button key={entry.itemId} class={'cb-slot' + (active ? ' is-active' : '')} onClick={() => (isPotion ? handlePotion(entry) : handleEat(entry))}>
                <span class="cb-slot__qty">{fmtQty(entry.qty)}</span>
                <GameIcon item={entry.item} size={18} />
                <span class="cb-slot__name">{entry.item.name}</span>
                {isPotion
                  ? (POT_TAG[entry.item.effect] && <span class="cb-slot__tag">{POT_TAG[entry.item.effect]}</span>)
                  : (entry.item.heals != null && <span class="cb-slot__tag heal">+{entry.item.heals}</span>)}
                {active && <span class="cb-slot__ring" />}
                {ping(entry)}
              </button>
            )
          }))}

        {tab === 'weapon' && (weapons.length === 0
          ? <div class="cb-qa__empty">No weapons to wield</div>
          : weapons.map((entry) => (
            <button key={entry.itemId} class="cb-slot" onClick={() => handleEquip(entry)}>
              {entry.qty > 1 && <span class="cb-slot__qty">{fmtQty(entry.qty)}</span>}
              <GameIcon item={entry.item} size={18} />
              <span class="cb-slot__name">{entry.item.name}</span>
              {ping(entry)}
            </button>
          )))}

        {tab === 'armour' && (armour.length === 0
          ? <div class="cb-qa__empty">No armour to equip</div>
          : armour.map((entry) => (
            <button key={entry.itemId} class="cb-slot" onClick={() => handleEquip(entry)}>
              {entry.qty > 1 && <span class="cb-slot__qty">{fmtQty(entry.qty)}</span>}
              <GameIcon item={entry.item} size={18} />
              <span class="cb-slot__name">{entry.item.name}</span>
              <span class="cb-slot__tag">{entry.item.slot}</span>
              {ping(entry)}
            </button>
          )))}

        {tab === 'prayer' && showPrayers && (quickPrayerDefs.length === 0
          ? <div class="cb-qa__empty">Tap ✏️ to pick your quick prayers</div>
          : quickPrayerDefs.map((prayer) => {
            const active = isPrayerActive ? isPrayerActive(prayer.id) : false
            const locked = typeof prayerLevel === 'number' && prayerLevel < prayer.level
            return (
              <button
                key={prayer.id}
                class={'cb-slot' + (active ? ' is-active' : '') + (locked ? ' is-locked' : '')}
                disabled={locked}
                onClick={() => !locked && handlePrayer(prayer)}
              >
                <SkillIcon skill={prayerSkill(prayer)} size={18} />
                <span class="cb-slot__name">{prayer.name}</span>
                <span class="cb-slot__tag">Lv {prayer.level}</span>
                {active && <span class="cb-slot__ring" />}
                {pinged && pinged.id === prayer.id ? <span key={pinged.n} class="cb-slot__ping" /> : null}
              </button>
            )
          }))}
      </div>
    </div>
  )
}
