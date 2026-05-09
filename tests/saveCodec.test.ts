import { describe, it, expect } from 'vitest'
import { decodeSaveRow, gzipJsonString } from '../functions/_lib/saveCodec.js'

describe('decodeSaveRow', () => {
  it('decodes gzip save_blob payloads', async () => {
    const payload = JSON.stringify({ stats: { attack: 42 } })
    const save_blob = await gzipJsonString(payload)
    const decoded = await decodeSaveRow({ save_blob, save_data: null, updated_at: 123 })

    expect(decoded).toEqual({ save_data: payload, updatedAt: 123 })
  })

  it('does not fall back to legacy save_data when save_blob is absent', async () => {
    const decoded = await decodeSaveRow({ save_blob: null, save_data: '{"stale":true}', updated_at: 456 })

    expect(decoded).toBeNull()
  })
})
