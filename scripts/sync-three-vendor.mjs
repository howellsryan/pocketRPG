// Sync the vendored three.js under public/vendor/three/ from the pinned npm
// package (devDependency "three", exact version). The app loads these as real
// ES modules at runtime (see src/utils/three3d.js) — they are never bundled —
// so the vendor copy must be a complete, self-resolving module graph.
//
//   npm run sync:three
//
// Copies the core build (three.module.js + three.core.js — BOTH are required;
// three.module.js imports './three.core.js') and the addons we use, rewriting
// the addons' bare `from 'three'` specifiers to relative paths so the graph
// resolves without an import map in both Vite dev (/vendor/…) and the deployed
// single-file build (/public/vendor/…).

import fs from 'fs';
import path from 'path';

const SRC = 'node_modules/three';
const DEST = 'public/vendor/three';

// [source (relative to node_modules/three), dest (relative to DEST), rewrite bare 'three'?]
const FILES = [
  ['build/three.module.js', 'three.module.js', false],
  ['build/three.core.js', 'three.core.js', false],
  ['examples/jsm/loaders/GLTFLoader.js', 'jsm/loaders/GLTFLoader.js', true],
  ['examples/jsm/controls/OrbitControls.js', 'jsm/controls/OrbitControls.js', true],
  ['examples/jsm/libs/meshopt_decoder.module.js', 'jsm/libs/meshopt_decoder.module.js', true],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'jsm/utils/BufferGeometryUtils.js', true],
  ['examples/jsm/utils/SkeletonUtils.js', 'jsm/utils/SkeletonUtils.js', true],
];

for (const [src, dest, rewrite] of FILES) {
  let code = fs.readFileSync(path.join(SRC, src), 'utf8');
  if (rewrite) {
    const depth = dest.split('/').length - 1;
    const rel = '../'.repeat(depth) + 'three.module.js';
    code = code.replace(/from\s+(['"])three\1/g, `from '${rel}'`);
  }
  const out = path.join(DEST, dest);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, code);
  console.log(`${out}  ${(code.length / 1024).toFixed(0)} KiB`);
}
console.log(`synced from three@${JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version}`);
