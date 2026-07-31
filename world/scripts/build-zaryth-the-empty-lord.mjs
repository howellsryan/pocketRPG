#!/usr/bin/env node
// Builds world/client/public/models/zaryth_the_empty_lord.glb from the arena's
// boss model (public/3d-samples/monsters/zaryth_the_empty_lord.glb).
//
// Same shape as build-warlord-grondar.mjs — rename the arena's clips to the
// protocol's anim states (§5 EntityDiff.anim) and drop the rest — minus the
// decimation pass: this source is already inside the world's triangle budget,
// so simplifying it would only cost silhouette on a boss the camera sits close
// to.
//
// Zaryth swings with ONE clip for every style. The world protocol splits ranged
// from magic where the arena treats them as one, so `attack_magic` is a copy of
// `attack_ranged` rather than a missing action that would fall back to idle
// mid-cast — and `attack` is a copy of it too. The rig's own melee clip rears
// up, strikes, and then collapses to the floor with no recovery: trimmed at the
// follow-through it read as a slow reach, untrimmed as the boss dying mid-fight,
// and this boss rerolls its style every swing, so it was a third of everything
// you ever saw it do. The runtime side of that call is the shared clip table
// (src/engine/monsterClips.js), which sends the arena's melee style to the same
// clip; this drops the unused one out of the world's GLB.
//
// The source has no locomotion clip at all, and aliasing walk to idle left the
// boss sliding across its throne room in a standing pose. WALK_SRC is the
// Quaternius UAL `Walk_Loop` retargeted onto this rig's own bones and stripped
// to keyframes (no mesh), regenerated with:
//
//   node scripts/retarget-animations.mjs \
//     --target public/3d-samples/monsters/zaryth_the_empty_lord.glb \
//     --source "assets/open-world/Quaternius/Universal Animation Library[Standard] (1)/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb" \
//     --clips Walk_Loop --rename '{"Walk_Loop":"walk"}' --out <tmp>.glb
//
// then dropping the meshes/materials from the result. It is a separate file
// rather than a clip baked into the arena source because that source is the
// combat arena's model too, and re-exporting a Tripo asset through the
// retargeter to gain one clip drifts the mesh it shares with the arena.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, resample, getBounds } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const SRC = path.join(repoRoot, 'public', '3d-samples', 'monsters', 'zaryth_the_empty_lord.glb')
const WALK_SRC = path.join(repoRoot, 'assets', 'open-world', 'retargeted', 'zaryth_the_empty_lord_walk.glb')
const OUT = path.join(worldDir, 'client', 'public', 'models', 'zaryth_the_empty_lord.glb')

const CLIPS = [
  { clip: 'Idle', as: 'idle' },
  { clip: 'AttackRanged', as: 'attack_ranged' },
  { clip: 'Death', as: 'die' },
]
const ALIAS = [
  { from: 'attack_ranged', as: 'attack_magic' },
  { from: 'attack_ranged', as: 'attack' },
]

// The corpse is removed NPC_REMOVE_AFTER_DEATH_TICKS after death (3.6s), so a
// longer die clip is simply cut off mid-fall. This source collapses by ~3.0s
// and then spends five seconds settling, so the tail is trimmed rather than the
// world-wide linger being stretched for one monster. Keyframes only — LINEAR
// and STEP samplers both survive a slice; CUBICSPLINE would not, so it throws.
const DIE_MAX_SEC = 3.4

/**
 * Trims one clip to `maxSec` by giving each of its samplers a FRESH pair of
 * accessors sized to match.
 *
 * Never mutate an accessor in place here. dedup() merges byte-identical
 * accessors, so by this point one array is shared by dozens of samplers — and
 * across clips, since every clip animates the same rig. Slicing in place cut
 * data that other samplers still pointed at, leaving times and values with
 * different lengths: 107 of `die`'s 123 samplers, plus one in every other clip.
 * THREE throws building a KeyframeTrack from that, which took the whole world
 * client down the moment the model loaded. A later dedup() re-shares whatever
 * is genuinely identical, so unsharing here costs nothing in the output.
 */
