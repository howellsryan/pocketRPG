import { coopLootProgress } from '../engine/coopBossEngine.js'

// Your loot share, as a hairline bar under the boss's name.
//
// Loot in a group fight goes to everyone who personally deals 10% of the boss's
// max HP, so "am I getting a drop" is a decision the player makes mid-fight —
// but it is a glance, not a screen. The bar measures against the THRESHOLD, not
// the boss's health: it fills across the 0–10% you need and turns solid green
// the moment the drop is secured.

export default function CoopLootShare({ member, maxHP }) {
  const { pct, qualified, remaining } = coopLootProgress(member, maxHP)
  return (
    <div class={'cb-loot' + (qualified ? ' is-paid' : '')}>
      <div class="cb-loot__track">
        <div class="cb-loot__fill" style={{ width: `${pct}%` }} />
      </div>
      <span class="cb-loot__v">
        {qualified ? 'Drop secured' : `${remaining.toLocaleString()} dmg to loot`}
      </span>
    </div>
  )
}
