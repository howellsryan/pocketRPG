// Warlord Grondar's death animation never played. Two independent causes, one
// regression each below:
//   1. resolveGltfAnim gated every non-attack anim behind `!attackPlaying`, and
//      Grondar's attack clip (6.625s) outlasts his attack cycle (5 ticks = 3.0s),
//      so a swing was always mid-flight and `die` was never handed to the mixer.
//   2. the corpse was removed 3 ticks (1.8s) after death, shorter than the
//      3.042s die clip, so even a playing death was cut off.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveGltfAnim } from '../client/src/motion'
import { NPC_REMOVE_AFTER_DEATH_TICKS } from '../server/combat'
import { MONSTER_MODELS } from '../shared/monsterModels'

const TICK_MS = 600

describe('resolveGltfAnim death precedence', () => {
  it('hands the mixer the death clip even while an attack clip is still running', () => {
    expect(resolveGltfAnim('die', false, true, true)).toEqual({ fireSwing: false, latched: false, playBase: true })
  })

  it('plays the death clip while the corpse is still finishing a movement segment', () => {
    expect(resolveGltfAnim('die', true, false, true).playBase).toBe(true)
  })

  it('still suppresses the base anim for a non-death state under a running swing', () => {
    expect(resolveGltfAnim('idle', false, false, true).playBase).toBe(false)
  })
})

/** Longest keyframe time across a clip's samplers, straight out of the GLB's
 * JSON chunk — no three.js/DOM needed. */
function clipDurationSec(glbPath: string, clipName: string): number | null {
  const buf = readFileSync(glbPath)
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'))
  const clip = (json.animations ?? []).find((a: { name: string }) => a.name === clipName)
  if (!clip) return null
  let max = 0
  for (const sampler of clip.samplers) {
    const input = json.accessors[sampler.input]
    if (input?.max) max = Math.max(max, input.max[0])
  }
  return max
}

describe('corpse linger covers the death clip', () => {
  // Structural, not a mirror list: every registered GLB monster is checked
  // against the actual clip in the shipped asset, so swapping a model in with a
  // longer death animation fails here rather than silently truncating in game.
  it('holds every registered monster corpse long enough for its die clip to finish', () => {
    const lingerMs = NPC_REMOVE_AFTER_DEATH_TICKS * TICK_MS
    for (const [monsterId, spec] of Object.entries(MONSTER_MODELS)) {
      const path = fileURLToPath(new URL(`../client/public${spec.url}`, import.meta.url))
      const duration = clipDurationSec(path, 'die')
      if (duration === null) continue
      expect(duration * 1000, `${monsterId} die clip outlasts the corpse linger`).toBeLessThanOrEqual(lingerMs)
    }
  })
})