function trimClip(doc, anim, maxSec) {
  const buffer = doc.getRoot().listBuffers()[0]
  for (const sampler of anim.listSamplers()) {
    // LINEAR and STEP both survive a slice; CUBICSPLINE stores tangents either
    // side of each value and would need those rebuilt.
    if (sampler.getInterpolation() === 'CUBICSPLINE') throw new Error('cannot trim a CUBICSPLINE sampler')
    const input = sampler.getInput()
    const output = sampler.getOutput()
    const times = input.getArray()
    const values = output.getArray()
    const size = output.getElementSize()
    let keep = 0
    while (keep < times.length && times[keep] <= maxSec) keep += 1
    if (keep >= times.length) continue

    // Dropping the later keyframes is not enough on its own: resample() reduces
    // an unchanging track to two keyframes spanning the WHOLE clip, and a
    // track's last time is what gives the clip its duration. So the cut always
    // ends on a keyframe pinned at maxSec, holding the pose the rig is in at
    // that instant — which is what actually shortens the clip.
    const step = sampler.getInterpolation() === 'STEP'
    const prev = Math.max(0, keep - 1)
    const t0 = times[prev]
    const t1 = times[keep]
    const f = step || t1 === t0 ? 0 : (maxSec - t0) / (t1 - t0)
    const edge = new Float32Array(size)
    for (let c = 0; c < size; c++) {
      const a = values[prev * size + c]
      const b = values[keep * size + c]
      edge[c] = a + (b - a) * f
    }
    // Rotations are quaternions: componentwise blending shortens them, so
    // renormalise or the bone arrives at the cut visibly scaled.
    if (size === 4) {
      const len = Math.hypot(edge[0], edge[1], edge[2], edge[3])
      if (len > 0) for (let c = 0; c < 4; c++) edge[c] /= len
    }

    const newTimes = new Float32Array(keep + 1)
    newTimes.set(times.slice(0, keep))
    newTimes[keep] = maxSec
    const newValues = new Float32Array((keep + 1) * size)
    newValues.set(values.slice(0, keep * size))
    newValues.set(edge, keep * size)

    sampler
      .setInput(doc.createAccessor().setType('SCALAR').setArray(newTimes).setBuffer(buffer))
      .setOutput(doc.createAccessor().setType(output.getType()).setArray(newValues).setBuffer(buffer))
  }
}

/**
 * Copies one clip out of another document onto THIS rig, matching channels to
 * bones by NAME — the retargeted file carries the same skeleton, so a name that
 * doesn't resolve means the rig changed underneath it and the walk would come
 * out missing a limb rather than failing.
 */
function importClip(doc, srcDoc, name) {
  const srcAnim = srcDoc.getRoot().listAnimations().find((a) => a.getName() === name)
  if (!srcAnim) throw new Error(`clip '${name}' not found in ${WALK_SRC}`)
  const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
  const buffer = doc.getRoot().listBuffers()[0]
  const anim = doc.createAnimation(name)
  for (const channel of srcAnim.listChannels()) {
    const target = byName.get(channel.getTargetNode().getName())
    if (!target) throw new Error(`clip '${name}' animates '${channel.getTargetNode().getName()}', absent from ${SRC}`)
    const src = channel.getSampler()
    const sampler = doc.createAnimationSampler()
      .setInterpolation(src.getInterpolation())
      .setInput(doc.createAccessor().setType('SCALAR').setArray(src.getInput().getArray().slice()).setBuffer(buffer))
      .setOutput(doc.createAccessor().setType(src.getOutput().getType()).setArray(src.getOutput().getArray().slice()).setBuffer(buffer))
    anim.addSampler(sampler)
    anim.addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(channel.getTargetPath()).setSampler(sampler))
  }
  return anim
}

