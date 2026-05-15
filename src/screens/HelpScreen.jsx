import { useState } from 'preact/hooks'
import Card from '../components/Card.jsx'

const HELP_GUIDES = [
  {
    title: 'Getting Started',
    icon: '🌟',
    points: [
      'In your first 10 minutes, equip your starter bronze gear from Items.',
      'Train on safer early monsters like chickens, cows, goblins, or crabs.',
      'Eat food when HP gets low, then bank or sell loot and upgrade gear.',
      'Try easy skills like Mining, Woodcutting, and Fishing before branching out.',
      'Once comfortable, start quests for guided progression and rewards.'
    ]
  },
  {
    title: 'Account & Character Modes',
    icon: '👤',
    points: [
      'GitHub and Google logins use separate character rosters.',
      'Character names are permanent, so pick a name you want to keep.',
      'Normal mode is best for first-time players.',
      'Ironman limits shop access and is a challenge mode.',
      'One Life deletes the character on death, with or without Ironman.',
      'Ironman + One Life is the hardest challenge combination.'
    ]
  },
  {
    title: 'Combat Basics',
    icon: '⚔️',
    points: [
      'Bring food and watch HP carefully. Dying can be costly in risky content.',
      'Equip gear that matches your level and combat style.',
      'Use attack styles, food, potions, prayers, and specials where supported.',
      'Magic needs the correct spell, runes, and weapon setup. Ranged needs ammo.',
      'Bosses and raids are much more dangerous than standard training monsters.'
    ]
  },
  {
    title: 'Idle Combat Supplies',
    icon: '🧰',
    points: [
      'Idle Eat, Idle Potion, and Idle Pray are for away combat and Skip 1h progress.',
      'Idle Eat lets you pre-select food consumed automatically based on expected damage.',
      'Idle Potion lets you pre-select potions that are used when relevant.',
      'Idle Pray lets you pre-select prayers applied during idle combat when resources exist.',
      'Food, potions, and prayer supplies are consumed during idle/skip progress and can run out.',
      'If supplies run out, progress may slow, stop, or become more dangerous depending on the fight.',
      'Match your food, prayer, and potion setup to the monster and your combat style.'
    ]
  },
  {
    title: 'Idle Progress & Skip 1h',
    icon: '💤',
    points: [
      'Active tasks can continue while you are away.',
      'Idle progress can apply to combat, gathering, skills, agility, thieving, hunter, and quests where supported.',
      'Some idle tasks consume supplies like runes, ammo, food, potions, or materials.',
      'Skip 1h manually advances eligible active tasks.',
      'If required supplies are missing, progress or rewards may be limited.',
      'High-risk boss and raid content may have additional restrictions.'
    ]
  },
  {
    title: 'Inventory, Bank & Equipment',
    icon: '🎒',
    points: [
      'Inventory space is limited, so bank often when grinding.',
      'Some items stack and some are noted to save space.',
      'Equip gear into the correct slot to gain stats and bonuses.',
      'Check item stats, weapon charge behavior, and ammo/rune needs when relevant.'
    ]
  },
  { title: 'Store & Economy', icon: '🪙', points: ['Use coins to buy items and sell extra loot for upgrades.', 'Some items are visible but not buyable until requirements are met.', 'Quest items may need quest completion first.', 'Boss uniques and clue rewards must be earned from their activities.', 'Ironman has stricter shop access, and some minigame rewards unlock differently.'] },
  { title: 'Skills Overview', icon: '🔨', points: ['Combat skills improve your fighting power.', 'Gathering skills collect raw resources.', 'Production skills turn resources into gear and supplies.', 'Utility skills support account progression and unlocks.', 'Some skills use standard action lists, while others have dedicated screens.'] },
  { title: 'Slayer', icon: '💀', points: ['Take Slayer tasks to fight assigned monsters.', 'Complete tasks for Slayer XP and Slayer points.', 'Spend points on unlocks that expand Slayer progression.', 'Some Slayer gear and unlocks improve efficiency on relevant targets.'] },
  { title: 'Quests & Minigames', icon: '📜', points: ['Quests can have requirements and reward useful progression unlocks.', 'Quest progress can run in the background where supported.', 'Minigames can unlock unique rewards and progression options.', 'Some minigame rewards may later become purchasable or re-obtainable, depending on the activity.'] },
  { title: 'Collection Log & Leaderboards', icon: '📖', points: ['Collection Log tracks important drops and reward milestones.', 'Boss, raid, clue, and minigame rewards may appear there.', 'Leaderboards show account progression and ranking snapshots.'] },
  { title: 'PvP Basics', icon: '🛡️', points: ['PvP is higher risk than normal PvE.', 'Learn invitations, matchmaking flow, and risk before entering.', 'Deaths in PvP can cause item or coin loss depending on current rules.', 'Bring proper food, prayer, potions, gear, and special attack setup before fighting players.'] },
  { title: 'Cloud Saves & Troubleshooting', icon: '☁️', points: ['Cloud saves sync progress for the selected account and character.', 'GitHub and Google sign-ins do not share character rosters.', 'If progress looks wrong, verify both provider and selected character first.', 'Try to avoid refreshing during critical combat or PvP moments.'] }
]

function CollapsibleGuide({ icon, title, points }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        class="w-full flex items-center justify-between gap-2 px-4 py-3 bg-transparent border-0 text-left cursor-pointer"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xl flex-shrink-0">{icon}</span>
          <span class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">{title}</span>
        </div>
        <span class="text-[var(--color-gold)] text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div class="px-4 pb-4 pt-1">
          <ul class="list-disc pl-4 space-y-1">
            {points.map((point) => (
              <li key={point} class="text-sm text-[var(--color-parchment)] opacity-90 leading-relaxed">{point}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

export default function HelpScreen() {
  return (
    <div class="h-full flex flex-col">
      <div class="flex-shrink-0 bg-[#111] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">🧭 Help</h1>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {HELP_GUIDES.map((guide) => (
          <CollapsibleGuide key={guide.title} icon={guide.icon} title={guide.title} points={guide.points} />
        ))}
      </div>
    </div>
  )
}
