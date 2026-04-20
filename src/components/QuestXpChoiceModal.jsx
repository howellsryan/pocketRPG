import { h } from 'preact'
import { useState } from 'preact/hooks'
import { SKILL_ICONS, COMBAT_SKILLS, ALL_SKILLS } from '../utils/constants.js'
import { getLevelFromXP } from '../engine/experience.js'

const UNIQUE_ALL_SKILLS = [...new Set(ALL_SKILLS)]

export default function QuestXpChoiceModal({ rewards, questName, stats, onComplete }) {
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState([])

  const current = rewards[step]
  const isLast = step === rewards.length - 1
  const skillList = current.type === 'combat' ? COMBAT_SKILLS : UNIQUE_ALL_SKILLS

  function pick(skill) {
    const updated = [...chosen, { skill, xp: current.amount }]
    if (isLast) {
      onComplete(updated)
    } else {
      setChosen(updated)
      setStep(step + 1)
    }
  }

  const label = current.type === 'combat' ? 'a combat skill' : 'any skill'

  return (
    <div class="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
      <div class="absolute inset-0 bg-black/80" />
      <div class="relative w-full sm:max-w-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)] rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header — no close button, must choose */}
        <div class="px-4 pt-4 pb-3 border-b border-[var(--color-void-border)] text-center">
          <div class="text-xs text-[var(--color-gold)] uppercase tracking-widest mb-1 opacity-70">📜 Quest Complete</div>
          <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-parchment)]">{questName}</h2>
        </div>

        {/* Prompt */}
        <div class="px-4 py-3 text-center border-b border-[#222]">
          <p class="text-sm text-[var(--color-parchment)]">
            Choose {label} to receive{' '}
            <span class="text-[var(--color-gold)] font-bold">{current.amount.toLocaleString()} XP</span>
          </p>
          {rewards.length > 1 && (
            <p class="text-xs text-[var(--color-parchment)] opacity-40 mt-1">
              Choice {step + 1} of {rewards.length}
            </p>
          )}
        </div>

        {/* Skill grid */}
        <div class="flex-1 overflow-y-auto p-3">
          <div class={`grid gap-2 ${current.type === 'combat' ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {skillList.map(skill => {
              const lvl = getLevelFromXP(stats?.[skill]?.xp || 0)
              return (
                <button
                  key={skill}
                  onClick={() => pick(skill)}
                  class="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-xl border border-[var(--color-void-border)] bg-[#111] hover:border-[var(--color-gold)] hover:bg-[#1c1c1c] active:bg-[#222] transition-colors p-2"
                >
                  <span class="text-2xl leading-none">{SKILL_ICONS[skill]}</span>
                  <span class="text-xs font-bold text-[var(--color-parchment)] capitalize">{skill}</span>
                  <span class="text-[10px] text-[var(--color-gold)] opacity-60">Lv {lvl}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
