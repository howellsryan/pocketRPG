import { palette } from './palette.js';
import * as T from '../../public/vendor/three/three.module.min.js';

const W = 600, H = 384;
const scene = new T.Scene();
scene.background = new T.Color(palette['--ink-mine-background']);
const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W,H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const camera = new T.OrthographicCamera(-2.55,2.55,1.632,-1.632,.01,40);
camera.position.set(4.1,4.4,7.1);
camera.lookAt(.17,1.08,0);
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

// A small, fixed-camera mine. Geometry carries the texture; no image filters.
box(12,.18,12,palette['--ink-floor-mid'],0,-.13,0);
for(let x=-5;x<5;x++)for(let z=-4;z<5;z++){
 const tones=[palette['--ink-floor-shadow'],palette['--ink-floor-light'],palette['--ink-floor-dark'],palette['--ink-floor-pale']];
 const m=box(.99,.035,.99,tones[(x*x+z*z)%4],x,.001,z);m.receiveShadow=true;
}
for(let i=0;i<19;i++){
 const x=-5+i*.54,z=-1.55-rnd()*.5;
 const m=ico(.65+rnd()*.4,[palette['--ink-shale-shadow'],palette['--ink-shale-mid'],palette['--ink-shale-light'],palette['--ink-shale-deep']][i%4],x,.47+rnd()*.23,z,[1,1.05+rnd()*.4,.72]);
 m.rotation.set(rnd(),rnd()*3,rnd());
 if(i%3===0)ico(.47,palette['--ink-shale-deep'],x,.22,z+.5,[1,.7,.65]);
}
for(let i=0;i<45;i++){
 const x=(rnd()-.5)*8,z=(rnd()-.5)*5;
 if(x>-.95&&x<2.1&&z>-.7&&z<.8)continue;
 const m=ico(.05+rnd()*.14,[palette['--ink-gravel-mid'],palette['--ink-gravel-dark'],palette['--ink-gravel-light']][i%3],x,.04,z,[1,.5,1]);m.rotation.y=rnd()*6;
}
// A weathered timber support and an unlit crate keep the mine unglamorous.
box(.15,2.8,.17,palette['--ink-support-dark'],-2.13,1.36,-1.2);
box(.18,2.75,.19,palette['--ink-support-low'],2.65,1.33,-1.33);
box(5.1,.2,.2,palette['--ink-support-mid'],.23,2.62,-1.32);
for(const x of [-2.13,2.65]){box(.2,.06,.2,palette['--ink-support-deep'],x,.22,-1.28);box(.2,.06,.2,palette['--ink-support-deep'],x,1.82,-1.28);}
box(.65,.46,.56,palette['--ink-crate-wood'],-1.72,.24,.2);
for(let i=0;i<4;i++)box(.62,.014,.015,palette['--ink-crate-gap'],-1.72,.06+i*.12,.487);
for(const x of [-1.99,-1.46])box(.07,.48,.05,palette['--ink-haft'],x,.24,.5);
const brazier=new T.Group();scene.add(brazier);brazier.position.set(2.24,0,-.92);
seg(v(0,0,0),v(0,1.12,0),.042,.036,palette['--ink-boot'],brazier);
mesh(new T.ConeGeometry(.085,.23,5),palette['--ink-leather'],brazier).position.y=1.17;
const flame=mesh(new T.ConeGeometry(.052,.16,5),palette['--ink-ember'],brazier);flame.position.y=1.36;
const flameCore=mesh(new T.ConeGeometry(.025,.10,4),palette['--ink-ember-light'],brazier);flameCore.position.set(0,1.32,.032);
const lamp=new T.PointLight(palette['--ink-light-lamp'],1.1,3,2);lamp.position.set(2.24,1.35,-.9);scene.add(lamp);

