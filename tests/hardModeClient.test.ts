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
