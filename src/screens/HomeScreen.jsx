import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { calcCombatLevel, formatNumber } from '../utils/helpers.js'
import { getLevelFromXP } from '../engine/experience.js'
import { SCREENS } from '../utils/constants.js'
import Modal from '../components/Modal.jsx'

export default function HomeScreen({ onNavigate, onLogout, isCloudAccount, removeAds, identityId, characterId, stripeLinks }) {
  const { player, stats, setActiveTask, equipment, inventory, itemsData } = useGame()
  const [loggingOut, setLoggingOut] = useState(false)
  const [viewSection, setViewSection] = useState('overview')

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

        {/* Section tabs */}
        <div class="flex gap-2">
          {[
            { id: 'overview', label: 'Overview', icon: '📋' },
            { id: 'stats', label: 'Stats', icon: '📊' },
          ].map(sec => {
            const isActive = viewSection === sec.id
            const tabClass = isActive
              ? 'border-[var(--color-gold)] bg-[rgba(212,175,55,0.15)] text-[var(--color-gold)]'
              : 'border-[#2a2a2a] bg-[var(--color-void-light)] text-[var(--color-parchment)] opacity-60'
            return (
              <button
                key={sec.id}
                onClick={() => setViewSection(sec.id)}
                class={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${tabClass}`}
              >
                {sec.icon} {sec.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content area */}
      <div class="flex-1 overflow-y-auto px-4 pb-4">
        {viewSection === 'overview' && (
          <div>
            <div class="py-4 space-y-3">
              <div class="flex justify-between items-center bg-[#1a1a1a] rounded-lg p-3 border border-[#2a2a2a]">
                <span class="text-sm text-[var(--color-parchment)] opacity-60">Combat Level</span>
                <span class="font-[var(--font-mono)] text-lg font-bold text-[var(--color-gold)]">{combatLevel}</span>
              </div>
              <div class="flex justify-between items-center bg-[#1a1a1a] rounded-lg p-3 border border-[#2a2a2a]">
                <span class="text-sm text-[var(--color-parchment)] opacity-60">Total Level</span>
                <span class="font-[var(--font-mono)] text-lg font-bold text-[var(--color-gold)]">{totalLevel}</span>
              </div>
              <div class="flex justify-between items-center bg-[#1a1a1a] rounded-lg p-3 border border-[#2a2a2a]">
                <span class="text-sm text-[var(--color-parchment)] opacity-60">Total XP</span>
                <span class="font-[var(--font-mono)] text-lg font-bold text-[var(--color-gold)]">{formatNumber(totalXP)}</span>
              </div>
            </div>
          </div>
        )}

        {viewSection === 'stats' && (
          <div class="py-4">
            <div class="flex justify-between items-center mb-3 px-1">
              <span class="text-xs text-[var(--color-parchment)] opacity-60">
                Total Level: <span class="font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{totalLevel}</span>
              </span>
              <span class="text-xs text-[var(--color-parchment)] opacity-60">
                Total XP: <span class="font-[var(--font-mono)] font-bold text-[var(--color-gold)]">{formatNumber(totalXP)}</span>
              </span>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
