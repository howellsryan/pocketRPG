import Modal from './Modal.jsx'
import GameIcon from './GameIcon.jsx'
import SkillIcon from './SkillIcon.jsx'
import { prayerSkill } from '../utils/prayerIcons.js'
import prayersData from '../data/prayers.json'

// The ✏️ on the combat Prayers tab. Shared by the solo and group fights —
// CombatQuickActions renders the pencil whenever `onPrayer` is supplied, so any
// screen with a Prayers tab needs this or the button is a dead tap.
export default function QuickPrayerConfigModal({ prayerLevel, selected, onChange, onClose }) {
  const picked = Array.isArray(selected) ? selected : []
  const toggle = (prayerId) => {
    onChange(picked.includes(prayerId) ? picked.filter((id) => id !== prayerId) : [...picked, prayerId])
  }
  const protectionPrayers = Object.values(prayersData).filter((p) => p.bonusType === 'protection')
  const combatPrayers = Object.values(prayersData)
    .filter((p) => p.bonusType !== 'protection')
    .sort((a, b) => b.level - a.level)

  return (
    <Modal onClose={onClose}>
      <div class="cb-prayhead">
        <h3>Quick Prayers</h3>
        <button onClick={onClose} class="cb-x" aria-label="Close">
          <GameIcon iconKey="cancel" color="var(--text-soft)" size={16} />
        </button>
      </div>

      <div class="max-h-96 overflow-y-auto">
        <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mb-2 px-0.5">Pick the prayers to show in the combat Prayers tab.</p>
        <div class="cb-praysec">Protection</div>
        <div class="cb-praygrid cb-praygrid--prot">
          {protectionPrayers.map((prayer) => {
            const canUse = prayerLevel >= prayer.level
            const isPicked = picked.includes(prayer.id)
            const protectType = prayer.style === 'magic' ? 'Magic' : prayer.style === 'ranged' ? 'Ranged' : 'Melee'
            return (
              <button
                key={prayer.id}
                onClick={() => canUse && toggle(prayer.id)}
                disabled={!canUse}
                class={'cb-prayer' + (isPicked ? ' is-on' : '') + (!canUse ? ' is-locked' : '')}
                style={{ alignItems: 'center', textAlign: 'center', minHeight: 64 }}
              >
                <span class="cb-prayer__name" style={{ justifyContent: 'center', gap: '4px' }}><SkillIcon skill={prayerSkill(prayer)} size={14} /> Protect</span>
                <span class="cb-prayer__desc" style={{ textAlign: 'center', width: '100%' }}>{protectType}</span>
                <span class="cb-prayer__lv" style={{ margin: '0 auto' }}>Lv {prayer.level}</span>
                {isPicked && <span class="cb-prayer__chk">✓</span>}
              </button>
            )
          })}
        </div>

        <div class="cb-praysec">Combat</div>
        <div class="cb-praygrid">
          {combatPrayers.map((prayer) => {
            const canUse = prayerLevel >= prayer.level
            const isPicked = picked.includes(prayer.id)
            return (
              <button
                key={prayer.id}
                onClick={() => canUse && toggle(prayer.id)}
                disabled={!canUse}
                class={'cb-prayer' + (isPicked ? ' is-on' : '') + (!canUse ? ' is-locked' : '')}
              >
                <span class="cb-prayer__name" style={{ gap: '4px' }}><SkillIcon skill={prayerSkill(prayer)} size={14} /> {prayer.name}</span>
                <span class="cb-prayer__desc">{prayer.description}</span>
                <span class="cb-prayer__lv">Lv {prayer.level}</span>
                {isPicked && <span class="cb-prayer__chk">✓</span>}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
