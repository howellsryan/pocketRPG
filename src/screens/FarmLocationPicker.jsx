import farmingData from '../data/farming.json'

export default function FarmLocationPicker({ farmingLevel, onSelectLocation }) {
  return (
    <div className="flex flex-col h-full">
      <div style={{ background: 'linear-gradient(135deg, var(--color-emerald-mid), var(--color-emerald))', padding: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--color-gold-light)', marginBottom: '4px' }}>🌿 Farming</h1>
        <p style={{ fontSize: '13px', color: 'var(--color-parchment)', opacity: 0.8 }}>Level: {farmingLevel}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {farmingData.locations.map(location => (
          <button
            key={location.id}
            onClick={() => onSelectLocation(location.id)}
            style={{
              width: '100%',
              background: 'var(--color-void-lighter)',
              border: '1px solid var(--color-void-border)',
              borderRadius: '8px',
              padding: '12px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-emerald-light)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-void-border)'}
          >
            <div style={{ fontWeight: '600', color: 'var(--color-gold-light)' }}>{location.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--color-parchment)', opacity: 0.7, marginTop: '4px' }}>
              {location.patches.map(p => `${p.count}x ${p.type}`).join(', ')}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
