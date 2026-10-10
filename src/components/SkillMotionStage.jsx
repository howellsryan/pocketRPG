import { getItemIconTint } from '../utils/itemIcons.js'
import { resolveIconTint } from '../utils/iconTints.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import GameIcon from './GameIcon.jsx'
import { skillMotionFamily, SKILL_MOTION_CLIPS, advanceSkillMotion, sampleSkillMotion, tintSkillMotionPixels } from '../utils/skillMotion.js'
import itemsData from '../data/items.json'

// A small decoded-image cache: visiting every skill does not retain every atlas.
const skillMotionImages = new Map()
function loadSkillMotionImage(src) {
  const cached = skillMotionImages.get(src)
  if (cached) { skillMotionImages.delete(src); skillMotionImages.set(src,cached); return cached }
  const promise = new Promise((resolve,reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => { skillMotionImages.delete(src); reject(new Error(`Cannot load ${src}`)) }
    const base = (typeof pocketAssetBase !== 'undefined' && pocketAssetBase) || '/'
    img.src = base + src
  })
  skillMotionImages.set(src,promise)
  while (skillMotionImages.size > 4) skillMotionImages.delete(skillMotionImages.keys().next().value)
  return promise
}

/** Original faceted human, baked offline. No WebGL or loot decisions at runtime. */
export default function SkillMotionStage({ plan, tool = null, product = null, subject = null, rewards = [], yieldToken = 0, paused = false, holding = false, label = null, fallback = null, once = false, frame = null, elapsedAtEntry = 0 }) {
  const family = skillMotionFamily(plan.skill,plan.actionId,tool?.id)
  const clip = SKILL_MOTION_CLIPS[family]
  const canvas = useRef(null), payoff = useRef(null), clock = useRef(null)
  const [image,setImage] = useState(null)
  const latest = useRef(null)
  latest.current = {plan,yieldToken,paused,holding,frame,elapsedAtEntry}
  const actionKey = `${plan.skill}:${plan.actionId}:${tool?.id||'hands'}:${plan.cycleMs}`

  const toolTint = tool ? resolveIconTint(getItemIconTint(tool)) : null
  const resourceItem = product || subject
  const resourceTint = resourceItem ? resolveIconTint(getItemIconTint(resourceItem)) : null
  useEffect(() => {
    let cancelled = false
    setImage(null)
    if(clip)Promise.all([loadSkillMotionImage(clip.src),loadSkillMotionImage(clip.src.replace('.webp','-mask.webp'))]).then(([img,mask]) => {
      if(cancelled)return
      const rgb=hex => hex && /^#[0-9a-f]{6}$/i.test(hex) ? [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)) : null
      if(!toolTint&&!resourceTint){setImage(img);return}
      const buffer=document.createElement('canvas');buffer.width=img.width;buffer.height=img.height
      const context=buffer.getContext('2d');context.drawImage(img,0,0)
      const pixels=context.getImageData(0,0,img.width,img.height)
      context.drawImage(mask,0,0)
      const slots=context.getImageData(0,0,img.width,img.height)
      pixels.data.set(tintSkillMotionPixels(pixels.data,slots.data,rgb(toolTint),rgb(resourceTint),['clay','rune_essence'].includes(plan.actionId)?rgb(resourceTint):null))
      context.putImageData(pixels,0,0);setImage(buffer)
    }).catch(() => {})
    return () => {cancelled = true}
  }, [clip?.src,toolTint,resourceTint])

  useEffect(() => {
    if(!image || !canvas.current || !clip)return
    const ctx=canvas.current.getContext('2d')
    const media=window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedPayoffStarted=null
    const settleReducedPayoff=()=>{
      if(reducedPayoffStarted!==null&&clock.current?.payoffAgeMs!==null)clock.current={...clock.current,payoffAgeMs:clock.current.payoffAgeMs+performance.now()-reducedPayoffStarted}
      reducedPayoffStarted=null
    }
    let raf=0,payoffTimer=0,last=performance.now(),lastFrame=-1,lastPayoff=-1
    const draw = now => {
      const input=latest.current
      const hidden=document.hidden
      clock.current=advanceSkillMotion(clock.current,{actionKey,completionToken:input.yieldToken,paused:input.paused,holding:input.holding,hidden,startElapsedMs:input.elapsedAtEntry},Math.min(100,Math.max(0,now-last)))
      last=now
      const frame=input.frame === null ? sampleSkillMotion(family,clock.current.elapsedMs,input.plan,media.matches) : Math.max(0,Math.min(23,input.frame))
      if(frame!==lastFrame){
        ctx.clearRect(0,0,200,128)
        ctx.drawImage(image,(frame%clip.columns)*200,Math.floor(frame/clip.columns)*128,200,128,0,0,200,128)
        lastFrame=frame
      }
      const age=clock.current.payoffAgeMs
      const visible=age!==null&&age<input.plan.payoffMs
      if(payoff.current && (age!==lastPayoff||media.matches)){
        payoff.current.style.visibility=visible?'visible':'hidden'
        const p=visible?age/input.plan.payoffMs:1
        payoff.current.style.opacity=String(media.matches?1:1-p*p)
        payoff.current.style.transform=media.matches?'none':`translateY(${-p*16}px)`
        lastPayoff=age
      }
      if(media.matches&&visible&&!hidden&&!input.paused){
        clearTimeout(payoffTimer)
        reducedPayoffStarted=now
        payoffTimer=setTimeout(()=>{reducedPayoffStarted=null;clock.current={...clock.current,payoffAgeMs:input.plan.payoffMs};if(payoff.current)payoff.current.style.visibility='hidden'},Math.max(0,input.plan.payoffMs-age))
      }
      if(!hidden&&!input.paused&&!media.matches&&(!once||clock.current.elapsedMs<input.plan.cycleMs))raf=requestAnimationFrame(draw)
    }
    const restart=() => {cancelAnimationFrame(raf);clearTimeout(payoffTimer);settleReducedPayoff();last=performance.now();draw(last)}
    document.addEventListener('visibilitychange',restart)
    media.addEventListener('change',restart)
    restart()
    return () => {cancelAnimationFrame(raf);clearTimeout(payoffTimer);settleReducedPayoff();document.removeEventListener('visibilitychange',restart);media.removeEventListener('change',restart)}
  }, [image,actionKey,yieldToken,paused,holding,frame])

  if(!clip)return fallback
  const workItem=subject || (['gem-cut','jewellery','brew','combine-potions','carve','feather','arrow-tip','string-bow','bolt-tip','food-assemble','alchemy','enchant-jewel','enchant-bolt','magic-tan','magic-plank','infuse','scroll'].includes(family)?product:null)
  const awardedRewards = rewards.filter(r=>r.quantity>0&&itemsData[r.itemId])
  return <div class="ink-stage skill-motion-stage" role="img" aria-label={`${label||`${plan.label} in progress`}${tool ? ` with ${tool.name}` : ''}`} data-motion={family}>
    {!image&&fallback}
    <canvas ref={canvas} width="200" height="128" class={`skill-motion-canvas${image?' is-ready':''}`} aria-hidden="true" />
    {image&&tool&&<span class="skill-motion-tool" aria-hidden="true"><GameIcon item={tool} size={22}/></span>}
    {image&&workItem&&<span class="skill-motion-subject" aria-hidden="true"><GameIcon item={workItem} size={15}/></span>}
    {awardedRewards.length>0&&<div ref={payoff} class="skill-motion-rewards" style={{visibility:'hidden'}} aria-hidden="true">
      {awardedRewards.map(r=><span key={r.itemId}><GameIcon item={itemsData[r.itemId]} size={19}/><b>+{r.quantity}</b></span>)}
    </div>}
  </div>
}
