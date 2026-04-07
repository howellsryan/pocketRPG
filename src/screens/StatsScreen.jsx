import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP, getLevelProgress, getXPToNextLevel } from '../engine/experience.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { formatNumber } from '../utils/helpers.js'
import { COMBAT_SKILLS, GATHERING_SKILLS, PRODUCTION_SKILLS, UTILITY_SKILLS, SKILL_ICONS, STUB_SKILLS } from '../utils/constants.js'
import SkillBadge from '../components/SkillBadge.jsx'
import { useState } from 'preact/hooks'
import Modal from '../components/Modal.jsx'

function SkillGroup({ title, skills, stats, onSelect }) {
  return (
    <div class="mb-4">
      <h3 class="text-[10px] font-bold text-[var(--color-parchment)] opacity-40 uppercase tracking-widest mb-1.5">
        {title}
      </h3>
      <div class="grid grid-cols-2 gap-1.5">
        {skills.map(skill => {
          const data = stats[skill] || { xp: 0, level: 1 }
          return (
            <SkillBadge
              key={skill}
              skill={skill}
              xp={data.xp}
              level={data.level || getLevelFromXP(data.xp)}
              onClick={onSelect}
            />
          )
        })}
      </div>
    </div>
  )
}

export default function StatsScreen() {
  const { stats } = useGame()
  const [selectedSkill, setSelectedSkill] = useState(null)

  const totalLevel = Object.values(stats).reduce((s, d) => s + (d.level || getLevelFromXP(d.xp)), 0)
  const totalXP = Object.values(stats).reduce((s, d) => s + d.xp, 0)

  const selected = selectedSkill ? stats[selectedSkill] : null
  const selLevel = selected ? (selected.level || getLevelFromXP(selected.xp)) : 0
  const selProgress = selected ? getLevelProgress(selected.xp) : 0
  const selToNext = selected ? getXPToNextLevel(selected.xp) : 0

  return (
    <div class="h-full overflow-y-auto p-4">
      {/* Summary */}
      <div class="flex justify-between items-center mb-3 px-1">
        <span class="text-xs text-[var(--color-parchment)] opacity-60">
          Total Level: <span class="font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{totalLevel}</span>
        </span>
        <span class="text-xs text-[var(--color-parchment)] opacity-60">
          Total XP: <span class="font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{formatNumber(totalXP)}</span>
        </span>
      </div>

      <SkillGroup title="Combat" skills={COMBAT_SKILLS} stats={stats} onSelect={setSelectedSkill} />
      <SkillGroup title="Gathering" skills={GATHERING_SKILLS} stats={stats} onSelect={setSelectedSkill} />
      <SkillGroup title="Production" skills={PRODUCTION_SKILLS} stats={stats} onSelect={setSelectedSkill} />
      <SkillGroup title="Utility" skills={UTILITY_SKILLS} stats={stats} onSelect={setSelectedSkill} />

      {/* Skill detail modal */}
      {selectedSkill && selected && (
        <Modal title={`${SKILL_ICONS[selectedSkill]} ${selectedSkill.charAt(0).toUpperCase() + selectedSkill.slice(1)}`} onClose={() => setSelectedSkill(null)}>
          <div class="space-y-3">
            <div class="text-center">
              <div class="text-4xl font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{selLevel}</div>
              <div class="text-xs text-[var(--color-parchment)] opacity-50 mt-1">Current Level</div>
            </div>
            <div class="bg-[#111] rounded-lg p-3 space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-[var(--color-parchment)] opacity-60">Total XP</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatNumber(selected.xp)}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-[var(--color-parchment)] opacity-60">XP to next level</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selLevel >= 99 ? 'MAX' : formatNumber(selToNext)}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-[var(--color-parchment)] opacity-60">Progress</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{(selProgress * 100).toFixed(1)}%</span>
              </div>
            </div>
            {STUB_SKILLS.has(selectedSkill) && (
              <div class="text-xs text-center text-[var(--color-parchment)] opacity-40 italic">
                This skill is not yet trainable — coming soon!
              </div>
            )}
            {selectedSkill === 'agility' && (
              <div class="bg-[#111] rounded-lg p-3">
                <div class="flex justify-between text-sm">
                  <span class="text-[var(--color-parchment)] opacity-60">🏦 Bank delay</span>
                  <span class="font-[var(--font-mono)] text-[var(--color-gold)]">
                    {formatBankDelay(getAgilityBankDelayMs(selLevel))}
                  </span>
                </div>
                <div class="text-[10px] text-[var(--color-parchment)] opacity-30 mt-1">
                  Time to bank a full inventory during combat
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
