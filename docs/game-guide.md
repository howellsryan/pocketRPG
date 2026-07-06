# PocketRPG Game Guide

> Player-facing help content. Each `##` section becomes one retrieval chunk for
> the in-game help chatbot (regenerate with `npm run gen:knowledge`). Keep
> sections short, factual and free of developer/internal detail. PocketRPG is
> its own game — never describe another game's values as PocketRPG's.

## What is PocketRPG?

PocketRPG is a menu-driven, mobile-first fantasy idle RPG. You train skills, fight monsters and bosses, complete quests and slayer tasks, and collect rare drops. Progress continues while you are away: idle activities keep running and are caught up when you return. Playing requires an account (sign in with GitHub or Google) and an internet connection — your characters and progress are stored in the cloud.

## Game tick and timing

The game runs on a 600 millisecond tick. Combat attacks, skilling actions and most timers are measured in ticks. After you defeat a monster with auto-fight enabled, the next fight starts after a short 1.2 second delay. All gameplay maths rounds down (floor).

## XP, levels and the skill curve

Every skill goes from level 1 to 99, and XP in a skill is capped at 200,000,000. The XP curve accelerates: each level needs more XP than the last, and level 99 needs about 13 million XP. Hitpoints starts at level 10. In combat you gain 4 XP per point of damage in the combat skill matching your attack style, plus 1.33 XP per damage to Hitpoints. Magic grants each spell's base XP plus 2 XP per point of damage dealt.

## Combat basics

Combat is tick-based. Your max hit and accuracy come from your effective levels and equipment bonuses: melee max hit is floor(0.5 + effectiveStrength × (strengthBonus + 64) / 640), and hit chance compares your attack roll against the target's defence roll. Choose a combat style before fighting: Accurate (+3 effective Attack), Aggressive (+3 effective Strength), Defensive (+3 effective Defence), or Controlled (+1 to Attack, Strength and Defence). Auto-fight keeps killing the same monster, banking loot as you go.

## Special attacks

Some weapons have a special attack, triggered manually with the ⚡ Special Attack button during a fight. Special attack energy runs 0–100: each fight starts at full energy, using a special drains its energy cost, and energy refills when you get a kill. Specials never fire automatically or while offline. Each weapon's special has its own effect — stuns, heals, bonus damage and more — shown on the button.

## Food, potions and combo eating

Eating food during combat heals you but shares a cooldown, so spamming food delays nothing else — except combo consumables. Combo items (for example Karam, and every potion and brew) use a separate combo cooldown: you can use one combo item in the same tick as one normal food, and doing so never delays your next attack. Use this to burst-heal in dangerous fights.

## Prayer

Prayers give combat bonuses but drain a prayer pool while active. Your pool's maximum equals your Prayer level, starts each session full, and persists across auto-fight kills. Each prayer drains the pool over time — stronger prayers drain faster — and when the pool hits zero all prayers switch off. Prayer potions restore 20 prayer points and super restores 22, in both live and idle combat. In PvP, protection prayers are disabled (v1), so only offensive prayers drain there.

## Dragonfire

Dragons breathe fire: dragonfire has a 33% chance to proc and can hit up to 50. It is fully blocked by equipment with dragonfire protection (an anti-dragon shield effect) — bring one to any dragon fight or you will take heavy damage.

## Health and regeneration

Your hitpoints regenerate naturally at +1 HP every 60 seconds, in and out of combat. For faster healing, eat food or use potions; some weapon specials also heal.

## Inventory and banking

Your inventory holds a hard maximum of 28 slots. Your bank stores everything else. While doing idle activities, loot is banked automatically when your inventory fills; the auto-bank delay scales with your Agility level, from 5 minutes at Agility 1 down to just 10 seconds at Agility 99 — a strong reason to train Agility.

## World map, travel and town maps

The World Map shows every settlement in Eldermoor, joined by roads. Tap a settlement to open its hub — lore, facilities, travel and teleport options, and a browsable list of what's available there. Walking follows the roads and takes real time; teleporting is instant but needs the destination's Magic level plus runes, and grants Magic XP. Some settlements (starting with Varrick) have their own illustrated town map: when you're there, tapping the settlement opens the town map instead, and you start activities by tapping the markers placed on it — city gates for monsters, the rooftop course for Agility, and so on. The bank marker opens banking plus training for the crafts doable at any banked settlement (Crafting, Fletching, Firemaking, Herblore, Magic, Construction). Prayer, Cooking and Smithing are tied to their own facilities — an altar, a stove, and a furnace & anvil — found only in some settlements; on a town map each facility is its own marker (in Varrick: the Royal Chapel, the Market Stove, the Grand Smithy). Every settlement with a sawmill (Varrick, Faloden, Ardounne, Seerhold) converts all log types to planks — its sawmill marker lists every conversion; the trading post marker opens the Trading Post. For mapped places the hub's activity list is browse-only — visit the town and tap a marker to begin — and backing out of a skilling screen you entered from the town map returns you to that map.

## Idle progress and offline catch-up

