import { actionCycleMs } from './actionSprites.js'
// Presentation only. Timing is supplied by inkwrightPlan; rewards by callers.
const SKILL_CLIP_NAMES = ['mine-pick','mine-hands','chop-axe','chop-hands','fish-net','fish-rod','fish-cage','fish-harpoon','fish-hands','kindle','cook','food-assemble','smelt','smith','smith-ammo','blade-assemble','special-assemble','tan','sew','glass','gem-cut','jewellery','carve','feather','arrow-tip','string-bow','bolt-tip','brew','combine-potions','bury','offer','scatter','hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank','runecraft','hunt-cow','hunt-person','hunt-wizard','hunt-jeweller','hunt-master-trader','hunt-herbi','hunt-reaper','steal','steal-farmer','steal-gardener','steal-baker','steal-master-farmer','steal-guard','steal-knight','steal-ardougne-knight','steal-vyre','steal-elf','steal-tzraar','steal-stall','build','infuse','scroll','agility','agility-balance','dungeon','plant','plant-sapling','harvest-ground','harvest-tree','harvest-fruit']
export const SKILL_MOTION_CLIPS = Object.fromEntries(SKILL_CLIP_NAMES.map(name => [name, {src:`skill-motion/${name}.webp?v=2`,width:400,height:256,columns:6,frames:24}]))

export function skillMotionFamily(skill, actionId = '', toolId = null) {
  const id=String(actionId || '')
  if(id.startsWith('unlock_'))return null
  if(skill==='mining')return toolId?'mine-pick':'mine-hands'
  if(skill==='woodcutting')return toolId?'chop-axe':'chop-hands'
  if(skill==='fishing'){
    if(toolId==='fishing_rod')return 'fish-rod'
    if(toolId==='lobster_cage')return 'fish-cage'
    if(toolId==='harpoon'||toolId==='shardglass_harpoon')return 'fish-harpoon'
    if(toolId==='fishing_net'||toolId==='angler_net')return 'fish-net'
    return 'fish-hands'
  }
  if(skill==='smithing')return id.startsWith('smelt_')?'smelt':id==='forge_godsword_blade'?'blade-assemble':id.startsWith('make_')?'special-assemble':id.endsWith('_bolts_unf')||id.endsWith('_arrowtips')?'smith-ammo':'smith'
  if(skill==='crafting')return id.startsWith('tan_')?'tan':id==='molten_glass'?'glass':id.startsWith('cut_')?'gem-cut':/_(amulet|bracelet|necklace|ring)$/.test(id)?'jewellery':'sew'
  if(skill==='fletching')return id.endsWith('_string')?'string-bow':id.startsWith('cut_')&&id.endsWith('_bolt_tips')?'gem-cut':id.startsWith('tip_')?'bolt-tip':id==='headless_arrows'||id.startsWith('make_')&&id.endsWith('_bolts')?'feather':id.endsWith('_arrows')?'arrow-tip':'carve'
  if(skill==='cooking')return id==='cook_tuna_potato'?'food-assemble':'cook'
  if(skill==='herblore')return id==='super_combat'?'combine-potions':'brew'
  if(skill==='prayer')return id.startsWith('altar_')?'offer':id.startsWith('scatter_')?'scatter':'bury'
  if(skill==='magic')return id==='curse'||id==='stun'?'hex':id==='high_alch'?'alchemy':id==='superheat'?'superheat':id==='tan_leather'?'magic-tan':id==='plank_make'?'magic-plank':id.includes('bolt')?'enchant-bolt':'enchant-jewel'
  if(skill==='hunter')return {hunt_cow:'hunt-cow',hunt_herbi:'hunt-herbi',hunt_grim_reaper:'hunt-reaper',hunt_wizard:'hunt-wizard',hunt_jeweller:'hunt-jeweller',hunt_master_trader:'hunt-master-trader'}[id]||'hunt-person'
  if(skill==='thieving')return id.endsWith('_stall')?'steal-stall':id==='villager'?'steal':SKILL_MOTION_CLIPS[`steal-${id.replaceAll('_','-')}`]?`steal-${id.replaceAll('_','-')}`:'steal'
  if(skill==='summoning')return id.startsWith('summon_scroll_')?'scroll':'infuse'
  if(skill==='farming')return id==='plant_tree'?'plant-sapling':id==='plant'?'plant':id==='harvest_tree'?'harvest-tree':id==='harvest_fruit'?'harvest-fruit':'harvest-ground'
  if(skill==='agility')return id==='gnome_stronghold'?'agility-balance':'agility'
  return {firemaking:'kindle',runecraft:'runecraft',construction:'build',dungeoneering:'dungeon'}[skill] || null
}

