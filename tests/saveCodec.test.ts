import { describe, it, expect } from 'vitest'
import { decodeSaveRow, gzipJsonString } from '../functions/_lib/saveCodec.js'

describe('decodeSaveRow', () => {
  it('decodes gzip save_blob payloads', async () => {
    const payload = JSON.stringify({ stats: { attack: 42 } })
    const save_blob = await gzipJsonString(payload)
    const decoded = await decodeSaveRow({ save_blob, save_data: null, updated_at: 123 })

    expect(decoded).toEqual({ save_data: payload, updatedAt: 123 })
  })


  it('throws when save_blob has gzip header but cannot be decompressed', async () => {
    const brokenBlob = new Uint8Array([0x1f, 0x8b, 0x00])

    await expect(decodeSaveRow({ save_blob: brokenBlob, save_data: null, updated_at: 789 })).rejects.toThrow('save_blob_decode_failed')
  })

  it('does not fall back to legacy save_data when save_blob is absent', async () => {
    const decoded = await decodeSaveRow({ save_blob: null, save_data: '{"stale":true}', updated_at: 456 })

    expect(decoded).toBeNull()
  })
})
