import * as THREE from 'three'
import { tileToWorld } from './scene'
import type { ExitMarker } from '../../shared/protocol'
import type { Pickable } from './picking'

export type ExitLayer = {
  pickables: THREE.Object3D[]
  tiles: Map<string, { x: number; z: number }>
  update: (now: number) => void
}

function nameboard(label: string): THREE.Sprite | null {
  if(typeof document==='undefined') return null
  const canvas=document.createElement('canvas')
  canvas.width=512; canvas.height=160
  const ctx=canvas.getContext('2d')
  if(!ctx) return null
  ctx.fillStyle='#302419';ctx.fillRect(0,0,512,160)
  ctx.strokeStyle='#b9975d';ctx.lineWidth=10;ctx.strokeRect(5,5,502,150)
  ctx.fillStyle='#f2e1b7';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 38px Georgia'
  const words=label.split(' '),lines:string[]=[];let line=''
  for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>460&&line){lines.push(line);line=word}else line=next}
  lines.push(line)
  lines.slice(0,2).forEach((text,i)=>ctx.fillText(text,256,lines.length>1?54+i*54:80))
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true}))
  sprite.scale.set(3.6,1.125,1)
  return sprite
}

export function createExitMarkers(scene: THREE.Scene, exits: ExitMarker[]): ExitLayer {
  const pickables:THREE.Object3D[]=[],tiles=new Map<string,{x:number;z:number}>()
  const pulsing:THREE.MeshBasicMaterial[]=[]
  for(const exit of exits) {
    if(exit.hideMarker&&!exit.presentation) continue
    const wrapper=new THREE.Group()
    if(exit.presentation&&!exit.hideMarker) {
      const material=new THREE.MeshStandardMaterial({color:exit.presentation==='gate'?0x765534:0x777367,roughness:1})
      // Side posts occupy the blocked tiles x±2. The three-tile opening is clear.
      for(const x of [-2,2]) {
        const post=new THREE.Mesh(new THREE.BoxGeometry(.7,2.7,.65),material)
        post.position.set(x,1.35,0);post.castShadow=true;post.receiveShadow=true;wrapper.add(post)
      }
      if(exit.presentation==='cave') {
        const recess=new THREE.Mesh(new THREE.PlaneGeometry(3,2.45),new THREE.MeshStandardMaterial({color:0x211e19,roughness:1,side:THREE.DoubleSide}))
        recess.position.set(0,1.22,-.65);wrapper.add(recess)
      }
      const lintel=new THREE.Mesh(new THREE.BoxGeometry(4.7,.45,.7),material)
      lintel.position.y=2.8;lintel.castShadow=true;wrapper.add(lintel)
      if(exit.presentation==='cave') {
        const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.15,0),material)
        crown.scale.set(2.05,.5,.7);crown.position.set(0,3.15,0);crown.castShadow=true;wrapper.add(crown)
      }
    } else if(!exit.presentation) {
      const pad=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.04,24),new THREE.MeshBasicMaterial({color:0xd9a94a,transparent:true,opacity:.55}))
      const ring=new THREE.Mesh(new THREE.RingGeometry(.44,.55,24).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xf3d27e,transparent:true,opacity:.8}))
      pad.position.y=.02;ring.position.y=.03;wrapper.add(pad,ring)
      pulsing.push(pad.material as THREE.MeshBasicMaterial,ring.material as THREE.MeshBasicMaterial)
    }
    if(exit.presentation) {
      const proxy=new THREE.Mesh(new THREE.BoxGeometry(3,2.7,.65),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}))
      proxy.position.y=1.35;wrapper.add(proxy)
      const board=nameboard(exit.label)
      if(board){board.position.set(0,exit.hideMarker?2.7:3.8,0);wrapper.add(board)}
    }
    wrapper.position.copy(tileToWorld(exit.x,exit.z))
    wrapper.userData.pick={kind:'exit',id:exit.id,name:exit.label,actions:[{label:'Enter',action:'go'}],
      examine:exit.description??'Enter this area through the doorway.'} satisfies Pickable
    scene.add(wrapper);pickables.push(wrapper);tiles.set(exit.id,{x:exit.x,z:exit.z})
  }
  return {pickables,tiles,update:(now)=>{
    const pulse=.65+.35*Math.sin(now/400)
    for(let i=0;i<pulsing.length;i+=2){pulsing[i].opacity=.35+.3*pulse;pulsing[i+1].opacity=.5+.4*pulse}
  }}
}

