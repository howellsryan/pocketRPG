import { palette } from './palette.js';
import * as T from '../../public/vendor/three/three.module.min.js';

const W = 800, H = 512;
const scene = new T.Scene();
scene.background = new T.Color(palette['--ink-stone-shade']);
const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W,H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const camera = new T.OrthographicCamera(-1.72,1.72,1.1008,-1.1008,.01,40);
camera.position.set(3.4,3.3,7.1);
camera.lookAt(.12,.98,0);
camera.updateMatrixWorld(true);
scene.add(new T.HemisphereLight(palette['--ink-light-sky'],palette['--ink-light-ground'],2.15));
const sun = new T.DirectionalLight(palette['--ink-light-sun'],2.45);
sun.position.set(-2.5,6,4.5); sun.castShadow=true;
sun.shadow.mapSize.set(1024,1024);
Object.assign(sun.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:16});
sun.shadow.bias=-.001;sun.shadow.normalBias=.025;scene.add(sun);
const fill=new T.DirectionalLight(palette['--ink-light-fill'],.65);fill.position.set(4,2,-4);scene.add(fill);

const mats={};
function mat(color){ return mats[color] ||= new T.MeshLambertMaterial({color,flatShading:true}); }
function mesh(g,c,parent=scene){const m=new T.Mesh(g,typeof c==='string'?mat(c):c);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function box(w,h,d,c,x,y,z,parent=scene){const m=mesh(new T.BoxGeometry(w,h,d),c,parent);m.position.set(x,y,z);return m;}
function ico(r,c,x,y,z,s=[1,1,1],parent=scene){const m=mesh(new T.IcosahedronGeometry(r,0),c,parent);m.position.set(x,y,z);m.scale.set(...s);return m;}
function seg(a,b,r1,r2,c,parent=scene){const m=mesh(new T.CylinderGeometry(r2,r1,1,5),c,parent);setSeg(m,a,b);return m;}
const up=new T.Vector3(0,1,0);
function setSeg(m,a,b){const d=new T.Vector3().subVectors(b,a);m.position.copy(a).add(b).multiplyScalar(.5);m.scale.y=d.length();m.quaternion.setFromUnitVectors(up,d.normalize());}
const v=(x,y,z)=>new T.Vector3(x,y,z);
let seed=31;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};

// Original faceted human. Cross-sections describe anatomy rather than stacking
// cylinders/boxes: broad shoulders, waist taper, cheekbones and a narrow jaw.
const profile=[[1,.5],[.65,1],[-.65,1],[-1,.5],[-1,-.5],[-.65,-1],[.65,-1],[1,-.5]];
function loft(rings,c,parent=scene){
 const pos=[],indices=[];
 for(const r of rings)for(const [x,z] of profile)pos.push(x*(x>0?r.front:r.back)+(r.cx||0),r.y,z*r.width);
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<8;i++){
  const a=j*8+i,b=j*8+(i+1)%8,d=a+8,e=b+8;
  indices.push(a,d,b,b,d,e);
 }
 for(let i=1;i<7;i++){indices.push(0,i,i+1);const o=(rings.length-1)*8;indices.push(o,o+i+1,o+i);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(indices);g.computeVertexNormals();
 return mesh(g,c,parent);
}
function patch(points,c,parent){
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points.flat(),3));g.computeVertexNormals();
 const surface=mat(c).clone();surface.side=T.DoubleSide;return mesh(g,surface,parent);
}
const skin=palette['--ink-skin'],hairColor=palette['--ink-hair-cropped'];
const torso=new T.Group();scene.add(torso);
loft([
 {y:.015,front:.139,back:.119,width:.165},
 {y:.18,front:.142,back:.127,width:.176},
 {y:.39,front:.18,back:.143,width:.241},
 {y:.49,front:.143,back:.12,width:.266},
 {y:.545,front:.09,back:.09,width:.125},
],palette['--ink-leather'],torso);
// Open vest over a linen shirt. A low V collar preserves the existing costume.
patch([[.147,.48,-.078],[.153,.38,0],[.147,.48,.078]],palette['--ink-bone'],torso);
for(const side of [-1,1])patch([[.145,.492,side*.085],[.158,.388,0],[.181,.396,side*.09]],palette['--ink-leather-shade'],torso);
loft([{y:.01,front:.147,back:.126,width:.174},{y:.072,front:.148,back:.127,width:.173}],palette['--ink-leather-shade'],torso);
box(.018,.046,.055,palette['--ink-brass'],.157,.041,0,torso);
box(.022,.024,.027,palette['--ink-leather-shade'],.163,.041,0,torso);
const neck=loft([{y:.53,front:.068,back:.06,width:.066},{y:.66,front:.065,back:.055,width:.057}],skin,torso);
const head=new T.Group();torso.add(head);head.position.set(.043,.775,0);head.scale.setScalar(.84);
loft([
 {y:-.175,front:.071,back:.059,width:.065},
 {y:-.125,front:.121,back:.094,width:.098},
 {y:-.058,front:.149,back:.122,width:.128},
 {y:.045,front:.141,back:.133,width:.133},
 {y:.133,front:.123,back:.124,width:.119},
 {y:.17,front:.078,back:.087,width:.087},
],skin,head);
// Small eyes sit on the forward plane; no painted cheeks or cartoon pupils.
for(const z of [-.061,.061]){
 box(.008,.015,.026,palette['--ink-eye'],.144,.018,z,head);
 const brow=box(.009,.017,.038,hairColor,.143,.047,z,head);brow.rotation.x=z>0?-.08:.08;
}
// Four planes form the bridge and tip of the nose rather than a projecting cube.
patch([[.145,.047,-.022],[.187,-.039,0],[.145,-.057,-.023],
 [.145,.047,.022],[.145,-.057,.023],[.187,-.039,0],
 [.145,-.057,-.023],[.187,-.039,0],[.145,-.057,.023]],skin,head);
