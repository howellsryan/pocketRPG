// Logic-only coverage for the video pipeline's pure half: recipe validation,
// timeline maths, caption fitting and seed record building. The browser and
// ffmpeg halves are exercised by actually running a render (video/README.md);
// everything testable without a browser lives in these modules on purpose.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  validateRecipe, planTimeline, safeBox, wrapCaption, captionFits,
  FRAME, SAFE_ZONE, MIN_CAPTION_MS, DEFAULT_FPS,
} from '../video/lib/recipe.mjs'
import { buildSeed } from '../video/lib/seed.mjs'
import { getXPForLevel } from '../src/engine/experience.js'
import { ALL_SKILLS, HITPOINTS_START_XP, INVENTORY_SIZE } from '../src/utils/constants.js'

const minimal = () => ({ id: 'demo', scenes: [{ action: 'hold', holdMs: 1000 }] })

describe('validateRecipe', () => {
  it('accepts a minimal recipe and fills defaults', () => {
    const r = validateRecipe(minimal())
    expect(r.fps).toBe(DEFAULT_FPS)
    expect(r.scenes[0].holdMs).toBe(1000)
  })

  it('rejects an id that is not a kebab-case slug (it names the output file)', () => {
    expect(() => validateRecipe({ ...minimal(), id: 'Not A Slug' })).toThrow(/kebab-case/)
    expect(() => validateRecipe({ ...minimal(), id: '-leading' })).toThrow(/kebab-case/)
  })

  it('rejects an unknown action rather than silently skipping it', () => {
    expect(() => validateRecipe({ id: 'x', scenes: [{ action: 'teleport' }] })).toThrow(/unknown action/)
  })

  // `text` exists because parts of the UI hang onClick on a plain div (the
  // mobile monster rows), where getByRole resolves nothing.
  it('requires a target for every targeted action', () => {
    for (const action of ['nav', 'click', 'text']) {
      expect(() => validateRecipe({ id: 'x', scenes: [{ action }] })).toThrow(/requires a target/)
    }
  })

  it('accepts a text action with a target', () => {
    const r = validateRecipe({ id: 'x', scenes: [{ action: 'text', target: 'Pasture Bull', holdMs: 900 }] })
    expect(r.scenes[0].action).toBe('text')
  })

  it('requires a seed object for reseed', () => {
    expect(() => validateRecipe({ id: 'x', scenes: [{ action: 'reseed' }] })).toThrow(/requires a seed/)
  })

  it('rejects a caption too brief to read', () => {
    const scenes = [{ action: 'hold', holdMs: MIN_CAPTION_MS - 1, caption: 'blink' }]
    expect(() => validateRecipe({ id: 'x', scenes })).toThrow(/readable/)
  })

  it('rejects an empty caption string', () => {
    const scenes = [{ action: 'hold', holdMs: 3000, caption: '   ' }]
    expect(() => validateRecipe({ id: 'x', scenes })).toThrow(/non-empty/)
  })

  it('rejects an out-of-range fps', () => {
    expect(() => validateRecipe({ ...minimal(), fps: 0 })).toThrow(/1-60/)
    expect(() => validateRecipe({ ...minimal(), fps: 120 })).toThrow(/1-60/)
  })

  it('rejects an empty scene list', () => {
    expect(() => validateRecipe({ id: 'x', scenes: [] })).toThrow(/non-empty/)
  })

  // Top-level fields used to pass through unchecked, so a typo was a silent
  // no-op that only showed up as missing text in a finished render.
  it('rejects malformed top-level hook, outro, hookMs and seed', () => {
    expect(() => validateRecipe({ ...minimal(), hook: '  ' })).toThrow(/non-empty/)
    expect(() => validateRecipe({ ...minimal(), outro: 42 })).toThrow(/non-empty/)
    expect(() => validateRecipe({ ...minimal(), hookMs: 'soon' })).toThrow(/non-negative/)
    expect(() => validateRecipe({ ...minimal(), hookMs: -1 })).toThrow(/non-negative/)
    expect(() => validateRecipe({ ...minimal(), seed: 'maxed' })).toThrow(/must be an object/)
  })

  it('accepts the top-level fields when well formed', () => {
    const r = validateRecipe({ ...minimal(), hook: 'Hi', outro: 'Bye', hookMs: 0, seed: {} })
    expect(r.hook).toBe('Hi')
    expect(r.hookMs).toBe(0)
  })
})

describe('planTimeline', () => {
  it('lays scenes end to end with no gaps', () => {
    const { scenes, durationMs } = planTimeline({
      id: 'x',
      scenes: [
        { action: 'hold', holdMs: 1000 },
        { action: 'hold', holdMs: 2000 },
        { action: 'hold', holdMs: 500 },
      ],
    })
    expect(scenes.map((s) => s.startMs)).toEqual([0, 1000, 3000])
    expect(scenes.map((s) => s.endMs)).toEqual([1000, 3000, 3500])
    expect(durationMs).toBe(3500)
  })

  it('derives frame numbers from fps', () => {
    const { scenes, totalFrames } = planTimeline({
      id: 'x', fps: 30, scenes: [{ action: 'hold', holdMs: 1000 }, { action: 'hold', holdMs: 1000 }],
    })
    expect(scenes[1].startFrame).toBe(30)
    expect(totalFrames).toBe(60)
  })
})

