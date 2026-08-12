import { describe, it, expect } from 'vitest'
import { validateBiomeSpec } from '../src/3d/biomes.js'
import registry from '../src/data/biomes3d.json'
import worldData from '../src/data/world.json'

const validSpec = () => ({
  sky: { top: '#efe4c4', bottom: '#d9d5a6' },
  haze: { color: '#e3ddb4', amount: 0.4 },
  light: { sky: '#fff2e0', ground: '#3a3320', key: '#fff2e0', keyIntensity: 2.2 },
  ground: { colors: ['#8a9a55', '#75864a', '#a3a86b'], scale: 1.6 },
  palette: ['#6b4a2f', '#7d8f4a'],
  shapes: {
    rock: [{ id: 'rock', a: [0, 0.2, 0], b: [0, 0.3, 0], r1: 0.3, r2: 0.25, color: 0, blend: 0.1 }],
  },
  placements: [{ shape: 'rock', at: [2.5, -2], scale: 1.1, rotY: 40 }],
})

describe('biomes3d registry', () => {
  it('every biome entry passes validation', () => {
    for (const [id, spec] of Object.entries(registry.biomes)) {
      expect(validateBiomeSpec(spec), `biomes3d.json entry ${id}`).toEqual([])
    }
  })

  it('the default biome exists', () => {
    expect(registry.biomes[registry.default]).toBeTruthy()
  })

  it('the places map references real world places and real biomes', () => {
    for (const [placeId, biomeId] of Object.entries(registry.places)) {
      expect(worldData.places[placeId], `biomes3d.json places key ${placeId} is not a world.json place`).toBeTruthy()
      expect(registry.biomes[biomeId], `biomes3d.json places[${placeId}] names unknown biome ${biomeId}`).toBeTruthy()
    }
  })

})

describe('validateBiomeSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateBiomeSpec(validSpec())).toEqual([])
  })

  it('rejects malformed colors', () => {
    const spec = validSpec()
    spec.sky.top = 'red'
    spec.ground.colors[1] = '#12345'
    expect(validateBiomeSpec(spec).length).toBeGreaterThanOrEqual(2)
  })

  it('rejects ground without exactly 3 colors', () => {
    const spec = validSpec()
    spec.ground.colors = ['#8a9a55']
    expect(validateBiomeSpec(spec)).toContain('ground.colors must be an array of 3 colors')
  })

  it('rejects out-of-range haze and light numbers', () => {
    const spec = validSpec()
    spec.haze.amount = 1.4
    spec.light.keyIntensity = 0
    expect(validateBiomeSpec(spec).length).toBeGreaterThanOrEqual(2)
  })

  it('rejects shape parts with bad geometry or palette indices', () => {
    const spec = validSpec()
    spec.shapes.rock[0].r1 = 0
    spec.shapes.rock[0].color = 7
    const errors = validateBiomeSpec(spec)
    expect(errors.some((e) => e.includes('r1'))).toBe(true)
    expect(errors.some((e) => e.includes('color'))).toBe(true)
  })

  it('rejects placements naming unknown shapes or bad coordinates', () => {
    const spec = validSpec()
    spec.placements.push({ shape: 'ghost', at: [1] } as never)
    const errors = validateBiomeSpec(spec)
    expect(errors.some((e) => e.includes('shape must name an authored shape'))).toBe(true)
    expect(errors.some((e) => e.includes('at must be [x,z]'))).toBe(true)
  })
})
