import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import FarmLocationPicker from '../screens/FarmLocationPicker.jsx'
import FarmPatchView from '../screens/FarmPatchView.jsx'

export default function FarmingScreen({ onBack }) {
  const { stats } = useGame()
  const farmingLevel = getLevelFromXP(stats.farming?.xp || 0)

  const [selectedLocation, setSelectedLocation] = useState(null)

  if (selectedLocation) {
    return (
      <FarmPatchView
        locationId={selectedLocation}
        farmingLevel={farmingLevel}
        onBack={() => setSelectedLocation(null)}
      />
    )
  }

  return (
    <FarmLocationPicker
      farmingLevel={farmingLevel}
      onSelectLocation={setSelectedLocation}
      onBack={onBack}
    />
  )
}
