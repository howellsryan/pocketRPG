import { describe, expect, it } from 'vitest'
import skillsData from '../src/data/skills.json'
import { getXPForLevel, getLevelFromXP } from '../src/engine/experience.js'
import { calculateDungeoneeringTokensForXp, calculateDungeoneeringTokensForAction, canAffordDungeoneeringReward } from '../src/engine/dungeoneeringTokens.js'

describe('dungeoneering token helpers', () => {
  it('calculates from xp', () => {
    expect(calculateDungeoneeringTokensForXp(0)).toBe(0)
    expect(calculateDungeoneeringTokensForXp(1000)).toBe(150)
    expect(calculateDungeoneeringTokensForXp(-1)).toBe(0)
    expect(calculateDungeoneeringTokensForXp('bad' as any)).toBe(0)
    expect(calculateDungeoneeringTokensForXp(1)).toBe(1)
  })
  it('uses action xp safely', () => {
    expect(calculateDungeoneeringTokensForAction({ xp: 2000 } as any)).toBe(300)
    expect(calculateDungeoneeringTokensForAction({ xp: null } as any)).toBe(0)
  })
  it('validates reward affordability', () => {
    const reward = { level: 80, tokenCost: 300000 }
    expect(canAffordDungeoneeringReward(reward as any, 300000, 80)).toBe(true)
    expect(canAffordDungeoneeringReward(reward as any, 500000, 99)).toBe(true)
    expect(canAffordDungeoneeringReward(reward as any, 299999, 80)).toBe(false)
    expect(canAffordDungeoneeringReward(reward as any, 300000, 79)).toBe(false)
    expect(canAffordDungeoneeringReward({ level: 80, tokenCost: 0 } as any, 999999, 99)).toBe(false)
  })
})

describe('dungeoneering reward prices and progression balance', () => {
  const actions = (skillsData as any).dungeoneering.actions
  it('all rewards have token cost and product', () => {
    const rewards = actions.filter((a:any) => a.category === 'reward')
    for (const action of rewards) {
      expect(action.product).toBeTruthy()
      expect(Number(action.tokenCost)).toBeGreaterThan(0)
    }
  })
  it('has configured costs', () => {
    // The chaotic weapons are the top of their respective ladders, so they cost
    // more than the kiteshields they sit alongside.
    for (const a of actions.filter((x:any) => x.category === 'reward')) {
      const n = String(a.name).toLowerCase()
      if (n.includes('arcane necklace')) expect(a.tokenCost).toBe(65000)
      else if (n.includes('chaotic')) expect(a.tokenCost).toBe(1000000)
      else expect(a.tokenCost).toBe(300000)
    }
  })
  function simTo(level:number){
    const target = getXPForLevel(level)
    const training = actions.filter((a:any)=>a.category!=='reward').sort((a:any,b:any)=>a.level-b.level)
    let xp=0,t=0
    while (xp < target) {
      const l = getLevelFromXP(xp)
      const action = [...training].reverse().find((a:any)=>a.level<=l) || training[0]
      xp += action.xp
      t += calculateDungeoneeringTokensForAction(action)
    }
    return t
  }
  it('level 80 affords one chaotic but not two', () => {
    const t = simTo(80)
    expect(t).toBeGreaterThanOrEqual(295000)
    expect(t).toBeLessThan(600000)
  })
  it('level 65 can afford arcane necklace', () => {
    expect(simTo(65)).toBeGreaterThanOrEqual(65000)
  })
})
