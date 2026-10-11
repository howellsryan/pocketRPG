import { palette } from './palette.js';
import {T,scene,renderer,camera,W,H,mesh,box,ico,seg,setSeg,v,patch,loft,torso,pelvis,head,neck,feet,thighs,calves,boots,arms,ik} from './rig.js';
import {makeCharacter} from './characters.js';

// Fixed material roles match the game's --ink-* palette. Original geometry.
const C={ground:palette['--ink-hide-stone'],stone:palette['--ink-hide-stone'],dark:palette['--ink-stone-shade'],wood:palette['--ink-haft'],bark:palette['--ink-bark'],leaf:palette['--ink-leaf'],leafHi:palette['--ink-leaf-light'],water:palette['--ink-water'],waterHi:palette['--ink-water-light'],steel:palette['--ink-hide-iron-light'],steelDark:palette['--ink-hide-iron-shade'],linen:palette['--ink-bone'],leather:palette['--ink-leather'],ember:palette['--ink-ember'],gold:palette['--ink-brass'],magic:palette['--ink-arcane'],spirit:palette['--ink-spirit'],rope:palette['--ink-rope']};
const HUMAN=[torso,pelvis,...thighs,...calves,...boots,...arms.flatMap(a=>[a.upper,a.fore,a.hand])];
const allFamilies=['mine-pick','mine-hands','chop-axe','chop-hands','fish-net','fish-rod','fish-cage','fish-harpoon','fish-hands','kindle','cook','food-assemble','smelt','smith','smith-ammo','blade-assemble','special-assemble','tan','sew','glass','gem-cut','jewellery','carve','feather','arrow-tip','string-bow','bolt-tip','brew','combine-potions','bury','offer','scatter','hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank','runecraft','hunt-cow','hunt-person','hunt-wizard','hunt-jeweller','hunt-master-trader','hunt-herbi','hunt-reaper','steal','steal-farmer','steal-gardener','steal-baker','steal-master-farmer','steal-guard','steal-knight','steal-ardougne-knight','steal-vyre','steal-elf','steal-tzraar','steal-stall','build','infuse','scroll','agility','agility-balance','dungeon','plant','plant-sapling','harvest-ground','harvest-tree','harvest-fruit'];
let family='',world,tool,other,fx=[],dynamic=[],held=[],npc=null,contact=null,tip=null,toolLine=null,thread=null,flames=[];
const anchor=v(0,1.02,.05);
function line(a,b,r,c,parent){return seg(v(...a),v(...b),r,r,c,parent);}
function newGroup(parent=world){const g=new T.Group();parent.add(g);return g;}
function ring(r,c,x,y,z,parent=world){const m=mesh(new T.TorusGeometry(r,.014,4,12),c,parent);m.position.set(x,y,z);return m;}
function timber(w,h,d,x,y,z,parent=world){return box(w,h,d,C.wood,x,y,z,parent);}
function tree(x=1.05,z=0,fruit=false){
 seg(v(x,.02,z),v(x+.06,2.55,z),.22,.13,C.bark,world);
 for(let i=0;i<5;i++){const a=i*Math.PI*2/5;line([x+Math.cos(a)*.34,.02,z+Math.sin(a)*.34],[x, .38,z],.055,C.bark,world);}
 for(const a of [-.7,.8]){const stripe=box(.028,1.50,.028,C.wood,x+.155,.88,z+a*.15,world);stripe.rotation.z=.018;}
 for(const s of [-1,1])line([x,1.6,z],[x+s*.55,2.15,z+s*.27],.075,C.bark,world);
 for(const [dx,dy,dz] of [[0,2.9,0],[-.4,2.55,.1],[.4,2.6,-.1],[.15,2.45,.38]])ico(.7,C.leaf,x+dx,dy,z+dz,[1,.7,1],world);
 if(fruit)for(const [dx,dy,dz] of [[-.4,2.05,.27],[.16,2.13,.5],[.53,2.15,.05]]){const f=ico(.095,C.ember,x+dx,dy,z+dz,[1,1,1],world);if(dx===-.4)dynamic.push(f);}
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
function portable(name){
 tool=newGroup();other=newGroup();
 if(name==='carve'){
  line([0,-.10,0],[0,.04,0],.026,C.bark,tool);box(.035,.17,.045,C.steel,0,.12,0,tool);
  line([-.28,0,0],[.28,0,0],.068,C.wood,other);
  for(const x of [-.22,.22])ring(.054,C.rope,x,0,0,other).rotation.y=Math.PI/2;
 }else if(name==='gem-cut'){
  line([0,-.10,0],[0,.10,0],.019,C.bark,tool);mesh(new T.ConeGeometry(.021,.12,4),C.steel,tool).position.y=.15;
  ico(.091,C.magic,.025,.025,0,[1,.7,1],other);
 }else if(name==='sew'){
  line([0,-.04,0],[0,.11,0],.007,C.steel,tool);
  patch([[-.15,.02,-.11],[.15,.03,-.13],[.17,-.18,.06],[-.15,.02,-.11],[.17,-.18,.06],[-.13,-.21,.12]],C.leather,other);
  thread=line([0,0,0],[0,1,0],.003,C.linen,world);
 }else if(name==='string-bow'){
  const curve=new T.QuadraticBezierCurve3(v(0,-.40,0),v(.16,0,0),v(0,.40,0));mesh(new T.TubeGeometry(curve,12,.022,4,false),C.wood,other);
  thread=line([0,0,0],[0,1,0],.004,C.rope,world);
  held.push(line([0,0,0],[0,1,0],.004,C.rope,world));
  tool=null;
 }else if(['feather','arrow-tip','bolt-tip'].includes(name)){
  for(let i=0;i<3;i++)line([-.12,i*.035,0],[.12,i*.035,0],.008,name==='bolt-tip'?C.steelDark:C.wood,other);
  if(name==='feather')patch([[0,0,0],[.035,.15,0],[-.04,.14,0]],C.linen,tool);
  else ico(.039,C.steel,0,.03,0,[.5,1.6,.6],tool);
 }else if(['brew','combine-potions'].includes(name)){
  for(const g of [tool,other]){
   ico(.083,C.magic,0,-.04,0,[.8,1, .8],g);line([0,0,0],[0,.14,0],.032,C.linen,g);
   ring(.033,C.gold,0,.15,0,g).rotation.x=Math.PI/2;
  }
  thread=line([0,0,0],[0,1,0],.007,C.magic,world);
  if(name==='combine-potions'){for(let i=0;i<3;i++)ico(.07,C.magic,.76+i*.16,.30,-.56,[.7,1,.7],world);timber(.70,.18,.35,.92,.16,-.56);}
 }else if(name==='food-assemble'){
  ico(.105,C.linen,0,0,0,[1,.6,.8],other);ico(.045,C.leaf,0,.04,0,[1,.4,1],tool);
 }else if(['blade-assemble','special-assemble'].includes(name)){
  line([-.18,0,0],[.39,0,0],.029,C.steel,other);box(.06,.045,.26,C.gold,-.14,0,0,other);box(.12,.04,.04,C.bark,-.24,0,0,other);
  box(.065,.06,.065,C.gold,0,0,0,tool);
 }else if(name==='tan'){
  bench();patch([[.0,.94,-.28],[.70,.95,-.30],[.67,.95,.27],[.0,.94,-.28],[.67,.95,.27],[-.03,.94,.24]],C.leather,world);
  box(.13,.035,.19,C.steel,0,0,0,tool);world.remove(other);other=null;
 }
}
function quarry(kind){
 if(['person','wizard','jeweller','master-trader'].includes(kind)){const target=makeCharacter(kind==='person'?'merchant':kind,world);target.root.position.x=1.12;return target;}
 if(kind==='reaper'){
 mesh(new T.ConeGeometry(.32,1.45,6),C.dark,world).position.set(1.07,.75,.12);
 ico(.23,C.bark,1.07,1.53,.12,[.8,1.2,1],world);ico(.12,C.linen,.88,1.48,.18,[.5,1,.8],world);
 line([1.33,.08,.34],[1.33,1.88,.34],.028,C.wood,world);line([1.33,1.88,.34],[.86,1.67,.34],.045,C.steel,world);return;
 }
 const cow=kind==='cow',color=cow?C.linen:C.bark;
 ico(.45,color,1.15,.62,.12,[1.45,.78,.75],world);ico(.25,color,.72,.73,.11,[1.1,.8,.9],world);
 ico(.14,cow?C.bark:C.dark,.51,.67,.12,[.7,.55,1],world);
 for(const x of [.85,1.48])for(const z of [-.14,.37])line([x,.6,z],[x,.04,z],.06,cow?C.linen:C.bark,world);
 if(cow){for(const z of [-.04,.24])line([.75,1.0,z],[.8,1.20,z*1.8],.035,C.gold,world);ico(.20,C.dark,1.12,.7,.45,[1,.6,.4],world);}
 else{for(let i=0;i<5;i++)ico(.18,C.leafHi,1.15+(i-2)*.11,.98,.1,[.4,1.4,.6],world);for(const z of [-.03,.27])line([.53,.64,z],[.47,.73,z],.022,C.linen,world);}
}
function setup(name){
 if(world){scene.remove(world);world.traverse(m=>{if(m.isMesh)m.geometry.dispose();});}
 family=name;world=new T.Group();scene.add(world);fx=[];dynamic=[];held=[];flames=[];thread=null;npc=null;tool=null;other=null;tip=null;contact=null;toolLine=null;
 const tall=['chop-axe','harvest-tree','harvest-fruit','magic-plank','magic-tan','agility'].includes(name);
 const portableFrame=['carve','sew','gem-cut','string-bow','feather','arrow-tip','bolt-tip','brew','combine-potions','food-assemble','blade-assemble','special-assemble','alchemy','superheat','enchant-jewel','enchant-bolt','scatter'].includes(name);
 const span=tall?2.0:portableFrame?1.48:1.72;camera.left=-span;camera.right=span;camera.top=span*.64;camera.bottom=-span*.64;
 camera.lookAt(portableFrame?-.28:.12,tall?1.20:.98,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 const city=name.startsWith('steal')&&!['steal-elf','steal-farmer','steal-gardener','steal-master-farmer'].includes(name);
 const outdoor=/^(chop|fish|hunt|agility|plant|harvest)/.test(name)||name==='steal-elf'||name.includes('farmer')||name==='steal-gardener',river=name.startsWith('fish');
 scene.background=new T.Color(outdoor?C.leaf:C.dark);
 box(12,.14,12,outdoor?C.leaf:C.ground,0,-.09,0,world);
 if(!outdoor)for(let x=-4;x<5;x++)for(let z=-3;z<4;z++)box(.78,.018,.58,(x+z)%3?C.stone:C.ground,x*.81+(z%2)*.4,-.003,z*.61,world);
 if(!outdoor){
  for(let i=-3;i<4;i++)for(let j=0;j<3;j++)box(.93,.52,.20,j%2?C.dark:C.stone,i+(j%2)*.45,.24+j*.54,-1.62,world);
  timber(.14,2.65,.15,-2.22,1.28,-1.4);timber(.14,2.65,.15,2.5,1.28,-1.4);timber(4.85,.15,.16,.14,2.55,-1.4);
  if(city){box(.66,1.07,.035,C.bark,.73,1.02,-1.49,world);box(.09,1.2,.13,C.wood,.37,1.02,-1.39,world);box(.09,1.2,.13,C.wood,1.09,1.02,-1.39,world);}
 }else{
  tree(-2.35,-2);tree(2.9,-2);ico(.32,C.stone,-1.8,.12,.7,[1,.5,1],world);
  for(let i=0;i<12;i++){const x=-1.8+(i%4)*1.1,z=-.9+Math.floor(i/4)*.8;if(river&&x>.1)continue;for(let j=0;j<3;j++)line([x,.015,z],[x+(j-1)*.045,.12+j*.022,z],.008,C.leafHi,world);}
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
   ring(.23,C.rope,.13,-.04,0,tool).rotation.x=Math.PI/2;
   for(let i=-2;i<3;i++){line([.13+i*.07,-.04,-.18],[.13+i*.035,-.32,.08],.005,C.rope,tool);line([-.04,-.04,i*.07],[.31,-.32,i*.035],.005,C.rope,tool);}tip=null;
  }else if(name==='fish-cage'){
   for(const y of [0,.16,.32])ring(.19,C.rope,0,y,0,tool).rotation.x=Math.PI/2;
   for(let i=0;i<8;i++){const a=i*Math.PI/4;line([Math.cos(a)*.19,0,Math.sin(a)*.19],[Math.cos(a)*.19,.32,Math.sin(a)*.19],.013,C.wood,tool);}tip=v(0,0,0);
  }else if(name==='fish-harpoon'){
   line([0,-.04,0],[0,.84,0],.022,C.wood,tool);line([0,.82,0],[0,1.0,0],.025,C.steel,tool);line([0,.95,0],[.10,.85,0],.025,C.steel,tool);tip=v(0,1,0);toolLine=[v(0,-.04,0),v(0,.84,0)];
  }
 }else if(['kindle','cook','bury','plant','plant-sapling','harvest-ground'].includes(name)||name.startsWith('hunt-')){
  if(name==='cook')fire(.35);
  else if(name==='kindle'){
   timber(.45,.12,.13,.22,.09,.06);fire(.22,.06);flames=fx.slice();
  }
  else if(name==='bury'||name.startsWith('plant')||name==='harvest-ground'){
   box(.95,.025,.85,C.bark,.4,.025,0,world);
   for(let i=0;i<4;i++)box(.88,.015,.045,C.dark,.4,.045,(i-1.5)*.18,world);
   if(name==='harvest-ground')for(let i=0;i<5;i++){const x=.1+(i%3)*.23,z=(i%2)*.27-.1;line([x,0,z],[x,.50,z],.018,C.leafHi,world);for(const y of [.22,.38,.49])ico(.09,C.leafHi,x,y,z,[1,.6,1],world);}
  }else{
   quarry(name.slice(5));box(.43,.03,.43,C.bark,.29,.045,.10,world);
   if(name==='hunt-herbi')ico(.17,C.dark,.29,.055,.10,[1,.18,1],world);
   else ring(.19,C.rope,.29,.085,.10).rotation.x=Math.PI/2;
  }
  if(name==='kindle'){tool=newGroup();box(.07,.055,.06,C.steel,0,0,0,tool);other=newGroup();box(.12,.08,.10,C.bark,0,0,0,other);}
  if(name==='cook'){other=newGroup();ico(.10,C.linen,0,0,0,[1.6,.5,.8],other);}
  if(name==='plant-sapling'){other=newGroup();mesh(new T.CylinderGeometry(.11,.07,.17,6),C.bark,other).position.y=-.10;line([0,0,0],[0,.30,0],.012,C.wood,other);for(const y of [.13,.26])ico(.085,C.leafHi,0,y,0,[1,.5,1],other);}
  if(name==='hunt-herbi'){
   other=newGroup();for(let i=0;i<5;i++)ico(.12,C.leafHi,(i-2)*.10,0,0,[.6,1,.7],other);
  }
 }else if(['smelt','glass','jewellery'].includes(name)){
  furnace();other=newGroup();box(.18,.08,.15,name==='jewellery'?C.gold:name==='glass'?C.linen:C.steel,0,0,0,other);
 }else if(name==='smith'||name==='smith-ammo'){
  box(.39,.53,.45,C.bark,.46,.26,0,world);box(.53,.12,.38,C.steelDark,.46,.61,0,world);box(.69,.14,.40,C.steel,.36,.76,0,world);
  const horn=mesh(new T.ConeGeometry(.18,.36,4),C.steel,world);horn.position.set(.8,.77,0);horn.rotation.z=-Math.PI/2;
  box(.27,.025,.15,C.ember,.22,.85,0,world);contact=v(.22,.88,-.10);
  if(name==='smith-ammo')for(let i=0;i<5;i++)box(.07,.02,.07,C.steel,.20+(i%2)*.1,.85,.12+(i%3)*.06,world);
  tool=newGroup();line([0,-.025,0],[0,.34,0],.028,C.wood,tool);box(.23,.12,.12,C.steel,0,.36,0,tool);tip=v(.10,.36,0);toolLine=[v(0,-.025,0),v(0,.34,0)];
 }else if(name.startsWith('steal')){
  if(name==='steal-stall'){
   bench();for(let i=0;i<6;i++){box(.30,.045,1.10,i%2?C.linen:C.steelDark,-.05+i*.30,2.13,0,world);box(.30,.12,.035,i%2?C.linen:C.steelDark,-.05+i*.30,2.06,.54,world);}
   for(const x of [-.1,1.5])timber(.07,2.15,.07,x,1.06,-.5);
   for(let i=0;i<3;i++){const x=.30+i*.30;ico(.13,C.wood,x,.98,.08,[1,.5,1],world);box(.20,.04,.20,C.linen,x,1.045,.08,world);box(.17,.015,.035,C.ember,x,1.073,.08,world);}
  }
  else npc=makeCharacter(name==='steal'?'villager':name.slice(6),world);
 }else if(name==='harvest-fruit'){tree(.7,0,true);other=newGroup();ico(.095,C.ember,0,0,0,[1,1,1],other);}
 else if(name==='agility'||name==='agility-balance'){
  const obstacle=newGroup();dynamic.push(obstacle);
  if(name==='agility-balance'){
   timber(4,.08,.17,-.1,.05,0);for(const x of [-1.3,1.3])timber(.15,.25,.3,x,-.10,0);
  }else{
   for(const x of [-1.52,1.52]){
    box(2.25,.30,1.15,C.dark,x,-.17,0,obstacle);
    for(let i=0;i<9;i++)box(.25,.045,1.12,i%2?C.stone:C.steelDark,x-1.05+i*.26,.007,0,obstacle);
   }
   box(.26,.65,.30,C.stone,1.80,.32,-.38,obstacle);
  }
 }else if(name==='dungeon'){
  for(const x of [.55,1.65])box(.34,1.8,.46,C.dark,x,.90,-.45,world);
  box(1.4,.40,.46,C.dark,1.10,1.85,-.45,world);box(.95,1.5,.06,C.bark,1.1,.75,-.55,world);
  tool=newGroup();line([0,-.05,0],[0,.38,0],.025,C.wood,tool);fx.push(mesh(new T.ConeGeometry(.06,.20,5),C.ember,tool));fx[0].position.y=.46;
 }else if(['offer','runecraft','infuse','scroll','hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank'].includes(name)){
  if(['offer','runecraft','infuse','scroll'].includes(name))altar(name==='offer'?C.gold:name==='infuse'||name==='scroll'?C.spirit:C.magic);
  if(name==='hex'){box(.22,.7,.20,C.bark,1.38,.50,0,world);ico(.21,C.rope,1.38,1.0,0,[1,1.25,1],world);}
  if(name==='infuse'||name==='scroll')ico(.24,C.spirit,.63,1.32,0,[.55,1.8,.55],world);
  const color=name==='alchemy'||name==='offer'?C.gold:name==='superheat'?C.ember:name==='magic-tan'?C.linen:['infuse','scroll','magic-plank'].includes(name)?C.spirit:C.magic;
  for(let i=0;i<3;i++){const r=ring(.10+i*.07,color,0,0,0);r.material=new T.MeshBasicMaterial({color});fx.push(r);}
  const glow=mesh(new T.IcosahedronGeometry(.115,0),new T.MeshBasicMaterial({color,transparent:true,opacity:.65,depthWrite:false}),world);fx.push(glow);
  other=newGroup();
  if(name==='magic-plank')box(.48,.09,.10,C.wood,0,0,0,other);
  else if(name==='magic-tan')patch([[-.14,0,-.09],[.14,0,-.11],[.11,-.16,.08],[-.14,0,-.09],[.11,-.16,.08],[-.14,-.13,.10]],C.leather,other);
  else if(name==='scroll')box(.13,.018,.18,C.linen,0,0,0,other);
  else ico(.059,name==='offer'?C.linen:name==='alchemy'?C.gold:C.magic,0,0,0,[1,.7,1],other);
 }else if(name==='scatter'){
  for(let i=0;i<8;i++)fx.push(ico(.018,C.linen,0,0,0,[1,1,1],world));
 }else if(['carve','sew','gem-cut','string-bow','feather','arrow-tip','bolt-tip','brew','combine-potions','food-assemble','tan','blade-assemble','special-assemble'].includes(name))portable(name);
 else if(name==='build'){
  bench();
  for(const z of [-.25,.25])timber(.65,.10,.08,.40,1.05,z);
  for(const x of [.15,.68])timber(.08,.34,.08,x,1.15,.25);
  tool=newGroup();line([0,-.025,0],[0,.3,0],.026,C.wood,tool);box(.2,.1,.1,C.steel,0,.32,0,tool);tip=v(.1,.32,0);contact=v(.15,1.10,-.18);toolLine=[v(0,-.025,0),v(0,.3,0)];
 }else throw new Error('No authored method: '+name);
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
 let hx=-.64,hy=.89,lean=-.04,turn=0,workHand=0;
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
  position.set(k[0],k[1],contact.z);angle=k[2];lean=k[3];hx=-.58;workHand=1;targets[0].set(-.31,1.06,-.34);
 }else if(family==='chop-hands'){
  hx=-.04;lean=-.15;footTargets=feet.map(f=>f.clone().add(v(.68,0,0)));
  targets=[v(.47-.14*reach,1.04,-.12),v(.53,1.10,.12)];
 }else if(family.startsWith('fish')){
  hx=-.45;footTargets=feet.map(f=>f.clone().add(v(.27,0,0)));
  if(family==='fish-rod'){
   const k=keys(p,[[0,-.04,1.16,-.88],[.18,-.06,1.35,-.12],[.32,-.02,1.15,-.95],[.78,-.02,1.15,-.95],[.92,-.05,1.26,-.55],[1,-.04,1.16,-.88]]);
   position.set(k[0],k[1],0);angle=k[2];
  }else if(family==='fish-net'){
   const k=keys(p,[[0,.03,.66,0],[.18,.10,.76,-.1],[.32,.17,.23,-.12],[.78,.17,.23,-.12],[.92,.04,.66,.05],[1,.03,.66,0]]);
   position.set(k[0],k[1],.02);angle=k[2];hy=.43;hx=-.24;lean=-.23;footTargets=[v(-.58,.095,-.21),v(-.05,.095,.28)];
  }else if(family==='fish-harpoon'){
   const dip=-2.35;
   const k=keys(p,[[0,-.10,1.10,-.95],[.18,-.10,1.24,-.35],[.32,-.04,.72,dip],[.78,-.04,.72,dip],[.92,-.10,1.10,-.95],[1,-.10,1.10,-.95]]);position.set(k[0],k[1],.03);angle=k[2];lean=-.18;hy=.70;hx=-.53;
  }else if(family==='fish-cage'){
   const dip=keys(p,[[0,0],[.20,.1],[.32,1],[.78,1],[.93,0],[1,0]])[0];position.set(.08+.15*dip,.83-.35*dip,-.03);angle=.15*dip;lean=-.06-.20*dip;hx=-.32;hy=.86-.12*dip;footTargets=[v(-.49,.095,-.21),v(-.16,.095,.24)];
  }else{
   hy=.38;hx=-.15;lean=-.30;footTargets=[v(-.43,.095,-.21),v(.04,.095,.24)];targets=[v(.25,.15,-.12),v(.25-reach*.10,.15+reach*.18,.18)];
  }
 }else if(family==='bury'||family==='harvest-ground'){
  const fold=keys(p,[[0,.06],[.18,.10],[.43,1],[.59,1],[.79,.06],[1,.06]])[0];
  const harvest=family==='harvest-ground';hx=-.29;hy=.86-(harvest?.06:.23)*fold;lean=-.04-(harvest?.20:.95)*fold;footTargets=[v(-.50,.095,-.20),v(-.04,.095,.23)];
  targets=[v(-.02+.17*fold,1.12-(harvest?.21:.67)*fold,-.28),v(.0+.28*fold,1.09-(harvest?.44:.91)*fold,.30)];
 }else if(['kindle','plant','plant-sapling'].includes(family)||family.startsWith('hunt')){
  hx=-.25;hy=.43;lean=-.19;footTargets=[v(-.59,.095,-.24),v(-.10,.095,.31)];
  targets=[v(.18-.06*reach,.29+.045*s,-.14),v(.23,.28,.19)];position.copy(targets[0]);angle=-.8;
  if(family==='plant'){targets[0].y+=.10*reach;}
  if(family==='plant-sapling'){targets[1].set(.20,.50-.20*reach,.16);targets[0].set(.18,.38-.10*reach,-.12);}
  if(family.startsWith('hunt')){
   const standing=family==='hunt-herbi'?keys(p,[[0,1],[.78,1],[.90,0],[1,1]])[0]:p<.20?0:p<.32?smooth((p-.20)/.12):p<.78?1:p<.90?1-smooth((p-.78)/.12):0;
   hx=-.25-.10*standing;hy=.43+.43*standing;lean=-.19+.15*standing;
   targets[0].lerp(v(-.09,1.03,-.22),standing);targets[1].lerp(v(-.16,1.10,.23),standing);
   if(family==='hunt-herbi'){
    const kick=p>.15&&p<.32?Math.sin((p-.15)/.17*Math.PI):0;
    footTargets[1].x+=.24*kick;footTargets[1].y+=.13*kick;
   }
  }
 }else if(family==='cook'){
  const dip=keys(p,[[0,.1],[.23,.9],[.57,1],[.81,.1],[1,.1]])[0];
  hy=.83-.09*dip;hx=-.34;lean=-.10-.12*dip;targets=[v(-.17,1.04,-.32),v(.05+.17*dip,.88-.13*dip,.20)];
 }else if(['smelt','glass','jewellery'].includes(family)){
  const feed=keys(p,[[0,.08],[.18,.05],[.39,1],[.59,1],[.79,.08],[1,.08]])[0];
  hx=-.36;lean=-.04-.13*feed;hy=.88-.04*feed;
  targets=[v(-.10,1.03,-.31),v(-.04+.32*feed,1.10-.24*feed,.20)];
 }else if(['smith','smith-ammo','build'].includes(family)){
  hx=-.46;
  const a=family==='build'?-1.53:-1.85;
  const end=contact.clone().sub(tip.clone().applyAxisAngle(v(0,0,1),a));
  const k=keys(p,[[0,end.x,end.y,a],[.2,end.x+(family==='build'?.015:-.09),end.y+.15,-1.1],[.55,family==='build'?-.04:-.12,1.54,.16],[.76,family==='build'?-.04:-.12,1.54,.16],[.86,-.04,1.44,-.25],[1,end.x,end.y,a]]);
  position.set(k[0],k[1],contact.z);angle=k[2];lean=-.06+.05*reach;workHand=1;targets[0].set(-.08,.99,-.28);
 }else if(family.startsWith('steal')){
  const pocket=family==='steal-stall'?v(.37,1.08,.17):npc.contact;
  const k=keys(p,[[0,-.08,1.05,.33,0],[.12,-.02,1.04,.36,.12],[.32,pocket.x,pocket.y,pocket.z,1],[.45,pocket.x,pocket.y,pocket.z,1],[.64,.03,.98,.36,.3],[.80,-.08,1.05,.33,0],[1,-.08,1.05,.33,0]]);
  hx=-.26;hy=.88-.026*k[3];lean=-.025-.075*k[3];turn=-.055*k[3];
  footTargets=[v(-.45,.095,-.21),v(-.13,.095,.24)];targets=[v(-.16,.94,-.30),v(k[0],k[1],k[2])];
 }else if(family==='harvest-fruit'){
  hx=-.08;turn=-.05;const pick=keys(p,[[0,.10,1.23],[.22,.30,2.03],[.44,.30,2.03],[.66,.10,1.23],[1,.10,1.23]]);
  targets=[v(.05,1.28,-.32),v(pick[0],pick[1],.27)];footTargets=[v(-.30,.095,-.21),v(.08,.095,.24)];
 }else if(family==='agility-balance'){
  hx=-.35;hy=.88;lean=-.035;
  footTargets=[v(-.47+.16*s,.185+Math.max(0,s)*.06,-.06),v(-.24-.16*s,.185+Math.max(0,-s)*.06,.06)];
  targets=[v(-.25,1.44,-1.0),v(-.25,1.44,1.0)];
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
   if(dynamic[0])dynamic[0].position.x=1.15-2.3*p;
  }
 }else if(family==='scatter'){
  targets=[v(-.08+.16*reach,1.30+.22*reach,-.23),v(-.14,1.05,.23)];lean=.02;position.copy(targets[0]);
 }else if(['offer','runecraft','infuse','scroll','hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank'].includes(family)){
  hx=-.35;lean=-.03+.055*reach;
  if(family==='offer'){targets=[v(.08+.08*reach,1.05,-.14),v(.08+.08*reach,1.05,.14)];}
  else if(family==='hex'){targets=[v(.15*reach,1.40+.08*reach,-.22),v(-.16,1.23,.23)];}
  else if(family==='infuse'){targets=[v(.10,1.21+.13*reach,-.23),v(.10,1.21+.13*reach,.23)];}
  else if(family==='scroll'){targets=[v(.08,1.13,-.16),v(.03+.09*reach,1.34+.06*reach,.22)];}
  else if(family==='runecraft'){targets=[v(.12,1.02+.24*reach,-.19),v(.12,1.02+.24*reach,.19)];}
  else if(family==='alchemy'){targets=[v(-.02,1.19+.12*reach,-.11),v(.01,1.19+.16*reach,.11)];turn=.04*reach;}
  else if(family==='superheat'){targets=[v(-.07,1.20,-.28),v(-.09+.09*reach,1.20+.49*reach,.26)];}
  else if(family==='magic-plank'||family==='magic-tan'){targets=[v(-.01,1.25,-.23),v(-.11,1.26+.57*reach,.31)];hy=.88-.06*reach;}
  else if(family==='enchant-bolt'){targets=[v(.04,1.18,-.10),v(.04+.08*reach,1.14+.26*reach,.24)];}
  else if(family==='enchant-jewel'){targets=[v(-.07,1.13,-.12),v(-.08+.12*reach,1.24+.20*reach,.24)];}
 }else{
  hx=-.43;position.set(-.03+reach*.08,1.13+(family==='sew'?.21:family==='tan'?.01:.05)*reach,-.15);angle=-1.7+.13*s;
  workHand=1;
  if(family==='carve'){const pull=keys(p,[[0,.2],[.18,0],[.53,1],[.68,1],[.84,.2],[1,.2]])[0];position.set(.09-.16*pull,1.19-.10*pull,.18);angle=-1.55;targets[0].set(.01,1.07,-.11);}
  if(family==='gem-cut'){const strike=keys(p,[[0,0],[.20,1],[.44,1],[.52,0],[.65,.25],[.79,0],[1,0]])[0];position.set(.03,1.21+.23*strike,.10);angle=-2.08;targets[0].set(.08,1.02,-.02);}
  if(family==='tan'){position.set(.00+reach*.11,1.015,.16);angle=0;targets[0].set(.02,.99,-.25);}
  if(family==='sew'){position.set(-.04+.05*reach,1.13+.31*reach,.27);angle=-.15;targets[0].set(.02,1.02,-.08);}
  if(family==='string-bow'){targets=[v(-.01,1.14,-.08),v(.12-.20*reach,1.20+.20*reach,.31)];}
  if(family==='brew'||family==='combine-potions'){const pour=keys(p,[[0,0],[.18,.1],[.38,1],[.59,1],[.82,0],[1,0]])[0];angle=-.10-1.25*pour;const mouth=v(.04,1.28,-.08),end=mouth.sub(v(0,.15,0).applyAxisAngle(v(0,0,1),angle));position.copy(v(.13,1.16,.19).lerp(end,pour));targets[0].set(.04,1.07,-.08);}
  if(family==='feather'||family==='arrow-tip'||family==='bolt-tip'){position.set(family==='feather'?-.02-.07*reach:.23-.08*reach,1.16-.10*reach,-.08);angle=-1.35;targets[0].set(.03,1.06,-.08);}
  if(family==='blade-assemble'||family==='special-assemble'){position.set(.10-.22*reach,1.10-.03*reach,.16-.24*reach);angle=0;targets[0].set(.02,1.07,-.08);}
  if(family==='food-assemble'){position.set(.06,1.21-.13*reach,.14);angle=-.8;targets[0].set(.02,1.05,-.08);}
 }
 if(!/^(mine|fish|steal|hunt)/.test(family)&&!['chop-hands','kindle','bury','plant','plant-sapling','harvest-ground','agility','agility-balance','dungeon','harvest-fruit'].includes(family))footTargets=[v(hx-.16,.095,-.21),v(hx+.18,.095,.24)];
 torso.position.set(hx,hy,0);torso.rotation.set(0,turn,lean);pelvis.position.set(hx,hy-.04,0);head.rotation.z=-.045-lean*.2;
 for(let i=0;i<2;i++){
  const hip=v(hx,hy-.06,i?.17:-.17),foot=footTargets[i],knee=ik(hip,foot,.39,.40,v(hx+.18,.40,i?.47:-.47));
  setSeg(thighs[i],hip,knee);setSeg(calves[i],knee,foot);boots[i].position.set(foot.x,foot.y-.095,foot.z);
 }
 if(tool){tool.position.copy(position);tool.rotation.set(0,0,angle);
  if(family==='gem-cut')tool.quaternion.setFromUnitVectors(v(0,1,0),v(.105,1.045,-.02).sub(position).normalize());
  if(family==='carve')tool.quaternion.setFromUnitVectors(v(0,1,0),v(.14,1.11,-.06).sub(position).normalize());
 }
 scene.updateMatrixWorld(true);
 if(tool&&!['kindle','fish-hands','fish-net'].includes(family))targets[workHand]=tool.localToWorld(v(0,family==='fish-cage'?.34:0,0));
 if(family==='fish-cage')targets[1]=tool.localToWorld(v(0,.34,.08));
 if(['mine-pick','fish-rod','fish-harpoon'].includes(family))targets[1]=tool.localToWorld(v(0,family==='fish-harpoon'?.12:.19,.035));
 if(family==='fish-net')targets=[tool.localToWorld(v(0,0,-.19)),tool.localToWorld(v(0,0,.19))];
 if(other){
  const portableWork=['carve','sew','gem-cut','string-bow','feather','arrow-tip','bolt-tip','brew','combine-potions','food-assemble','blade-assemble','special-assemble'].includes(family);
  other.position.copy(targets[portableWork?0:1]);other.rotation.z=family==='string-bow'?-.15:0;
  if(family==='magic-plank'||family==='magic-tan'){other.position.set(-.11,1.88+.10*reach,.14);other.visible=p>.23&&p<.79;}
  if(family==='harvest-fruit'){other.visible=p>.44&&p<.80;if(dynamic[0])dynamic[0].visible=p<=.44||p>=.80;}
 }
 if(thread){
  const pouring=['brew','combine-potions'].includes(family);
  const start=family==='string-bow'?other.localToWorld(v(0,.40,0)):family==='sew'?other.localToWorld(v(.03,-.09,.04)):tool.localToWorld(v(0,.15,0));
  const end=family==='sew'?tool.localToWorld(v(0,.09,0)):pouring?other.localToWorld(v(0,.14,0)):targets[1];setSeg(thread,start,end);thread.visible=!pouring||(p>.32&&p<.64);
  if(family==='string-bow')setSeg(held[0],targets[1],other.localToWorld(v(0,-.40,0)));
 }
 const shoulderPositions=[],elbows=[];
 for(let i=0;i<2;i++){
  const shoulder=torso.localToWorld(v(.025,.49,i?.265:-.265));
  // Elbows stay on the outward side of the chest, rather than folding inward.
  const restingFar=i===0&&(family.startsWith('steal')||family==='chop-axe'||family==='harvest-tree');
  const elbow=ik(shoulder,targets[i],.39,.39,restingFar?v(hx-.06,hy+.16,-.54):v(hx+.50,hy+.17,i?.57:-.57));
  setSeg(arms[i].upper,shoulder,elbow);setSeg(arms[i].fore,elbow,targets[i]);
  arms[i].hand.position.copy(targets[i]);arms[i].hand.rotation.z=tool&&i===workHand?angle:-.1;
  shoulderPositions.push(shoulder);elbows.push(elbow);
 }
 if(family==='fish-rod'&&other){const end=tool.localToWorld(tip.clone());const float=v(1.35,.04,.19);setSeg(other,end,float);}
 for(let i=0;i<fx.length;i++){
  const m=fx[i];
  if(['kindle','cook','smelt','glass','jewellery','dungeon'].includes(family)){m.scale.y=.82+.18*Math.sin(p*Math.PI*4+i);if(family==='kindle')m.visible=p<.08||p>.77;continue;}
  if(family==='fish-rod')continue;
  const a=p*Math.PI*2+i*Math.PI*2/fx.length;
  if(family==='scatter')m.position.copy(targets[0]).add(v(.10+reach*.40,reach*.16-.03*i,(i-4)*.045));
  else{
   const magic=['hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank'].includes(family);
   m.position.copy(magic?targets[1]:v(.48,1.0,0));if(magic)m.position.y+=family==='alchemy'?.03:.12;
   m.rotation.set(0,magic?.1:Math.PI/2,a*.16);m.scale.setScalar(.15+reach*1.35);m.visible=p>.22&&p<.79;
  }
 }
 scene.updateMatrixWorld(true);if(draw)renderer.render(scene,camera);
 lastInfo={family,phase:p,arms:arms.map(a=>[a.upper.scale.y,a.fore.scale.y]),legs:thighs.map((a,i)=>[a.scale.y,calves[i].scale.y]),feet:footTargets.map(a=>a.toArray()),grips:targets.map(a=>a.toArray()),pocket:npc?.contact.toArray()||null,tip:tool&&tip?tool.localToWorld(tip.clone()).toArray():null,contact:contact?.toArray()||null};
 return lastInfo;
}
window.__mask=()=>{
 const old=[],black=new T.MeshBasicMaterial({color:0}),red=new T.MeshBasicMaterial({color:0xff0000}),green=new T.MeshBasicMaterial({color:0x00ff00});
 scene.traverse(m=>{if(!m.isMesh)return;old.push([m,m.material]);const color='#'+m.material.color.getHexString();
 const metal=tool?.getObjectById(m.id)&&[C.steel,C.steelDark].includes(color);
 const resource=(other?.getObjectById(m.id)&&!family.startsWith('fish')&&color!==C.linen)||(tool?.getObjectById(m.id)&&['brew','combine-potions'].includes(family)&&color===C.magic)||(world.getObjectById(m.id)&&!tool?.getObjectById(m.id)&&((family.startsWith('mine')&&color===C.ember)||(['gem-cut','jewellery','brew','combine-potions'].includes(family)&&color===C.magic)||(['tan'].includes(family)&&m.position.y>.90&&m.position.y<1.10)));
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
