import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import placeMaps from '../src/data/placeMaps.json'
import { getWorld } from '../src/engine/world.js'
import { SCREENS } from '../src/utils/constants.js'
import { placeActivities, placesForActivity, isPlaceVaryingSkillRef, FACILITY_SKILL_MAP, FACILITY_SKILLS } from '../src/engine/worldContent.js'
import { getPlaceMap, placeHasMap, resolveSpotRefs, describeSpot, spotType, BANK_TRAINING_SKILLS, facilityTrainingSkill } from '../src/engine/placeMaps.js'
import { SKILL_ART } from '../src/utils/skillArt.js'

const mapped = Object.keys(placeMaps)
const activitySpots = (id: string) => getPlaceMap(id)!.spots.filter((s: any) => spotType(s) === 'activity')

describe('placeMaps data', () => {
  it('every mapped place exists in world.json', () => {
    const places = getWorld().places
    for (const id of mapped) expect(places[id], `placeMaps key "${id}"`).toBeTruthy()
  })

  it('every map has a committed image and positive dimensions', () => {
    for (const id of mapped) {
      const map = getPlaceMap(id)!
      expect(map.w).toBeGreaterThan(0)
      expect(map.h).toBeGreaterThan(0)
      // image URLs are '/public/...' paths served from the repo root
      const file = path.join(__dirname, '..', map.image.replace(/^\//, ''))
      expect(fs.existsSync(file), `${id} image ${map.image}`).toBe(true)
    }
  })

  it('every spot sits inside its image', () => {
    for (const id of mapped) {
      const map = getPlaceMap(id)!
      for (const spot of map.spots) {
        const tag = `${id} spot ${spot.label || spot.ref || spot.group || spot.kind || spot.facility || spot.screen}`
        expect(spot.x, tag).toBeGreaterThanOrEqual(0)
        expect(spot.x, tag).toBeLessThanOrEqual(map.w)
        expect(spot.y, tag).toBeGreaterThanOrEqual(0)
        expect(spot.y, tag).toBeLessThanOrEqual(map.h)
      }
    }
  })

  it('every activity spot resolves refs the world actually offers', () => {
    for (const id of mapped) {
      const offeredHere = new Set(placeActivities(id).map((a) => `${a.kind}|${a.ref}`))
      for (const spot of activitySpots(id)) {
        const tag = `${id} spot ${spot.label || spot.ref || spot.group || spot.kind}`
        const refs = resolveSpotRefs(id, spot)
        expect(refs.length, `${tag} resolves no activities`).toBeGreaterThan(0)
        for (const ref of refs) {
          if (Array.isArray(spot.refs)) {
            // Explicit lists may span other places (starting a remote one opens
            // the travel prompt) — but each ref must be offered somewhere.
            expect(placesForActivity(spot.kind, ref).length, `${tag} → ${ref} offered nowhere`).toBeGreaterThan(0)
          } else {
            expect(offeredHere.has(`${spot.kind}|${ref}`), `${tag} → ${ref} not offered here`).toBe(true)
          }
        }
      }
    }
  })

  it('facility and screen spots reference known facilities/screens', () => {
    const facilities = new Set(Object.keys(getWorld().facilities || {}))
    const screens = new Set(Object.values(SCREENS))
    for (const id of mapped) {
      for (const spot of getPlaceMap(id)!.spots) {
        if (spotType(spot) === 'facility') expect(facilities.has(spot.facility), `${id} facility ${spot.facility}`).toBe(true)
        if (spotType(spot) === 'screen') expect(screens.has(spot.screen), `${id} screen ${spot.screen}`).toBe(true)
      }
    }
  })

  it('facility spots only appear at places that actually have the facility', () => {
    const places = getWorld().places
    for (const id of mapped) {
      const has = new Set(places[id].facilities || [])
      for (const spot of getPlaceMap(id)!.spots) {
        if (spotType(spot) !== 'facility') continue
        expect(has.has(spot.facility), `${id}: ${spot.facility} spot but no such facility in world.json`).toBe(true)
        // Non-bank facility spots must train a known single skill the place offers.
        if (spot.facility !== 'bank') {
          const skillId = facilityTrainingSkill(spot.facility)
          expect(skillId, `${id}: ${spot.facility} trains nothing`).toBeTruthy()
          expect(
            placeActivities(id).some((a) => a.kind === 'skill' && a.ref.startsWith(skillId + ':')),
            `${id}: ${spot.facility} spot but no ${skillId} actions seeded here`
          ).toBe(true)
        }
      }
    }
  })

  it('covers every activity the read-only hub list shows (nothing becomes unstartable)', () => {
    // Mapped places swap the hub's clickable list for map spots, so every
    // place-varying activity the hub lists must be reachable via some spot.
    for (const id of mapped) {
      const covered = new Set<string>()
      for (const spot of activitySpots(id)) {
        for (const ref of resolveSpotRefs(id, spot)) covered.add(`${spot.kind}|${ref}`)
      }
      for (const a of placeActivities(id)) {
        if (a.kind === 'skill' && !isPlaceVaryingSkillRef(a.ref)) continue
        if (a.kind === 'minigame') continue // minigames screen handles its own venue list
        if (a.kind === 'bank') continue // covered by the facility-type "Bank of X" spot instead
        if (a.kind === 'combat' || a.kind === 'raid') continue // covered by the place's Dungeon screen (screen spot)
        expect(covered.has(`${a.kind}|${a.ref}`), `${id}: ${a.kind}|${a.ref} has no map spot`).toBe(true)
      }
    }
  })

  it('every Quests Board spot uses the shared blue quest-scroll icon, not the plain 📜 emoji', () => {
    for (const id of mapped) {
      for (const spot of getPlaceMap(id)!.spots) {
        if (spot.kind === 'quest') expect(spot.iconKey, `${id}: quest spot`).toBe('quest_scroll_blue')
      }
    }
  })

  it('single-ref gather/slayer/minigame spots resolve a data-authored iconKey, not just the generic per-kind emoji', () => {
    // PlaceMapView's ActivityIcon renders desc.iconKey (gather tasks/slayer
    // masters/minigames each carry their own game-icons key) ahead of the
    // generic '🌿'/'💀'/'🎮' fallback baked into describeActivity. A spot with
    // no group/explicit refs list describes exactly one activity, so it must
    // resolve that activity's own iconKey for the map badge to look distinct.
    for (const id of mapped) {
      for (const spot of activitySpots(id)) {
        if (spot.group || Array.isArray(spot.refs)) continue
        if (!['gather', 'slayer', 'minigame'].includes(spot.kind)) continue
        const desc = describeSpot(id, spot)
        if (desc.refs.length !== 1) continue
        expect(desc.iconKey, `${id}: ${spot.kind} ${spot.ref} has no iconKey`).toBeTruthy()
      }
    }
  })

  it('single-ref skill spots with no product resolve a real (non-default) skill emblem', () => {
    // Skill actions with an item output (mining/woodcutting/smithing/...) show
    // that item's own icon; actions with none (dungeoneering floors) fall back
    // to the skill's own emblem — which only works if the ref's skill id is a
    // real SKILL_ART entry, not silently landing on the generic default icon.
    for (const id of mapped) {
      for (const spot of activitySpots(id)) {
        if (spot.kind !== 'skill' || spot.group || Array.isArray(spot.refs)) continue
        const desc = describeSpot(id, spot)
        if (desc.refs.length !== 1 || desc.product) continue
        const skillId = desc.refs[0].split(':')[0]
        expect(SKILL_ART[skillId], `${id}: skill ${desc.refs[0]} has no SKILL_ART entry`).toBeTruthy()
      }
    }
  })

  it('describeSpot yields a label and a glyph for every activity spot', () => {
    for (const id of mapped) {
      for (const spot of activitySpots(id)) {
        const d = describeSpot(id, spot)
        expect(d.label).toBeTruthy()
        expect(d.skillArtId || d.icon).toBeTruthy()
        expect(d.refs.length).toBeGreaterThan(0)
      }
    }
  })

  it('the bank modal trains exactly the bank-bound facility skills', () => {
    expect(new Set(BANK_TRAINING_SKILLS)).toEqual(new Set(FACILITY_SKILL_MAP.bank))
    expect(BANK_TRAINING_SKILLS.length).toBe(FACILITY_SKILL_MAP.bank.length)
    // Every facility-bound skill is reachable from exactly one facility type.
    const all = Object.values(FACILITY_SKILL_MAP).flat()
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(all)).toEqual(FACILITY_SKILLS)
    // The single-skill facilities resolve as expected.
    expect(facilityTrainingSkill('furnace_anvil')).toBe('smithing')
    expect(facilityTrainingSkill('altar')).toBe('prayer')
    expect(facilityTrainingSkill('stove')).toBe('cooking')
    expect(facilityTrainingSkill('bank')).toBe(null)
  })

  it('foes live in the Dungeon screen: no combat/raid spots, one dungeon spot where foes are offered', () => {
    // Monsters/bosses/raids were moved off the map into a per-place Dungeon
    // screen. A map must therefore carry no combat/raid activity spots, and any
    // place that offers combat or raids must surface exactly one dungeon spot
    // (a `screen: 'dungeons'` landmark) as the way in.
    for (const id of mapped) {
      const spots = getPlaceMap(id)!.spots
      for (const spot of spots) {
        expect(spot.kind === 'combat' || spot.kind === 'raid', `${id}: stray ${spot.kind} spot`).toBe(false)
      }
      const dungeonSpots = spots.filter((s: any) => s.screen === SCREENS.DUNGEONS)
      const offersFoes = placeActivities(id).some((a) => a.kind === 'combat' || a.kind === 'raid')
      if (offersFoes) {
        expect(dungeonSpots.length, `${id}: offers foes but has no single dungeon spot`).toBe(1)
        expect(dungeonSpots[0].iconKey, `${id}: dungeon spot icon`).toBe('dungeon')
      } else {
        expect(dungeonSpots.length, `${id}: no foes offered but has a dungeon spot`).toBe(0)
      }
    }
  })

  it('placeHasMap only reports mapped places', () => {
    expect(placeHasMap('varrick')).toBe(true)
    expect(placeHasMap('lumbright')).toBe(true)
    expect(placeHasMap('nowhere')).toBe(false)
  })
})
