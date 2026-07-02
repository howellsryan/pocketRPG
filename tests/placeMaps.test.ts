import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import placeMaps from '../src/data/placeMaps.json'
import { getWorld } from '../src/engine/world.js'
import { placeActivities, isPlaceVaryingSkillRef } from '../src/engine/worldContent.js'
import { getPlaceMap, placeHasMap, resolveSpotRefs, describeSpot } from '../src/engine/placeMaps.js'

const mapped = Object.keys(placeMaps)

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

  it('every spot sits inside its image and resolves at least one offered activity', () => {
    for (const id of mapped) {
      const map = getPlaceMap(id)!
      for (const spot of map.spots) {
        const tag = `${id} spot ${spot.label || spot.ref || spot.group || spot.kind}`
        expect(spot.x, tag).toBeGreaterThanOrEqual(0)
        expect(spot.x, tag).toBeLessThanOrEqual(map.w)
        expect(spot.y, tag).toBeGreaterThanOrEqual(0)
        expect(spot.y, tag).toBeLessThanOrEqual(map.h)
        const refs = resolveSpotRefs(id, spot)
        expect(refs.length, `${tag} resolves no activities`).toBeGreaterThan(0)
        // Everything a spot starts must genuinely be offered at the place.
        const offered = new Set(placeActivities(id).map((a) => `${a.kind}|${a.ref}`))
        for (const ref of refs) expect(offered.has(`${spot.kind}|${ref}`), `${tag} → ${ref}`).toBe(true)
      }
    }
  })

  it('covers every activity the read-only hub list shows (nothing becomes unstartable)', () => {
    // Mapped places swap the hub's clickable list for map spots, so every
    // place-varying activity the hub lists must be reachable via some spot.
    for (const id of mapped) {
      const covered = new Set<string>()
      for (const spot of getPlaceMap(id)!.spots) {
        for (const ref of resolveSpotRefs(id, spot)) covered.add(`${spot.kind}|${ref}`)
      }
      for (const a of placeActivities(id)) {
        if (a.kind === 'skill' && !isPlaceVaryingSkillRef(a.ref)) continue
        if (a.kind === 'minigame') continue // minigames screen handles its own venue list
        expect(covered.has(`${a.kind}|${a.ref}`), `${id}: ${a.kind}|${a.ref} has no map spot`).toBe(true)
      }
    }
  })

  it('describeSpot yields a label and a glyph for every spot', () => {
    for (const id of mapped) {
      for (const spot of getPlaceMap(id)!.spots) {
        const d = describeSpot(id, spot)
        expect(d.label).toBeTruthy()
        expect(d.skillArtId || d.icon).toBeTruthy()
        expect(d.refs.length).toBeGreaterThan(0)
      }
    }
  })

  it('placeHasMap only reports mapped places', () => {
    expect(placeHasMap('varrick')).toBe(true)
    expect(placeHasMap('lumbright')).toBe(false)
    expect(placeHasMap('nowhere')).toBe(false)
  })
})
