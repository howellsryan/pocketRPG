import { palette } from './palette.js';
import {T,scene,renderer,camera,W,H,mesh,box,ico,seg,setSeg,v,torso,pelvis,head,neck,feet,thighs,calves,boots,arms,ik} from './rig.js';

// Fixed material roles match the game's --ink-* palette. Original geometry.
const C={ground:palette['--ink-hide-stone'],stone:palette['--ink-hide-stone'],dark:palette['--ink-stone-shade'],wood:palette['--ink-haft'],bark:palette['--ink-bark'],leaf:palette['--ink-leaf'],leafHi:palette['--ink-leaf-light'],water:palette['--ink-water'],waterHi:palette['--ink-water-light'],steel:palette['--ink-hide-iron-light'],steelDark:palette['--ink-hide-iron-shade'],linen:palette['--ink-bone'],leather:palette['--ink-leather'],ember:palette['--ink-ember'],gold:palette['--ink-brass'],magic:palette['--ink-arcane'],spirit:palette['--ink-spirit'],rope:palette['--ink-rope']};
const HUMAN=[torso,pelvis,...thighs,...calves,...boots,...arms.flatMap(a=>[a.upper,a.fore,a.hand])];
const allFamilies=['mine-pick','mine-hands','chop-axe','chop-hands','fish-net','fish-rod','fish-cage','fish-harpoon','fish-hands','kindle','cook','food-assemble','smelt','smith','smith-ammo','blade-assemble','special-assemble','tan','sew','glass','gem-cut','jewellery','carve','feather','arrow-tip','string-bow','bolt-tip','brew','combine-potions','bury','offer','scatter','hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank','runecraft','hunt-cow','hunt-person','hunt-herbi','hunt-reaper','steal','steal-guard','steal-stall','build','infuse','scroll','agility','dungeon','plant','harvest-ground','harvest-tree','harvest-fruit'];
let family='',world,tool,other,fx=[],dynamic=[],contact=null,tip=null,toolLine=null;
const anchor=v(0,1.02,.05);
function line(a,b,r,c,parent){return seg(v(...a),v(...b),r,r,c,parent);}
function newGroup(parent=world){const g=new T.Group();parent.add(g);return g;}
function ring(r,c,x,y,z,parent=world){const m=mesh(new T.TorusGeometry(r,.014,4,12),c,parent);m.position.set(x,y,z);return m;}
function timber(w,h,d,x,y,z,parent=world){return box(w,h,d,C.wood,x,y,z,parent);}
function tree(x=1.05,z=0,fruit=false){
 line([x,.02,z],[x,2.55,z],.19,C.bark,world);
 for(const s of [-1,1])line([x,1.6,z],[x+s*.55,2.15,z+s*.27],.075,C.bark,world);
 for(const [dx,dy,dz] of [[0,2.9,0],[-.4,2.55,.1],[.4,2.6,-.1],[.15,2.45,.38]])ico(.7,C.leaf,x+dx,dy,z+dz,[1,.7,1],world);
 if(fruit)for(const [dx,dy,dz] of [[-.4,2.05,.27],[.16,2.13,.5],[.53,2.15,.05]])ico(.095,C.ember,x+dx,dy,z+dz,[1,1,1],world);
}
function bench(){
 timber(1.35,.11,.8,.5,.86,0);
 for(const x of [-.02,1.03])for(const z of [-.3,.3])timber(.09,.83,.09,x,.42,z);
 timber(.12,.09,.75,.5,.24,0);
}
function altar(color=C.magic){
 box(.95,.67,.72,C.dark,.56,.34,0,world);box(1.08,.16,.86,C.stone,.56,.76,0,world);
 for(const z of [-.42,.42])box(1.0,.06,.025,color,.56,.78,z,world);
 ring(.22,color,.5,.86,.03).rotation.x=-Math.PI/2;
}
function fire(x=.5,z=0){
 for(const a of [-.6,.6]){const m=timber(.65,.10,.10,x,.06,z);m.rotation.y=a;}
 for(let i=0;i<5;i++){const m=mesh(new T.ConeGeometry(.09,.38,5),i%2?C.gold:C.ember,world);m.position.set(x+(i-2)*.075,.22,z+(i%2)*.08);fx.push(m);}
}
function furnace(){
 box(1.3,1.65,.20,C.dark,.98,.82,-.43,world);
 box(.24,1.65,.85,C.stone,1.50,.82,.1,world);
 box(.24,.70,.85,C.stone,.45,.35,.1,world);
 box(1.30,.38,.85,C.stone,.98,1.48,.1,world);
 box(1.3,.22,.85,C.dark,.98,.11,.1,world);fire(.86,.18);
 box(.63,.035,.56,C.ember,.88,.30,.16,world);
}
function person(guard=false){
 const body=torso.clone(true);body.position.set(1.02,.89,.08);body.rotation.set(0,Math.PI,0);world.add(body);
 for(const z of [-.17,.17]){
 line([1.02,.88,z],[1.02,.22,z],.09,guard?C.steelDark:C.leather,world);
 box(.30,.14,.18,C.bark,.97,.10,z,world);
 line([1.02,1.34,z*1.6],[1.1,.89,z*1.65],.066,guard?C.steel:C.linen,world);
 }
 if(guard){box(.28,.40,.51,C.steel,1.01,1.18,.08,world);ico(.19,C.steelDark,1.01,1.62,.08,[1,1,1],world);}
 return body;
}
function quarry(kind){
 if(kind==='person')return person();
 if(kind==='reaper'){
 mesh(new T.ConeGeometry(.32,1.45,6),C.dark,world).position.set(1.07,.75,.12);
 ico(.23,C.bark,1.07,1.53,.12,[.8,1.2,1],world);ico(.12,C.linen,.88,1.48,.18,[.5,1,.8],world);
 line([1.33,.08,.34],[1.33,1.88,.34],.028,C.wood,world);line([1.33,1.88,.34],[.86,1.67,.34],.045,C.steel,world);return;
 }
 const cow=kind==='cow',color=cow?C.linen:C.leaf;
 ico(.45,color,1.15,.62,.12,[1.45,.78,.75],world);ico(.25,color,.72,.83,.11,[.75,1,.7],world);
 for(const x of [.85,1.48])for(const z of [-.14,.37])line([x,.6,z],[x,.04,z],.06,cow?C.linen:C.bark,world);
 if(cow){for(const z of [-.04,.24])line([.75,1.0,z],[.8,1.20,z*1.8],.035,C.gold,world);ico(.20,C.dark,1.12,.7,.45,[1,.6,.4],world);}
 else for(let i=0;i<5;i++)ico(.18,C.leafHi,1.15+(i-2)*.11,1.0,.1,[.4,1.4,.6],world);
}
function setup(name){
 if(world){scene.remove(world);world.traverse(m=>{if(m.isMesh)m.geometry.dispose();});}
 family=name;world=new T.Group();scene.add(world);fx=[];dynamic=[];tool=null;other=null;tip=null;contact=null;toolLine=null;
 const outdoor=/^(chop|fish|hunt|steal|agility|plant|harvest)/.test(name),river=name.startsWith('fish');
 scene.background=new T.Color(outdoor?C.leaf:C.dark);
 box(12,.14,12,outdoor?C.leaf:C.ground,0,-.09,0,world);
 for(let x=-4;x<5;x++)for(let z=-3;z<4;z++){
  if(river&&x>0)continue;
  box(.98,.018,.98,outdoor?(x%2?C.leafHi:C.leaf):(x%2?C.stone:C.dark),x,-.003,z,world);
 }
 if(!outdoor){
  for(let i=-3;i<4;i++)for(let j=0;j<3;j++)box(.93,.52,.20,j%2?C.dark:C.stone,i+(j%2)*.45,.24+j*.54,-1.62,world);
  timber(.14,2.65,.15,-2.22,1.28,-1.4);timber(.14,2.65,.15,2.5,1.28,-1.4);timber(4.85,.15,.16,.14,2.55,-1.4);
 }else{
  tree(-2.35,-2);tree(2.9,-2);ico(.32,C.stone,-1.8,.12,.7,[1,.5,1],world);
 }
 if(name.startsWith('mine')){
  const rock=mesh(new T.DodecahedronGeometry(.79,0),C.steelDark,world);rock.position.set(1.2,.54,.02);rock.scale.set(1,.87,.8);rock.rotation.set(.15,.38,.1);
  scene.updateMatrixWorld(true);const h=new T.Raycaster(v(-2,.99,.075),v(1,0,0)).intersectObject(rock)[0];contact=h.point.clone();
  for(let i=0;i<6;i++)ico(.055,C.ember,contact.x+.015,contact.y+(i-2.5)*.065,contact.z+(i%2)*.08,[.6,1,.7],world);
  if(name==='mine-pick'){
   tool=newGroup();line([0,-.14,0],[0,.88,0],.03,C.wood,tool);
   const s=new T.Shape();s.moveTo(-.39,.86);s.lineTo(-.23,.95);s.lineTo(0,.985);s.lineTo(.23,.95);s.lineTo(.39,.86);s.lineTo(.2,.875);s.lineTo(.08,.8);s.lineTo(-.08,.8);s.lineTo(-.2,.875);s.closePath();
   const b=mesh(new T.ExtrudeGeometry(s,{depth:.065,bevelEnabled:false}),C.steel,tool);b.position.z=-.0325;tip=v(.39,.86,0);toolLine=[v(0,-.14,0),v(0,.88,0)];
  }
 }else if(name.startsWith('chop')||name==='harvest-tree'){
  tree(.78,0);contact=v(.59,1.06,.075);
  if(name!=='chop-hands'){
   tool=newGroup();line([0,-.09,0],[0,.70,0],.031,C.wood,tool);
   const s=new T.Shape();s.moveTo(-.06,.74);s.lineTo(.14,.83);s.lineTo(.34,.82);s.lineTo(.39,.62);s.lineTo(.28,.46);s.lineTo(.09,.52);s.lineTo(-.06,.57);s.closePath();
   const b=mesh(new T.ExtrudeGeometry(s,{depth:.065,bevelEnabled:false}),C.steel,tool);b.position.z=-.0325;tip=v(.39,.62,0);toolLine=[v(0,-.09,0),v(0,.7,0)];
  }
 }else if(river){
  box(6,.04,6,C.water,3.25,-.02,1.0,world);
  for(let i=0;i<10;i++)box(1.2,.008,.025,C.waterHi,.6+(i%3)*.7,.011,(i-5)*.42,world);
  for(let i=0;i<7;i++){line([.23,.02,-.65-i*.12],[.23,.55+i%2*.14,-.65-i*.12],.012,C.leafHi,world);}
  tool=newGroup();
  if(name==='fish-rod'){
   line([0,-.09,0],[0,1.37,0],.018,C.wood,tool);box(.06,.11,.065,C.gold,0,.10,.04,tool);tip=v(0,1.37,0);toolLine=[v(0,-.09,0),tip.clone()];
   other=line([0,0,0],[0,1,0],.003,C.linen,world);fx.push(ico(.025,C.ember,1.35,.04,.19,[1,1.5,1],world));
  }else if(name==='fish-net'){
   line([0,-.04,0],[0,.68,0],.025,C.wood,tool);const r=ring(.23,C.rope,0,.79,0,tool);r.rotation.x=Math.PI/2;
   for(let i=-2;i<3;i++){line([i*.07,.79,-.18],[i*.06,.56,.14],.006,C.rope,tool);line([-.18,.75,i*.07],[.18,.56,i*.06],.006,C.rope,tool);}tip=v(0,.79,0);toolLine=[v(0,-.04,0),v(0,.68,0)];
  }else if(name==='fish-cage'){
   for(const y of [0,.16,.32])ring(.19,C.rope,0,y,0,tool).rotation.x=Math.PI/2;
   for(let i=0;i<8;i++){const a=i*Math.PI/4;line([Math.cos(a)*.19,0,Math.sin(a)*.19],[Math.cos(a)*.19,.32,Math.sin(a)*.19],.013,C.wood,tool);}tip=v(0,0,0);
  }else if(name==='fish-harpoon'){
   line([0,-.04,0],[0,.84,0],.022,C.wood,tool);line([0,.82,0],[0,1.0,0],.025,C.steel,tool);line([0,.95,0],[.10,.85,0],.025,C.steel,tool);tip=v(0,1,0);toolLine=[v(0,-.04,0),v(0,.84,0)];
  }
 }else if(['kindle','cook','bury','plant','harvest-ground','hunt-cow','hunt-person','hunt-herbi','hunt-reaper'].includes(name)){
  if(name==='kindle'||name==='cook')fire(.30);
  else if(name==='bury'||name==='plant'||name==='harvest-ground'){
   box(.95,.025,.85,C.bark,.4,.025,0,world);
   for(let i=0;i<4;i++)box(.88,.015,.045,C.dark,.4,.045,(i-1.5)*.18,world);
   if(name==='harvest-ground')for(let i=0;i<5;i++){const x=.1+(i%3)*.23,z=(i%2)*.27-.1;line([x,0,z],[x,.30,z],.018,C.leafHi,world);ico(.1,C.leaf,x,.23,z,[1,.6,1],world);}
  }else{
   quarry(name.slice(5));box(.43,.03,.43,C.bark,.29,.045,.10,world);ring(.19,C.rope,.29,.085,.10).rotation.x=Math.PI/2;
  }
  if(name==='kindle'){tool=newGroup();box(.07,.055,.06,C.steel,0,0,0,tool);}
  if(name==='cook'){tool=newGroup();line([0,-.10,0],[0,.45,0],.02,C.wood,tool);box(.35,.025,.23,C.steel,0,.45,0,tool);tip=v(0,.45,0);}
 }else if(['smelt','glass'].includes(name)){
  furnace();tool=newGroup();line([0,-.08,0],[0,.6,0],.021,C.steelDark,tool);box(.23,.06,.25,C.steel,0,.62,0,tool);tip=v(0,.62,0);toolLine=[v(0,-.08,0),v(0,.6,0)];
 }else if(name==='smith'||name==='smith-ammo'){
  box(.39,.53,.45,C.bark,.46,.26,0,world);box(.53,.12,.38,C.steelDark,.46,.61,0,world);box(.69,.14,.40,C.steel,.36,.76,0,world);
  mesh(new T.ConeGeometry(.18,.36,4),C.steel,world).position.set(.8,.77,0);
  box(.27,.025,.15,C.ember,.22,.85,0,world);contact=v(.22,.88,-.10);
  if(name==='smith-ammo')for(let i=0;i<5;i++)box(.07,.02,.07,C.steel,.20+(i%2)*.1,.85,.12+(i%3)*.06,world);
  tool=newGroup();line([0,-.025,0],[0,.34,0],.028,C.wood,tool);box(.23,.12,.12,C.steel,0,.36,0,tool);tip=v(.10,.36,0);toolLine=[v(0,-.025,0),v(0,.34,0)];
 }else if(name.startsWith('steal')){
  if(name==='steal-stall'){bench();timber(1.8,.1,1.3,.7,1.85,0);for(const x of [-.1,1.5])timber(.09,1.8,.09,x,.9,-.5);for(let i=0;i<3;i++)ico(.15,C.linen,.4+i*.25,1.04,0,[1,.5,1],world);}
  else person(name==='steal-guard');
 }else if(name==='harvest-fruit')tree(.7,0,true);
 else if(name==='agility'){
  const barrier=newGroup();dynamic.push(barrier);
  for(const z of [-.38,.38])timber(.10,.65,.10,.75,.32,z,barrier);
  timber(.08,.12,1.0,.75,.67,0,barrier);box(1.6,.08,1.15,C.stone,1.63,.09,0,world);
 }else if(name==='dungeon'){
  for(const x of [.55,1.65])box(.34,1.8,.46,C.dark,x,.90,-.45,world);
  box(1.4,.40,.46,C.dark,1.10,1.85,-.45,world);box(.95,1.5,.06,C.bark,1.1,.75,-.55,world);
  tool=newGroup();line([0,-.05,0],[0,.38,0],.025,C.wood,tool);fx.push(mesh(new T.ConeGeometry(.06,.20,5),C.ember,tool));fx[0].position.y=.46;
 }else if(['offer','runecraft','infuse','scroll','hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank'].includes(name)){
  altar(name==='offer'?C.gold:name==='infuse'||name==='scroll'?C.spirit:C.magic);
  if(name==='hex'){box(.22,.7,.20,C.bark,1.38,.50,0,world);ico(.21,C.rope,1.38,1.0,0,[1,1.25,1],world);}
  if(name==='infuse'||name==='scroll')ico(.24,C.spirit,.63,1.32,0,[.55,1.8,.55],world);
  for(let i=0;i<7;i++)fx.push(ico(.028,name==='offer'?C.gold:name==='superheat'?C.ember:name==='infuse'||name==='scroll'?C.spirit:C.magic,0,0,0,[1,1,1],world));
 }else if(name==='scatter'){
  for(let i=0;i<8;i++)fx.push(ico(.018,C.linen,0,0,0,[1,1,1],world));
 }else{
  bench();
  if(name==='build'){
   for(const z of [-.25,.25])timber(.65,.10,.08,.40,1.05,z);
   for(const x of [.15,.68])timber(.08,.34,.08,x,1.15,.25);
   tool=newGroup();line([0,-.025,0],[0,.3,0],.026,C.wood,tool);box(.2,.1,.1,C.steel,0,.32,0,tool);tip=v(.1,.32,0);contact=v(.15,1.10,-.18);toolLine=[v(0,-.025,0),v(0,.3,0)];
  }else if(['brew','combine-potions'].includes(name)){
   for(let i=0;i<(name==='combine-potions'?3:1);i++){ico(.11,C.magic,.45+i*.22,1.02,.08,[.65,1,.65],world);box(.065,.10,.065,C.linen,.45+i*.22,1.16,.08,world);}
   other=newGroup();ico(.08,C.magic,0,0,0,[.65,1,.65],other);box(.05,.08,.05,C.linen,0,.12,0,other);
   tool=newGroup();line([0,-.08,0],[0,.22,0],.01,C.wood,tool);
  }else if(name==='string-bow'){
   other=newGroup();const curve=new T.QuadraticBezierCurve3(v(0,-.42,0),v(.20,0,0),v(0,.42,0));mesh(new T.TubeGeometry(curve,12,.025,4,false),C.wood,other);line([0,-.42,0],[0,.42,0],.005,C.rope,other);
  }else if(name==='tan'){
   const hide=ico(.40,C.leather,.40,.97,.06,[1.7,.055,1.0],world);tool=newGroup();box(.1,.04,.20,C.steel,0,0,0,tool);
  }else if(name==='blade-assemble'||name==='special-assemble'){
   box(.90,.035,.13,C.steel,.46,.97,.07,world);box(.08,.07,.30,C.gold,.80,1.01,.07,world);tool=newGroup();box(.12,.07,.12,C.gold,0,0,0,tool);
  }else{
   const color=['gem-cut','jewellery'].includes(name)?C.magic:name==='sew'?C.leather:C.wood;
   box(.44,.025,.24,color,.27,.96,.05,world);
   tool=newGroup();
   if(name==='sew')line([0,-.05,0],[0,.12,0],.006,C.steel,tool);
   else if(name==='feather'){line([0,-.08,0],[0,.09,0],.008,C.wood,tool);ico(.09,C.linen,0,.07,0,[.3,1,.25],tool);}
   else if(name==='arrow-tip'||name==='bolt-tip')ico(.035,C.steel,0,.02,0,[.5,1.3,.5],tool);
   else if(name==='food-assemble')box(.10,.045,.09,C.linen,0,0,0,tool);
   else {line([0,-.08,0],[0,.06,0],.025,C.wood,tool);box(.035,.18,.04,C.steel,0,.13,0,tool);}
  }
 }
 scene.updateMatrixWorld(true);
}
function smooth(t){return t*t*(3-2*t);}
function keys(p,rows){
 let a=rows[0],b=rows[1];for(let i=1;i<rows.length;i++)if(p<=rows[i][0]){a=rows[i-1];b=rows[i];break;}
 const t=a[0]>=.76?(p-a[0])/(b[0]-a[0]):smooth((p-a[0])/(b[0]-a[0]));
 return a.slice(1).map((n,i)=>T.MathUtils.lerp(n,b[i+1],t));
}
let lastInfo;
function pose(p,name=family,draw=true){
 if(name!==family)setup(name);
 p=Math.max(0,Math.min(1,p));const s=Math.sin(p*Math.PI*2),reach=Math.sin(p*Math.PI)**2;
 let hx=-.64,hy=.89,lean=-.04,turn=0;
 let targets=[v(-.10,1.10,-.18),v(-.12,1.06,.19)];
 let position=v(-.10,1.13,-.18),angle=-1.65,footTargets=feet.map(f=>f.clone().add(v(.08,0,0)));
 if(family==='mine-pick'){
  hx=-.72;
  const end=contact.clone().sub(tip.clone().applyAxisAngle(v(0,0,1),-1.10));
  const k=keys(p,[[0,end.x,end.y,-1.1,-.12,.045],[.09,end.x-.035,end.y+.02,-1.06,-.10,.04],[.26,-.31,1.07,-.65,-.055,.015],[.42,-.39,1.30,-.05,0,-.005],[.65,-.39,1.59,.54,.10,-.045],[.76,-.39,1.59,.54,.10,-.045],[.84,-.32,1.50,.08,.015,0],[1,end.x,end.y,-1.1,-.12,.045]]);
  position.set(k[0],k[1],contact.z);angle=k[2];lean=k[3];hx+=k[4];footTargets=feet.map(f=>f.clone());
 }else if(family==='mine-hands'){
  hx=.08;lean=-.12;footTargets=feet.map(f=>f.clone().add(v(.8,0,0)));
  targets=[v(contact.x-.09-.14*reach,.99+.055*Math.sin(p*Math.PI),.035),v(contact.x-.07,.99,.14)];
 }else if(family==='chop-axe'||family==='harvest-tree'){
  const end=contact.clone().sub(tip.clone().applyAxisAngle(v(0,0,1),-1.50));
  const k=keys(p,[[0,end.x,end.y,-1.5,-.1],[.18,end.x-.05,end.y+.08,-1.25,-.03],[.52,-.34,1.5,.02,.06],[.76,-.34,1.5,.02,.06],[.84,-.22,1.42,-.45,0],[1,end.x,end.y,-1.5,-.1]]);
  position.set(k[0],k[1],contact.z);angle=k[2];lean=k[3];hx=-.58;
 }else if(family==='chop-hands'){
  hx=-.04;lean=-.15;footTargets=feet.map(f=>f.clone().add(v(.68,0,0)));
  targets=[v(.47-.14*reach,1.04,-.12),v(.53,1.10,.12)];
 }else if(family.startsWith('fish')){
  hx=-.45;footTargets=feet.map(f=>f.clone().add(v(.27,0,0)));
  if(family==='fish-rod'){
   const k=keys(p,[[0,-.04,1.16,-.88],[.18,-.06,1.35,-.12],[.32,-.02,1.15,-.95],[.78,-.02,1.15,-.95],[.92,-.05,1.26,-.55],[1,-.04,1.16,-.88]]);
   position.set(k[0],k[1],0);angle=k[2];
  }else if(family==='fish-net'||family==='fish-harpoon'){
   const dip=family==='fish-net'?-2.59:-2.35;
   const k=keys(p,[[0,-.10,1.10,-.95],[.18,-.10,1.24,-.35],[.32,-.04,.72,dip],[.78,-.04,.72,dip],[.92,-.10,1.10,-.95],[1,-.10,1.10,-.95]]);position.set(k[0],k[1],.03);angle=k[2];lean=-.18;hy=.70;hx=-.53;
  }else if(family==='fish-cage'){
   position.set(.26+reach*.25,.70-reach*.65,-.08);angle=0;lean=-.22;hx=-.16+.12*reach;hy=.64-reach*.13;footTargets=[v(-.40,.095,-.21),v(.02,.095,.24)];
  }else{
   hy=.38;hx=-.15;lean=-.30;footTargets=[v(-.43,.095,-.21),v(.04,.095,.24)];targets=[v(.25,.15,-.12),v(.25-reach*.10,.15+reach*.18,.18)];
  }
 }else if(['kindle','bury','plant','harvest-ground'].includes(family)||family.startsWith('hunt')){
  hx=-.25;hy=.43;lean=-.19;footTargets=[v(-.59,.095,-.24),v(-.10,.095,.31)];
  targets=[v(.18-.06*reach,.29+.045*s,-.14),v(.23,.28,.19)];position.copy(targets[0]);angle=-.8;
  if(family==='harvest-ground'){targets[0].y+=.14*reach;targets[0].x-=.06*reach;}
  if(family==='plant'){targets[0].y+=.10*reach;}
  if(family.startsWith('hunt')){
   const standing=p<.20?0:p<.32?smooth((p-.20)/.12):p<.78?1:p<.90?1-smooth((p-.78)/.12):0;
   hx=-.25-.10*standing;hy=.43+.43*standing;lean=-.19+.15*standing;
   targets[0].lerp(v(-.09,1.03,-.22),standing);targets[1].lerp(v(-.16,1.10,.23),standing);
  }
 }else if(family==='cook'){
  hy=.74;hx=-.54;lean=-.1;position.set(-.10,.95+.025*s,-.05);angle=-1.60+.06*s;
 }else if(['smelt','glass'].includes(family)){
  hx=-.46;lean=-.11;position.set(.0+reach*.08,1.03+.025*s,-.04);angle=-1.70+reach*.13;
 }else if(['smith','smith-ammo','build'].includes(family)){
  hx=-.46;
  const a=family==='build'?-1.53:-1.85;
  const end=contact.clone().sub(tip.clone().applyAxisAngle(v(0,0,1),a));
  const k=keys(p,[[0,end.x,end.y,a],[.2,end.x+(family==='build'?.015:-.09),end.y+.15,-1.1],[.55,family==='build'?-.04:-.12,1.54,.16],[.76,family==='build'?-.04:-.12,1.54,.16],[.86,-.04,1.44,-.25],[1,end.x,end.y,a]]);
  position.set(k[0],k[1],contact.z);angle=k[2];lean=-.06+.05*reach;targets[1].set(.02,.96,.20);
 }else if(family.startsWith('steal')){
  hx=-.13;hy=family==='steal-stall'?.84:.80;lean=-.16;
  footTargets=feet.map(f=>f.clone().add(v(.48,0,0)));
  targets=[v(.27+.27*reach,.99,-.10),v(.14,1.08,.23)];
 }else if(family==='harvest-fruit'){
  hx=-.21;turn=-.05;targets=[v(.22+.07*reach,1.79-.10*reach,-.08),v(.12,1.49,.2)];
  footTargets=feet.map(f=>f.clone().add(v(.43,0,0)));
 }else if(family==='agility'||family==='dungeon'){
  const running=family==='agility';hx=-.46+(running?.13*s:0);hy=(running?.78:.83)+(running?.04*Math.abs(s):.012*Math.abs(s));lean=running?-.18:-.04;
  footTargets=[v(-.62+(running?.29*s:.1*s),.095+(running?Math.max(0,s)*.22:Math.max(0,s)*.04),-.19),v(-.34-(running?.29*s:.1*s),.095+(running?Math.max(0,-s)*.22:Math.max(0,-s)*.04),.23)];
  targets=[v(-.25+(running?-.19*s:0),1.12+(running?.12*s:0),-.28),v(-.20+(running?.19*s:.04*s),1.14-(running?.12*s:0),.27)];
  position.copy(targets[0]);angle=.12;
  if(running){
   targets[0].z=-.43;targets[1].z=.43;
   const flight=Math.sin(Math.PI*Math.max(0,Math.min(1,(p-.28)/.45)))**2;
   hy+=.56*flight;for(const f of footTargets)f.y+=.59*flight;
   for(const g of targets)g.y+=.56*flight;
   if(dynamic[0])dynamic[0].position.x=1.15-4.8*p;
  }
 }else if(family==='scatter'){
  targets=[v(-.08+.16*reach,1.30+.22*reach,-.23),v(-.14,1.05,.23)];lean=.02;position.copy(targets[0]);
 }else if(['offer','runecraft','infuse','scroll','hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank'].includes(family)){
  hx=-.48;lean=-.03+.055*reach;
  if(family==='offer'){targets=[v(.08+.08*reach,1.05,-.14),v(.08+.08*reach,1.05,.14)];}
  else if(family==='hex'){targets=[v(.15*reach,1.40+.08*reach,-.22),v(-.16,1.23,.23)];}
  else if(family==='infuse'){targets=[v(.10,1.21+.13*reach,-.23),v(.10,1.21+.13*reach,.23)];}
  else if(family==='scroll'){targets=[v(.08,1.13,-.16),v(.03+.09*reach,1.34+.06*reach,.22)];}
  else if(family==='runecraft'){targets=[v(.12,1.02+.24*reach,-.19),v(.12,1.02+.24*reach,.19)];}
  else if(family.startsWith('enchant')){targets=[v(.0+.04*s,1.15+.13*reach,-.18),v(-.12,1.14,.19)];turn=.05*s;}
  else {targets=[v(-.03+.12*reach,1.21+.17*reach,-.21),v(-.08,1.14,.21)];}
 }else{
  hx=-.53;position.set(-.03+reach*.08,1.13+(family==='sew'?.21:family==='tan'?.01:.05)*reach,-.15);angle=-1.7+.13*s;
  if(family==='carve'){position.y=1.20-reach*.15;position.x=-.02-reach*.04;angle=-1.55;targets[1].set(-.02,1.05,.13);}
  if(family==='gem-cut'){position.set(-.01+reach*.04,1.10+reach*.045,-.12);angle=-1.73;}
  if(family==='jewellery'){position.set(-.01+.04*s,1.14,-.16);angle=-.65;}
  if(family==='tan'){position.set(.04+reach*.12,1.045,-.11);angle=0;}
  if(family==='string-bow'){targets=[v(-.07+reach*.12,1.22,-.22),v(-.09,1.18,.19)];}
  if(family==='brew'||family==='combine-potions'){position.set(-.03+.035*s,1.12,-.17);angle=.10*s;targets[1].set(-.03,1.07,.2);}
  if(family==='feather'||family==='arrow-tip'||family==='bolt-tip'){position.set(.03+reach*.09,1.09+(family==='feather'?.04:.09)*reach,-.12);angle=0;}
  if(family==='blade-assemble'||family==='special-assemble'){position.set(.09+.08*reach,1.04,-.12);angle=0;targets[1].set(.0,1.06,.20);}
 }
 if(!/^(mine|fish|steal|hunt)/.test(family)&&!['chop-hands','kindle','bury','plant','harvest-ground','agility','dungeon','harvest-fruit'].includes(family))footTargets=[v(hx-.16,.095,-.21),v(hx+.18,.095,.24)];
 torso.position.set(hx,hy,0);torso.rotation.set(0,turn,lean);pelvis.position.set(hx,hy-.04,0);head.rotation.z=-.045-lean*.2;
 for(let i=0;i<2;i++){
  const hip=v(hx,hy-.06,i?.17:-.17),foot=footTargets[i],knee=ik(hip,foot,.39,.40,v(hx+.18,.40,i?.47:-.47));
  setSeg(thighs[i],hip,knee);setSeg(calves[i],knee,foot);boots[i].position.set(foot.x,foot.y-.095,foot.z);
 }
 if(tool){tool.position.copy(position);tool.rotation.set(0,0,angle);}
 scene.updateMatrixWorld(true);
 if(tool&&!['kindle','fish-hands'].includes(family))targets[0]=tool.localToWorld(v(0,family==='fish-cage'?.34:0,0));
 if(family==='fish-cage')targets[1]=tool.localToWorld(v(0,.34,.08));
 if(['mine-pick','chop-axe','harvest-tree','fish-rod','fish-net','fish-harpoon'].includes(family))targets[1]=tool.localToWorld(v(0,['fish-net','fish-harpoon'].includes(family)?.12:.19,.035));
 if(other&&['brew','combine-potions','string-bow'].includes(family)){other.position.copy(targets[1]);other.rotation.z=family==='string-bow'?-.3:-.35*reach;}
 const shoulderPositions=[],elbows=[];
 for(let i=0;i<2;i++){
  const shoulder=torso.localToWorld(v(.025,.49,i?.265:-.265));
  // Elbows stay on the outward side of the chest, rather than folding inward.
  const elbow=ik(shoulder,targets[i],.39,.39,v(hx+.50,hy+.17,i?.57:-.57));
  setSeg(arms[i].upper,shoulder,elbow);setSeg(arms[i].fore,elbow,targets[i]);
  arms[i].hand.position.copy(targets[i]);arms[i].hand.rotation.z=tool&&i===0?angle:-.1;
  shoulderPositions.push(shoulder);elbows.push(elbow);
 }
 if(family==='fish-rod'&&other){const end=tool.localToWorld(tip.clone());const float=v(1.35,.04,.19);setSeg(other,end,float);}
 for(let i=0;i<fx.length;i++){
  const m=fx[i];
  if(['kindle','cook','smelt','glass','dungeon'].includes(family)){m.scale.y=.82+.18*Math.sin(p*Math.PI*4+i);continue;}
  if(family==='fish-rod')continue;
  const a=p*Math.PI*2+i*Math.PI*2/fx.length;
  if(family==='scatter')m.position.copy(targets[0]).add(v(.10+reach*.40,reach*.16-.03*i,(i-4)*.045));
  else m.position.set(.4+Math.cos(a)*.16,1.03+reach*.22+(i%3)*.08,Math.sin(a)*.21);
 }
 scene.updateMatrixWorld(true);if(draw)renderer.render(scene,camera);
 lastInfo={family,phase:p,arms:arms.map(a=>[a.upper.scale.y,a.fore.scale.y]),legs:thighs.map((a,i)=>[a.scale.y,calves[i].scale.y]),feet:footTargets.map(a=>a.toArray()),grips:targets.map(a=>a.toArray()),tip:tool&&tip?tool.localToWorld(tip.clone()).toArray():null,contact:contact?.toArray()||null};
 return lastInfo;
}
window.__mask=()=>{
 const old=[],black=new T.MeshBasicMaterial({color:0}),red=new T.MeshBasicMaterial({color:0xff0000}),green=new T.MeshBasicMaterial({color:0x00ff00});
 scene.traverse(m=>{if(!m.isMesh)return;old.push([m,m.material]);const color='#'+m.material.color.getHexString();
 const metal=tool?.getObjectById(m.id)&&[C.steel,C.steelDark].includes(color);
 const resource=world.getObjectById(m.id)&&!tool?.getObjectById(m.id)&&((family.startsWith('mine')&&color===C.ember)||(['gem-cut','jewellery','brew','combine-potions'].includes(family)&&color===C.magic)||(['carve','sew','tan','feather','arrow-tip','bolt-tip','blade-assemble','special-assemble'].includes(family)&&m.position.y>.90&&m.position.y<1.10));
 m.material=metal?red:resource?green:black;
 });
 const bg=scene.background;scene.background=new T.Color(0);renderer.render(scene,camera);const png=renderer.domElement.toDataURL('image/png');
 for(const [m,mat] of old)m.material=mat;scene.background=bg;black.dispose();red.dispose();green.dispose();return png;
};
window.__compact=()=>({...lastInfo,matrices:[head,neck,torso].map(m=>m.matrixWorld.toArray()),shaft:toolLine?.map(a=>tool.localToWorld(a.clone()).toArray())||null,forearms:arms.map(a=>[a.fore.localToWorld(v(0,-.5,0)).toArray(),a.fore.localToWorld(v(0,.5,0)).toArray()])});
window.__families=allFamilies;window.__pose=pose;window.__export=()=>renderer.domElement.toDataURL('image/png');
window.__snapshot=()=>{
 function triangles(group,exclude=[],local=false){const r=[];group.traverse(m=>{if(!m.isMesh||exclude.some(g=>g===m||g.getObjectById(m.id)))return;const a=m.geometry.attributes.position,idx=m.geometry.index,n=idx?idx.count:a.count;for(let i=0;i<n;i+=3)r.push([0,1,2].map(j=>v(0,0,0).fromBufferAttribute(a,idx?idx.getX(i+j):i+j).applyMatrix4(m.matrixWorld).applyMatrix4(local?group.matrixWorld.clone().invert():new T.Matrix4()).toArray()));});return r;}
 window.__bodyData=()=>[triangles(head,[],true),triangles(neck,[],true),triangles(torso,[head,neck],true)];
 return {...lastInfo,head:triangles(head),torso:triangles(torso,[head,neck]),neck:triangles(neck),shaft:toolLine?.map(a=>tool.localToWorld(a.clone()).toArray())||null,forearms:arms.map(a=>[a.fore.localToWorld(v(0,-.5,0)).toArray(),a.fore.localToWorld(v(0,.5,0)).toArray()])};
};
setup('chop-axe');pose(.70);window.__ready=true;