const rockGroup=new T.Group();scene.add(rockGroup);
const rock=mesh(new T.DodecahedronGeometry(.79,0),palette['--ink-rock'],rockGroup);
rock.position.set(1.2,.54,.02);rock.scale.set(1,.87,.8);rock.rotation.set(.15,.38,.1);
ico(.28,palette['--ink-rock-shade'],1.64,.15,.36,[1,.65,1]);ico(.22,palette['--ink-rock'],.87,.08,.55,[1,.5,1]);
scene.updateMatrixWorld(true);
const ray=new T.Raycaster(v(-2,.99,.075),v(1,0,0));
const hit=ray.intersectObject(rock)[0];
if(!hit)throw new Error('Contact ray misses the rock');
const contact=hit.point.clone();
const normal=hit.face.normal.clone().transformDirection(rock.matrixWorld);
const bareTargets=[.035,.14].map(z=>{
 const h=new T.Raycaster(v(-2,.99,z),v(1,0,0)).intersectObject(rock)[0];
 return h.point.clone().addScaledVector(h.face.normal.clone().transformDirection(rock.matrixWorld),.06);
});
const ore=new T.Group();scene.add(ore);
// Copper seams sit on the actual contact face, with a depleted material variant.
const basisX=v(0,1,0).cross(normal).normalize(),basisY=normal.clone().cross(basisX).normalize();
for(let i=0;i<8;i++){
 const off=basisX.clone().multiplyScalar((rnd()-.5)*.32).addScaledVector(basisY,(rnd()-.5)*.25);
 const p=contact.clone().add(off).addScaledVector(normal,.012);
 const s=.035+rnd()*.03;
 const m=ico(s,[palette['--ink-copper-light'],palette['--ink-copper-dark'],palette['--tier-bronze']][i%3],p.x,p.y,p.z,[1,.68,.6],ore);m.rotation.set(rnd(),rnd(),rnd());
}
for(const p of [[1.24,1.12,.17],[1.55,.93,.35],[.99,.94,.41],[1.54,.56,.62]])ico(.07,palette['--tier-bronze'],...p,[1,.5,1],ore);

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
const pick=new T.Group();scene.add(pick);
seg(v(0,-.14,0),v(0,.88,0),.034,.027,palette['--ink-haft'],pick);
seg(v(0,-.13,0),v(0,.035,0),.037,.037,palette['--ink-haft-shade'],pick);
const shape=new T.Shape();
// Crescent profile follows the bespoke steel-pickaxe icon, in a rigid tool frame.
shape.moveTo(-.39,.86);shape.lineTo(-.23,.95);shape.lineTo(0,.985);shape.lineTo(.23,.95);shape.lineTo(.39,.86);shape.lineTo(.2,.875);shape.lineTo(.08,.80);shape.lineTo(-.08,.80);shape.lineTo(-.20,.875);shape.closePath();
const blade=mesh(new T.ExtrudeGeometry(shape,{depth:.065,bevelEnabled:false}),palette['--tier-steel'],pick);blade.position.z=-.0325;
box(.09,.15,.09,palette['--tier-iron'],0,.862,0,pick);
const pickTip=v(.39,.86,0);
const strikeAngle=-1.10;
const rotatedTip=pickTip.clone().applyAxisAngle(v(0,0,1),strikeAngle);
const impactPivot=contact.clone().sub(rotatedTip);