/** A mount/action switch establishes a baseline; only a NEW token earns payoff. */
export function advanceSkillMotion(state, input, deltaMs) {
  const {actionKey,completionToken=0,paused=false,hidden=false,holding=false}=input
  if(!state || state.actionKey!==actionKey || completionToken<state.completionToken)return {actionKey,completionToken,elapsedMs:Math.max(0,Number(input.startElapsedMs)||0),payoffAgeMs:null}
  if(completionToken>state.completionToken)return {actionKey,completionToken,elapsedMs:0,payoffAgeMs:hidden?null:0}
  const dt=paused||hidden?0:Math.max(0,Number(deltaMs)||0)
  return {...state,elapsedMs:state.elapsedMs+(holding?0:dt),payoffAgeMs:state.payoffAgeMs===null?null:state.payoffAgeMs+dt}
}

export function sampleSkillMotion(family, elapsedMs, plan, reducedMotion=false) {
  if(reducedMotion)return 12
  let phase=(Math.max(0,elapsedMs)%plan.strikePeriodMs)/plan.strikePeriodMs
  const cycle=Math.max(1,plan.cycleMs),elapsed=Math.max(0,elapsedMs)%cycle
  if(family.startsWith('steal'))phase=Math.min(1,elapsed/Math.min(cycle,1200))
  else if(['hex','alchemy','superheat','enchant-jewel','enchant-bolt','magic-tan','magic-plank','bury','scatter','offer','infuse','scroll'].includes(family))phase=Math.min(1,elapsed/Math.min(cycle,1800))
  else if(family.startsWith('plant')||family.startsWith('harvest'))phase=elapsed/cycle
  else if(family==='kindle')phase=elapsed<cycle*.72?.20+.025*Math.sin(elapsed/plan.strikePeriodMs*Math.PI*2):.77+(elapsed-cycle*.72)/(cycle*.28)*.23
  if(family.startsWith('fish-')||family.startsWith('hunt-')){
    const setMs=Math.min(cycle*.35,plan.strikePeriodMs*1.4),retrieveMs=Math.min(cycle*.30,900)
    if(elapsed<setMs)phase=elapsed/setMs*.32
    else if(elapsed>=cycle-retrieveMs)phase=.78+(elapsed-(cycle-retrieveMs))/retrieveMs*.22
    else phase=.50+.03*Math.sin((elapsed-setMs)/plan.strikePeriodMs*Math.PI*2)
  }
  return Math.min(23,Math.floor(phase*24))
}

export function farmingMotionAction(operation, type) {
  if(operation==='plant')return type==='tree'||type==='fruitTree'?'plant_tree':'plant'
  return type==='tree'?'harvest_tree':type==='fruitTree'?'harvest_fruit':'harvest_ground'
}

export function tintSkillMotionPixels(pixels, mask, toolRgb, resourceRgb, rockRgb = null) {
  const result = new Uint8ClampedArray(pixels)
  for(let i=0;i<pixels.length;i+=4){
    const rock=rockRgb&&mask[i+2]>Math.max(mask[i],mask[i+1])
    const rgb=rock?rockRgb:mask[i]>mask[i+1]?toolRgb:resourceRgb
    const weight=(rock?mask[i+2]:Math.max(mask[i],mask[i+1]))/255
    if(!rgb || weight===0)continue
    const brightness=Math.max(pixels[i],pixels[i+1],pixels[i+2])/255
    for(let j=0;j<3;j++)result[i+j]=pixels[i+j]*(1-weight)+rgb[j]*brightness*weight
  }
  return result
}

// Seed on entry only; subsequent frames use smooth presentation time.
export function entrySkillMotionMs(ticks, ticksRemaining) {
  const total=Math.max(1,Number(ticks)||1)
  const remaining=Number.isFinite(Number(ticksRemaining))?Math.max(0,Math.min(total,Number(ticksRemaining))):total
  return actionCycleMs(total)*(total-remaining)/total
}
