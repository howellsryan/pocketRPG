import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorld } from '../src/utils/helpers.js'
import { hasPendingWorldHandoff } from '../src/cloud/worldHandoff.js'

describe('saved same-tab world entry', () => {
  const writes = new Map<string, string>()
  let navigated: string[]
  let opened: string[]
  beforeEach(() => {
    writes.clear()
    navigated = []
    opened = []
    vi.stubGlobal('localStorage', {getItem: (key: string) => writes.get(key) ?? null, setItem: (key: string, value: string) => writes.set(key, value)})
    vi.stubGlobal('window', {location: {assign: (url: string) => navigated.push(url)}, open: (url: string) => {opened.push(url); return {}}})
  })
  afterEach(() => vi.unstubAllGlobals())
  it('finishes saving before minting and navigating with the one-use handoff', async () => {
    const order: string[] = []
    const api = {requestWorldHandoff: async () => {order.push('handoff'); return {handoff: 'abc.def'}}}
    await openWorld(api, undefined, {sameTab: true, beforeEnter: async () => {order.push('save'); return true}})
    expect(order).toEqual(['save', 'handoff'])
    expect(navigated).toEqual(['/world/#handoff=abc.def'])
    expect(opened).toEqual([])
    expect(hasPendingWorldHandoff()).toBe(true)
  })
  it('stays in idle and leaves cloud ownership untouched when saving fails', async () => {
    let requested = false
    const api = {requestWorldHandoff: async () => {requested = true; return {handoff: 'abc.def'}}}
    await expect(openWorld(api, undefined, {sameTab: true, beforeEnter: async () => false})).rejects.toThrow(/save/i)
    expect(requested).toBe(false)
    expect(navigated).toEqual([])
    expect(hasPendingWorldHandoff()).toBe(false)
  })
  it('stays in idle when the authenticated handoff request fails', async () => {
    const api = {requestWorldHandoff: async () => {throw new Error('Leave your co-op session first')}}
    await expect(openWorld(api, undefined, {sameTab: true, beforeEnter: async () => true})).rejects.toThrow('Leave your co-op session first')
    expect(navigated).toEqual([])
    expect(hasPendingWorldHandoff()).toBe(false)
  })
})
