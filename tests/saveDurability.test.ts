// ensureSaveDurable — the pre-server-write durability gate. A trade endpoint
// loads-mutates-returns the whole save and the client adopts that copy, so the
// caller must only proceed when the local save is provably durable first.
import { describe, it, expect, vi } from 'vitest'
import { ensureSaveDurable } from '../src/cloud/saveDurability.js'

const SNAP = { stats: {} }

describe('ensureSaveDurable', () => {
  it('is true only when the push confirms durability (resolves true)', async () => {
    const push = vi.fn(async () => true)
    expect(await ensureSaveDurable(push, SNAP)).toBe(true)
    expect(push).toHaveBeenCalledWith(SNAP)
  })

  it('is false when the push reports it did not land (resolves false)', async () => {
    expect(await ensureSaveDurable(async () => false, SNAP)).toBe(false)
  })

  it('is false for a non-true resolution (undefined/no boolean contract)', async () => {
    expect(await ensureSaveDurable(async () => undefined as any, SNAP)).toBe(false)
  })

  it('is false when the push throws (network/abort) rather than propagating', async () => {
    expect(await ensureSaveDurable(async () => { throw new Error('offline') }, SNAP)).toBe(false)
  })
})
