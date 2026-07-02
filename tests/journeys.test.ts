import { describe, it, expect } from 'vitest'
import {
  planJourney,
  planClueJourney,
  planQuestJourney,
  journeyStepCount,
  advanceJourneyPhase,
  advanceJourneyOffline,
  teleportIntoJourney,
  isJourneyTask,
  journeyStatus,
  JOURNEY_TIME_FACTOR,
} from '../src/engine/journeys.js'
import { shortestPath, getPlace } from '../src/engine/world.js'

const CLUE = {
  id: 'complete_medium_clue',
  name: 'Complete Medium Clue',
  icon: '📜',
  ticks: 500,
  requiresItem: 'clue_scroll_medium',
  isClue: true,
  clueLevel: 'medium',
}

const plan = (over: Record<string, unknown> = {}) =>
  planJourney({
    kind: 'clue',
    ref: CLUE.id,
    name: 'Medium Clue Trail',
    icon: '🗺️',
    idleTicks: CLUE.ticks,
    payload: CLUE,
    from: 'lumbright',
    ...over,
  })!

describe('journeyStepCount', () => {
  it('scales steps with the idle duration (2–4)', () => {
    expect(journeyStepCount(500)).toBe(2)
    expect(journeyStepCount(1500)).toBe(3)
    expect(journeyStepCount(6000)).toBe(4)
  })
})

describe('planJourney', () => {
  it('builds a travel task to the first waypoint carrying the journey', () => {
    const task = plan()
    expect(task.type).toBe('travel')
    expect(isJourneyTask(task)).toBe(true)
    expect(task.journey.kind).toBe('clue')
    expect(task.journey.step).toBe(0)
    expect(task.journey.phase).toBe('travel')
    expect(task.dest).toBe(task.journey.steps[0])
    expect(task.journey.payload).toEqual(CLUE)
  })

  it('is deterministic for the same content + origin', () => {
    expect(plan().journey.steps).toEqual(plan().journey.steps)
  })

  it('picks distinct waypoints, none the origin, at increasing distance bands', () => {
    const task = planJourney({
      kind: 'clue', ref: 'complete_master_clue', name: 'Master Clue Trail', icon: '🗺️',
      idleTicks: 6000, payload: CLUE, from: 'lumbright',
    })!
    const steps = task.journey.steps
    expect(steps.length).toBe(4)
    expect(new Set(steps).size).toBe(steps.length)
    expect(steps).not.toContain('lumbright')
    for (const id of steps) expect(getPlace(id)).toBeTruthy()
    const dist = (id: string) => shortestPath('lumbright', id)!.ticks
    expect(dist(steps[steps.length - 1])).toBeGreaterThanOrEqual(dist(steps[0]))
  })

  it('search time totals roughly the idle duration times the journey factor', () => {
    const task = plan()
    const { dwellTicks, steps } = task.journey
    expect(dwellTicks * steps.length).toBeGreaterThanOrEqual(CLUE.ticks * JOURNEY_TIME_FACTOR - steps.length)
    expect(dwellTicks * steps.length).toBeLessThanOrEqual(CLUE.ticks * JOURNEY_TIME_FACTOR + steps.length)
  })

  it('normalises an unknown origin to the start place', () => {
    expect(planJourney({ kind: 'clue', ref: 'x', name: 'x', icon: '', idleTicks: 500, payload: {}, from: 'atlantis' })).toBeTruthy()
  })
})

describe('advanceJourneyPhase', () => {
  it('arrival at a waypoint starts a search dwell there', () => {
    const leg = plan()
    const step = advanceJourneyPhase({ ...leg, ticksRemaining: 0 })!
    expect(step.kind).toBe('search')
    expect(step.next.type).toBe('travel')
    expect(step.next.from).toBe(leg.dest)
    expect(step.next.dest).toBe(leg.dest)
    expect(step.next.totalTicks).toBe(leg.journey.dwellTicks)
    expect(step.next.journey.phase).toBe('search')
  })

  it('a finished non-final search walks on to the next waypoint', () => {
    const leg = plan()
    const search = advanceJourneyPhase({ ...leg, ticksRemaining: 0 })!.next
    const onward = advanceJourneyPhase({ ...search, ticksRemaining: 0 })!
    expect(onward.kind).toBe('leg')
    expect(onward.next.journey.step).toBe(1)
    expect(onward.next.journey.phase).toBe('travel')
    expect(onward.next.from).toBe(leg.journey.steps[0])
    expect(onward.next.dest).toBe(leg.journey.steps[1])
  })

  it('the final search completes the journey', () => {
    const leg = plan()
    const j = { ...leg.journey, step: leg.journey.steps.length - 1, phase: 'search' }
    const finalSearch = { ...leg, from: j.steps[j.step], dest: j.steps[j.step], journey: j, ticksRemaining: 0 }
    expect(advanceJourneyPhase(finalSearch)!.kind).toBe('complete')
  })

  it('returns null for a journey-less task', () => {
    expect(advanceJourneyPhase({ type: 'travel' } as any)).toBeNull()
  })
})

