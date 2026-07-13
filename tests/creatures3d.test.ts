import { describe, it, expect } from 'vitest'
import { getCreatureSpec, hasCreatureSpec, listCreatureSpecIds, validateCreatureSpec } from '../src/3d/creatures.js'
import { buildBlendShellShaders, BLEND_SHELL_MAX_PARTS } from '../src/3d/blendShell.js'
import registry from '../src/data/creatures3d.json'
import monstersData from '../src/data/monsters.json'

const validSpec = () => ({
  height: 1.2,
  archetype: 'quadruped',
  palette: ['#8a5a34', '#c9a86a'],
  parts: [
    { id: 'body', a: [0, 0.5, -0.3], b: [0, 0.5, 0.3], r1: 0.3, r2: 0.25, color: 0, blend: 0.15 },
    { id: 'legL', a: [-0.1, 0.4, 0], b: [-0.1, 0.05, 0], r1: 0.06, r2: 0.04, color: 0, blend: 0.05 },
    { id: 'legR', a: [0.1, 0.4, 0], b: [0.1, 0.05, 0], r1: 0.06, r2: 0.04, color: 0, blend: 0.05 },
    { id: 'tail', a: [0, 0.5, -0.35], b: [0, 0.6, -0.6], r1: 0.08, r2: 0.03, color: 1, blend: 0.08 },
    { id: 'patch', a: [0, 0.7, 0], b: [0, 0.68, 0.1], r1: 0.1, r2: 0.08, color: 1, colorOnly: true },
  ],
  breathe: { parts: ['body'], amp: 0.03, rate: 2 },
  head: { parts: ['body'], anchor: [0, 0.5, 0.3], amp: 0.1 },
  legs: [{ part: 'legL' }, { part: 'legR' }],
  ropes: [{ parts: ['tail'], gravity: 2, sway: 0.3 }],
})

describe('creatures3d registry', () => {
  it('every registry entry passes validation (each form of a multiForm entry)', () => {
    for (const [id, entry] of Object.entries(registry.monsters) as [string, Record<string, unknown>][]) {
      if (entry.forms && !entry.parts) {
        const forms = Object.entries(entry.forms as Record<string, unknown>)
        expect(forms.length, `creatures3d.json entry ${id} has empty forms`).toBeGreaterThan(0)
        for (const [formKey, spec] of forms) {
          expect(validateCreatureSpec(spec), `creatures3d.json entry ${id} form ${formKey}`).toEqual([])
        }
      } else {
        expect(validateCreatureSpec(entry), `creatures3d.json entry ${id}`).toEqual([])
      }
    }
  })

  it('multiForm form keys match the monster combat forms so currentForm always resolves', () => {
    for (const [id, entry] of Object.entries(registry.monsters) as [string, Record<string, unknown>][]) {
      if (!entry.forms || entry.parts) continue
      const monster = (monstersData as Record<string, Record<string, unknown>>)[id]
      expect(monster?.multiForm, `creatures3d.json ${id} has forms but the monster is not multiForm`).toBe(true)
      for (const key of Object.keys(monster.forms as Record<string, unknown>)) {
        expect((entry.forms as Record<string, unknown>)[key], `creatures3d.json ${id} is missing combat form ${key}`).toBeTruthy()
      }
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
    expect(getCreatureSpec('cave_goblin')).toBeNull()
    expect(getCreatureSpec(undefined)).toBeNull()
    expect(hasCreatureSpec('cave_goblin')).toBe(false)
  })

  it('resolves multiForm entries per form, falling back to the initial form', () => {
    const p1 = getCreatureSpec('verzik_vitur', 'phase1')
    const p2 = getCreatureSpec('verzik_vitur', 'phase2')
    expect(p1).toBeTruthy()
    expect(p2).toBeTruthy()
    expect(JSON.stringify(p1)).not.toEqual(JSON.stringify(p2))
    // form-less and unknown-form callers get the initial form
    expect(JSON.stringify(getCreatureSpec('verzik_vitur'))).toEqual(JSON.stringify(p1))
    expect(JSON.stringify(getCreatureSpec('verzik_vitur', 'nope'))).toEqual(JSON.stringify(p1))
    expect(hasCreatureSpec('verzik_vitur')).toBe(true)
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

  it('rejects a spec where every part is buried or colorOnly', () => {
    const s = validSpec()
    for (const p of s.parts) (p as { buried?: boolean }).buried = true
    expect(validateCreatureSpec(s).some((e) => e.includes('buried'))).toBe(true)
  })

  it('rejects unknown archetypes', () => {
    const s = validSpec()
    ;(s as { archetype: string }).archetype = 'centaur'
    expect(validateCreatureSpec(s).some((e) => e.includes('archetype must be one of'))).toBe(true)
  })

  it('rejects rig groups with dangling part references', () => {
    const s = validSpec()
    s.breathe.parts.push('ghost')
    s.legs.push({ part: 'phantomLeg' })
    s.ropes.push({ parts: ['tail'], anchorTo: 'nowhere' } as never)
    const errors = validateCreatureSpec(s)
    expect(errors.some((e) => e.includes('breathe: references unknown part "ghost"'))).toBe(true)
    expect(errors.some((e) => e.includes('legs[2]: part must name an existing part'))).toBe(true)
    expect(errors.some((e) => e.includes('anchorTo references unknown part "nowhere"'))).toBe(true)
  })

  it('requires a head anchor when a head group is present', () => {
    const s = validSpec()
    delete (s.head as { anchor?: number[] }).anchor
    expect(validateCreatureSpec(s).some((e) => e.includes('head needs an [x,y,z] anchor'))).toBe(true)
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