// Two-bone solve with a stable elbow pole. Tool frame owns both grip targets.
function ik(start,end,L1,L2,pole){
 const dir=end.clone().sub(start),dist=dir.length();dir.normalize();
 const d=Math.max(.001,Math.min(dist,L1+L2-.001));
 const along=(L1*L1-L2*L2+d*d)/(2*d);
 const height=Math.sqrt(Math.max(0,L1*L1-along*along));
 const perp=pole.clone().sub(start);perp.addScaledVector(dir,-perp.dot(dir)).normalize();
 return start.clone().addScaledVector(dir,along).addScaledVector(perp,height);
}
const keys=[
 {p:0, x:impactPivot.x,y:impactPivot.y,a:strikeAngle,lean:-.12,hip:.045},
 {p:.09,x:impactPivot.x-.035,y:impactPivot.y+.02,a:strikeAngle+.04,lean:-.10,hip:.04},
 {p:.26,x:-.31,y:1.07,a:-.65,lean:-.055,hip:.015},
 {p:.42,x:-.39,y:1.30,a:-.05,lean:0,hip:-.005},
 {p:.65,x:-.39,y:1.59,a:.54,lean:.10,hip:-.045},
 {p:.76,x:-.39,y:1.59,a:.54,lean:.10,hip:-.045},
 {p:.84,x:-.32,y:1.50,a:.08,lean:.015,hip:0},
 {p:1, x:impactPivot.x,y:impactPivot.y,a:strikeAngle,lean:-.12,hip:.045},
];
const chips=[];
for(let i=0;i<6;i++)chips.push(ico(.018+i%3*.007,i%2?palette['--ink-copper-dark']:palette['--tier-iron'],0,0,0));
let current=0,currentMode='pick';
function pose(ms,depleted=false,mode='pick',draw=true){
 current=ms;
 currentMode=mode;
 const p=((ms%800)+800)%800/800;
 let a=keys[0],b=keys[1];
 for(let i=1;i<keys.length;i++){if(p<=keys[i].p){a=keys[i-1];b=keys[i];break;}}
 let t=(p-a.p)/(b.p-a.p);
 // Deliberate pose transitions: no spring easing, overshoot, or squash.
 if(a.p<.76)t=t*t*(3-2*t);
 const mix=k=>T.MathUtils.lerp(a[k],b[k],t);
 const bare=mode==='bare',offset=bare?.8:0;
 const hx=-.72+(bare?.012*Math.sin(p*Math.PI*2):mix('hip'))+offset,hy=.89;
 const lean=bare?-.12:mix('lean');
 torso.position.set(hx,hy,0);torso.rotation.set(0,.04*Math.sin(p*Math.PI*2),lean);
 pelvis.position.set(hx,.85,0);
 head.rotation.z=-.05-lean*.25;
 for(let i=0;i<2;i++){
  const h=v(hx,.83,(i?.17:-.17));
  const foot=feet[i].clone().add(v(offset,0,0));
  const knee=ik(h,foot,.39,.40,v((i?-.18:-.49)+offset,.45,foot.z));
  setSeg(thighs[i],h,knee);setSeg(calves[i],knee,foot);
  boots[i].position.x=feet[i].x+offset;
 }
 pick.visible=!bare;
 pick.position.set(mix('x'),mix('y'),contact.z);pick.rotation.z=mix('a');
 scene.updateMatrixWorld(true);
 for(let i=0;i<2;i++){
  const shoulder=torso.localToWorld(v(.025,.49,i?.265:-.265));
  const grip=bare?bareTargets[i].clone().add(v(i?0:-.14*Math.sin(p*Math.PI)**2,i?0:.055*Math.sin(p*Math.PI),0)):pick.localToWorld(v(0,i?0:.205,i?.035:-.035));
  const elbow=ik(shoulder,grip,.39,.39,v(-.17+offset,1.10,i?.5:-.5));
  setSeg(arms[i].upper,shoulder,elbow);setSeg(arms[i].fore,elbow,grip);
  arms[i].hand.position.copy(grip);arms[i].hand.rotation.z=bare?-.15:mix('a');
 }
 ore.visible=!depleted;
 const age=p*800;
 for(let i=0;i<chips.length;i++){
  const m=chips[i];m.visible=!bare&&age>0&&age<240;
  const dt=age/1000;
  m.position.copy(contact).add(v(-dt*(.7+i*.16),dt*(.8+i*.10)-dt*dt*4.5,(i-2.5)*dt*.27));
  m.rotation.set(i+dt*7,i*.3+dt*5,dt*4);
 }
 if(draw)renderer.render(scene,camera);
 const worldTip=pick.localToWorld(pickTip.clone());
 return {p,mode,tip:worldTip.toArray(),contact:contact.toArray(),tipDistance:worldTip.distanceTo(contact),feet:feet.map(f=>f.clone().add(v(offset,0,0)).toArray()),grips:arms.map(x=>x.hand.position.toArray()),armLengths:arms.map(x=>[x.upper.scale.y,x.fore.scale.y])};
}
function screen(p){const q=p.clone().project(camera);return {x:(q.x+1)/2*W,y:(1-q.y)/2*H};}
window.__pose=(ms,depleted=false,mode='pick')=>pose(ms,depleted,mode);
// Offline authoring diagnostics expose the actual transformed meshes and joints.
window.__rigSnapshot=()=>{
 scene.updateMatrixWorld(true);
 function triangles(group,exclude=[],local=false){
  const result=[];
  group.traverse(m=>{
   if(!m.isMesh||exclude.some(g=>g===m||g.getObjectById(m.id)))return;
   const position=m.geometry.attributes.position,index=m.geometry.index;
   const count=index?index.count:position.count;
   for(let i=0;i<count;i+=3){
    const tri=[];
    for(let j=0;j<3;j++)tri.push(v(0,0,0).fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(m.matrixWorld).applyMatrix4(local?group.matrixWorld.clone().invert():new T.Matrix4()).toArray());
    result.push(tri);
   }
  });return result;
 }
 const line=(a,b)=>[pick.localToWorld(a).toArray(),pick.localToWorld(b).toArray()];
 window.__bodyData=()=>[triangles(head,[],true),triangles(neck,[],true),triangles(torso,[head,neck],true)];
 return {head:triangles(head),neck:triangles(neck),torso:triangles(torso,[head,neck]),
  shaft:currentMode==='bare'?null:line(v(0,-.14,0),v(0,.88,0)),
  arms:arms.map(a=>({shoulder:a.upper.localToWorld(v(0,-.5,0)).toArray(),elbow:a.upper.localToWorld(v(0,.5,0)).toArray(),grip:a.hand.position.toArray()}))};
};
window.__export=()=>renderer.domElement.toDataURL('image/png');
window.__mask=()=>{
 const originals=[],black=new T.MeshBasicMaterial({color:0x000000}),red=new T.MeshBasicMaterial({color:0xff0000}),green=new T.MeshBasicMaterial({color:0x00ff00}),blue=new T.MeshBasicMaterial({color:0x0000ff});
 scene.traverse(m=>{if(!m.isMesh)return;originals.push([m,m.material]);
  m.material=m===rock?blue:ore.getObjectById(m.id)?green:(m===blade||(m.parent===pick&&m.material.color?.getHexString()==='8c8c8c'))?red:black;
 });
 const background=scene.background;scene.background=new T.Color(0x000000);
 renderer.render(scene,camera);const png=renderer.domElement.toDataURL('image/png');
 for(const [m,material] of originals)m.material=material;
 scene.background=background;black.dispose();red.dispose();green.dispose();blue.dispose();
 renderer.render(scene,camera);return png;
};
window.__meta={width:W,height:H,contact:screen(contact),periodMs:800,cycleMs:2400,framesPerStrike:20};
window.__ready=true;
pose(400);

window.__snapshot=window.__rigSnapshot;
window.__compact=()=>({family:currentMode==='bare'?'mine-hands':'mine-pick',arms:arms.map(a=>[a.upper.scale.y,a.fore.scale.y]),legs:thighs.map((a,i)=>[a.scale.y,calves[i].scale.y]),feet:feet.map(f=>f.clone().add(v(currentMode==='bare'?.8:0,0,0)).toArray()),matrices:[head,neck,torso].map(m=>m.matrixWorld.toArray()),shaft:currentMode==='bare'?null:[v(0,-.14,0),v(0,.88,0)].map(a=>pick.localToWorld(a).toArray()),forearms:arms.map(a=>[a.fore.localToWorld(v(0,-.5,0)).toArray(),a.fore.localToWorld(v(0,.5,0)).toArray()]),contact:contact.toArray(),tip:currentMode==='bare'?null:pick.localToWorld(pickTip.clone()).toArray()});
window.__pose=(phase,family,draw=true)=>{const result=pose(phase*800,false,family==='mine-hands'?'bare':'pick',draw);return {...result,...window.__compact()}};
window.__families=['mine-pick','mine-hands'];