/**
 * Holds every bone the other clips animate, but this one doesn't, at its REST
 * transform for the clip's whole duration.
 *
 * three.js only writes the bones a clip has tracks for, so an imported clip that
 * covers 22 of 43 bones inherits the other 21 from whatever played last — the
 * retargeter maps the skeleton proper and leaves the twist bones (and Root /
 * Pelvis) alone, so a walk crossfaded out of an attack kept that attack's hunch
 * baked into the spine and hips. Two keyframes per track: the cost is bytes, and
 * it makes the clip self-contained from any starting pose.
 */
function pinRestPose(doc, anim, others) {
  const buffer = doc.getRoot().listBuffers()[0]
  const animated = new Set(anim.listChannels().map((c) => c.getTargetNode()))
  const end = Math.max(...anim.listSamplers().map((s) => s.getInput().getMax([0])[0]))
  const elsewhere = new Set()
  for (const other of others) for (const channel of other.listChannels()) elsewhere.add(channel.getTargetNode())
  for (const node of elsewhere) {
    if (animated.has(node)) continue
    for (const [path, value] of [['translation', node.getTranslation()], ['rotation', node.getRotation()], ['scale', node.getScale()]]) {
      const sampler = doc.createAnimationSampler()
        .setInterpolation('LINEAR')
        .setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, end])).setBuffer(buffer))
        .setOutput(doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array([...value, ...value])).setBuffer(buffer))
      anim.addSampler(sampler)
      anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler))
    }
  }
}

/** Every sampler must have one value per keyframe time. Asserted on the way out
 * because a mismatch is invisible in the file size and the bounds log, and only
 * shows up as a crash in the client. */
function assertSamplersIntact(doc) {
  for (const anim of doc.getRoot().listAnimations()) {
    for (const sampler of anim.listSamplers()) {
      const times = sampler.getInput().getCount()
      const values = sampler.getOutput().getCount()
      if (times !== values) {
        throw new Error(`clip '${anim.getName()}': ${times} keyframe times vs ${values} values`)
      }
    }
  }
}

await MeshoptDecoder.ready
await MeshoptEncoder.ready
// The arena source is meshopt-compressed (process-3d-model.mjs), so writing it
// back out needs the ENCODER as well as the decoder that read it.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(SRC)

const keep = new Map()
for (const anim of doc.getRoot().listAnimations()) {
  const name = anim.getName()
  const spec = CLIPS.find(({ clip }) => name === clip || name.endsWith(`|${clip}`))
  if (spec && !keep.has(spec.as)) {
    keep.set(spec.as, anim)
  } else {
    for (const channel of anim.listChannels()) channel.dispose()
    for (const sampler of anim.listSamplers()) sampler.dispose()
    anim.dispose()
  }
}
for (const { as } of CLIPS) {
  if (!keep.has(as)) throw new Error(`clip for '${as}' not found in ${SRC}`)
}
for (const [as, anim] of keep) anim.setName(as)
for (const { from, as } of ALIAS) {
  const copy = keep.get(from).clone()
  copy.setName(as)
  keep.set(as, copy)
}
const walk = importClip(doc, await io.read(WALK_SRC), 'walk')
pinRestPose(doc, walk, [...keep.values()])
keep.set('walk', walk)

await doc.transform(resample(), dedup(), prune())

// Trim last: resample() reads the untouched samplers, and dedup() decides which
// accessors are shared — trimClip has to know it is working against shared data.
trimClip(doc, keep.get('die'), DIE_MAX_SEC)
// Re-share what is still identical and drop the accessors the trim orphaned.
await doc.transform(dedup(), prune())
assertSamplersIntact(doc)

await io.write(OUT, doc)

const b = getBounds(doc.getRoot().listScenes()[0])
const f = (n) => Number(n.toFixed(3))
console.log(`build-zaryth-the-empty-lord: wrote ${path.relative(repoRoot, OUT)}`)
console.log(`clips: ${[...keep.keys()].join(', ')}`)
console.log(`bounds: { minX: ${f(b.min[0])}, minY: ${f(b.min[1])}, minZ: ${f(b.min[2])}, maxX: ${f(b.max[0])}, maxY: ${f(b.max[1])}, maxZ: ${f(b.max[2])} }`)