describe('advanceJourneyOffline', () => {
  it('keeps a part-way leg in progress', () => {
    const leg = plan()
    const res = advanceJourneyOffline(leg, 600) // one tick
    expect(res.completedPending).toBe(false)
    expect(res.msRemaining).toBe(0)
    expect(res.task.ticksRemaining).toBe(leg.totalTicks - 1)
    expect(res.location).toBeNull()
  })

  it('chains leg → search across the elapsed time and reports the waypoint reached', () => {
    const leg = plan()
    const res = advanceJourneyOffline(leg, (leg.totalTicks + 3) * 600)
    expect(res.completedPending).toBe(false)
    expect(res.location).toBe(leg.journey.steps[0])
    expect(res.task.journey.phase).toBe('search')
    expect(res.task.ticksRemaining).toBe(leg.journey.dwellTicks - 3)
  })

  it('a journey that finishes while away parks on its final search at 0 ticks', () => {
    const leg = plan()
    const res = advanceJourneyOffline(leg, 24 * 60 * 60 * 1000) // a day away
    expect(res.completedPending).toBe(true)
    // Unspent time is reported so the credit skip can chain further scrolls.
    expect(res.msRemaining).toBeGreaterThan(0)
    expect(res.msRemaining).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
    expect(res.task.ticksRemaining).toBe(0)
    expect(res.task.journey.phase).toBe('search')
    expect(res.location).toBe(leg.journey.steps[leg.journey.steps.length - 1])
    // never grants content itself: the task survives for the App tick to complete
    expect(res.task.journey.payload).toEqual(CLUE)
  })
})

describe('canonical planners', () => {
  it('planClueJourney names the trail after the scroll and scales from its ticks', () => {
    const task = planClueJourney(CLUE, 'lumbright')!
    expect(task.journey.kind).toBe('clue')
    expect(task.journey.name).toBe('Medium Clue Trail')
    expect(task.journey.steps.length).toBe(journeyStepCount(CLUE.ticks))
    expect(task.journey.payload).toEqual(CLUE)
  })

  it('planQuestJourney converts durationSeconds to ticks', () => {
    const quest = { id: 'q1', name: 'The Lost Heirloom', durationSeconds: 1200, xpReward: {}, coinReward: 50 }
    const task = planQuestJourney(quest, 'varrick')!
    expect(task.journey.kind).toBe('quest')
    expect(task.journey.steps.length).toBe(journeyStepCount(2000)) // 1200s = 2000 ticks
    expect(task.journey.payload).toEqual(quest)
  })
})

describe('teleportIntoJourney', () => {
  it('teleporting to the waypoint skips the walk straight into the search', () => {
    const leg = plan()
    const res = teleportIntoJourney(leg, leg.dest)!
    expect(res.searching).toBe(true)
    expect(res.task.journey.phase).toBe('search')
    expect(res.task.from).toBe(leg.dest)
    expect(res.task.totalTicks).toBe(leg.journey.dwellTicks)
  })

  it('teleporting elsewhere re-plans the leg from the landing place', () => {
    const leg = plan()
    const landing = leg.dest === 'varrick' ? 'faloden' : 'varrick'
    const res = teleportIntoJourney(leg, landing)!
    expect(res.searching).toBe(false)
    expect(res.task.from).toBe(landing)
    expect(res.task.dest).toBe(leg.dest)
    expect(res.task.totalTicks).toBe(shortestPath(landing, leg.dest)!.ticks)
    expect(res.task.journey).toEqual(leg.journey) // same trail, same step
  })

  it('a search in progress is bound to its waypoint', () => {
    const leg = plan()
    const search = advanceJourneyPhase({ ...leg, ticksRemaining: 0 })!.next
    expect(teleportIntoJourney(search, 'varrick')).toBeNull()
  })

  it('returns null for a journey-less travel task', () => {
    expect(teleportIntoJourney({ type: 'travel', dest: 'varrick' } as any, 'varrick')).toBeNull()
  })
})

describe('journeyStatus', () => {
  it('describes travel and search phases for the banner', () => {
    const leg = plan()
    const t = journeyStatus(leg)!
    expect(t.searching).toBe(false)
    expect(t.step).toBe(1)
    expect(t.steps).toBe(leg.journey.steps.length)
    const search = advanceJourneyPhase({ ...leg, ticksRemaining: 0 })!.next
    const s = journeyStatus(search)!
    expect(s.searching).toBe(true)
    expect(s.lead).toContain('Searching')
    expect(journeyStatus({ type: 'travel' } as any)).toBeNull()
  })
})
