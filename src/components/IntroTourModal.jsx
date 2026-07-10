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

const DISCORD_INVITE_URL = 'https://discord.gg/trjZRWe2K'

function DiscordMark({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
    </svg>
  )
}

function DiscordButton() {
  return (
    <a
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noreferrer"
      class="flex items-center justify-center gap-2 w-full min-h-[44px] rounded-lg bg-[#5865F2] text-white font-semibold text-[13px] no-underline hover:brightness-110 active:brightness-95"
    >
      <DiscordMark />
      Join the PocketRPG Discord
    </a>
  )
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
          PocketRPG is an idle RPG. Start training a skill or fighting a monster, and your
          character keeps at it after you close the app. Come back later to collect
          everything you earned while away.
        </p>
        <p>
          This short tour shows where everything is. You can replay it any time from
          Settings.
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
          Home shows all your skills, grouped into Combat, Gathering, Production and
          Utility. Every skill levels from 1 to 99.
        </p>
        <p>
          Tap a skill card to see its actions and start training: chop trees, catch fish,
          smith bars, brew potions.
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
          Pick a monster and fight it for XP and loot. Start small and work up as your
          levels grow.
        </p>
        <p>
          Your starter kit covers all three combat styles: bronze melee gear, a shortbow
          with arrows, and runes for spells. Keep your shrimps handy — eating heals you
          mid-fight.
        </p>
      </>
    ),
  })

  steps.push({
    iconKey: 'progression',
    title: 'Leaderboards & community',
    body: (
      <>
        <p>
          Every player is ranked on the leaderboards: total level, plus kill counts for
          each boss and raid. You'll find them under Settings. Start climbing.
        </p>
        <p>
          And you're not grinding alone — the community lives on our Discord. Join for
          help, advice and game news, or just to compare progress.
        </p>
        <DiscordButton />
      </>
    ),
  })

  steps.push({
    iconKey: 'backpack',
    title: 'Inventory & Equipment',
    body: (
      <>
        <p>
          Your inventory is what you carry:{' '}
          <b class="text-[var(--color-gold)]">28 slots</b>. Tap an item to eat, equip, bank
          or sell it.
        </p>
        <p>
          Equipment shows what you're wearing and the stats it gives you. Put your bronze
          gear on before your first fight.
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
          The Bank holds everything you're not carrying, with far more room than your
          inventory. Deposit loot to keep your 28 slots free.
        </p>
        <p>
          Fill your inventory while gathering and your character walks to the bank on
          their own.
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
            The world is split into places, each with its own monsters, gathering spots
            and activities. Travel between them on the World Map.
          </p>
        )}
        <p>
          Adventures holds your quests, clue scrolls and minigames. Quests pay out big XP;
          clues and minigames drop items you can't get anywhere else.
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
        <NavRow iconKey="home" label="Home" note="Your skills" />
        {worldMap && <NavRow iconKey="globe" label="World Map" note="Travel between places" />}
        <NavRow iconKey="coins" label="Bank" note="Your stored items" />
        <NavRow iconKey="combat_level" label="Combat" note="Fight monsters" />
        <NavRow iconKey="backpack" label="Inventory" note="What you're carrying" />
        <NavRow iconKey="paperdoll" label="Equipment" note="What you're wearing" />
        <NavRow iconKey="adventures_scroll" label="Adventures" note="Quests, clues and minigames" />
        <NavRow iconKey="gears" label="Settings" note="Options, unlocks, leaderboards and the collection log" />
        <RailLabel>Top bar</RailLabel>
        {isCloudAccount ? (
          <>
            <NavRow emoji="📋" label="Daily Tasks" note="Five a day, each worth a credit" />
            <NavRow iconKey="cut_diamond" label="Credits" note="Your balance — tap to top up" />
            <NavRow iconKey="fast_forward_button" label="Skip 1h" note="Skip an hour of any activity for one credit" />
          </>
        ) : (
          <NavRow emoji="🔒" label="Cloud extras" note="Daily Tasks, Credits and Skip unlock with a free account" />
        )}
      </div>
    ) : (
      <div class="space-y-1.5">
        <RailLabel>Top rail</RailLabel>
        {worldMap && <NavRow iconKey="globe" label="Map" note="Travel between places" />}
        <NavRow iconKey="coins" label="Bank" note="Your stored items" />
        <NavRow iconKey="combat_level" label="Combat" note="Fight monsters" />
        <NavRow iconKey="backpack" label="Items" note="What you're carrying" />
        <NavRow iconKey="paperdoll" label="Equip" note="What you're wearing" />
        <RailLabel>Bottom rail</RailLabel>
        <NavRow iconKey="gears" label="Settings" note="Options, unlocks, leaderboards and the collection log" />
        <NavRow iconKey="adventures_scroll" label="Adventures" note="Quests, clues and minigames" />
        {isCloudAccount ? (
          <>
            <NavRow emoji="📋" label="Daily Tasks" note="Five a day, each worth a credit" />
            <NavRow iconKey="cut_diamond" label="Credits" note="Your balance — tap to top up" />
            <NavRow iconKey="fast_forward_button" label="Skip 1h" note="Skip an hour of any activity for one credit" />
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
          Questions? Stuck? Open the{' '}
          <b class="text-[var(--color-gold)]">💬 Game Helper</b>{' '}
          {desktop ? 'at the bottom of the sidebar' : 'from the bottom rail'} and ask. It
          can answer most questions about items, monsters and quests, and it can see your
          own character's progress.
        </p>
        <p>
          It can also act for you: sell an item, fetch a slayer task, buy gear. It always
          asks before it changes anything.
        </p>
        <p>
          And remember — we have a Discord. If the helper can't crack it, another player
          probably can.
        </p>
        <DiscordButton />
      </>
    ) : (
      <>
        <p>
          The <b class="text-[var(--color-gold)]">💬 Game Helper</b> is an in-game chat
          that answers questions about items, monsters, quests and your own progress, and
          can handle jobs like selling items for you.
        </p>
        <p>
          It unlocks with a free account, along with cloud saves, daily tasks and credits.
          The Discord is open to everyone, though — come say hello.
        </p>
        <DiscordButton />
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
            <GameIcon iconKey={step.iconKey} size={30} color="var(--color-parchment)" />
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
            variant="forgeGhost"
            size="sm"
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
            variant="forgePrimary"
            size="sm"
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
