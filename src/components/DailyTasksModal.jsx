import { useState, useEffect } from 'preact/hooks'
import Modal from './Modal.jsx'
import GameIcon from './GameIcon.jsx'
import GildedComplete from './GildedComplete.jsx'
import { COMPLEXITY_COLORS, COMPLEXITY_ORDER } from '../utils/complexityColors.js'

function formatCountdown(ms) {
  if (!ms || ms <= 0) return '00:00:00'
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function TierChip({ tier }) {
  const color = COMPLEXITY_COLORS[tier] ?? '#aaa'
  return (
    <span
      class="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
      style={{ background: color + '22', color, border: `1px solid ${color}66` }}
    >
      {tier}
    </span>
  )
}

export default function DailyTasksModal({ onClose, tasks = [], resetInMs = 0, taskPool = [] }) {
  const [remainingMs, setRemainingMs] = useState(resetInMs)

  useEffect(() => {
    setRemainingMs(resetInMs)
    if (!resetInMs || resetInMs <= 0) return
    const id = setInterval(() => setRemainingMs(prev => Math.max(0, prev - 1000)), 1000)
    return () => clearInterval(id)
  }, [resetInMs])

  const sorted = [...tasks].sort((a, b) => {
    const ao = COMPLEXITY_ORDER[a.tier] ?? 99
    const bo = COMPLEXITY_ORDER[b.tier] ?? 99
    return ao - bo
  })

  const completedCount = tasks.filter(t => t.completed).length

  // Build a lookup from taskId → pool definition for name/description/icon
  const poolById = {}
  for (const def of taskPool) poolById[def.id] = def

  return (
    <Modal title="Daily Tasks" onClose={onClose}>
      <div class="space-y-4">
        <div class="flex items-center justify-between text-[12px] text-[var(--color-parchment)] opacity-70">
          <span>{completedCount}/5 complete</span>
          <span>Resets in {formatCountdown(remainingMs)} (UTC)</span>
        </div>

        <div class="space-y-2">
          {sorted.map(task => {
            const def = poolById[task.taskId]
            const name = def?.name ?? task.taskId
            const description = def?.description ?? ''
            const icon = def?.icon ?? task.taskId
            const target = task.target ?? 1
            const progress = task.progress ?? 0
            const done = task.completed || progress >= target
            const color = COMPLEXITY_COLORS[task.tier] ?? '#aaa'

            return (
              <GildedComplete key={task.slot} complete={done}>
                <div
                  class="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)]"
                  style={{ borderLeft: `3px solid ${color}` }}
                >
                  <span class="text-[28px] shrink-0">
                    <GameIcon iconKey={icon} size={28} />
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-[13px] font-semibold text-[var(--color-parchment)] leading-tight">{name}</span>
                      <TierChip tier={task.tier} />
                    </div>
                    {description ? (
                      <div class="text-[11px] text-[var(--color-parchment)] opacity-60 mt-0.5 leading-snug">{description}</div>
                    ) : null}
                    <div class="flex items-center justify-between gap-2 mt-1">
                      {done ? (
                        <span class="text-[11px] font-bold" style={{ color: 'var(--color-gold)' }}>Complete ✓</span>
                      ) : (
                        <span class="text-[11px] text-[var(--color-parchment)] opacity-50">{progress}/{target}</span>
                      )}
                      <span class="shrink-0 text-[12px] font-bold text-[var(--color-gold)]">+1 💎</span>
                    </div>
                  </div>
                </div>
              </GildedComplete>
            )
          })}

          {sorted.length === 0 && (
            <div class="text-center text-[var(--color-parchment)] opacity-50 py-8 text-sm">
              No tasks available. Sign in to a cloud account to get daily tasks.
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
