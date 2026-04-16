import farmingData from '../data/farming.json'

export default function FarmLocationPicker({ farmingLevel, onSelectLocation }) {
  return (
    <div className="flex flex-col h-full">
      <div className="bg-gradient-to-r from-green-700 to-green-600 text-white p-4">
        <h1 className="text-2xl font-bold">🌿 Farming</h1>
        <p className="text-green-100">Level: {farmingLevel}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {farmingData.locations.map(location => (
          <button
            key={location.id}
            onClick={() => onSelectLocation(location.id)}
            className="w-full bg-green-50 hover:bg-green-100 border border-green-300 rounded p-4 text-left transition"
          >
            <div className="font-bold text-green-900">{location.name}</div>
            <div className="text-sm text-green-700 mt-1">
              {location.patches.map(p => `${p.count}x ${p.type}`).join(', ')}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
