import { palette } from './palette.js';
import {T,mesh,box,ico,seg,v,loft,patch,torso,pelvis,thighs,calves,boots,arms,setSeg} from './rig.js';

const P=key=>palette[`--ink-${key}`];
function copy(source,parent,colors={}) {
 const result=source.clone(true);
 result.traverse(m=>{if(m.isMesh){m.geometry=m.geometry.clone();const replacement=colors['#'+m.material.color.getHexString()];if(replacement){m.material=m.material.clone();m.material.color.set(replacement);}}});
 parent.add(result);return result;
}
function robe(parent,color,hem=.40) {
 return loft([{y:hem,front:.21,back:.19,width:.30},{y:.67,front:.16,back:.14,width:.22},{y:.96,front:.15,back:.13,width:.19}],color,parent);
}

/** Original costumes use the same anatomical cross-sections as the player. */
export function makeCharacter(kind,parent) {
 const root=new T.Group();parent.add(root);root.position.set(.55,0,-.03);
 const knight=kind==='knight'||kind==='ardougne-knight',guard=kind==='guard'||knight;
 const elf=kind==='elf',vyre=kind==='vyre',farmer=['farmer','gardener','master-farmer'].includes(kind),baker=kind==='baker';
 const cloth=elf?P('hide-void'):vyre?P('hide-blood-shade'):knight?P(kind==='ardougne-knight'?'hide-void':'hide-azure-shade'):guard?P('hide-iron-shade'):farmer?P('hide-moss-shade'):baker?P('bone'):P('hide-azure-shade');
 const skin=vyre?P('hide-bone'):P('skin'),hair=elf?P('hide-crimson-shade'):vyre?P('hide-ash-shade'):farmer?P('hide-bark'):P('hair-cropped');
 const colors={[P('leather')]:cloth,[P('leather-shade')]:P('haft-shade'),[P('hair-cropped')]:hair,[P('hair-highlight')]:hair,[P('skin')]:skin,[P('bone')]:guard?P('hide-iron'):elf?cloth:vyre?cloth:P('bone')};
 const body=copy(torso,root,colors);body.position.set(0,.90,0);body.rotation.set(0,0,0);
 const face=body.children.find(m=>m.isGroup);
 const hips=copy(pelvis,root);hips.position.set(0,.86,0);
 for(let i=0;i<2;i++){
  const z=i?.17:-.17,hip=v(0,.84,z),knee=v(.025,.48,z),foot=v(i?.10:-.05,.095,z);
  const upper=copy(thighs[i],root),lower=copy(calves[i],root),boot=copy(boots[i],root);
  setSeg(upper,hip,knee);setSeg(lower,knee,foot);boot.position.set(foot.x,0,foot.z);
  if(kind==='tzraar'){upper.scale.x=upper.scale.z=1.65;lower.scale.x=lower.scale.z=1.65;boot.scale.z=1.4;}
  const shoulder=v(.025,1.39,i?.265:-.265),elbow=v(.09,1.08,i?.34:-.34),hand=v(.17,.90,i?.35:-.35);
  const a=copy(arms[i].upper,root,colors),b=copy(arms[i].fore,root,colors),h=copy(arms[i].hand,root,colors);
  setSeg(a,shoulder,elbow);setSeg(b,elbow,hand);h.position.copy(hand);
 }
 if(elf){
  face.scale.set(.80,.89,.80);
  for(const side of [-1,1])patch([[-.025,.09,side*.13],[-.07,.10,side*.34],[.037,-.03,side*.13]],skin,face);
  loft([{y:-.43,front:.015,back:.18,width:.14,cx:-.07},{y:.11,front:.015,back:.16,width:.15,cx:-.07}],hair,face);
  robe(root,cloth,.39);
  for(const side of [-1,1])patch([[-.13,1.46,side*.25],[.09,1.43,side*.30],[.13,1.23,side*.25]],P('hide-iron-shade'),root);
  patch([[.185,1.27,-.14],[.194,1.10,0],[.185,1.27,.14]],P('hide-void-light'),root);
  const jewel=ico(.050,P('spirit'),.193,1.06,0,[.3,1.5,1],root);
  box(.02,.06,.42,P('hide-gold-shade'),.162,.94,0,root);root.scale.set(.96,1.055,.94);
 }
 if(vyre){
  robe(root,cloth,.19);
  patch([[-.13,1.35,-.22],[-.25,.15,-.33],[-.25,.15,.33],[-.13,1.35,-.22],[-.25,.15,.33],[-.13,1.35,.22]],P('hide-blood-shade'),root);
  for(const side of [-1,1])patch([[.15,1.40,side*.07],[.22,1.26,0],[.17,.98,side*.14]],P('hide-void-light'),root);
  for(const z of [-.052,.052])box(.008,.015,.020,P('hide-blood-light'),.149,.017,z,face);
 }
 if(farmer){
  const gardener=kind==='gardener';
  const brim=mesh(new T.CylinderGeometry(gardener?.20:.29,gardener?.20:.29,.035,10),gardener?P('hide-moss-shade'):P('rope'),face);brim.position.y=.18;
  const crown=mesh(new T.CylinderGeometry(.16,gardener?.17:.23,.16,8),gardener?P('hide-moss'):P('haft'),face);crown.position.y=.255;
  box(.34,.50,.015,kind==='master-farmer'?P('hide-azure-shade'):P('bone-shade'),.17,1.08,0,root);
  for(const z of [-.14,.14])box(.014,.09,.027,P('bone'),.185,1.39,z,root);
  if(kind==='gardener')for(let i=0;i<4;i++)seg(v(-.06,.97,.37),v(-.12,1.15+i*.04,.37),.015,.010,P('leaf-light'),root);
  if(kind==='master-farmer')patch([[.14,-.06,-.10],[.17,-.13,0],[.13,-.24,0],[.14,-.06,-.10],[.13,-.24,0],[.14,-.06,.10]],P('hide-ash-light'),face);
 }
 if(baker){
  box(.022,.58,.34,P('bone'),.18,1.05,0,root);
  const hat=mesh(new T.CylinderGeometry(.14,.13,.24,8),P('bone'),face);hat.position.y=.27;
  for(let i=0;i<3;i++)ico(.12,P('bone'),-.04+i*.065,.41,0,[1,.65,1],face);
 }
 if(guard){
  loft([{y:.97,front:.19,back:.16,width:.20},{y:1.26,front:.21,back:.17,width:.25},{y:1.44,front:.17,back:.13,width:.27}],P('hide-iron'),root);
  for(const side of [-1,1]){
   ico(.15,P('hide-iron-light'),.02,1.39,side*.29,[1,.65,1],root);
   box(.11,.22,.15,P('hide-iron-shade'),.12,.41,side*.17,root);
  }
  loft([{y:.04,front:.16,back:.15,width:.16},{y:.20,front:.13,back:.14,width:.14},{y:.25,front:.02,back:.08,width:.07}],P('hide-iron-shade'),face);
  if(knight){
   robe(root,cloth,.49);
   box(.026,.28,.28,cloth,.215,1.16,0,root);
   box(.027,.025,.19,P('hide-gold'),.23,1.17,0,root);
   box(.027,.16,.025,P('hide-gold'),.23,1.17,0,root);
   box(.022,.24,.28,P('hide-iron-light'),.20,-.04,0,face);
   box(.008,.017,.23,P('hide-obsidian-shade'),.214,.013,0,face);
   const plume=ico(.14,P(kind==='ardougne-knight'?'hide-crimson':'hide-azure'),-.08,.28,0,[1.4,.7,.38],face);
  }
  seg(v(-.10,.92,-.26),v(-.13,.34,-.27),.036,.028,P('hide-iron-shade'),root);
  box(.10,.045,.15,P('hide-gold-shade'),-.1,.96,-.26,root);
 }
 if(kind==='wizard'){
  robe(root,P('hide-azure-shade'),.14);
  mesh(new T.ConeGeometry(.25,.53,6),P('hide-azure'),face).position.y=.40;
 }
 if(['jeweller','merchant','master-trader'].includes(kind)){
  robe(root,kind==='jeweller'?P('hide-void'):kind==='master-trader'?P('hide-gold-shade'):P('hide-crimson-shade'),kind==='master-trader'?.33:.56);
  box(.017,.40,.095,P('hide-gold'),.185,1.20,0,root);
  if(kind==='master-trader'){
   for(const side of [-1,1])patch([[.17,1.39,side*.12],[.23,1.28,0],[.18,1.0,side*.14]],P('bone'),root);
   const cap=mesh(new T.CylinderGeometry(.16,.18,.16,8),P('hide-gold-shade'),face);cap.position.y=.23;
   box(.021,.035,.28,P('hide-gold'),.18,1.04,0,root);
  }
 }
 if(kind==='tzraar'){
  root.remove(body);hips.visible=false;
  root.traverse(m=>{if(m.isMesh&&[P('skin'),P('bone'),P('trousers'),P('boot')].includes('#'+m.material.color.getHexString())){m.material=m.material.clone();m.material.color.set(P('hide-obsidian'));}});
  loft([{y:.84,front:.19,back:.18,width:.25},{y:1.13,front:.29,back:.23,width:.36},{y:1.44,front:.26,back:.22,width:.38}],P('hide-obsidian-shade'),root);
  const stoneHead=ico(.25,P('hide-obsidian'),.03,1.64,0,[.9,1.2,1.2],root);
  for(const z of [-.12,.12])box(.012,.025,.053,P('ember'),.24,1.66,z,root);
  for(const side of [-1,1]){
   ico(.22,P('hide-obsidian'),.02,1.35,side*.34,[1,.9,1],root);
   for(let j=0;j<3;j++)patch([[.27,1.36-j*.13,side*.15],[.29,1.31-j*.13,side*.24],[.27,1.23-j*.13,side*.16]],P('ember'),root);
   ico(.13,P('hide-obsidian'),.13,.89,side*.36,[1,1,1.3],root);
   for(let i=0;i<3;i++)seg(v(.17,.86,side*.33+(i-1)*.043),v(.24,.80,side*.33+(i-1)*.043),.027,.008,P('hide-obsidian-shade'),root);
  }
 }
 const pouch=new T.Group();root.add(pouch);pouch.position.set(-.13,.96,.32);
 ico(.10,kind==='tzraar'?P('hide-gold-shade'):P('leather-shade'),0,0,0,[.8,1.0,.6],pouch);
 box(.13,.035,.055,P('haft'),0,.063,.048,pouch);
 box(.035,.043,.02,P('hide-gold'),0,.033,.077,pouch);
 root.updateMatrixWorld(true);
 return {root,pouch,contact:root.localToWorld(v(-.13,.98,.40))};
}