box(.006,.009,.05,palette['--ink-lip'],.128,-.105,0,head);
for(const z of [-.137,.137])ico(.026,skin,-.027,-.002,z,[.62,1,.5],head);
// A pitched crown, clipped temples and irregular fringe keep the hair human.
loft([
 {y:.116,front:.137,back:.142,width:.14},
 {y:.18,front:.113,back:.13,width:.126},
 {y:.207,front:.054,back:.08,width:.077,cx:-.026},
],hairColor,head);
for(const side of [-1,1]){
 patch([[-.14,.119,side*.073],[-.14,-.056,side*.072],[-.075,-.039,side*.134],
 [-.14,.119,side*.073],[-.075,-.039,side*.134],[.075,.081,side*.138]],hairColor,head);
 patch([[.076,.135,side*.136],[.113,.058,side*.101],[.145,.121,side*.057]],hairColor,head);
}
patch([[.144,.124,-.076],[.151,.087,-.035],[.146,.116,.033]],palette['--ink-hair-highlight'],head);

const pelvis=loft([{y:-.06,front:.122,back:.124,width:.181},{y:.09,front:.14,back:.127,width:.174}],palette['--ink-waist']);
const feet=[v(-.91,.095,-.21),v(-.49,.095,.24)];
const thighs=[],calves=[],boots=[];
function limb(rings,c){return loft(rings.map(([y,r,w])=>({y:-y,front:r,back:r,width:w})),c);}
for(let i=0;i<2;i++){
 const boot=new T.Group();scene.add(boot);boot.position.set(feet[i].x,.0,feet[i].z);boot.rotation.y=i?.08:-.06;
 boots.push(boot);
 loft([{y:.015,front:.208,back:.082,width:.091},{y:.06,front:.194,back:.075,width:.085},{y:.11,front:.134,back:.068,width:.078},{y:.21,front:.058,back:.054,width:.063}],palette['--ink-boot'],boot);
 loft([{y:.013,front:.209,back:.084,width:.093},{y:.034,front:.203,back:.08,width:.091}],palette['--ink-sole'],boot);
 thighs.push(limb([[-.5,.086,.08],[-.10,.108,.10],[.5,.118,.116]],palette['--ink-trousers']));
 calves.push(limb([[-.5,.057,.055],[-.08,.079,.072],[.28,.087,.082],[.5,.083,.077]],palette['--ink-trousers']));
}
const arms=[];
for(let i=0;i<2;i++){
 const upper=limb([[-.5,.065,.061],[-.10,.085,.077],[.5,.101,.094]],skin);
 const sleeve=loft([{y:-.51,front:.1,back:.1,width:.095},{y:-.34,front:.107,back:.107,width:.098},{y:0,front:.092,back:.092,width:.084}],palette['--ink-bone'],upper);
 const fore=limb([[-.5,.040,.038],[-.04,.065,.054],[.5,.065,.059]],skin);
 const hand=new T.Group();scene.add(hand);
 loft([{y:-.055,front:.039,back:.035,width:.037},{y:.007,front:.046,back:.043,width:.04},{y:.041,front:.033,back:.034,width:.03}],skin,hand);
 const thumb=ico(.023,skin,.035,-.005,i?-.035:.035,[1,1.25,.85],hand);
 arms.push({upper,fore,hand});
}
function ik(start,end,L1,L2,pole){
 const dir=end.clone().sub(start),dist=dir.length();dir.normalize();
 const d=Math.max(.001,Math.min(dist,L1+L2-.001));
 const along=(L1*L1-L2*L2+d*d)/(2*d);
 const height=Math.sqrt(Math.max(0,L1*L1-along*along));
 const perp=pole.clone().sub(start);perp.addScaledVector(dir,-perp.dot(dir)).normalize();
 return start.clone().addScaledVector(dir,along).addScaledVector(perp,height);
}

export {T,scene,renderer,camera,W,H,mat,mesh,box,ico,seg,setSeg,v,loft,patch,torso,pelvis,head,neck,feet,thighs,calves,boots,arms,ik};
