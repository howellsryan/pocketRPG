import { useState } from 'preact/hooks'
import Modal from './Modal.jsx'
import Button from './Button.jsx'
import GameIcon from './GameIcon.jsx'
import { useGame } from '../state/gameState.jsx'
import { isWorldMapEnabled } from '../utils/constants.js'

// First-run tour shown once right after character creation (App.startNewGame),
// replayable from Settings. Nav copy is chrome-specific: below md the game uses
// the GameFrameBar medallion rails, at md+ the SideNav/Header — so the tour
// describes whichever the player is actually looking at.
function isDesktopChrome() {
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)')?.matches === true
}

function NavRow({ iconKey, emoji, label, note }) {
  return (
    <div class="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-[var(--color-void-light)] border border-[var(--color-void-border)]">
      <span class="w-8 flex justify-center items-center flex-shrink-0">
        {iconKey ? <GameIcon iconKey={iconKey} size={24} /> : <span class="text-[18px] leading-none">{emoji}</span>}
      </span>
      <span class="text-[13px] font-semibold text-[var(--color-gold)] w-24 flex-shrink-0">{label}</span>
      <span class="text-[12px] text-[var(--color-parchment)] opacity-70 leading-snug">{note}</span>
    </div>
  )
}

function RailLabel({ children }) {
  return (
    <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-parchment)] opacity-50 mt-3 mb-1 first:mt-0">
      {children}
    </div>
  )
}

function buildSteps({ playerName, isCloudAccount, desktop, worldMap }) {
  const steps = []

  steps.push({
    iconKey: 'home',
    title: `Welcome${playerName ? `, ${playerName}` : ''}!`,
    body: (
      <>
        <p>
          PocketRPG is an idle RPG — your character keeps training, fighting and gathering
          even while you're away.
        </p>
        <p>
          Here's a quick tour of where everything lives. Flick through with{' '}
          <b class="text-[var(--color-gold)]">Next</b>, or close this any time — you can
          replay the tour from the Settings screen.
        </p>
      </>
    ),
  })

  steps.push({
    iconKey: 'home',
    title: 'Home — your skills',
    body: (
      <>
        <p>
          The Home screen lists every skill, grouped into Combat, Gathering, Production and
          Utility.
        </p>
        <p>
          Tap any skill card to see its level and XP and jump straight into its actions —
          chop trees, catch fish, smith bars and much more.
        </p>
      </>
    ),
  })

  steps.push({
    iconKey: 'combat_level',
    title: 'Combat',
    body: (
      <>
        <p>
          Browse monsters and pick a fight to earn XP and loot. Start with the easiest
          monsters and work your way up as your levels grow.
        </p>
        <p>
          Keep food in your inventory — your starter shrimps heal you mid-fight — and equip
          your bronze gear before your first battle.
        </p>
      </>
    ),
  })

  steps.push({
    iconKey: 'backpack',
    title: 'Inventory & Equipment',
    body: (
      <>
        <p>
          Your inventory holds <b class="text-[var(--color-gold)]">28 slots</b> of items
          you're actively using. Tap an item to eat, equip, bank or sell it.
        </p>
        <p>
          The Equipment screen shows what you're wearing and how it changes your combat
          stats.
        </p>
      </>
    ),
  })

  steps.push({
    iconKey: 'coins',
    title: 'Bank',
    body: (
      <>
        <p>
          The Bank stores everything you're not carrying — with far more room than your
          inventory. Deposit loot to keep your 28 slots free.
        </p>
        <p>
          If your inventory fills up while gathering, your character heads to the bank
          automatically.
        </p>
      </>
    ),
  })

  steps.push({
    iconKey: worldMap ? 'globe' : 'adventures_scroll',
    title: worldMap ? 'World Map & Adventures' : 'Adventures',
    body: (
      <>
        {worldMap && (
          <p>
            Travel the world from the World Map — each place holds its own gathering spots,
            monsters, quests and more.
          </p>
        )}
        <p>
          The Adventures screen gathers your quests, clue scrolls and minigames in one
          place — great for XP, coins and unique rewards.
        </p>
      </>
    ),
  })

  steps.push({
    iconKey: 'gears',
    title: 'Finding your way',
    body: desktop ? (
      <div class="space-y-1.5">
        <RailLabel>Left sidebar</RailLabel>
        <NavRow iconKey="home" label="Home" note="Your skills at a glance" />
        {worldMap && <NavRow iconKey="globe" label="World Map" note="Travel between places" />}
        <NavRow iconKey="coins" label="Bank" note="Store your items" />
        <NavRow iconKey="combat_level" label="Combat" note="Fight monsters for XP and loot" />
        <NavRow iconKey="backpack" label="Inventory" note="Your 28 carried items" />
        <NavRow iconKey="paperdoll" label="Equipment" note="What you're wearing" />
        <NavRow iconKey="adventures_scroll" label="Adventures" note="Quests, clues and minigames" />
        <NavRow iconKey="gears" label="Settings" note="Options, unlocks, collection log" />
        <RailLabel>Top bar</RailLabel>
        {isCloudAccount ? (
          <>
            <NavRow emoji="📋" label="Daily Tasks" note="5 fresh tasks a day — each earns a credit" />
            <NavRow iconKey="cut_diamond" label="Credits" note="Your credit balance" />
            <NavRow iconKey="fast_forward_button" label="Skip 1h" note="Spend a credit to skip an hour instantly" />
          </>
        ) : (
          <NavRow emoji="🔒" label="Cloud extras" note="Daily Tasks, Credits and Skip unlock with a free account" />
        )}
      </div>
    ) : (
      <div class="space-y-1.5">
        <RailLabel>Top rail</RailLabel>
        {worldMap && <NavRow iconKey="globe" label="Map" note="Travel between places" />}
        <NavRow iconKey="coins" label="Bank" note="Store your items" />
        <NavRow iconKey="combat_level" label="Combat" note="Fight monsters for XP and loot" />
        <NavRow iconKey="backpack" label="Items" note="Your 28 carried items" />
        <NavRow iconKey="paperdoll" label="Equip" note="What you're wearing" />
        <RailLabel>Bottom rail</RailLabel>
        <NavRow iconKey="gears" label="Settings" note="Options, unlocks, collection log" />
        <NavRow iconKey="adventures_scroll" label="Adventures" note="Quests, clues and minigames" />
        {isCloudAccount ? (
          <>
            <NavRow emoji="📋" label="Daily Tasks" note="5 fresh tasks a day — each earns a credit" />
            <NavRow iconKey="cut_diamond" label="Credits" note="Your credit balance" />
            <NavRow iconKey="fast_forward_button" label="Skip 1h" note="Spend a credit to skip an hour instantly" />
          </>
        ) : (
          <NavRow emoji="🔒" label="Cloud extras" note="Daily Tasks, Credits and Skip unlock with a free account" />
        )}
        <NavRow iconKey="home" label="Home" note="Back to your skills" />
      </div>
    ),
  })

  steps.push({
    iconKey: 'chat_bubble',
    title: 'Stuck? Ask the Game Helper',
    body: isCloudAccount ? (
      <>
        <p>
          If you have questions or difficulties, tap the{' '}
          <b class="text-[var(--color-gold)]">💬 Game Helper</b>{' '}
          {desktop ? 'at the bottom of the sidebar' : 'in the bottom rail'} and ask the AI
          helper — it can answer most questions about items, monsters, quests and your own
          progress.
        </p>
        <p>
          It can even do things for you — sell an item, get a slayer task, buy gear — and
          always confirms before anything changes.
        </p>
        <p>That's the tour — good luck out there, adventurer!</p>
      </>
    ) : (
      <>
        <p>
          Create a free account to unlock the{' '}
          <b class="text-[var(--color-gold)]">💬 Game Helper</b> — an AI chat that answers
          questions about items, monsters, quests and your own progress, and can even do
          things for you.
        </p>
        <p>That's the tour — good luck out there, adventurer!</p>
      </>
    ),
  })

  return steps
}

