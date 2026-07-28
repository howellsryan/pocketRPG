// The client's end of a co-op fight.
//
// Two things must hold whatever the network does: the screen sees whole states
// even though the wire carries patches, and a fight still runs where a
// WebSocket cannot be had — Pages and the world Worker deploy separately (§20),
// so a Worker without the socket action is a routine state, not an outage.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const coopApi = {
  socketTicket: vi.fn(),
  tick: vi.fn(),
  sendAction: vi.fn(),
}
vi.mock('../src/cloud/coop.js', () => ({ coopApi }))

const { openCoopFeed } = await import('../src/cloud/coopFeed.js')

class FakeClientSocket {
  static instances: FakeClientSocket[] = []
  static failToOpen = false
  readyState = 0
  sent: string[] = []
  private listeners: Record<string, ((e: any) => void)[]> = {}
  constructor(public url: string) {
    FakeClientSocket.instances.push(this)
    // The runtime resolves the handshake asynchronously; a socket that will
    // never open closes instead, which is what an older Worker's 404 looks like.
    queueMicrotask(() => {
      if (FakeClientSocket.failToOpen) this.emit('close', { code: 1006 })
      else { this.readyState = 1; this.emit('open', {}) }
    })
  }
  addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ||= []).push(fn) }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.emit('close', { code: 1000 }) }
  emit(type: string, event: any) { for (const fn of this.listeners[type] || []) fn(event) }
  /** A frame arriving from the room. */
  serverSends(frame: unknown) { this.emit('message', { data: JSON.stringify(frame) }) }
  framesSent(): any[] { return this.sent.map((s) => JSON.parse(s)) }
}

function state(over: Record<string, unknown> = {}) {
  return {
    tick: 4,
    bossId: 'corporeal_horror',
    boss: { currentHP: 2000, maxHP: 2000 },
    members: { 7: { characterId: 7, hp: 99, maxHP: 99, damage: 0, status: 'alive', inventory: [] } },
    ...over,
  }
}

/** Lets the module's own promise chain (ticket fetch, then connect) settle. */
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

let beats: any[]
let statuses: (string | null)[]
let fatals: string[]
let losses: string[]

function open() {
  return openCoopFeed({
    sessionId: 12,
    onTick: (beat: any) => beats.push(beat),
    onStatus: (s: any) => statuses.push(s),
    onLost: (r: any) => losses.push(r),
    onFatal: (m: any) => fatals.push(m),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  beats = []
  statuses = []
  fatals = []
  losses = []
  FakeClientSocket.instances = []
  FakeClientSocket.failToOpen = false
  ;(globalThis as any).WebSocket = FakeClientSocket
  coopApi.socketTicket.mockReset().mockResolvedValue({ ticket: 'ticket-abc' })
  coopApi.tick.mockReset().mockResolvedValue({ state: state(), events: [], current_tick: 4, next_tick_in_ms: 600 })
  coopApi.sendAction.mockReset().mockResolvedValue({ tick_number: 5 })
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as any).WebSocket
})

describe('the socket transport', () => {
  it('opens with a ticket rather than the session token', async () => {
    const feed = open()
    await settle()

    expect(coopApi.socketTicket).toHaveBeenCalledWith(12)
    expect(FakeClientSocket.instances[0].url).toContain('ticket=ticket-abc')
    expect(FakeClientSocket.instances[0].url).toMatch(/^ws/)
    feed.close()
  })

  it('delivers whole states even though the wire carries patches', async () => {
    const feed = open()
    await settle()
    const ws = FakeClientSocket.instances[0]

    ws.serverSends({ t: 'sync', tick: 4, state: state(), events: [] })
    ws.serverSends({ t: 'tick', tick: 5, delta: { tick: 5, boss: { currentHP: 1958, maxHP: 2000 } } })

    expect(beats.at(-1).state.boss.currentHP).toBe(1958)
    // The parts the delta never mentioned are still there.
    expect(beats.at(-1).state.members['7'].status).toBe('alive')
    expect(beats.at(-1).state.bossId).toBe('corporeal_horror')
    feed.close()
  })

  it('passes events through with the beat they belong to', async () => {
    const feed = open()
    await settle()
    const ws = FakeClientSocket.instances[0]
    ws.serverSends({ t: 'sync', tick: 4, state: state(), events: [] })

    ws.serverSends({ t: 'tick', tick: 5, delta: null, events: [{ type: 'chatMessage', text: 'hi' }] })

    expect(beats.at(-1).events).toEqual([{ type: 'chatMessage', text: 'hi' }])
    feed.close()
  })

  it('resolves an action on the room’s acknowledgement', async () => {
    const feed = open()
    await settle()
    const ws = FakeClientSocket.instances[0]

    const pending = feed.send({ type: 'queue_special' })
    const frame = ws.framesSent().at(-1)
    expect(frame).toMatchObject({ t: 'intent', action: { type: 'queue_special' } })

    ws.serverSends({ t: 'ack', id: frame.id, tick_number: 9 })
    await expect(pending).resolves.toEqual({ tick_number: 9 })
    // Not through HTTP: the whole point is that an action costs no request.
    expect(coopApi.sendAction).not.toHaveBeenCalled()
    feed.close()
  })

  it('rejects a refused action, so the screen can un-do its echo', async () => {
    const feed = open()
    await settle()
    const ws = FakeClientSocket.instances[0]

    const pending = feed.send({ type: 'eat', inventorySlot: 3 })
    const frame = ws.framesSent().at(-1)
    ws.serverSends({ t: 'nack', id: frame.id, error: 'chat_rate_limited', status: 429 })

    await expect(pending).rejects.toThrow('chat_rate_limited')
    // The status has to survive the transport change: the screen turns a 429
    // into "slow down" and anything else into the raw message.
    await pending.catch((err: any) => expect(err.status).toBe(429))
    feed.close()
  })

  it('gives up on a close the room says is final', async () => {
    const feed = open()
    await settle()
    const ws = FakeClientSocket.instances[0]

    ws.serverSends({ t: 'bye', reason: 'flooding' })

    expect(fatals).toEqual(['This fight has ended.'])
    // …and nothing keeps trying afterwards.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(coopApi.tick).not.toHaveBeenCalled()
    feed.close()
  })
})

