import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { calcCombatLevel, formatNumber } from '../utils/helpers.js'
import { getLevelFromXP, getLevelProgress, getXPToNextLevel } from '../engine/experience.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { SCREENS, COMBAT_SKILLS, GATHERING_SKILLS, PRODUCTION_SKILLS, UTILITY_SKILLS, SKILL_ICONS, STUB_SKILLS } from '../utils/constants.js'
import Modal from '../components/Modal.jsx'
import SkillBadge from '../components/SkillBadge.jsx'

export default function HomeScreen({ onNavigate, onLogout, isCloudAccount, removeAds, identityId, characterId, stripeLinks }) {
  const { player, stats, setActiveTask, equipment, inventory, itemsData } = useGame()
  const [loggingOut, setLoggingOut] = useState(false)
  const [selectedSkillDetail, setSelectedSkillDetail] = useState(null)

  async function handleLogout() {
    setLoggingOut(true)
    try { await onLogout() } finally { setLoggingOut(false) }
  }

  if (!player) return null

  const levels = {}
  for (const [skill, data] of Object.entries(stats)) {
    levels[skill] = data.level || getLevelFromXP(data.xp)
  }
  const totalLevel = Object.values(levels).reduce((s, l) => s + l, 0)
  const totalXP = Object.values(stats).reduce((s, d) => s + d.xp, 0)
  const combatLevel = calcCombatLevel({
    attack: levels.attack || 1, strength: levels.strength || 1,
    defence: levels.defence || 1, hitpoints: levels.hitpoints || 10,
    prayer: levels.prayer || 1, ranged: levels.ranged || 1, magic: levels.magic || 1
  })

  const selectedSkillData = selectedSkillDetail ? stats[selectedSkillDetail] : null
  const selLevel = selectedSkillData ? (selectedSkillData.level || getLevelFromXP(selectedSkillData.xp)) : 0
  const selProgress = selectedSkillData ? getLevelProgress(selectedSkillData.xp) : 0
  const selToNext = selectedSkillData ? getXPToNextLevel(selectedSkillData.xp) : 0

  const handleSkillSelect = (skill) => {
    setSelectedSkillDetail(skill)
  }

  function SkillGroup({ title, skills }) {
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
                onClick={handleSkillSelect}
              />
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div class="h-full flex flex-col">
      {/* Welcome card and section tabs */}
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <div style={{ background: 'linear-gradient(135deg, #1a1a1a, #0f0f0f)', borderRadius: '14px', border: '1px solid #333', padding: '16px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontFamily: 'Cinzel, serif', fontSize: '18px', fontWeight: 'bold', color: '#d4af37', marginBottom: '4px' }}>
              Welcome, {player.name}
            </h1>
            <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#e8d5b0', opacity: 0.7 }}>
              <span>⚔️ Combat {combatLevel}</span>
              <span>📊 Total {totalLevel}</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #333', borderRadius: '8px', padding: '6px 10px', fontSize: '11px', color: '#e8d5b0', opacity: loggingOut ? 0.4 : 0.7, cursor: loggingOut ? 'default' : 'pointer' }}
          >
            {isCloudAccount && loggingOut ? '☁️ Saving...' : '🚪 Logout'}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div class="flex-1 overflow-y-auto px-4 pb-4">
        <div class="py-4">
          <div class="flex justify-between items-center mb-3 px-1">
            <span class="text-xs text-[var(--color-parchment)] opacity-60">
              Total Level: <span class="font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{totalLevel}</span>
            </span>
            <span class="text-xs text-[var(--color-parchment)] opacity-60">
              Total XP: <span class="font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{formatNumber(totalXP)}</span>
            </span>
          </div>
          <SkillGroup title="Combat" skills={COMBAT_SKILLS} />
          <SkillGroup title="Gathering" skills={GATHERING_SKILLS.filter(s => s !== 'farming')} />
          <SkillGroup title="Production" skills={PRODUCTION_SKILLS} />
          <SkillGroup title="Utility" skills={UTILITY_SKILLS} />
        </div>
      </div>

      {/* Skill detail modal */}
      {selectedSkillDetail && selectedSkillData && (
        <Modal title={`${SKILL_ICONS[selectedSkillDetail]} ${selectedSkillDetail.charAt(0).toUpperCase() + selectedSkillDetail.slice(1)}`} onClose={() => setSelectedSkillDetail(null)}>
          <div class="space-y-3">
            <div class="text-center">
              <div class="text-4xl font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{selLevel}</div>
              <div class="text-xs text-[var(--color-parchment)] opacity-50 mt-1">Current Level</div>
            </div>
            <div class="bg-[#111] rounded-lg p-3 space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-[var(--color-parchment)] opacity-60">Total XP</span>
                <span class="font-[var(--font-mono)] text-[var(--color-gold)]">{formatNumber(selectedSkillData.xp)}</span>
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
            {STUB_SKILLS.has(selectedSkillDetail) && (
              <div class="text-xs text-center text-[var(--color-parchment)] opacity-40 italic">
                This skill is not yet trainable — coming soon!
              </div>
            )}
            {selectedSkillDetail === 'agility' && (
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