Start a skilling task, gather task or auto-fight and it keeps running while the app is closed. When you come back, PocketRPG simulates the time you were away and awards the XP, loot and coins you earned. Supplies (food, potions, runes, ammunition) are consumed during idle combat exactly as they would be live — stock up before long sessions.

## Credits and skipping time

Credits are a premium currency. You earn +1 credit for each daily task you complete, and can buy more in the store. Spend credits to skip an hour of your current idle activity instantly (Skip 1h), to skip straight to a boss or raid kill while fighting one, or to skip a slayer task you don't like. Credits are tracked server-side on each character.

## Daily tasks

You get 5 daily tasks per day, one per difficulty tier from Novice up to Grandmaster. Tasks reset at 00:00 UTC and each completed task awards 1 credit. Progress is tracked automatically as you play (kills, skilling actions, and so on). Daily tasks are available on cloud accounts.

## Slayer

Slayer masters assign you a task to kill a set number of a specific monster. Each master lives at a world place — Torvak in Lumbright, Morven in Canifel, Valdrin in Edgevale, Caelira in Seerhold, Nyra in Camlann and Druven in Brimhollow — and getting a task is an action at that settlement: visit the master (the Slayer screen or the world map offers to travel there if you're elsewhere) to be assigned. Completing tasks earns slayer points and Slayer XP; higher-tier masters need higher combat and Slayer levels and pay more points. Killing your assigned monster is the only way to finish a task — you can also spend credits to skip a task, or slayer points to buy unlocks (found on the Character Unlocks screen) and rewards. Boss slayer tasks award a ×4 Slayer XP multiplier on kills.

## Quests

Quests are journeys across the world map: meet the requirements (skill levels, quest points, combat level or earlier quests), begin the quest, and follow its trail through several places — teleporting between waypoints finishes it faster. Quests live on the world map: every settlement offers a selection (from Novice quests in the starting hamlets up to Grandmaster quests in the cities) — tap a place, or the Quests Board in Varrick, to browse and begin its quests; the ⓘ button beside each quest shows its full requirements and rewards. Rewards include coins, XP (sometimes in a skill of your choice), quest points and item unlocks; longer, harder quests pay better.

## Clue scrolls

Clue scrolls come in four tiers: medium, hard, elite and master. Completing a clue takes time and rewards you from that tier's loot table — runes, coins, gear and rare cosmetic uniques that fill your collection log. Higher tiers roll rarer rewards.

## Minigames

Minigames are timed grinds for specific unique rewards — for example running Viking Assault until you earn a piece of the Fighter set. Each minigame task shows its expected duration and its reward. Minigame uniques are granted server-side when the grind completes and count toward your collection log.

## Raids and bosses

Raids are multi-boss gauntlets (for example the Vaults of Xyren) with big reward tables: guaranteed loot plus a chance at rare uniques. Bosses are tougher single monsters with their own drop tables and kill counts. Boss and raid uniques are granted by the server when you complete the kill, and every kill is recorded — check the Collection Log and Leaderboard. You can spend credits to skip to a boss kill or pay a raid's skip cost.

## Farming

Plant seeds in farming patches (herbs, trees and fruit trees) at different locations, wait for them to grow in real time, then harvest for crops and Farming XP. Higher Farming levels unlock better seeds. Harvest everything at once with Harvest All.

## Magic

Magic is trained by casting combat spells, which need runes. Each spell has a level requirement, base damage, and rune cost per cast; you earn the spell's base XP plus 2 XP per damage dealt. Higher tiers (strike, bolt, blast and beyond) hit harder and cost pricier runes.

## Trading Post and shops

The General Store sells a fixed catalogue of basics at fixed prices. Everything else trades on the Trading Post, a player-to-player order book: list items to sell, place buy offers, instant-sell into existing offers, and collect your coins or items when offers fill. Ironman characters cannot trade with other players.

## PvP

PvP matches are run entirely on the server: matchmaking pairs you with an opponent (or a practice bot), and the fight plays out tick by tick with the same combat rules as PvE — same tick speed, special attacks and combo eating. Protection prayers are disabled in PvP (v1). Your save is locked during an active match, and wins earn PvP rank progress shown on the leaderboard.

## Collection log

The collection log tracks every rare unique in the game — boss drops, raid uniques, clue rewards and minigame prizes. Each slot fills when you obtain that item for the first time. It is the long-term completionist goal.

## Leaderboard

The public leaderboard ranks characters by total level, and separately by kill counts for each boss and raid. It is a fun comparison, not a competition with prizes.

## Ironman and one-life modes

When creating a character you can pick special modes. Ironman characters are self-sufficient: no Trading Post trading with other players. One-life characters are hardcore — death is permanent (the character can be reset). Both modes are badges of honour on the leaderboard.

## Account, characters and saving

You sign in with GitHub or Google and can have multiple characters. Your game saves to the cloud automatically as you play; manual save is available from the Home screen. The server owns your account, credits, high-value drops and PvP results.

## Getting help

This assistant (the 💬 button) is the in-game help: it answers questions about PocketRPG — game mechanics, items, monsters, and your own character's progress. It can only talk about PocketRPG; it has no access to the internet and won't answer unrelated questions. The Settings screen holds game preferences, such as toggling info notifications.
