import { describe, it, expect } from 'vitest'
import monstersData from '../src/data/monsters.json'

const shaman: any = (monstersData as any).lizardman_shaman

describe('Slayer monster requirements', () => {
  it('lizardman shaman exists with expected core config', () => {
    expect(shaman).toBeDefined()
    expect(shaman.name).toBe('Marshscale Shaman')
    expect(shaman.boss).not.toBe(true)
    expect(shaman.slayerRequirement).toBe(80)
    expect(shaman.skippable).toBe(true)
    expect(shaman.attackStyle).toBe('ranged')
  })

  it('lizardman shaman includes dragon warhammer at exactly 1/3000', () => {
    const dwhDrop = shaman.drops.find((drop: any) => drop.itemId === 'dragon_warhammer')
    expect(dwhDrop).toBeDefined()
    expect(dwhDrop.quantity).toBe(1)
    expect(dwhDrop.chance).toBe(1 / 3000)
  })

  it('slayer thresholds lock below requirement and unlock at requirement', () => {
    const canFight = (slayerLevel: number, required: number) => slayerLevel >= required
    expect(canFight(79, shaman.slayerRequirement)).toBe(false)
    expect(canFight(80, shaman.slayerRequirement)).toBe(true)
    const gorilla: any = (monstersData as any).demonic_gorilla
    expect(canFight(69, gorilla.slayerRequirement)).toBe(false)
    expect(canFight(70, gorilla.slayerRequirement)).toBe(true)
  })
})