describe('safe zone', () => {
  it('keeps the text box clear of TikTok chrome on all four sides', () => {
    const box = safeBox()
    expect(box.x).toBe(SAFE_ZONE.left)
    expect(box.y).toBe(SAFE_ZONE.top)
    expect(box.x + box.width).toBe(FRAME.width - SAFE_ZONE.right)
    expect(box.y + box.height).toBe(FRAME.height - SAFE_ZONE.bottom)
  })

  it('throws when a zone would leave no room to draw', () => {
    expect(() => safeBox(FRAME, { top: 1000, bottom: 1000, left: 600, right: 600 })).toThrow(/no usable area/)
  })

  it('wraps a caption to the box width', () => {
    const lines = wrapCaption('the quick brown fox jumps over the lazy dog again and again', {
      maxWidth: 300, fontSize: 40,
    })
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog again and again')
  })

  it('never drops a word that is longer than one line', () => {
    const lines = wrapCaption('supercalifragilisticexpialidocious', { maxWidth: 60, fontSize: 40 })
    expect(lines.join('')).toContain('supercalifragilisticexpialidocious')
  })

  it('returns no lines for blank text', () => {
    expect(wrapCaption('   ', { maxWidth: 500, fontSize: 40 })).toEqual([])
  })

  it('flags a caption that overflows the safe box', () => {
    const long = 'word '.repeat(400).trim()
    expect(captionFits(long, { fontSize: 40 }).fits).toBe(false)
    expect(captionFits('Maxed. Every skill, 99.', { fontSize: 40 }).fits).toBe(true)
  })
})

describe('buildSeed', () => {
  it('gives every skill the XP its level actually requires', () => {
    const { stats } = buildSeed({ levels: { all: 50 } })
    const byId = Object.fromEntries(stats)
    expect(stats).toHaveLength(new Set(ALL_SKILLS).size)
    expect(byId.attack).toEqual({ skill: 'attack', xp: getXPForLevel(50), level: 50 })
  })

  it('defaults to a fresh character — level 1, Hitpoints 10', () => {
    const byId = Object.fromEntries(buildSeed().stats)
    expect(byId.attack.level).toBe(1)
    expect(byId.hitpoints).toEqual({ skill: 'hitpoints', xp: HITPOINTS_START_XP, level: 10 })
  })

  it('never drops Hitpoints below its level-10 baseline', () => {
    const byId = Object.fromEntries(buildSeed({ levels: { all: 3 } }).stats)
    expect(byId.hitpoints.level).toBe(10)
    expect(byId.hitpoints.xp).toBe(HITPOINTS_START_XP)
  })

  it('lets a per-skill level override the blanket one', () => {
    const byId = Object.fromEntries(buildSeed({ levels: { all: 40, mining: 99 } }).stats)
    expect(byId.mining.level).toBe(99)
    expect(byId.attack.level).toBe(40)
  })

  it('rejects a skill or slot the game does not have', () => {
    expect(() => buildSeed({ levels: { fletchery: 50 } })).toThrow(/unknown skill/)
    expect(() => buildSeed({ equipment: { backpack: 'x' } })).toThrow(/unknown slot/)
  })

  it('rejects an out-of-range level', () => {
    expect(() => buildSeed({ levels: { all: 120 } })).toThrow(/1-99/)
    expect(() => buildSeed({ levels: { all: 0 } })).toThrow(/1-99/)
  })

  it('refuses an inventory beyond the 28-slot cap (CLAUDE.md §4)', () => {
    const inventory = Array.from({ length: INVENTORY_SIZE + 1 }, () => 'shark')
    expect(() => buildSeed({ inventory })).toThrow(/28-slot cap/)
  })

  // A mistyped id does not crash the game — it renders an empty slot — so
  // without this the render succeeds and the video is quietly broken.
  it('rejects an item id that is not in items.json', () => {
    expect(() => buildSeed({ equipment: { weapon: 'excalibur' } })).toThrow(/unknown item 'excalibur'/)
    expect(() => buildSeed({ bank: { gold_bar_of_doom: 5 } })).toThrow(/unknown item/)
    expect(() => buildSeed({ inventory: ['not_a_real_item'] })).toThrow(/unknown item/)
  })

  it('accepts every item the shipped zero-to-hero recipe seeds', () => {
    const recipe = JSON.parse(
      readFileSync(new URL('../video/recipes/zero-to-hero.json', import.meta.url), 'utf8'),
    )
    const seeds = [recipe.seed, ...recipe.scenes.map((s: any) => s.seed)].filter(Boolean)
    for (const seed of seeds) expect(() => buildSeed(seed)).not.toThrow()
  })

  it('keys each store the way src/db/stores.js reads it', () => {
    const seed = buildSeed({
      levels: { all: 1 },
      equipment: { weapon: 'zaryth_godsword' },
      inventory: ['shark', { itemId: 'coins', quantity: 5 }],
      bank: { coins: 100 },
    })
    expect(seed.equipment).toEqual([['weapon', { itemId: 'zaryth_godsword', quantity: 1 }]])
    expect(seed.inventory).toEqual([[0, { itemId: 'shark', quantity: 1 }], [1, { itemId: 'coins', quantity: 5 }]])
    expect(seed.bank).toEqual([['coins', { itemId: 'coins', quantity: 100 }]])
  })
})
