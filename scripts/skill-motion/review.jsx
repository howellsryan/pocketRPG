import { render } from 'preact'
import { useState, useEffect, useMemo, useRef } from 'preact/hooks'
import InkwrightStage from '../../src/components/InkwrightStage.jsx'
import GameIcon from '../../src/components/GameIcon.jsx'
import { inkwrightPlan } from '../../src/utils/inkwright.js'
import { skillMotionFamily, SKILL_MOTION_CLIPS, farmingMotionAction } from '../../src/utils/skillMotion.js'
import { getEffectiveToolActionTicks, createSkillingState, processSkillingTick } from '../../src/engine/skilling.js'
import { BUILDING_ACTIONS } from '../../src/engine/construction.js'
import { SUMMONING_CREATURES, getPouchRecipe, getScrollRecipe } from '../../src/engine/summoning.js'
import skills from '../../src/data/skills.json'
import items from '../../src/data/items.json'
import farms from '../../src/data/farming.json'

const reviewNames={mining:'Mining',woodcutting:'Woodcutting',fishing:'Fishing',firemaking:'Firemaking',smithing:'Smithing',crafting:'Crafting',fletching:'Fletching',cooking:'Cooking',herblore:'Herblore',prayer:'Prayer',magic:'Utility Magic',runecraft:'Runecraft',hunter:'Hunter',thieving:'Thieving',construction:'Construction',summoning:'Summoning',agility:'Agility',dungeoneering:'Dungeoneering',farming:'Farming'}
const reviewActions=Object.fromEntries(Object.keys(reviewNames).map(s=>[s,(skills[s]?.actions||skills[s]?.npcs||[]).filter(a=>!a.id.startsWith('unlock_')).map(a=>({...a,ticks:a.ticks||a.pickpocketTicks||4}))]))
reviewActions.construction=BUILDING_ACTIONS
reviewActions.summoning=SUMMONING_CREATURES.flatMap(c=>['pouch','scroll'].map(kind=>{const r=kind==='pouch'?getPouchRecipe(c):getScrollRecipe(c);return {id:`summon_${kind}_${c.id}`,name:`${c.name} ${kind}`,ticks:2,...r}}))
reviewActions.farming=Object.entries({herb:farms.herbs,vegetable:farms.vegetables,tree:farms.trees,fruitTree:farms.fruitTrees}).flatMap(([type,rows])=>rows.flatMap(c=>['plant','harvest'].map(op=>({id:farmingMotionAction(op,type),key:`${op}:${c.id}`,name:`${op==='plant'?'Plant':'Harvest'} ${c.name}`,ticks:2,product:op==='plant'?c.id:c.cropId,type}))))
const reviewStats=Object.fromEntries(Object.keys(reviewNames).map(s=>[s,{xp:13034431}]))
function previewRewards(action,scenario){
 if(scenario==='zero')return []
 if(scenario==='burn')return [{itemId:'burnt_food',quantity:1}]
 if(action.rewardTables)return action.rewardTables.slice(0,scenario==='multi'?action.rewardTables.length:1).map(t=>t.rewards[0]).filter(Boolean).map(d=>({itemId:d.itemId,quantity:Array.isArray(d.quantity)?d.quantity[0]:d.quantity||1}))
 if(action.dropTable)return action.dropTable.slice(0,scenario==='multi'?3:1).map(d=>({itemId:d.itemId,quantity:Array.isArray(d.quantity)?d.quantity[0]:d.quantity||1}))
 if(action.product)return [{itemId:action.product,quantity:action.productQty||1}]
 if(action.gemReward)return [{itemId:'diamond',quantity:1}]
 if(action.seedReward)return [{itemId:farms.herbs[0].id,quantity:1}]
 if(action.coinReward)return [{itemId:'coins',quantity:action.coinReward}]
 return []
}
function MotionReview(){
 const [skill,setSkill]=useState('woodcutting'),[actionKey,setActionKey]=useState('normal'),[toolId,setToolId]=useState('dragon_axe')
 const [playing,setPlaying]=useState(!matchMedia('(prefers-reduced-motion: reduce)').matches),[frame,setFrame]=useState(null),[scenario,setScenario]=useState('normal'),[speed,setSpeed]=useState(1)
 const [session,setSession]=useState(null),[rewards,setRewards]=useState([]),engine=useRef(null),native=useRef(null)
 const actions=reviewActions[skill],action=actions.find(a=>(a.key||a.id)===actionKey)||actions[0]
 const tool=items[toolId]||null,tools=Object.values(items).filter(i=>i.toolFor===skill)
 const ticks=getEffectiveToolActionTicks(skill,action.ticks,{weapon:tool?{itemId:toolId,charges:100}:null},items,reviewStats,[],action)
 const actualPlan=inkwrightPlan(skill,ticks,action.id)
 const plan={...actualPlan,cycleMs:actualPlan.cycleMs/speed,strikePeriodMs:actualPlan.strikePeriodMs/speed,payoffMs:actualPlan.payoffMs/speed}
 const family=skillMotionFamily(skill,action.id,tool?.id)
 const identity=`${skill}:${action.key||action.id}:${toolId}:${ticks}:${speed}`
 useEffect(()=>{
  engine.current=createSkillingState(skill,{...action,ticks});setSession({...engine.current});setRewards([]);setFrame(null);setScenario('normal')
 },[identity])
 useEffect(()=>{
  if(!playing)return
  const timer=setInterval(()=>{
   if(!engine.current)return
   const next=processSkillingTick(engine.current);engine.current=next.skillingState
   if(next.events.some(e=>e.type==='actionComplete'))setRewards(previewRewards(action,scenario))
   setSession({...engine.current})
  },600/speed)
  return()=>clearInterval(timer)
 },[playing,identity,scenario])
 useEffect(()=>{
  let raf=0
  function paint(){const source=document.querySelector('.review-enlarged canvas.is-ready');if(source&&native.current)native.current.getContext('2d').drawImage(source,0,0);raf=requestAnimationFrame(paint)}
  paint();return()=>cancelAnimationFrame(raf)
 },[])
 function chooseSkill(s){setSkill(s);setActionKey(reviewActions[s][0].key||reviewActions[s][0].id);setToolId(Object.values(items).filter(i=>i.toolFor===s).sort((a,b)=>(b.requirements?.[s]||0)-(a.requirements?.[s]||0))[0]?.id||'none');setFrame(null)}
 function chooseFamily(f){
  for(const s of Object.keys(reviewNames))for(const a of reviewActions[s])for(const t of [null,...Object.values(items).filter(i=>i.toolFor===s)])if(skillMotionFamily(s,a.id,t?.id)===f){setSkill(s);setActionKey(a.key||a.id);setToolId(t?.id||'none');setFrame(null);return}
 }
 function showPayoff(){engine.current={...engine.current,totalActions:(engine.current?.totalActions||0)+1,justCompleted:true,ticksRemaining:0};setRewards(previewRewards(action,scenario));setSession({...engine.current});setFrame(null)}
 const subjectId=Object.keys(action.materials||{})[0],product=items[action.product]||items[action.dropTable?.[0]?.itemId]||items[action.rewardTables?.[0]?.rewards?.[0]?.itemId]||null
 return <main class="review-shell forge-shell">
  <header><span class="fm-eyebrow">PocketRPG · Motion atelier</span><h1 class="fm-banner">The skills, brought to life.</h1><p>One approved human. Tools that meet their targets. Quiet, deliberate work.</p><div class="review-counts"><span class="fm-tag">339 recurring actions</span><span class="fm-tag">29 crops</span><span class="fm-tag">56 motion families</span></div></header>
  <nav class="review-skill-nav" aria-label="Skills">{Object.entries(reviewNames).map(([s,n])=><button class={`fm-toggle${s===skill?' is-on':''}`} aria-pressed={s===skill} onClick={()=>chooseSkill(s)}>{n}</button>)}</nav>
  <section class="fm-frame review-workbench"><div class="fm-parch">
   <div class="review-choice"><label>Action<select aria-label="Action" value={action.key||action.id} onChange={e=>{setActionKey(e.target.value);setFrame(null)}}>{actions.map(a=><option value={a.key||a.id}>{a.name}</option>)}</select></label>{tools.length>0&&<label>Tool<select aria-label="Tool" value={toolId} onChange={e=>{setToolId(e.target.value);setFrame(null)}}><option value="none">Bare hands</option>{tools.map(t=><option value={t.id}>{t.name}</option>)}</select></label>}</div>
   <div class="review-stage-heading"><h2 class="fm-rule-head">{action.name}</h2><span class="fm-num">{skill==='farming'?'Immediate · 1.2s gesture':`${ticks} ticks · ${(actualPlan.cycleMs/1000).toFixed(1)}s`}</span></div>
   <div class="review-enlarged"><InkwrightStage key={identity} plan={plan} tool={tool} subject={items[subjectId]||null} product={product} yieldToken={session?.totalActions||0} rewards={rewards} holding={session?.justCompleted||false} paused={!playing||frame!==null} frame={frame} label={`${action.name} preview`}/></div>
   <div class="review-controls"><button class="fm-btn fm-btn--ember" onClick={()=>{setPlaying(!playing);setFrame(null)}}>{playing?'Pause':'Play'}</button><button class="fm-btn fm-btn--brass" onClick={showPayoff}>Preview completion</button><label>Playback<select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1× actual cadence</option><option value={.5}>½× inspection</option></select></label><label>Outcome<select aria-label="Outcome" value={scenario} onChange={e=>setScenario(e.target.value)}><option value="normal">Recipe output</option><option value="zero">No item output</option>{(action.dropTable||action.rewardTables?.length>1)&&<option value="multi">Multiple drops</option>}{action.burnStopLevel&&<option value="burn">Burnt food</option>}</select></label></div>
   <label class="review-scrubber">Inspect the full motion <input aria-label="Inspect motion frame" type="range" min="0" max="23" value={frame??0} onInput={e=>{setPlaying(false);setFrame(Number(e.target.value))}}/></label>
   <div class="review-detail"><div><span class="fm-eyebrow">Native panel · 200 × 128</span><canvas ref={native} width="200" height="128" aria-label="Native size animation"/></div><div><span class="fm-eyebrow">Method & items</span><p class="fm-num" data-family={family}>{family}</p><div class="review-items">{tool&&<span><GameIcon item={tool} size={28}/>{tool.name}</span>}{product&&<span><GameIcon item={product} size={28}/>{product.name}</span>}</div><p class="review-note">{skill==='farming'?'Planting and harvesting complete immediately. This preview loops the presentation gesture.':'Completion follows the game’s 600ms ticks. The preview shows sample outcomes; it does not change an account.'}</p></div></div>
  </div></section>
  <section class="review-methods"><h2 class="fm-rule-head">Every method, ready to inspect</h2><div class="review-method-grid">{Object.keys(SKILL_MOTION_CLIPS).map(f=><button class="fm-tile" aria-pressed={f===family} onClick={()=>chooseFamily(f)}><img loading="lazy" src={`skill-motion/${f}-still.webp`} width="200" height="128" alt=""/><span>{f.replaceAll('-',' ')}</span></button>)}</div></section>
  <footer><a href="mining.html">Approved mining study & comparisons</a><a href="skill-motion-source.zip">Download the authoring and implementation sources</a></footer>
 </main>
}
render(<MotionReview/>,document.getElementById('app'))
