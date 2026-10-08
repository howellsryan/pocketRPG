import * as THREE from 'three'
import { GROUND_KINDS, groundKind, groundKindGrid, type ZoneGroundRegion } from '../../shared/groundKinds'

import { paintGeometryData } from './paintGeometry'

// Painted ground layer (docs/world-design-review-2026-07.md §4.1). Renders a
// zone's `ground` regions — dirt paths, cobbled roads, plazas, farm soil,
// interior floors, water — as a lit overlay draped over the base ground, plus a
// translucent surface plane for water. Pure decoration: collision/movement stay
// on the ASCII grid, so this touches render only. Composes over BOTH ground
// materials (checker and the blended terrain preset) because it's a separate
// mesh sitting just above them, not a texture edit — one code path, both looks.
//
// The overlay uses alphaTest (not blending): every texel is either a kind's
// solid colour or fully transparent, so a hard cutout keeps depthWrite on,
// receives the sun's shadow, and never z-fights (a small polygonOffset lifts it
// off the base). Raycasting is disabled on the overlay and water so click-to-
// move still hits the base ground mesh underneath.

/** Per-tile RGBA canvas: a painted tile gets its kind colour (opaque), an
 * unpainted tile is transparent. Null when nothing is painted. */
function buildKindTexture(width: number, height: number, grid: string[]): THREE.CanvasTexture | null {
  let painted = false
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, width, height)
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const kind = groundKind(grid[z * width + x])
      if (!kind) continue
      painted = true
      ctx.fillStyle = kind.color
      ctx.fillRect(x, z, 1, 1)
    }
  }
  if (!painted) return null
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Adds the painted-ground overlay for `ground` regions. Returns the mesh (for
 * disposal) or null when nothing is painted. */
export function createGroundPaint(
  scene: THREE.Scene,
  width: number,
  height: number,
  ground: ZoneGroundRegion[] | undefined,
  corners: Float32Array | null,
): THREE.Mesh | null {
  const grid = groundKindGrid(width, height, ground)
  const texture = buildKindTexture(width, height, grid)
  if (!texture) return null
  const codes=Object.fromEntries(GROUND_KINDS.map((kind,i)=>[kind.id,i+1]))
  const matches=(ids:string[])=>ids.map(id=>'abs(vPaintKind-'+codes[id]+'.0)<.1').join(' || ')
  const data=paintGeometryData(width,height,grid,codes,corners)
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3))
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2))
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3))
  geometry.setAttribute('paintKind',new THREE.Float32BufferAttribute(data.kinds,1))
  geometry.setIndex(data.indices)
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.5,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  material.onBeforeCompile=(shader)=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nattribute float paintKind;\nvarying float vPaintKind;\nvarying vec2 vPaintXY;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintKind=paintKind;\nvPaintXY=position.xz;')
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
varying float vPaintKind;
varying vec2 vPaintXY;
float paintHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`)
      .replace('#include <map_fragment>',`#include <map_fragment>
float shade=.95+.10*paintHash(floor(vPaintXY*14.0));
if(${matches(['path_cobble','plaza','floor_stone','floor_tile'])}){
  vec2 cell=vec2(vPaintXY.x*2.4+mod(floor(vPaintXY.y*2.8),2.0)*.5,vPaintXY.y*2.8);
  vec2 f=fract(cell);
  float edge=min(min(f.x,1.0-f.x),min(f.y,1.0-f.y));
  shade*=mix(.69,.92+.13*paintHash(floor(cell)),smoothstep(.025,.07,edge));
}else if(${matches(['farm'])}){
  shade*=.85+.15*smoothstep(.10,.45,abs(fract(vPaintXY.x*3.0)-.5));
}else if(${matches(['floor_plank'])}){
  float gap=min(fract(vPaintXY.y*4.0),1.0-fract(vPaintXY.y*4.0));
  shade*=mix(.58,1.05,smoothstep(.025,.09,gap));
  shade*=.92+.08*paintHash(floor(vec2(vPaintXY.x*.7,vPaintXY.y*4.0)));
}else if(${matches(['path_dirt','sand','marsh'])}){
  shade*=.94+.10*paintHash(floor(vPaintXY*2.5));
}
diffuseColor.rgb*=shade;`)
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.raycast = () => {}
  scene.add(mesh)
  return mesh
}

/** Adds a translucent surface plane per water region (its painted colour is the
 * riverbed showing through). Returns the planes for disposal. */
export function createWater(
  scene: THREE.Scene,
  ground: ZoneGroundRegion[] | undefined,
  heightAt: (x: number, z: number) => number,
): THREE.Mesh[] {
  const planes: THREE.Mesh[] = []
  for (const r of ground ?? []) {
    const kind = groundKind(r.kind)
    if (!kind?.water) continue
    const cx = r.x + r.w / 2
    const cz = r.z + r.h / 2
    const geometry = new THREE.PlaneGeometry(r.w, r.h)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(cx, heightAt(cx, cz) + 0.06, cz)
    const material = new THREE.MeshStandardMaterial({
      color: kind.surface ?? '#3b6b88',
      transparent: true,
      opacity: 0.74,
      // Molten rock is lit from inside and barely reflects; water is the reverse.
      roughness: kind.molten ? 0.85 : 0.15,
      metalness: kind.molten ? 0 : 0.2,
      emissive: new THREE.Color(kind.molten ? (kind.surface ?? '#d2571d') : '#000000'),
      emissiveIntensity: kind.molten ? 0.7 : 0,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    mesh.raycast = () => {}
    scene.add(mesh)
    planes.push(mesh)
  }
  return planes
}