export default function IntroTourModal({ onClose, isCloudAccount = false }) {
  const { player } = useGame()
  const [stepIndex, setStepIndex] = useState(0)
  const [desktop] = useState(isDesktopChrome)

  const steps = buildSteps({
    playerName: player?.name,
    isCloudAccount,
    desktop,
    worldMap: isWorldMapEnabled(),
  })
  const step = steps[Math.min(stepIndex, steps.length - 1)]
  const isLast = stepIndex >= steps.length - 1

  return (
    <Modal title="Getting Started" onClose={onClose}>
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <span class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-void-light)] border border-[var(--color-void-border)]">
            <GameIcon iconKey={step.iconKey} size={30} />
          </span>
          <h3 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
            {step.title}
          </h3>
        </div>

        <div class="space-y-2 text-[13px] leading-relaxed text-[var(--color-parchment)]">
          {step.body}
        </div>

        <div class="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={() => setStepIndex(i => Math.max(0, i - 1))}
            className={`min-h-[44px] ${stepIndex === 0 ? 'invisible' : ''}`}
          >
            Back
          </Button>
          <div class="flex items-center gap-1.5" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span
                key={i}
                class="h-1.5 w-1.5 rounded-full"
                style={{ background: i === stepIndex ? 'var(--color-gold)' : 'var(--color-void-border)' }}
              />
            ))}
          </div>
          <Button
            variant="primary"
            onClick={() => (isLast ? onClose?.() : setStepIndex(i => i + 1))}
            className="min-h-[44px]"
          >
            {isLast ? 'Start adventuring' : 'Next'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
