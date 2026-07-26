// The whole point of the quest-gate bypass is that production cannot have it.
// These tests fail the build if the flag ever leaks into a production config or
// a production build, so the guarantee survives a careless copy-paste.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = (p: string) => resolve(__dirname, '..', p)
const FLAG = 'DISABLE_QUEST_REQUIREMENTS'

describe('wrangler.toml (Pages)', () => {
  const toml = readFileSync(root('wrangler.toml'), 'utf8')
  // Everything before `[env.preview]` is the production environment.
  const productionSection = toml.slice(0, toml.indexOf('[env.preview]'))
  const previewSection = toml.slice(toml.indexOf('[env.preview]'))

  it('never enables the quest-gate bypass in the production vars', () => {
    const assignment = new RegExp(`^\\s*${FLAG}\\s*=|${FLAG}\\s*=\\s*"`, 'm')
    expect(assignment.test(productionSection.replace(/^\s*#.*$/gm, ''))).toBe(false)
  })

  it('enables it for preview, which is the environment it exists for', () => {
    expect(previewSection).toContain(`${FLAG} = "true"`)
  })
})

describe('world/wrangler.jsonc (open-world Worker)', () => {
  const jsonc = readFileSync(root('world/wrangler.jsonc'), 'utf8')
  const productionSection = jsonc.slice(0, jsonc.indexOf('"env"'))
  const previewSection = jsonc.slice(jsonc.indexOf('"env"'))

  it('never enables the quest-gate bypass in the production config', () => {
    expect(productionSection.replace(/^\s*\/\/.*$/gm, '')).not.toContain(FLAG)
  })

  it('enables it for the preview worker', () => {
    expect(previewSection).toContain(`"${FLAG}": "true"`)
  })
})

describe('build_single.cjs (client bake)', () => {
  const build = readFileSync(root('build_single.cjs'), 'utf8')

  it('bakes the client flag into the core preamble', () => {
    expect(build).toContain('const pocketQuestGatesDisabled = ${questGatesDisabled}')
  })

  it('makes the main branch an unconditional no, override included', () => {
    expect(build).toMatch(/process\.env\.CF_PAGES_BRANCH === 'main'\s*\?\s*false/)
  })
})

describe('the branch rule the client bake applies', () => {
  // Mirrors build_single.cjs so the truth table is asserted, not just the text.
  const bake = (env: Record<string, string | undefined>) =>
    env.CF_PAGES_BRANCH === 'main'
      ? false
      : env.DisableQuestRequirements != null
        ? env.DisableQuestRequirements === 'true'
        : Boolean(env.CF_PAGES_BRANCH)

  it('is off for the production branch and on for preview branches', () => {
    expect(bake({ CF_PAGES_BRANCH: 'main' })).toBe(false)
    expect(bake({ CF_PAGES_BRANCH: 'claude/some-feature' })).toBe(true)
  })

  it('is off for a local build with no branch information', () => {
    expect(bake({})).toBe(false)
  })

  it('cannot be forced on for the production branch by the override', () => {
    expect(bake({ DisableQuestRequirements: 'true', CF_PAGES_BRANCH: 'main' })).toBe(false)
  })

  it('lets the override turn it off on a preview branch, and on locally', () => {
    expect(bake({ DisableQuestRequirements: 'false', CF_PAGES_BRANCH: 'preview-branch' })).toBe(false)
    expect(bake({ DisableQuestRequirements: 'true' })).toBe(true)
  })
})
