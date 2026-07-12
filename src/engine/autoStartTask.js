/**
 * Rebuild a background activity's `activeTask` from the compact `autoStart`
 * descriptor that rides a travel task (App's resumeAutoStart carries the same
 * descriptors). Used by Skip-1h: a walk is seconds long, so skipping a trip
 * that was launched to start a skilling activity should spend the (near-)full
 * hour on that activity rather than burning the credit on the trip itself.
 *
 * Returns a task shaped exactly like the owning screen would set, or null for
 * descriptors that can't be idle-simulated here (combat/raid/slayer/farming,
 * one-shot/clue gathers, alchemy, long-form reward unlocks) — those resume live.
 */
import skillsData from '../data/skills.json'
import minigamesData from '../data/minigames.json'
import { findGatherTask } from './gatherTasks.js'

export function buildAutoStartTask(autoStart) {
  if (!autoStart?.kind) return null
  switch (autoStart.kind) {
    case 'skill': {
      const skill = autoStart.skill
      const action = skillsData?.[skill]?.actions?.find(a => a.id === autoStart.actionId)
      // Alchemy needs a picked item; reward unlocks need player confirmation.
      if (!action || action.type === 'alchemy' || action.category === 'reward') return null
      return { type: 'skill', skill, action, bankingEnabled: true }
    }
    case 'agility': {
      const action = skillsData?.agility?.actions?.find(a => a.id === autoStart.actionId)
      return action ? { type: 'agility', action } : null
    }
    case 'thieving': {
      const npc = skillsData?.thieving?.npcs?.find(n => n.id === autoStart.npcId)
      return npc ? { type: 'thieving', npc } : null
    }
    case 'hunter': {
      const action = skillsData?.hunter?.actions?.find(a => a.id === autoStart.actionId)
      return action ? { type: 'hunter', action } : null
    }
    case 'gather': {
      const gatherTask = findGatherTask(autoStart.gatherTaskId)
      // One-shot minigames and clue scrolls have bespoke skip handling.
      if (!gatherTask || gatherTask.oneShot || gatherTask.isClue) return null
      return { type: 'gather', gatherTask }
    }
    case 'minigame': {
      const minigameTask = minigamesData?.tasks?.find(t => t.id === autoStart.taskId)
      if (!minigameTask) return null
      return { type: 'minigame', minigameTask, bankingEnabled: true, totalTicks: minigameTask.ticks, ticksRemaining: minigameTask.ticks }
    }
    default:
      return null
  }
}