// The regression: a phone that locks its screen closes the socket, the room
// eventually lets the member go, and the reconnect is answered "not a member".
// That used to end on an error screen whose only way out was the back arrow —
// which reads as the fight breaking rather than as a moment away.
describe('being let go while away', () => {
  it('asks to be put back in rather than ending the fight', async () => {
    const feed = open()
    await settle()

    FakeClientSocket.instances[0].serverSends({ t: 'bye', reason: 'not_a_member' })

    expect(losses).toEqual(['not_a_member'])
    expect(fatals).toEqual([])
    feed.close()
  })

  it('treats an ejection and a finished session the same way', async () => {
    for (const reason of ['ejected', 'session_ended']) {
      losses = []
      fatals = []
      FakeClientSocket.instances = []
      const feed = open()
      await settle()
      FakeClientSocket.instances[0].serverSends({ t: 'bye', reason })
      expect(losses).toEqual([reason])
      expect(fatals).toEqual([])
      feed.close()
    }
  })

  it('does the same when the refusal arrives as a status instead of a frame', async () => {
    coopApi.socketTicket.mockRejectedValue(
      Object.assign(new Error('not a member'), { status: 403, body: { code: 'NOT_A_MEMBER' } }),
    )
    const feed = open()
    await settle()

    expect(losses).toEqual(['NOT_A_MEMBER'])
    expect(fatals).toEqual([])
    // Nothing retries behind the rejoin.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(coopApi.tick).not.toHaveBeenCalled()
    feed.close()
  })

  it('stops for a lost login, which rejoining cannot fix', async () => {
    coopApi.socketTicket.mockRejectedValue(Object.assign(new Error('Not authenticated'), { status: 401 }))
    const feed = open()
    await settle()

    expect(fatals).toEqual(['Not authenticated'])
    expect(losses).toEqual([])
    feed.close()
  })
})

describe('falling back', () => {
  // The §20 two-deploy case, and any network that blocks WebSockets.
  it('polls when the socket cannot be opened at all', async () => {
    FakeClientSocket.failToOpen = true
    const feed = open()
    await settle()

    await vi.advanceTimersByTimeAsync(5000)

    expect(coopApi.tick).toHaveBeenCalled()
    expect(feed.isPolling()).toBe(true)
    expect(beats.at(-1).state.bossId).toBe('corporeal_horror')
    feed.close()
  })

  it('sends actions over HTTP once it is polling', async () => {
    FakeClientSocket.failToOpen = true
    const feed = open()
    await settle()
    await vi.advanceTimersByTimeAsync(5000)

    await expect(feed.send({ type: 'queue_special' })).resolves.toEqual({ tick_number: 5 })
    expect(coopApi.sendAction).toHaveBeenCalledWith(12, { type: 'queue_special' })
    feed.close()
  })

  it('tries the socket a few times before giving up on it', async () => {
    FakeClientSocket.failToOpen = true
    const feed = open()
    await settle()
    await vi.advanceTimersByTimeAsync(5000)

    expect(FakeClientSocket.instances.length).toBeGreaterThan(1)
    feed.close()
  })

  it('stops everything when the screen closes, socket or poll', async () => {
    const feed = open()
    await settle()
    feed.close()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(coopApi.tick).not.toHaveBeenCalled()
    expect(beats).toEqual([])
  })

  it('does not reconnect past a refusal that will not change', async () => {
    coopApi.socketTicket.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }))
    const feed = open()
    await settle()

    await vi.advanceTimersByTimeAsync(10_000)

    expect(losses).toEqual(['gone'])
    expect(coopApi.tick).not.toHaveBeenCalled()
    feed.close()
  })
})
