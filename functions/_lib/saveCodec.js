const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function toUint8Array(bufferLike) {
  if (!bufferLike) return null
  if (bufferLike instanceof Uint8Array) return bufferLike
  if (bufferLike instanceof ArrayBuffer) return new Uint8Array(bufferLike)
  if (ArrayBuffer.isView(bufferLike)) {
    return new Uint8Array(bufferLike.buffer, bufferLike.byteOffset, bufferLike.byteLength)
  }
  return null
}

export function isGzipBuffer(blob) {
  const bytes = toUint8Array(blob)
  return !!bytes && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

async function transformBytes(inputBytes, streamType) {
  const stream = new Blob([inputBytes]).stream().pipeThrough(new streamType('gzip'))
  const out = await new Response(stream).arrayBuffer()
  return new Uint8Array(out)
}

export async function gzipJsonString(jsonText) {
  if (typeof jsonText !== 'string') return null
  const bytes = textEncoder.encode(jsonText)
  return transformBytes(bytes, CompressionStream)
}

export async function gunzipToJsonString(blob) {
  const bytes = toUint8Array(blob)
  if (!bytes) return null
  const out = await transformBytes(bytes, DecompressionStream)
  return textDecoder.decode(out)
}

export async function decodeSaveRow(row) {
  if (!row) return null
  if (row.save_blob && isGzipBuffer(row.save_blob)) {
    try {
      const decoded = await gunzipToJsonString(row.save_blob)
      if (decoded) return { save_data: decoded, updatedAt: row.updated_at }
    } catch (err) {
      const decodeError = new Error('save_blob_decode_failed')
      decodeError.cause = err
      throw decodeError
    }
  }
  return null
}

