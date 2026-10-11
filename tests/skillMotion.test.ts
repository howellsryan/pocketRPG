import { describe, it, expect } from 'vitest'
import { skillMotionFamily, advanceSkillMotion, sampleSkillMotion, farmingMotionAction, entrySkillMotionMs, tintSkillMotionPixels, SKILL_MOTION_CLIPS } from '../src/utils/skillMotion.js'
import skills from '../src/data/skills.json'
import { findBestToolForSkill } from '../src/engine/skilling.js'
import items from '../src/data/items.json'
import { inkwrightPlan } from '../src/utils/inkwright.js'

describe('skill motion presentation', () => {
  it('gives whole courses and floors a paced sprite plan', () => {
    expect(inkwrightPlan('agility', 40, 'gnome_stronghold')?.cycleMs).toBe(24000)
    expect(inkwrightPlan('dungeoneering', 500, 'dungeoneering_floor_1')?.strikePeriodMs).toBeLessThanOrEqual(900)
  })
  it('chooses planting, ground harvesting, chopping and fruit picking from the actual operation', () => {
    expect(farmingMotionAction('plant','fruitTree')).toBe('plant_tree')
    expect(farmingMotionAction('plant','herb')).toBe('plant')
    expect(farmingMotionAction('harvest','herb')).toBe('harvest_ground')
    expect(farmingMotionAction('harvest','tree')).toBe('harvest_tree')
    expect(farmingMotionAction('harvest','fruitTree')).toBe('harvest_fruit')
  })
  it('draws each pickpocket target as its own character, and reaches for goods at stalls', () => {
    const families=skills.thieving.npcs.map(n=>skillMotionFamily('thieving',n.id))
    expect(new Set(families).size).toBe(skills.thieving.npcs.length)
    expect(skillMotionFamily('thieving','elf')).toBe('steal-elf')
    expect(skillMotionFamily('thieving','ardougne_knight')).toBe('steal-ardougne-knight')
    expect(skillMotionFamily('thieving','cake_stall')).toBe('steal-stall')
    for(const family of families)expect(SKILL_MOTION_CLIPS[family!]).toBeDefined()
  })
  it('performs one pickpocket attempt, then waits rather than repeatedly grabbing before a reward', () => {
    const plan=inkwrightPlan('thieving',8,'master_farmer')!
    expect(sampleSkillMotion('steal-master-farmer',300,plan)).toBeLessThan(18)
    expect(sampleSkillMotion('steal-master-farmer',1800,plan)).toBe(23)
    expect(sampleSkillMotion('steal-master-farmer',plan.cycleMs,plan)).toBe(0)
  })
  it('uses the selected fishing tool rather than imposing a species restriction', () => {
    expect(skillMotionFamily('fishing','shark','fishing_net')).toBe('fish-net')
    expect(skillMotionFamily('fishing','shrimps','harpoon')).toBe('fish-harpoon')
    expect(skillMotionFamily('fishing','tuna',null)).toBe('fish-hands')
  })
  it('distinguishes physical methods that cannot share one generic gesture', () => {
    const cases=[['smithing','smelt_iron','smelt'],['smithing','smith_iron_sword','smith'],['smithing','smith_iron_arrowtips','smith-ammo'],['smithing','forge_godsword_blade','blade-assemble'],['crafting','tan_cowhide','tan'],['crafting','molten_glass','glass'],['crafting','cut_zenyte','gem-cut'],['crafting','leather_body','sew'],['fletching','magic_shortbow_string','string-bow'],['fletching','headless_arrows','feather'],['fletching','tip_onyx_bolts','bolt-tip'],['magic','enchant_ruby_bolts','enchant-bolt'],['magic','enchant_ruby','enchant-jewel']]
    for(const [skill,id,family] of cases)expect(skillMotionFamily(skill,id)).toBe(family)
  })
  it('resolves every real recurring training action to an authored clip', () => {
    for(const [skill,data] of Object.entries(skills))for(const action of data.actions||[]){
      if(action.id.startsWith('unlock_'))continue
      const family=skillMotionFamily(skill,action.id)
      expect(family,`${skill}:${action.id}`).not.toBeNull()
      expect(SKILL_MOTION_CLIPS[family!],`${skill}:${action.id}`).toBeDefined()
    }
  })
  it('uses the engine inventory-tool and depleted-charge selection', () => {
    const stats={mining:{xp:13034431}}
    const tool=findBestToolForSkill('mining',{weapon:{itemId:'shardglass_pickaxe',charges:0}},[{itemId:'dragon_pickaxe',quantity:1}],items,stats)
    expect(tool?.id).toBe('dragon_pickaxe')
    expect(skillMotionFamily('mining','copper',tool?.id)).toBe('mine-pick')
  })
  it('returns to the current work phase without replaying an old reward', () => {
    const elapsed=entrySkillMotionMs(16,5)
    expect(elapsed).toBe(6600)
    const s=advanceSkillMotion(null,{actionKey:'iron',completionToken:8,startElapsedMs:elapsed},0)
    expect(s.elapsedMs).toBe(6600)
    expect(s.payoffAgeMs).toBeNull()
  })
  it('does not replay an old completion when mounted or switched', () => {
    const s=advanceSkillMotion(null,{actionKey:'copper',completionToken:7},0)
    expect(s.payoffAgeMs).toBeNull()
    const complete=advanceSkillMotion(s,{actionKey:'copper',completionToken:8},60)
    expect(complete.payoffAgeMs).toBe(0)
    expect(complete.elapsedMs).toBe(0)
    const next=advanceSkillMotion(complete,{actionKey:'iron',completionToken:8},100)
    expect(next.payoffAgeMs).toBeNull()
  })
  it('does not replay rewards earned while the tab is hidden', () => {
    const s=advanceSkillMotion(null,{actionKey:'x',completionToken:1},0)
    expect(advanceSkillMotion(s,{actionKey:'x',completionToken:4,hidden:true},60000).payoffAgeMs).toBeNull()
  })
  it('freezes while paused or hidden and holds the actual completion frame', () => {
    const s=advanceSkillMotion(null,{actionKey:'x',completionToken:0},0)
    const running=advanceSkillMotion(s,{actionKey:'x',completionToken:0},250)
    expect(running.elapsedMs).toBe(250)
    expect(advanceSkillMotion(running,{actionKey:'x',completionToken:0,paused:true},1000).elapsedMs).toBe(250)
    expect(advanceSkillMotion(running,{actionKey:'x',completionToken:0,hidden:true},1000).elapsedMs).toBe(250)
    const held=advanceSkillMotion(running,{actionKey:'x',completionToken:1,holding:true},50)
    const waiting=advanceSkillMotion(held,{actionKey:'x',completionToken:1,holding:true},600)
    expect(waiting.elapsedMs).toBe(0)
    expect(waiting.payoffAgeMs).toBe(600)
  })
  it('keeps strikes brisk even on a five-minute dungeon floor', () => {
    expect(sampleSkillMotion('dungeon',1000,{cycleMs:300000,strikePeriodMs:800})).toBe(6)
    expect(sampleSkillMotion('smith',800,{cycleMs:2400,strikePeriodMs:800})).toBe(0)
  })
  it('holds a cast fishing pose during the wait and retrieves at completion', () => {
    expect(sampleSkillMotion('fish-rod',5000,{cycleMs:12000,strikePeriodMs:800})).toBeGreaterThanOrEqual(10)
    expect(sampleSkillMotion('fish-rod',5000,{cycleMs:12000,strikePeriodMs:800})).toBeLessThanOrEqual(15)
    expect(sampleSkillMotion('fish-rod',11900,{cycleMs:12000,strikePeriodMs:800})).toBeGreaterThanOrEqual(20)
  })
  it('tints only the visible tool/material slots and preserves the human and alpha', () => {
    const source=new Uint8ClampedArray([100,100,100,255,80,90,100,255,90,90,90,128])
    const mask=new Uint8ClampedArray([255,0,0,255,0,0,0,255,0,255,0,255])
    const tinted=tintSkillMotionPixels(source,mask,[255,0,0],[0,255,0])
    expect(Array.from(tinted)).toEqual([100,0,0,255,80,90,100,255,0,90,0,128])
    expect(source[1]).toBe(100)
  })
  it('can recolour an essence or clay boulder without tinting ordinary ore rocks', () => {
    const pixels=new Uint8ClampedArray([100,100,100,255]),mask=new Uint8ClampedArray([0,0,255,255])
    expect(Array.from(tintSkillMotionPixels(pixels,mask,null,null))).toEqual([100,100,100,255])
    expect(Array.from(tintSkillMotionPixels(pixels,mask,null,null,[255,0,0]))).toEqual([100,0,0,255])
  })
  it('uses a static readable pose for reduced motion', () => {
    expect(sampleSkillMotion('smith',100,{cycleMs:2400,strikePeriodMs:800},true)).toBe(sampleSkillMotion('smith',1700,{cycleMs:2400,strikePeriodMs:800},true))
  })
})
