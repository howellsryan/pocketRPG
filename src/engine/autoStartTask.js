/**
 * Rebuild a background activity's `activeTask` from the compact `autoStart`
 * descriptor that rides a travel task (App's resumeAutoStart carries the same
 * descriptors). Used by Skip-1h: a walk is seconds long, so skipping a trip
 * that was launched to start an activity should spend the (near-)full hour on
 * that activity rather than burning the credit on the trip itself.
 *
 * Returns a task shaped exactly like the owning screen would set, or null for
 * descriptors that can't be idle-simulated here — those resume live on
 * arrival instead:
 *  - boss combat + raids (per-kill skipCost model, never hour-simulated)
 *  - slayer/farming/bank (instant place actions, nothing to simulate)
 *  - clue gathers (clues run as world-map journeys)
 *  - alchemy (needs a picked item) and long-form reward unlocks
 *
 * `ctx` supplies what the owning screens read from live state:
 *  - equipment/itemsData + activeSpellId + stance → combat task spell/stance
 *    (mirrors CombatScreen's startFight derivation)
 *  - getProgressTicks(activityKey) → minigame partial-progress resume
 *    (mirrors MinigamesScreen's ledger seed)
 */
import skillsData from '../data/skills.json'
import minigamesData from '../data/minigames.json'
import monstersData from '../data/monsters.json'
import spellsData from '../data/spells.json'
import { findGatherTask } from './gatherTasks.js'
import { getCombatType } from './equipment.js'

export function buildAutoStartTask(autoStart, ctx = {}) {
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
      // Clue scrolls run as journeys, never as a travel autoStart.
      if (!gatherTask || gatherTask.isClue) return null
      return { type: 'gather', gatherTask }
    }
    case 'minigame': {
      const minigameTask = minigamesData?.tasks?.find(t => t.id === autoStart.taskId)
      if (!minigameTask) return null
      const saved = Math.max(0, Math.floor(Number(ctx.getProgressTicks?.(`minigame:${minigameTask.id}`)) || 0))
      const ticksRemaining = saved > 0 ? Math.max(0, minigameTask.ticks - saved) : minigameTask.ticks
      return { type: 'minigame', minigameTask, bankingEnabled: true, totalTicks: minigameTask.ticks, ticksRemaining }
    }
    case 'combat': {
      const monster = monstersData?.[autoStart.monsterId]
      // Bosses skip per-kill for skipCost credits, never by hour simulation.
      if (!monster || monster.boss === true) return null
      const rawStance = ctx.stance || 'accurate'
      const stance = rawStance === 'controlled' ? 'accurate' : rawStance
      let spell = null
      if (ctx.equipment && ctx.itemsData && getCombatType(ctx.equipment, ctx.itemsData) === 'magic') {
        const weapon = ctx.equipment?.weapon ? ctx.itemsData[ctx.equipment.weapon.itemId] : null
        if (!weapon?.poweredStaff && ctx.activeSpellId) spell = spellsData?.[ctx.activeSpellId] || null
      }
      return { type: 'combat', monster, stance, bankingEnabled: true, spell }
    }
    default:
      return null
  }
}
