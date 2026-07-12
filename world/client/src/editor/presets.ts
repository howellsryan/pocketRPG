import type { ZonePalette, ZoneAmbience } from '../../../shared/zone'

// Named ground-palette and ambience presets surfaced in the editor. Data-driven:
// add an entry and it appears in the dropdown. "Custom" is implicit — editing
// any colour/slider just leaves the preset select on its last match or blank.

export const PALETTE_PRESETS: { name: string; palette: ZonePalette }[] = [
  { name: 'Grass', palette: { walkableA: '#4a7c3a', walkableB: '#568c44', blockedA: '#3a3428', blockedB: '#443d30' } },
  { name: 'Sand', palette: { walkableA: '#d9c48a', walkableB: '#cbb578', blockedA: '#8a7a4e', blockedB: '#7a6c45' } },
  { name: 'Snow', palette: { walkableA: '#e8eef2', walkableB: '#d6dee5', blockedA: '#9aa7b0', blockedB: '#8593a0' } },
  { name: 'Ash', palette: { walkableA: '#4a4a4e', walkableB: '#3f3f43', blockedA: '#2a2a2d', blockedB: '#222225' } },
  { name: 'Night Forest', palette: { walkableA: '#22402a', walkableB: '#2a4c30', blockedA: '#16261a', blockedB: '#1c2f20' } },
  { name: 'Cave', palette: { walkableA: '#4a4238', walkableB: '#413a31', blockedA: '#241f19', blockedB: '#2c2620' } },
]

export const AMBIENCE_PRESETS: { name: string; ambience: ZoneAmbience }[] = [
  { name: 'Day', ambience: { sky: '#87ceeb', hemiIntensity: 1.1, sunIntensity: 1.4 } },
  { name: 'Overcast', ambience: { sky: '#9aa6ad', hemiIntensity: 1.0, sunIntensity: 0.7 } },
  { name: 'Dusk', ambience: { sky: '#e8925a', hemiIntensity: 0.8, sunIntensity: 0.9 } },
  { name: 'Night', ambience: { sky: '#0e1626', hemiIntensity: 0.35, sunIntensity: 0.35 } },
  { name: 'Cave Dark', ambience: { sky: '#0a0a0c', hemiIntensity: 0.3, sunIntensity: 0.5 } },
]

export const DEFAULT_PALETTE = PALETTE_PRESETS[0].palette
export const DEFAULT_AMBIENCE = AMBIENCE_PRESETS[0].ambience

export function matchPalette(p?: ZonePalette): string {
  if (!p) return ''
  const found = PALETTE_PRESETS.find(
    (x) => x.palette.walkableA === p.walkableA && x.palette.walkableB === p.walkableB && x.palette.blockedA === p.blockedA && x.palette.blockedB === p.blockedB
  )
  return found?.name ?? ''
}

export function matchAmbience(a?: ZoneAmbience): string {
  if (!a) return ''
  const found = AMBIENCE_PRESETS.find(
    (x) => x.ambience.sky === a.sky && x.ambience.hemiIntensity === a.hemiIntensity && x.ambience.sunIntensity === a.sunIntensity
  )
  return found?.name ?? ''
}
