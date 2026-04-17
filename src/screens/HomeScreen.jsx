import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { calcCombatLevel, formatNumber } from '../utils/helpers.js'
import { getLevelFromXP } from '../engine/experience.js'
import { SCREENS } from '../utils/constants.js'
import Modal from '../components/Modal.jsx'

const DEFAULT_SHORTCUTS = [
  { label: 'Fight Monsters', icon: '⚔️', screen: SCREENS.COMBAT },
  { label: 'Train Skills', icon: '🔨', screen: SCREENS.SKILLS },
  { label: 'Gather Resources', icon: '🌿', screen: SCREENS.GATHER },
  { label: 'Open Bank', icon: '🏦', screen: SCREENS.BANK },
  { label: 'View Stats', icon: '📊', screen: SCREENS.STATS },
  { label: 'Inventory', icon: '🎒', screen: SCREENS.INVENTORY },
  { label: 'Equipment', icon: '🛡️', screen: SCREENS.EQUIPMENT },
]

export default function HomeScreen({ onNavigate, onLogout, isCloudAccount }) {
  const { player, stats, homeShortcuts, updateHomeShortcuts } = useGame()
  const [removeConfirm, setRemoveConfirm] = useState(null)
  const [loggingOut, setLoggingOut] = useState(false)

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
  const combatLevel = calcCombatLevel({
    attack: levels.attack || 1, strength: levels.strength || 1,
    defence: levels.defence || 1, hitpoints: levels.hitpoints || 10,
    prayer: levels.prayer || 1, ranged: levels.ranged || 1, magic: levels.magic || 1
  })

  const shortcuts = homeShortcuts ?? DEFAULT_SHORTCUTS

  const handleRemove = (sc) => {
    setRemoveConfirm(sc)
  }

  const confirmRemove = () => {
    const next = shortcuts.filter(s => !(s.screen === removeConfirm.screen && s.label === removeConfirm.label))
    updateHomeShortcuts(next)
    setRemoveConfirm(null)
  }

  const handleShortcutClick = (sc) => {
    // Navigate to screen with optional action data
    onNavigate(sc.screen, {
      monsterId: sc.monsterId,
      raidId: sc.raidId,
      gatherTaskId: sc.gatherTaskId,
      skillId: sc.skillId,
      actionId: sc.actionId
    })
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px' }}>
      {/* Welcome card */}
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

      {/* Quick actions */}
      <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 'bold', color: '#e8d5b0', marginBottom: '8px', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        Quick Actions
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
        {shortcuts.map((sc, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <button
              onClick={() => handleShortcutClick(sc)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', paddingRight: '28px', borderRadius: '12px', background: '#1a1a1a', border: '1px solid #2a2a2a', cursor: 'pointer', width: '100%' }}
            >
              <span style={{ fontSize: '20px' }}>{sc.icon}</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#e8d5b0', textAlign: 'left' }}>{sc.label}</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRemove(sc) }}
              style={{
                position: 'absolute', top: '4px', right: '4px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: 'rgba(180,40,40,0.85)', border: 'none',
                color: '#fff', fontSize: '10px', lineHeight: '1',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 2
              }}
              aria-label={`Remove ${sc.label}`}
            >
              ✕
            </button>
          </div>
        ))}
        {shortcuts.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '24px', color: '#e8d5b0', opacity: 0.3, fontSize: '13px' }}>
            No shortcuts. Add them from the monster or skill screens.
          </div>
        )}
      </div>

      {/* Combat stats */}
      <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 'bold', color: '#e8d5b0', marginBottom: '8px', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        Combat Stats
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
        {[['attack','⚔️'],['strength','💪'],['defence','🛡️'],['hitpoints','❤️'],['ranged','🏹'],['magic','✨'],['prayer','🙏']].map(([skill, icon]) => (
          <div key={skill} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px', borderRadius: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <span style={{ fontSize: '16px' }}>{icon}</span>
            <span style={{ fontSize: '18px', fontFamily: 'monospace', fontWeight: 'bold', color: '#d4af37' }}>{levels[skill] || 1}</span>
            <span style={{ fontSize: '8px', color: '#e8d5b0', opacity: 0.4, textTransform: 'uppercase' }}>{skill.slice(0,3)}</span>
          </div>
        ))}
      </div>

      {/* Remove confirmation modal */}
      {removeConfirm && (
        <Modal title="Remove Shortcut" onClose={() => setRemoveConfirm(null)}>
          <div class="space-y-4 text-center">
            <p class="text-[var(--color-parchment)] text-sm opacity-70">
              Remove <span class="text-[var(--color-gold)] font-semibold">{removeConfirm.icon} {removeConfirm.label}</span> from your home screen?
            </p>
            <div class="grid grid-cols-2 gap-3">
              <button
                onClick={() => setRemoveConfirm(null)}
                class="py-2.5 rounded-lg bg-[#222] text-[var(--color-parchment)] font-semibold text-sm border border-[#333]"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemove}
                class="py-2.5 rounded-lg bg-[var(--color-blood)]/70 text-white font-semibold text-sm"
              >
                Remove
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
