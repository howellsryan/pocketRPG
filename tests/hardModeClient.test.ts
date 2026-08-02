// The client mirror of the Hard Mode switches. The rule it exists to keep: a
// write the server refused must leave the mirror alone, or the player fights a
// doubled boss for ordinary drop rates.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getToken = vi.fn(() => 'token')
const getCharacterId = vi.fn(() => 42)
const getHardModeTargets = vi.fn()
const setHardModeTarget = vi.fn()

vi.mock('../src/cloud/api.js', () => ({
  api: {
    getHardModeTargets: (...args: any[]) => getHardModeTargets(...args),
    setHardModeTarget: (...args: any[]) => setHardModeTarget(...args),
  },
  getToken: () => getToken(),
  getCharacterId: () => getCharacterId(),
}))

const { fetchHardModeTargets, hardModeKey, pushHardModeTarget } = await import('../src/cloud/hardMode.js')

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockReturnValue('token')
  getCharacterId.mockReturnValue(42)
})

describe('hard mode client mirror', () => {
  it('keys a target by type and id', () => {
    expect(hardModeKey('monsters', 'zaryth_the_shadowed')).toBe('monsters:zaryth_the_shadowed')
  })

  it('reads the server list and drops malformed entries', async () => {
    getHardModeTargets.mockResolvedValue({
      entries: [
        { sourceType: 'monsters', sourceId: 'corporeal_horror' },
        { sourceType: 'raids', sourceId: 'vaults_of_xyren' },
        { sourceType: 'monsters' },
        null,
      ],
    })
    expect(await fetchHardModeTargets()).toEqual(['monsters:corporeal_horror', 'raids:vaults_of_xyren'])
  })

  it('returns null when signed out, so the caller keeps what it has', async () => {
    getToken.mockReturnValue(null as any)
    expect(await fetchHardModeTargets()).toBeNull()
    expect(getHardModeTargets).not.toHaveBeenCalled()
  })

  it('returns null rather than an empty list when the fetch fails', async () => {
    getHardModeTargets.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await fetchHardModeTargets()).toBeNull()
    warn.mockRestore()
  })

  it('writes the switch and hands back its key', async () => {
    setHardModeTarget.mockResolvedValue({ ok: true })
    expect(await pushHardModeTarget('monsters', 'corporeal_horror', true)).toBe('monsters:corporeal_horror')
    expect(setHardModeTarget).toHaveBeenCalledWith('monsters', 'corporeal_horror', true)
  })

  it('throws on a refused write so the caller can leave the switch where it was', async () => {
    setHardModeTarget.mockRejectedValue(new Error('nope'))
    await expect(pushHardModeTarget('monsters', 'corporeal_horror', true)).rejects.toThrow('nope')
  })
})

// The bug this pins: the loot modal used to read `hardModeActive` off the
// record resolveMonsterRewardData returns, which is a RAW monsters.json lookup
// built for the reward tables. It never carries the flag, so the answer was
// always "not hard" — and Fight Again / Skip after a hard kill silently
// restarted an ORDINARY boss while the server's switch kept paying the doubled
// drop rates. The flag has to ride the fight record, or the modal itself.
describe('the reward-table lookup is not a record of how the fight was fought', () => {
  it('drops hardModeActive, so the flag can never be read back off it', async () => {
    const { resolveMonsterRewardData } = await import('../src/engine/slayerRewards.js')
    const { scaleMonsterForHardMode } = await import('../src/engine/hardMode.js')
    const monstersData = (await import('../src/data/monsters.json')).default as Record<string, any>
    const hardId = Object.keys(monstersData).find((id) => monstersData[id].hardMode === true)!

    const fought = scaleMonsterForHardMode(monstersData[hardId])
    expect(fought.hardModeActive).toBe(true)

    const forRewards = resolveMonsterRewardData(fought, fought, monstersData)
    expect(forRewards.hardModeActive).toBeUndefined()
  })

  it('scales back up from a plain id once the flag is carried alongside', async () => {
    const { monstersTableFor } = await import('../src/engine/hardMode.js')
    const monstersData = (await import('../src/data/monsters.json')).default as Record<string, any>
    const hardId = Object.keys(monstersData).find((id) => monstersData[id].hardMode === true)!

    // What Fight Again does: look the id back up in the table the flag selects.
    expect(monstersTableFor(monstersData, true)[hardId].hardModeActive).toBe(true)
    expect(monstersTableFor(monstersData, false)[hardId].hardModeActive).toBeUndefined()
    // Offence really is doubled in the table Fight Again lands in, and the
    // health bar really is not (HARD_MODE_MULTIPLIERS).
    expect(monstersTableFor(monstersData, true)[hardId].attackBonus)
      .toBe(monstersData[hardId].attackBonus * 2)
    expect(monstersTableFor(monstersData, true)[hardId].hitpoints)
      .toBe(monstersData[hardId].hitpoints)
  })
})
