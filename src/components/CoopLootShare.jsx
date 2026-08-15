import { coopLootProgress } from '../engine/coopBossEngine.js'

// Your share of the kill, as a hairline bar under the boss's name.
//
// Dealing 10% of the boss's max HP earns the whole kill — a roll of the drop
// table, the kill count, slayer progress and whatever daily tasks it feeds — so
// "am I getting this one" is a decision the player makes mid-fight, but it is a
// glance, not a screen. The bar measures against the THRESHOLD, not the boss's
// health: it fills across the 0–10% you need and turns solid green the moment
// the kill is secured. It says "kill", not "drop", because the loot stopped
// being the only thing riding on it (killCredit.js).

export default function CoopLootShare({ member, maxHP }) {
  const { pct, qualified, remaining } = coopLootProgress(member, maxHP)
  return (
    <div class={'cb-loot' + (qualified ? ' is-paid' : '')}>
      <div class="cb-loot__track">
        <div class="cb-loot__fill" style={{ width: `${pct}%` }} />
      </div>
      <span class="cb-loot__v">
        {qualified ? 'Kill secured' : `${remaining.toLocaleString()} dmg to earn it`}
      </span>
    </div>
  )
}
