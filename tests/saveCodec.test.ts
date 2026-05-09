import { describe, it, expect } from 'vitest'
import { decodeSaveRow, gzipJsonString } from '../functions/_lib/saveCodec.js'

describe('decodeSaveRow', () => {
  it('decodes gzip save_blob payloads', async () => {
    const payload = JSON.stringify({ stats: { attack: 42 } })
    const save_blob = await gzipJsonString(payload)
    const decoded = await decodeSaveRow({ save_blob, save_data: null, updated_at: 123 })

    expect(decoded).toEqual({ save_data: payload, updatedAt: 123 })
  })



  it('decodes array-like blobs returned by some runtimes', async () => {
    const payload = JSON.stringify({ stats: { strength: 55 } })
    const saveBlobBytes = await gzipJsonString(payload)
    const arrayLikeBlob = Array.from(saveBlobBytes)

    const decoded = await decodeSaveRow({ save_blob: arrayLikeBlob, save_data: null, updated_at: 321 })

    expect(decoded).toEqual({ save_data: payload, updatedAt: 321 })
  })

  it('throws when save_blob exists but is not gzip format', async () => {
    await expect(decodeSaveRow({ save_blob: new Uint8Array([0x00, 0x01, 0x02]), save_data: null, updated_at: 654 })).rejects.toThrow('save_blob_unexpected_format')
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
