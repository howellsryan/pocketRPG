import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { calcCombatLevel, formatNumber } from '../utils/helpers.js'
import { getLevelFromXP, getLevelProgress, getXPToNextLevel } from '../engine/experience.js'
import { getAgilityBankDelayMs, formatBankDelay } from '../engine/agility.js'
import { COMBAT_SKILLS, GATHERING_SKILLS, PRODUCTION_SKILLS, UTILITY_SKILLS, STUB_SKILLS } from '../utils/constants.js'
import { getSkillArt } from '../utils/skillArt.js'
import Modal from '../components/Modal.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillEmblem from '../components/SkillEmblem.jsx'
import GildedComplete from '../components/GildedComplete.jsx'
import { isSkillMaxed } from '../utils/completion.js'

const SKILL_GROUPS = [
  { title: 'Combat', skills: COMBAT_SKILLS },
  { title: 'Gathering', skills: GATHERING_SKILLS },
  { title: 'Production', skills: PRODUCTION_SKILLS },
  { title: 'Utility', skills: UTILITY_SKILLS },
]

function titleCase(skill) {
  return skill.charAt(0).toUpperCase() + skill.slice(1)
}

function SkillCard({ skill, level, progress, toNext, onClick }) {
  const art = getSkillArt(skill)
  const isMax = isSkillMaxed(level)
  return (
    <GildedComplete complete={isMax} className="rounded-[10px]">
      <button class="skill-card" onClick={() => onClick(skill)} aria-label={`${titleCase(skill)}, level ${level}`}>
        <SkillEmblem class="skill-card__emblem" iconKey={art.icon} accent={art.accent} size={38} glow={0} />
        <div class="skill-card__top">
          <div class="skill-card__name">
            <span>{titleCase(skill)}</span>
          </div>
          <div class="skill-card__level">{level}</div>
        </div>
        <div class="skill-card__bottom">
          <div class="xp-track"><div class="xp-fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div class={isMax ? 'xp-meta xp-meta--max' : 'xp-meta'}>
            {isMax ? 'MAX' : `${formatNumber(toNext)} to ${level + 1}`}
          </div>
        </div>
      </button>
    </GildedComplete>
  )
}

export default function HomeScreen({ onNavigate, onLogout, onManualSave, isCloudAccount, removeAds, identityId, characterId, stripeLinks }) {
  const { player, stats } = useGame()
  const [loggingOut, setLoggingOut] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedSkillDetail, setSelectedSkillDetail] = useState(null)

  async function handleLogout() {
    if (loggingOut || saving) return
    setLoggingOut(true)
    try { await onLogout() } finally { setLoggingOut(false) }
  }

  async function handleManualSave() {
    if (!onManualSave || saving || loggingOut) return
    setSaving(true)
    try { await onManualSave() } finally { setSaving(false) }
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
  const selArt = selectedSkillDetail ? getSkillArt(selectedSkillDetail) : null

  const saveDisabled = saving || loggingOut || !onManualSave

  return (
    <div class="h-full flex flex-col">
      {/* Welcome card with rune save/logout buttons */}
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <div class="welcome-card">
          <div class="welcome-card__top">
            <h1 class="welcome-card__title">Welcome, {player.name}</h1>
            <div class="welcome-card__actions welcome-card__actions--header">
              <button
                class="rune-btn"
                onClick={handleManualSave}
                disabled={saveDisabled}
                aria-label="Save game"
                title={saving ? 'Saving…' : 'Save your chronicle'}
              >
                <GameIcon iconKey="save" color="#f0c040" size={24} title="Save" />
              </button>
              <button
                class="rune-btn"
                onClick={handleLogout}
                disabled={loggingOut || saving}
                aria-label="Log out"
                title={isCloudAccount && loggingOut ? 'Saving…' : 'Log out'}
              >
                <GameIcon iconKey="door" color="#e8d5a8" size={24} title="Log out" />
              </button>
            </div>
          </div>
          <div class="welcome-card__bottom">
            <div class="welcome-card__stats">
              <span class="wstat">
                <span class="wstat__icon"><GameIcon iconKey="combat_level" size={20} title="Combat level" /></span>
                Combat <b>{combatLevel}</b>
              </span>
              <div class="welcome-card__actions welcome-card__actions--inline">
                <button
                  class="rune-btn"
                  onClick={handleManualSave}
                  disabled={saveDisabled}
                  aria-label="Save game"
                  title={saving ? 'Saving…' : 'Save your chronicle'}
                >
                  <GameIcon iconKey="save" color="#f0c040" size={24} title="Save" />
                </button>
                <button
                  class="rune-btn"
                  onClick={handleLogout}
                  disabled={loggingOut || saving}
                  aria-label="Log out"
                  title={isCloudAccount && loggingOut ? 'Saving…' : 'Log out'}
                >
                  <GameIcon iconKey="door" color="#e8d5a8" size={24} title="Log out" />
                </button>
              </div>
              <span class="wstat">
                <span class="wstat__icon"><GameIcon iconKey="progression" color="#9aa7b0" size={16} title="Total level" /></span>
                Total <b>{totalLevel.toLocaleString()}</b>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable skill grid */}
      <div class="flex-1 overflow-y-auto px-4 pb-4">
        {/* Hero emblem band */}
        <div class="hero-band">
          <div class="hero-total">
            <span class="hero-total__label">Total Level</span>
            <b>{totalLevel.toLocaleString()}</b>
          </div>
          <div class="hero-total hero-total--right">
            <span class="hero-total__label">Total XP</span>
            <b>{formatNumber(totalXP)}</b>
          </div>
        </div>

        {SKILL_GROUPS.map(group => (
          <div key={group.title}>
            <div class="section-head">
              <span>{group.title}</span>
              <div class="section-head__rule" />
            </div>
            <div class="skill-grid">
              {group.skills.map(skill => {
                const data = stats[skill] || { xp: 0, level: 1 }
                const level = data.level || getLevelFromXP(data.xp)
                return (
                  <SkillCard
                    key={`${group.title}-${skill}`}
                    skill={skill}
                    level={level}
                    progress={getLevelProgress(data.xp)}
                    toNext={getXPToNextLevel(data.xp)}
                    onClick={setSelectedSkillDetail}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Skill detail modal */}
      {selectedSkillDetail && selectedSkillData && (
        <Modal title={titleCase(selectedSkillDetail)} onClose={() => setSelectedSkillDetail(null)}>
          <div class="space-y-3">
            <div class="skill-detail__hero">
              <SkillEmblem iconKey={selArt.icon} accent={selArt.accent} size={64} glow={0} />
              <div class="skill-detail__lvl">Level <b>{selLevel}</b> / 99</div>
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
            <div class="xp-track" style={{ height: 9 }}>
              <div class="xp-fill" style={{ width: `${Math.round(selProgress * 100)}%` }} />
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
