import { describe, it, expect } from 'vitest'
import { getCreatureSpec, hasCreatureSpec, listCreatureSpecIds, validateCreatureSpec } from '../src/3d/creatures.js'
import { buildBlendShellShaders, BLEND_SHELL_MAX_PARTS } from '../src/3d/blendShell.js'
import registry from '../src/data/creatures3d.json'
import monstersData from '../src/data/monsters.json'

const validSpec = () => ({
  height: 1.2,
  palette: ['#8a5a34', '#c9a86a'],
  parts: [
    { id: 'body', a: [0, 0.5, -0.3], b: [0, 0.5, 0.3], r1: 0.3, r2: 0.25, color: 0, blend: 0.15 },
    { id: 'tail', a: [0, 0.5, -0.35], b: [0, 0.6, -0.6], r1: 0.08, r2: 0.03, color: 1, blend: 0.08 },
  ],
  idle: [
    { kind: 'breathe', parts: ['body'], amp: 0.03, rate: 2 },
    { kind: 'chain', parts: ['tail'], yaw: 0.5, rate: 3, lag: 0.7 },
  ],
})

describe('creatures3d registry', () => {
  it('every registry entry passes validation', () => {
    for (const [id, spec] of Object.entries(registry.monsters)) {
      expect(validateCreatureSpec(spec), `creatures3d.json entry ${id}`).toEqual([])
    }
  })

  it('every registry entry maps to a real monster id', () => {
    for (const id of listCreatureSpecIds()) {
      expect(monstersData[id], `creatures3d.json entry ${id} has no monster in monsters.json`).toBeTruthy()
    }
  })

  it('resolves a registered creature with arena defaults applied', () => {
    const spec = getCreatureSpec('pasture_bull')
    expect(spec).toBeTruthy()
    expect(spec!.parts.length).toBeGreaterThan(0)
    expect(typeof spec!.height).toBe('number')
    expect(spec!.rotationDeg).toHaveLength(3)
    expect(hasCreatureSpec('pasture_bull')).toBe(true)
  })

  it('returns null for unregistered monsters (GLB/classic fallback)', () => {
    expect(getCreatureSpec('field_chicken')).toBeNull()
    expect(getCreatureSpec(undefined)).toBeNull()
    expect(hasCreatureSpec('field_chicken')).toBe(false)
  })
})

describe('validateCreatureSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(validateCreatureSpec(validSpec())).toEqual([])
  })

  it('rejects non-objects and empty parts', () => {
    expect(validateCreatureSpec(null).length).toBeGreaterThan(0)
    expect(validateCreatureSpec({ palette: ['#ffffff'], parts: [] }).length).toBeGreaterThan(0)
  })

  it('rejects bad palette colors and out-of-range color indices', () => {
    const s = validSpec()
    s.palette = ['not-a-color']
    const errors = validateCreatureSpec(s)
    expect(errors.some((e) => e.includes('#rrggbb'))).toBe(true)
    expect(errors.some((e) => e.includes('color must index into palette'))).toBe(true)
  })

  it('rejects duplicate part ids, bad endpoints, and non-positive radii', () => {
    const s = validSpec()
    s.parts.push({ id: 'body', a: [0, 0], b: [0, 0, 0], r1: 0, r2: -1, color: 0 })
    const errors = validateCreatureSpec(s)
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true)
    expect(errors.some((e) => e.includes('a must be [x,y,z]'))).toBe(true)
    expect(errors.some((e) => e.includes('r1 must be a positive number'))).toBe(true)
    expect(errors.some((e) => e.includes('r2 must be a positive number'))).toBe(true)
  })

  it('enforces the primitive budget', () => {
    const s = validSpec()
    for (let i = 0; i < BLEND_SHELL_MAX_PARTS; i++) {
      s.parts.push({ id: `extra${i}`, a: [0, 0, 0], b: [0, 1, 0], r1: 0.1, r2: 0.1, color: 0 })
    }
    expect(validateCreatureSpec(s).some((e) => e.includes('budget'))).toBe(true)
  })

  it('rejects a spec where every part is buried', () => {
    const s = validSpec()
    for (const p of s.parts) (p as { buried?: boolean }).buried = true
    expect(validateCreatureSpec(s).some((e) => e.includes('buried'))).toBe(true)
  })

  it('rejects idle behaviors with unknown kinds or dangling part refs', () => {
    const s = validSpec()
    s.idle.push({ kind: 'moonwalk', parts: ['body'] } as never)
    s.idle.push({ kind: 'sway', parts: ['ghost'], anchor: [0, 0, 0] } as never)
    const errors = validateCreatureSpec(s)
    expect(errors.some((e) => e.includes('kind must be one of'))).toBe(true)
    expect(errors.some((e) => e.includes('unknown part "ghost"'))).toBe(true)
  })
})

describe('buildBlendShellShaders', () => {
  it('sizes the uniform arrays to the part count', () => {
    const { vertexShader, fragmentShader } = buildBlendShellShaders(14)
    expect(vertexShader).toContain('#define N 14')
    expect(vertexShader).toContain('uniform mat4 uXf[N]')
    expect(fragmentShader).toContain('uFlashAmt')
  })
})
