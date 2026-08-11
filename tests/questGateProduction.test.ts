// The whole point of the quest-gate bypass is that production cannot have it.
// These tests fail the build if the flag ever leaks into a production config or
// a production build, so the guarantee survives a careless copy-paste.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = (p: string) => resolve(__dirname, '..', p)
const FLAG = 'DISABLE_QUEST_REQUIREMENTS'

describe('wrangler.jsonc (the one Worker)', () => {
  const jsonc = readFileSync(root('wrangler.jsonc'), 'utf8')
  // Everything before the "env" block is the production environment.
  const productionSection = jsonc.slice(0, jsonc.indexOf('"env"'))
  const previewSection = jsonc.slice(jsonc.indexOf('"env"'))

  it('never enables the quest-gate bypass in the production config', () => {
    expect(productionSection.replace(/^\s*\/\/.*$/gm, '')).not.toContain(FLAG)
  })

  it('enables it for preview, which is the environment it exists for', () => {
    expect(previewSection).toContain(`"${FLAG}": "true"`)
  })
})

describe('build_single.cjs (client bake)', () => {
  const build = readFileSync(root('build_single.cjs'), 'utf8')

  it('bakes the client flag into the core preamble', () => {
    expect(build).toContain('const pocketQuestGatesDisabled = ${questGatesDisabled}')
  })

  it('makes the main branch an unconditional no, override included', () => {
    expect(build).toMatch(/const questGatesDisabled = isProductionBranch\s*\?\s*false/)
  })

  it('reads the branch from Workers Builds as well as Pages', () => {
    // Workers Builds injects WORKERS_CI_BRANCH, not CF_PAGES_BRANCH. Reading
    // only the Pages one would leave every branch-derived flag unset on a
    // Workers build — for the world origin below that means a production
    // bundle pointing players at preview, so the read is asserted here.
    expect(build).toContain('process.env.WORKERS_CI_BRANCH || process.env.CF_PAGES_BRANCH')
  })
})

describe('the branch rule the client bake applies', () => {
  // Mirrors build_single.cjs so the truth table is asserted, not just the text.
  const branchOf = (env: Record<string, string | undefined>) =>
    env.WORKERS_CI_BRANCH || env.CF_PAGES_BRANCH || ''
  const bake = (env: Record<string, string | undefined>) =>
    branchOf(env) === 'main'
      ? false
      : env.DisableQuestRequirements != null
        ? env.DisableQuestRequirements === 'true'
        : Boolean(branchOf(env))

  it('is off for the production branch and on for preview branches', () => {
    expect(bake({ CF_PAGES_BRANCH: 'main' })).toBe(false)
    expect(bake({ CF_PAGES_BRANCH: 'claude/some-feature' })).toBe(true)
  })

  it('applies the same rule to a Workers build, which names the branch differently', () => {
    expect(bake({ WORKERS_CI_BRANCH: 'main' })).toBe(false)
    expect(bake({ WORKERS_CI_BRANCH: 'claude/some-feature' })).toBe(true)
  })

  it('is off for a local build with no branch information', () => {
    expect(bake({})).toBe(false)
  })

  it('cannot be forced on for the production branch by the override', () => {
    expect(bake({ DisableQuestRequirements: 'true', CF_PAGES_BRANCH: 'main' })).toBe(false)
    expect(bake({ DisableQuestRequirements: 'true', WORKERS_CI_BRANCH: 'main' })).toBe(false)
  })

  it('lets the override turn it off on a preview branch, and on locally', () => {
    expect(bake({ DisableQuestRequirements: 'false', CF_PAGES_BRANCH: 'preview-branch' })).toBe(false)
    expect(bake({ DisableQuestRequirements: 'true' })).toBe(true)
  })
})
