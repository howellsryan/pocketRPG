// Derive a colour variant of a processed GLB by remapping its base-colour
// texture's dominant hue band — how one authored model (e.g. the dragon
// scimitar) becomes the whole metal tier (bronze/iron/.../runeforged) without
// re-authoring. Selective: only pixels within --tol degrees of --from move to
// --to, so leather grips and gold pommels (different hue bands) survive.
//
//   node scripts/recolor-model.mjs <in.glb> <out.glb> --from 6 --to 174 [--tol 30] [--sat 1.0] [--light 1.0]
//
// --from/--to : source/target hue in degrees (0-360)
// --tol       : half-width of the hue band to remap (default 30)
// --sat       : saturation multiplier for remapped pixels (iron/steel want <1)
// --light     : lightness multiplier for remapped pixels
//
// Run on the PROCESSED (post process-3d-model.mjs) file: textures are already
// webp and small, so variants stay cheap. Normal/roughness maps are untouched.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : Number(process.argv[i + 1]);
}

const [inFile, outFile] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && (i === 0 || !all[i - 1].startsWith('--')));
if (!inFile || !outFile) {
  console.error('usage: node scripts/recolor-model.mjs <in.glb> <out.glb> --from <hue> --to <hue> [--tol 30] [--sat 1.0] [--light 1.0]');
  process.exit(1);
}
const fromHue = arg('--from', 6);
const toHue = arg('--to', NaN);
const tol = arg('--tol', 30);
const satScale = arg('--sat', 1.0);
const lightScale = arg('--light', 1.0);
if (Number.isNaN(toHue)) {
  console.error('--to <hue> is required.');
  process.exit(1);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(conv(h + 1 / 3) * 255), Math.round(conv(h) * 255), Math.round(conv(h - 1 / 3) * 255)];
}

function hueDist(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return Math.min(d, 360 - d);
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const doc = await io.read(inFile);
const seen = new Set();
let remapped = 0;
for (const mat of doc.getRoot().listMaterials()) {
  const tex = mat.getBaseColorTexture();
  if (!tex || seen.has(tex)) continue;
  seen.add(tex);
  const img = tex.getImage();
  const { data, info } = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let touched = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    // Greys have no meaningful hue — leave them so shading detail survives.
    if (s < 0.08 || hueDist(h, fromHue) > tol) continue;
    const [r, g, b] = hslToRgb(toHue, Math.min(1, s * satScale), Math.min(1, l * lightScale));
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
    touched++;
  }
  remapped += touched;
  // Untouched texture (hue band absent) → keep the original bytes; a webp
  // re-encode would only add generation loss.
  if (touched === 0) continue;
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 85 })
    .toBuffer();
  tex.setImage(out).setMimeType('image/webp');
}

await io.write(outFile, doc);
console.log(`${outFile}  hue ${fromHue}→${toHue} (±${tol}, sat×${satScale}, light×${lightScale})  ${remapped.toLocaleString()} px remapped`);
