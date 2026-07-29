#!/usr/bin/env node
// Repaints the base-colour texels belonging to one REGION OF A MODEL'S BODY,
// selected in model space rather than by hue.
//
//   node scripts/paint-model-region.mjs <in.glb> --y0 0.62 --y1 0.79 --xmax 0.085 \
//     --color '#2c2333' [--out other.glb]
//
// Sibling of recolor-model.mjs, which remaps a hue BAND across the whole model
// — that cannot select a body part whose colour the rest of the body shares
// (bare skin is the same hue everywhere). This walks the mesh instead: every
// triangle whose vertices sit inside the box is rasterised through its own UVs
// into a texel mask, so only the surface inside the box is repainted, wherever
// its UV island happens to sit in the atlas.
//
// The original texel's luminance modulates the new colour, so painted-in
// shading and ambient occlusion survive the repaint and the region still reads
// as a surface rather than a flat hole.
//
// Editing the file in place is intended, but a re-run is NOT a no-op: the shade
// is taken from whatever the texel currently holds, so a second pass over an
// already-painted region reads its own output and shifts the colour again — and
// the whole atlas is re-encoded to lossy WebP each time, which costs quality on
// texels the box never touched. Re-run from the original model, not the output.

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

const args = process.argv.slice(2)
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def }
const num = (name, def) => { const v = opt(name); return v === null ? def : Number(v) }
const out = opt('--out')
const y0 = num('--y0', -Infinity)
const y1 = num('--y1', Infinity)
const xmax = num('--xmax', Infinity)
const zmin = num('--zmin', -Infinity)
// How many of a triangle's three corners must be inside the box. 2 closes the
// cracks a strict all-three test leaves along the region's own edges, without
// spilling a whole triangle in off a single stray corner.
const minInside = num('--corners', 2)
const color = opt('--color', '#2c2333')
const src = args[0]
if (!src) { console.error('usage: paint-model-region.mjs <in.glb> [--out o.glb] --y0 N --y1 N [--xmax N] [--zmin N] --color #rrggbb'); process.exit(1) }

const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(src)

const texture = doc.getRoot().listTextures()[0]
if (!texture) throw new Error('model has no texture to paint')
const [width, height] = texture.getSize()
const pixels = await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer()
const mask = new Uint8Array(width * height)

/** Marks every texel the triangle covers, half-open edges included — a texel
 * left unmarked between two triangles shows through as a lit skin-coloured
 * seam, so the test deliberately errs toward covering. */
function rasterise(uv, a, b, c) {
  const p = [a, b, c].map((v) => [uv[v * 2] * width, uv[v * 2 + 1] * height])
  const lo = (i, size) => Math.max(0, Math.floor(Math.min(p[0][i], p[1][i], p[2][i])) - 1)
  const hi = (i, size) => Math.min(size - 1, Math.ceil(Math.max(p[0][i], p[1][i], p[2][i])) + 1)
  const edge = (p1, p2, x, y) => (x - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (y - p2[1])
  for (let y = lo(1, height); y <= hi(1, height); y++) {
    for (let x = lo(0, width); x <= hi(0, width); x++) {
      const e1 = edge(p[0], p[1], x + 0.5, y + 0.5)
      const e2 = edge(p[1], p[2], x + 0.5, y + 0.5)
      const e3 = edge(p[2], p[0], x + 0.5, y + 0.5)
      // Inside when no pair of edge functions disagrees on sign — winding-order
      // agnostic, so a mesh with mixed winding still paints.
      if (!((e1 < 0 || e2 < 0 || e3 < 0) && (e1 > 0 || e2 > 0 || e3 > 0))) mask[y * width + x] = 1
    }
  }
}

let triangles = 0
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')?.getArray()
    const uv = prim.getAttribute('TEXCOORD_0')?.getArray()
    const idx = prim.getIndices()?.getArray()
    if (!pos || !uv || !idx) continue
    const inside = (v) => pos[v * 3 + 1] >= y0 && pos[v * 3 + 1] <= y1 && Math.abs(pos[v * 3]) <= xmax && pos[v * 3 + 2] >= zmin
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2]
      if (Number(inside(a)) + Number(inside(b)) + Number(inside(c)) < minInside) continue
      rasterise(uv, a, b, c)
      triangles++
    }
  }
}

let painted = 0
for (let i = 0; i < mask.length; i++) {
  if (!mask[i]) continue
  painted++
  const o = i * 3
  const luma = (pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114) / 255
  const shade = Math.min(1.35, 0.62 + 0.72 * luma)
  for (let c = 0; c < 3; c++) pixels[o + c] = Math.min(255, Math.round(rgb[c] * shade))
}

const repainted = await sharp(pixels, { raw: { width, height, channels: 3 } }).webp({ quality: 92 }).toBuffer()
texture.setImage(repainted).setMimeType('image/webp')
await io.write(out ?? src, doc)
console.log(`paint-model-region: ${triangles} triangles, ${painted} texels → ${color} in ${out ?? src}`)
