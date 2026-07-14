// Minimal binary-FBX (Kaydara "FBX Binary", version 6100–7400) reader for the
// geometry-only Quaternius "FBX Extras" gear — no scene graph, no skinning, no
// animation, just enough to pull each mesh's positions/normals/per-polygon
// material split so build-fbx-gear.mjs can bake tintable GLBs the same way the
// OBJ weapon builder does. Node's zlib inflates the deflate-compressed property
// arrays, so there is no fflate/three dependency.
//
// Not a general FBX importer: it assumes one Geometry per file, ByPolygonVertex
// Direct normals, and ByPolygon material mapping (what this pack exports). It
// throws on anything else so a surprising asset fails loudly instead of
// producing silent garbage.
import fs from 'node:fs'
import zlib from 'node:zlib'

function readProp(b, o) {
  const type = String.fromCharCode(b[o]); o += 1
  const arr = (Ctor) => {
    const len = b.readUInt32LE(o); const enc = b.readUInt32LE(o + 4); const clen = b.readUInt32LE(o + 8); o += 12
    let data = b.subarray(o, o + clen); o += clen
    if (enc === 1) data = zlib.inflateSync(data)
    // copy so the returned array doesn't alias the (soon-discarded) file buffer
    return { value: Array.from(new Ctor(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), 0, len)), o }
  }
  switch (type) {
    case 'Y': return { type, value: b.readInt16LE(o), o: o + 2 }
    case 'C': return { type, value: !!b[o], o: o + 1 }
    case 'I': return { type, value: b.readInt32LE(o), o: o + 4 }
    case 'F': return { type, value: b.readFloatLE(o), o: o + 4 }
    case 'D': return { type, value: b.readDoubleLE(o), o: o + 8 }
    case 'L': return { type, value: Number(b.readBigInt64LE(o)), o: o + 8 }
    case 'f': return { type, ...arr(Float32Array) }
    case 'd': return { type, ...arr(Float64Array) }
    case 'l': return { type, ...arr(BigInt64Array) }
    case 'i': return { type, ...arr(Int32Array) }
    case 'b': return { type, ...arr(Int8Array) }
    case 'S': case 'R': {
      const len = b.readUInt32LE(o); o += 4; const v = b.subarray(o, o + len)
      return { type, value: type === 'S' ? v.toString('binary') : v, o: o + len }
    }
    default: throw new Error('FBX: unknown property type "' + type + '"')
  }
}

function readNode(b, o, u64) {
  let end, numProps, nameLen
  if (u64) { end = Number(b.readBigUInt64LE(o)); numProps = Number(b.readBigUInt64LE(o + 8)); nameLen = b[o + 24]; o += 25 }
  else { end = b.readUInt32LE(o); numProps = b.readUInt32LE(o + 4); nameLen = b[o + 12]; o += 13 }
  if (end === 0) return { end: o, node: null } // null-record terminator
  const name = b.subarray(o, o + nameLen).toString('binary'); o += nameLen
  const props = []
  for (let i = 0; i < numProps; i++) { const r = readProp(b, o); props.push(r); o = r.o }
  const children = []
  while (o < end) { const r = readNode(b, o, u64); o = r.end; if (r.node) children.push(r.node); else break }
  return { end, node: { name, props, children } }
}

export function parseFbx(file) {
  const b = fs.readFileSync(file)
  if (b.subarray(0, 20).toString('binary') !== 'Kaydara FBX Binary  ') throw new Error('FBX: not a binary FBX: ' + file)
  const u64 = b.readUInt32LE(23) >= 7500
  let o = 27; const roots = []
  while (o < b.length - 25) { const r = readNode(b, o, u64); o = r.end; if (!r.node) break; roots.push(r.node) }
  return roots
}

const child = (node, name) => node.children.find((c) => c.name === name)
const propVal = (node, i) => node.props[i] && node.props[i].value

// Extract one mesh per source material: { name, positions:[], normals:[],
// indices:[] } with positions/normals already de-indexed to unique corners.
// FBX polygons are stored as a flat PolygonVertexIndex where the last corner of
// each face is bitwise-negated (~i) to mark the face end; faces may be tris or
// quads (fan-triangulated here).
export function extractMeshes(roots) {
  const objects = roots.find((r) => r.name === 'Objects')
  if (!objects) throw new Error('FBX: no Objects node')
  const geo = objects.children.find((c) => c.name === 'Geometry')
  if (!geo) throw new Error('FBX: no Geometry node')

  const verts = child(geo, 'Vertices')?.props[0].value || []
  const pvi = child(geo, 'PolygonVertexIndex')?.props[0].value || []

  const normLayer = child(geo, 'LayerElementNormal')
  if (!normLayer || propVal(child(normLayer, 'MappingInformationType'), 0) !== 'ByPolygonVertex')
    throw new Error('FBX: expected ByPolygonVertex normals')
  const normals = child(normLayer, 'Normals').props[0].value

  const matLayer = child(geo, 'LayerElementMaterial')
  const matMapping = matLayer ? propVal(child(matLayer, 'MappingInformationType'), 0) : 'AllSame'
  const matIndices = matLayer ? (child(matLayer, 'Materials')?.props[0].value || []) : []

  // Material objects, in connection order to the mesh, give per-slot names.
  // FBX stores an object name as "Name\x00\x01Class"; keep only the name so no
  // null byte reaches the GLTF material name (a null in the name breaks
  // three.js shader-comment injection → "Missing main()" on strict GL paths).
  const matNames = objects.children.filter((c) => c.name === 'Material').map((m) => String(propVal(m, 1) || 'Material').split('\x00')[0])

  const groups = new Map() // materialIndex -> { positions, normals, indices, key2idx }
  const groupFor = (mi) => {
    if (!groups.has(mi)) groups.set(mi, { positions: [], normals: [], indices: [], key2idx: new Map() })
    return groups.get(mi)
  }

  let corner = 0 // running index into PolygonVertexIndex / Normals
  let polygon = 0
  let face = [] // [ [vertIndex, cornerIndex], ... ] for the current polygon
  const flush = () => {
    if (face.length < 3) { face = []; return }
    const mi = matMapping === 'ByPolygon' ? (matIndices[polygon] || 0) : (matIndices[0] || 0)
    const g = groupFor(mi)
    const push = (v, c) => {
      const key = v + ':' + c
      let i = g.key2idx.get(key)
      if (i === undefined) {
        i = g.positions.length / 3
        g.key2idx.set(key, i)
        g.positions.push(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2])
        g.normals.push(normals[c * 3], normals[c * 3 + 1], normals[c * 3 + 2])
      }
      return i
    }
    for (let k = 2; k < face.length; k++) {
      g.indices.push(push(...face[0]), push(...face[k - 1]), push(...face[k]))
    }
    face = []
    polygon++
  }
  for (let p = 0; p < pvi.length; p++) {
    let vi = pvi[p]
    const endOfFace = vi < 0
    if (endOfFace) vi = ~vi
    face.push([vi, corner])
    corner++
    if (endOfFace) flush()
  }

  return [...groups.entries()].map(([mi, g]) => ({
    name: matNames[mi] || matNames[0] || 'Material',
    positions: g.positions,
    normals: g.normals,
    indices: g.indices,
  }))
}
