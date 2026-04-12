import { SCREENS } from '../utils/constants.js'

const tabs = [
  { id: SCREENS.HOME,      label: 'Home',    icon: '🏠' },
  { id: SCREENS.STATS,     label: 'Stats',   icon: '📊' },
  { id: SCREENS.INVENTORY, label: 'Items',   icon: '🎒' },
  { id: SCREENS.EQUIPMENT, label: 'Equip',   icon: '🛡️' },
  { id: SCREENS.BANK,      label: 'Bank',    icon: '🏦' },
  { id: SCREENS.STORE,     label: 'Store',   icon: '🪙' },
  { id: SCREENS.GATHER,    label: 'Gather',  icon: '🌿' },
  { id: SCREENS.COMBAT,    label: 'Combat',  icon: '⚔️' },
  { id: SCREENS.SKILLS,    label: 'Skills',  icon: '🔨' },
]

export default function BottomNav({ active, onNavigate, isInBossFight, onDisabledClick }) {
  return (
    <nav style={{ flexShrink: 0, background: '#111', borderTop: '1px solid #333', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: '52px' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              if (isInBossFight) {
                onDisabledClick?.()
              } else {
                onNavigate(tab.id)
              }
            }}
            disabled={isInBossFight}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              height: '100%',
              border: 'none',
              background: 'transparent',
              color: active === tab.id ? '#d4af37' : '#e8d5b0',
              opacity: isInBossFight ? 0.2 : active === tab.id ? 1 : 0.45,
              cursor: isInBossFight ? 'not-allowed' : 'pointer',
              padding: 0,
              transition: 'opacity 0.1s',
            }}
          >
            <span style={{ fontSize: '16px', lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: '9px', fontWeight: '600', marginTop: '2px', fontFamily: 'Nunito, sans-serif' }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
