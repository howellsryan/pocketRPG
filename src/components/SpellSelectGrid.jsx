import spellsData from '../data/spells.json'
import { hasRequiredRunes } from '../engine/runes.js'

// Shared combat-spell picker. Renders standard-spellbook combat spells in the
// same card grid the prayer modal uses (the `cb-pray*` classes from index.css),
// so the spell picker matches the prayer picker in BOTH PvE (CombatScreen) and
// PvP (PvpCombatScreen). Each screen supplies its own container (PvE a Modal,
// PvP an inline Card/panel) and its own onSelect dispatch — the spell list,
// level/rune gating, sorting and card markup live here once.

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : ''
}

// "5x Fire, 2x Air, 1x Chaos" from a runeReq map.
function formatRuneReq(runeReq) {
  if (!runeReq) return ''
  return Object.entries(runeReq)
    .map(([runeId, qty]) => `${qty}x ${capitalize(String(runeId).split('_')[0])}`)
    .join(', ')
}

// All standard combat spells, ordered low → high level. Computed once per render;
// spellsData is a static import so this is cheap.
function combatSpells() {
  return Object.values(spellsData)
    .filter((spell) => spell && typeof spell.baseDamage === 'number')
    .sort((a, b) => (Number(a.levelReq) || 0) - (Number(b.levelReq) || 0))
}

/**
 * @param {number}  magicLevel    - caster's Magic level (level gate)
 * @param {string?} activeSpellId - currently selected spell id (shows ✓ + is-on)
 * @param {(spell:object)=>void} onSelect - tapped a castable spell
 * @param {boolean} requireRunes  - also gate on rune availability (PvP). When
 *                                  true, inventory/equipment/itemsData are used
 *                                  with the shared hasRequiredRunes() check so an
 *                                  equipped elemental staff still frees its rune.
 * @param {Array}   inventory     - caster inventory (only when requireRunes)
 * @param {object}  equipment     - caster equipment (only when requireRunes)
 * @param {object}  itemsData     - items.json lookup (only when requireRunes)
 */
export default function SpellSelectGrid({
  magicLevel = 1,
  activeSpellId = null,
  onSelect,
  requireRunes = false,
  inventory = null,
  equipment = null,
  itemsData = null,
}) {
  return (
    <div class="cb-praygrid">
      {combatSpells().map((spell) => {
        const levelOk = (Number(magicLevel) || 1) >= (Number(spell.levelReq) || 1)
        const runesOk = !requireRunes
          || hasRequiredRunes(spell.runeReq, inventory || [], {}, equipment || {}, itemsData)
        const canCast = levelOk && runesOk
        const isActive = activeSpellId === spell.id
        const runeText = formatRuneReq(spell.runeReq)
        const tierText = spell.tier ? `${capitalize(spell.tier)} · ` : ''
        return (
          <button
            key={spell.id}
            type="button"
            onClick={() => canCast && onSelect && onSelect(spell)}
            disabled={!canCast}
            aria-pressed={isActive}
            class={'cb-prayer' + (isActive ? ' is-on' : '') + (!canCast ? ' is-locked' : '')}
          >
            <span class="cb-prayer__name">🔮 {spell.name}</span>
            <span class="cb-prayer__desc">{tierText}Dmg {spell.baseDamage}{runeText ? ` · ${runeText}` : ''}</span>
            <span class="cb-prayer__lv">Lv {spell.levelReq}</span>
            {isActive && <span class="cb-prayer__chk">✓</span>}
          </button>
        )
      })}
    </div>
  )
}
