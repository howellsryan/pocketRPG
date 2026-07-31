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

/** Every sampler in the GLB, as { clip, times, values } counts. Read straight
 * from the JSON chunk so this checks the SHIPPED bytes, not what a build script
 * believed it wrote. */
function samplerCounts(glbPath: string): Array<{ clip: string; times: number; values: number }> {
  const buf = readFileSync(glbPath)
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'))
  const out: Array<{ clip: string; times: number; values: number }> = []
  for (const clip of json.animations ?? []) {
    for (const sampler of clip.samplers) {
      out.push({
        clip: clip.name,
        times: json.accessors[sampler.input]?.count ?? -1,
        values: json.accessors[sampler.output]?.count ?? -1,
      })
    }
  }
  return out
}

describe('every one of Zaryth\'s styles swings with the same clip', () => {
  // Its own melee clip rears up, strikes, and then COLLAPSES to the floor over
  // its last two seconds and holds there — a knock-down tail with no recovery,
  // and trimmed at the follow-through it read as a slow reach. It rerolls its
  // style every swing, so that was a third of everything you ever saw it do.
  // The build script therefore ships `attack` as a copy of `attack_ranged`, and
  // the shared clip table (src/engine/monsterClips.js) sends the arena's melee
  // style to the same clip, so both render paths swing alike.
  it('ships Zaryth\'s melee clip as a copy of its ranged one', () => {
    const url = MONSTER_MODELS.zaryth_the_empty_lord.url
    const path = fileURLToPath(new URL(`../client/public${url}`, import.meta.url))
    const melee = clipDurationSec(path, 'attack')
    expect(melee).toBeGreaterThan(0)
    expect(melee).toBe(clipDurationSec(path, 'attack_ranged'))
    // The strike the wind-up is aligned to has to fall inside the clip that
    // actually plays, or the splat is aimed at a frame that never arrives.
    const impact = MONSTER_MODELS.zaryth_the_empty_lord.attackImpactSec as number
    expect(impact).toBeGreaterThan(0)
    expect(melee).toBeGreaterThanOrEqual(impact)
  })
})

describe('shipped monster rigs are structurally sound', () => {
  // Zaryth's world GLB shipped with 107 of its die clip's 123 samplers holding
  // more values than keyframe times, plus one broken sampler in every OTHER
  // clip. A build step had sliced accessors in place, and dedup() had already
  // merged those arrays across samplers and across clips, so the cut landed on
  // data other tracks still pointed at. THREE throws building a KeyframeTrack
  // from a mismatched pair, which took the entire world client down as soon as
  // the model loaded — the boss was unplayable in the open world.
  //
  // Structural over every registered model: a build script that corrupts an
  // asset fails here rather than in a player's browser.
  it('gives every sampler one value per keyframe time', () => {
    for (const [monsterId, spec] of Object.entries(MONSTER_MODELS)) {
      const path = fileURLToPath(new URL(`../client/public${spec.url}`, import.meta.url))
      const broken = samplerCounts(path).filter((s) => s.times !== s.values)
      expect(broken, `${monsterId} has ${broken.length} corrupt samplers`).toEqual([])
    }
  })

  it('ships a rig with animation data at all', () => {
    // Guards the check above from passing vacuously on an empty animation list.
    for (const [monsterId, spec] of Object.entries(MONSTER_MODELS)) {
      const path = fileURLToPath(new URL(`../client/public${spec.url}`, import.meta.url))
      expect(samplerCounts(path).length, `${monsterId} ships no animation samplers`).toBeGreaterThan(0)
    }
  })
})
