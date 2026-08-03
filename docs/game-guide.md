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

In the open world, any monster you have engaged keeps chasing you if you back away instead of resetting on the spot — and if it catches up, it starts swinging again on its own. Stepping back buys distance, not a free reset; only leaving its reach for good, or leaving the area, actually ends the fight. Walking away yourself still stops your own attacks until you tap Attack again — only the monster's swings resume automatically.

## Combat level

Your combat level summarises your fighting power for quests and for the Wilderness's ±10 attack bracket. It is 0.25 × (Defence + Hitpoints + half your Prayer level) plus 0.325 × your best attack contribution — Attack + Strength for melee, or 1.5 × Ranged, or 1.5 × Magic — rounded down, with a minimum of 3. Training any combat skill (including Prayer and Hitpoints) raises it.

## Equipment and gear

You have 11 equipment slots: weapon, ammo, head, body, legs, shield, neck, gloves, boots, cape and ring. Each piece adds attack, strength and defence bonuses that feed directly into the combat formulas. Metal gear progresses through tiers — Bronze, Iron, Steel, Mithril, Adamant, Rune and Dragon — with level requirements to equip. Compare an item's stats before equipping, and remember special gear effects (like dragonfire protection) only work while the item is worn.

Equipment tabs save a full loadout — everything worn plus your inventory — and load it back by re-arranging gear you already own between bank, inventory and equipment. Every character gets three tabs; more can be bought on the Character Unlocks screen for 10 credits each, with no limit on how many you buy.

## Shardglass gear

Shardglass gear runs on charges rather than durability: load it with shardglass shards from the item's modal, and it does nothing at all once empty. The Blighted Gauntlet drops the whole set, and any duplicate breaks down into 5,000 shards — which the shard store will sell you a replacement for, at 15,000 shards a tool and 50,000 a weapon.

Three gathering tools carry the same perk — the Shardglass Pickaxe (Mining 70), Axe (Woodcutting 70) and Harpoon (Fishing 70). Each is the fastest tool in its skill, and while charged every action spends 2 charges to bring back double the ore, logs or fish. This works live, idle and offline. Run one dry and it stops counting as a tool entirely, so you fall back to your next-best pickaxe, axe or harpoon until you recharge it.

The Shardglass Halberd (Attack and Strength 75) is the set's weapon: slow to swing but hitting harder than anything else in the game, with +150 accuracy and +200 strength. Its special, Shardstorm, sweeps three times in a single attack for 30% energy — roughly three specials per full bar. Every swing costs one charge, special attacks included, so bring shards to a long fight.

## Ranged combat and ammunition

Ranged weapons need matching ammunition equipped in your ammo slot (for example arrows for a bow), and ammunition is consumed as you shoot — in live and idle combat alike. If you run out mid-fight your attacks stop with a warning, so stock plenty before long idle sessions. A few special weapons use built-in charges instead of ammunition.

Both halves of a ranged setup carry damage: the bow or crossbow itself and the ammunition loaded into it. The arrow ladder runs Bronze through Runeforged and Dragon, then **Shardglass Arrows** (Ranged 75), knapped from shardglass shards at Smithing 85 and fletched at Fletching 85, and finally **Seraphic Arrows** (Ranged 85), which drop by the quiverful from the endgame raids. Crossbow bolts run their own ladder up to the enchanted dragon bolts, which carry procs as well as raw strength.

## Magic: spells and powered staves

Standard combat spells step through five tiers — Strike, Bolt, Blast, Wave and Surge — each a real jump in base damage over the one below, so the spell you can cast keeps pace with your Magic level. Casting speed comes from the staff you hold, which is why a faster staff is an upgrade even when its bonuses match.

Powered staves are the other path: they need no runes and scale their base hit with your Magic level instead of using a spell. They are tiered, so a better staff hits harder at the same level — the Duskmare Staff, then the Trident of Venom, the Sanguine Staff, and the Shadow of Tumaken at the top, which triples your worn magic damage.

Worn **magic damage %** multiplies whatever you cast. Melee and Ranged have the same lever: prestige gear like the Amulet of Torment, Ferocious Gloves and the Grondar set carries a melee damage percentage that multiplies your max hit on every swing, specials included.

## Special attacks

Some weapons have a special attack, triggered manually with the ⚡ Special Attack button during a fight. Special attack energy runs 0–100: each fight starts at full energy, using a special drains its energy cost, and energy refills when you get a kill. Specials never fire automatically or while offline. Each weapon's special has its own effect — stuns, heals, bonus damage and more — shown on the button. The Sunbearer Ring keeps your special attack energy pinned at 100% in PvE, letting you fire specials back-to-back with no cooldown. In the open world energy works differently: it is a session resource that never refills on a kill and only climbs on the clock, 10% every 30 seconds. The Master Rejuvenation Construction perk doubles that everywhere — 20% every 30 seconds, mid-fight, in solo fights, group bosses, raids and the open world alike.

## Food, potions and combo eating

Eating food during combat heals you but shares a cooldown, so spamming food delays nothing else — except combo consumables. Combo items (for example Karam, and every potion and brew) use a separate combo cooldown: you can use one combo item in the same tick as one normal food, and doing so never delays your next attack. Use this to burst-heal in dangerous fights.

## Prayer

Prayers give combat bonuses but drain a prayer pool while active. In the open world the protection prayer you have on shows as an icon over your head, and over everyone else's — you can read what an opponent is praying against before you swing. Your pool's maximum equals your Prayer level, starts each session full, and persists across auto-fight kills. Each prayer drains the pool over time — stronger prayers drain faster — and when the pool hits zero all prayers switch off. Prayer potions restore 20 prayer points and super restores 22, in both live and idle combat. Protection prayers work in the Wilderness, so a PvP fight drains your pool exactly as a boss fight does.

## Dragonfire

Dragons breathe fire: dragonfire has a 33% chance to proc and can hit up to 50. It is fully blocked by equipment with dragonfire protection (an anti-dragon shield effect) — bring one to any dragon fight or you will take heavy damage.

## Health and regeneration

Your hitpoints regenerate naturally at +1 HP every 60 seconds, in and out of combat. For faster healing, eat food or use potions; some weapon specials also heal.

## What happens when you die

Dying in PvE is forgiving: the fight ends, your hitpoints are restored to full, and you keep all your items and loot — nothing is dropped or lost. If you would die during idle combat or offline catch-up, the simulation stops at that point and you keep everything earned up to it; restock food and check your gear before restarting. One-life (hardcore) characters are the exception: death permanently revokes the one-life badge — an Ironman one-life character becomes a standard Ironman, and a non-Ironman one-life character becomes a standard account. The character itself, its level and all its items are untouched.

Dying in one of the open world's instanced boss lairs works differently: it ends your part of that fight. You're shown a choice — return to the boss in a fresh copy of the lair, or head back to the idle game — instead of respawning back in front of it able to keep swinging.

## Inventory and banking

Your inventory holds a hard maximum of 28 slots, and you can drag items to rearrange it. Your bank stores everything else. While doing idle activities, loot is banked automatically when your inventory fills; the auto-bank delay scales with your Agility level, from 5 minutes at Agility 1 down to just 10 seconds at Agility 99 — a strong reason to train Agility. On mobile, the Bank button opens a hub with both the Bank and the Trading Post; on desktop each has its own entry in the navigation rail.

## World map, travel and town maps

The World Map shows every settlement in Eldermoor, joined by roads. Tap a settlement to open its hub — lore, facilities, travel and teleport options, and a browsable list of what's available there. Walking follows the roads and takes real time; teleporting is instant but needs the destination's Magic level plus runes, and grants Magic XP. Some settlements (starting with Varrick) have their own illustrated town map: when you're there, tapping the settlement opens the town map instead, and you start activities by tapping the markers placed on it — city gates for monsters, the rooftop course for Agility, and so on. The bank marker opens banking plus training for the crafts doable at any banked settlement (Crafting, Fletching, Firemaking, Herblore, Magic, Construction). Prayer, Cooking and Smithing are tied to their own facilities — an altar, a stove, and a furnace & anvil — found only in some settlements; on a town map each facility is its own marker (in Varrick: the Royal Chapel, the Market Stove, the Grand Smithy). Every settlement with a sawmill (Varrick, Faloden, Ardounne, Seerhold) converts all log types to planks — its sawmill marker lists every conversion; the trading post marker opens the Trading Post. For mapped places the hub's activity list is browse-only — visit the town and tap a marker to begin — and backing out of a skilling screen you entered from the town map returns you to that map.

## Idle progress and offline catch-up

Start a skilling task, gather task or auto-fight and it keeps running while the app is closed. When you come back, PocketRPG simulates the time you were away and awards the XP, loot and coins you earned. Supplies (food, potions, runes, ammunition) are consumed during idle combat exactly as they would be live — stock up before long sessions.

## Credits and skipping time

Credits are a premium currency. You earn +1 credit for each daily task you complete, and can buy more in the store in packs of 10, 100 or 1,000 (real-money purchase via secure checkout). Spend credits to skip an hour of your current idle activity instantly (Skip 1h), to skip straight to a boss or raid kill while fighting one, or to skip a slayer task you don't like. Skip 1h also works on travel and journeys: it advances exactly one hour of trail time, so a longer journey continues from partway along. Credits are tracked server-side on each character.

## Daily tasks

You get 5 daily tasks per day, one per difficulty tier from Novice up to Grandmaster. Tasks reset at 00:00 UTC and each completed task awards 1 credit. Progress is tracked automatically as you play (kills, skilling actions, and so on). Daily tasks are available on cloud accounts.

## Slayer

Slayer masters assign you a task to kill a set number of a specific monster. Each master lives at a world place — Torvak in Lumbright, Morven in Canifel, Valdrin in Edgevale, Caelira in Seerhold, Nyra in Camlann and Druven in Brimhollow — and getting a task is an action at that settlement: visit the master (the Slayer screen or the world map offers to travel there if you're elsewhere) to be assigned. Completing tasks earns slayer points and Slayer XP; higher-tier masters need higher combat and Slayer levels and pay more points. Killing your assigned monster is the only way to finish a task — you can also spend credits to skip a task, or slayer points to buy unlocks (found on the Character Unlocks screen) and rewards. Boss slayer tasks award a ×4 Slayer XP multiplier on kills. The Auto Slayer Task unlock (100 credits, on the Character Unlocks screen) keeps your slayer grind going while you're away: when you're idling on your assigned monster, finishing a task automatically takes the next one from the same master, so offline catch-up and Skip 1h can complete several tasks in a row instead of grinding the finished monster. A boss task can't be auto-fought, so the chain stops there and leaves it assigned for you. Every slayer monster also drops farming seeds and saplings, tiered by its Slayer requirement: low-level tasks drop basic herb seeds and oak saplings, while the toughest monsters and slayer bosses rarely drop rynarr seeds and yew, palm and magic saplings.

Two extremely rare materials — the Imbued Crown and the Imbued Brain — can drop from any slayer-level-gated monster or boss, but **only while that monster is your currently assigned slayer task**; killing the same monster off-task never rolls them. Odds scale with the monster's Slayer requirement, from 1/25,000 (Imbued Crown) and 1/150,000 (Imbued Brain) at the lowest requirement up to 1/250 and 1/1,500 at the highest (Ashen Hydra). The Imbued Crown combines with a Slayer Helmet to forge the Imbued Slayer Crown, which extends the helmet's melee bonuses to ranged and magic as well. The Imbued Brain is an unlimited-use item — drinking it grants +18 Magic for 5 minutes without ever being consumed.

## Quests

Quests are journeys across the world map: meet the requirements (skill levels, quest points, combat level or earlier quests), begin the quest, and follow its trail through several places — teleporting between waypoints finishes it faster. Quests live on the world map: every settlement offers a selection (from Novice quests in the starting hamlets up to Grandmaster quests in the cities) — tap a place, or the Quests Board in Varrick, to browse and begin its quests; the ⓘ button beside each quest shows its full requirements and rewards. Rewards include coins, XP (sometimes in a skill of your choice), quest points and item unlocks; longer, harder quests pay better.

## Kingdom of Royals

Completing the "Crown Complications" quest unlocks Kingdom of Royals on the Adventures screen. Deposit coins into the royal coffer (up to 25,000,000) to fund a kingdom that gathers resources for you, even while you're offline — a full coffer runs for about 5 days. Assign your 4 labour points across Mining, Fishing, Woodcutting, Farm Herbs and Gathering (any split, e.g. 1 each or all 4 on one); each point works at half a real player's pace, producing ore, logs, fish or herbs weighted toward whatever your own skill level can reach — rarer, higher-level resources are less common than basic ones. Gathering is the exception with no level requirement at all: those workers bring back a random mix of everything the Gather screen offers — eye of newt, limpwurt root, snape grass, white berries, red spiders' eggs, potato cactus, Wine of Krylth, bowstring, seaweed and buckets of sand — so the kingdom can keep you stocked with potion secondaries. It won't make planks or soda ash, as kingdom workers carry no materials or coins of their own. Funding the kingdom costs a flat 5,000,000 coins per 24 hours regardless of how many points are allocated; the coffer stops draining and gathering stops the instant it runs dry. Gathered resources pile up as loot in the kingdom's treasury — they don't auto-bank, so check the Gathered Loot section on the Kingdom screen and withdraw it to your bank yourself. You can withdraw unspent coffer coins back to your bank at any time too.

## Clue scrolls

Clue scrolls drop from monsters and come in four tiers: medium, hard, elite and master. Solving a clue is a journey across the world map: follow the trail to 2–4 waypoints, searching each one, and the final search grants the reward. Searching takes about 5 minutes total for medium, 15 for hard, 30 for elite and 60 for master, plus road time — teleporting between waypoints finishes the trail faster, and if you have another scroll of the same tier the next journey starts automatically. Rewards are 1 to 4 rolls from that tier's loot table: runes, coins, gear and rare uniques (like the 2nd Age sets) that fill your collection log. Higher tiers roll rarer rewards.

## Minigames

Minigames are timed grinds for specific unique rewards — for example running Viking Assault until you earn a piece of the Fighter set. Each minigame task shows its expected duration and its reward. Minigame uniques are granted server-side when the grind completes and count toward your collection log. The Fletching Guild (Ardounne) is a 2-hour grind for the Bowyer's Knife — an untradeable tool that cuts one tick off the time to fletch any bow while it's in your inventory or equipped. Autumntodt (Catherra, unlocked at Firemaking 80) is a 5-hour grind for the Tomb of Fire. Lithe Farm (Seerhold) needs both Farming 50 and Herblore 50 to enter, and every task inside it is gated on the pair; its 2-hour grind earns the Magic Secateurs.

## Raids and bosses

Raids are multi-boss gauntlets (for example the Vaults of Xyren) with big reward tables: guaranteed loot plus a chance at rare uniques. Bosses are tougher single monsters with their own drop tables and kill counts. Boss and raid uniques are granted by the server when you complete the kill, and every kill is recorded — check the Collection Log and Leaderboard. You can spend credits to skip to a boss kill or pay a raid's skip cost.

A boss hunts you across its whole lair, further than any other monster will follow, and any minions it has summoned stay on the field with it. The way out of a boss fight is the way you came in.

## Hard Mode

Most bosses and every raid can be switched to Hard Mode from the prompt that opens when you tap them in the combat picker. The switch is per boss (and per raid), stays on until you turn it off, and shows as a **HARD** tag wherever that fight is listed.

A hard fight doubles the boss's offence — twice the max hit, twice the accuracy. Its health and its defences are untouched, so it dies to the same hits in the same time it always did; the only thing that changes is how much damage it does to you along the way. In exchange every drop rate on its table doubles — a 1-in-500 unique becomes 1-in-250. Guaranteed drops stay one drop, and a boss you skip with credits costs double the credits.

**If you die in Hard Mode you lose every tradeable item you are carrying and every tradeable item you are wearing, permanently.** Untradeables — Infernal Cape, quest gear, skill capes, anything you could never buy back — stay with you. Your bank is untouched, so the counter-play is to take in less than you can afford to lose. This applies to solo fights, group fights, raid parties and idle catch-up alike: a hard fight left running while you are away costs the same pack. Turning Hard Mode on asks you to confirm it first.

Difficulty belongs to the fight, not to you: a group boss room or a raid party is opened at the difficulty the player who opened it chose, everyone in it fights the same boss, and joining a listed group means taking that group's difficulty. Hard Mode applies to solo fights and group fights; open-world boss lairs are always normal.

## Group boss fights

Tap most bosses in the combat picker and you are asked whether to fight solo or join a group. A group holds up to 8 players against one shared boss; you join the fullest group with room, or open a new one. Raid bosses stay inside their raids, and four bosses are solo only: Ember Tyrant, Ashen Crucible, Venomcoil Matriarch and Blighted Gauntlet.

The server runs the whole fight — every swing, your XP, the food and potions you use and the loot roll. The fight plays the same as a solo one: same tick speed, prayers, special attacks, combo eating and gear swaps, and dying costs exactly what dying to that boss alone costs. The boss's entry requirements still apply to each player, quest, Slayer level and kill count alike.

After a kill the boss comes back 5 seconds later, shown as a countdown. That wait is preparation time, not dead time: eat, drink potions, toggle prayers and swap gear as normal, and the group goes into the next pull ready.

## Group boss loot and the 10% rule

Every player who personally deals at least 10% of the boss's maximum hitpoints gets their own roll of its drop table — not a share of one drop. Two players over the line means two independent rolls, each with its own collection log entries and kill count. Miss the line and you get nothing from that kill.

Damage from any source counts, including specials and summons, and it resets each time the boss respawns. The bar under the boss's name tracks your own progress toward the threshold: it fills as you deal the 10% you need and turns green when your drop is secured. With the group capped at 8, the top contributor always clears the line, so a kill never comes out empty for everyone. Being defeated does not cancel a drop you had already earned.

Slayer task credit works differently — it goes to everyone still alive at the kill who has that boss as their task, whatever their damage.

While you are in a group fight the server owns your save, so saving, skipping time, buying and Trading Post activity are all locked until you leave with the back arrow.

## Raid parties

Tap a raid and you can run it alone or take a party. Unlike bosses, a raid party is not drop-in: you either start a party and become its host, or join a party that is still waiting in its lobby. Once the host presses Start Raid, nobody else can join that run.

The lobby lists everyone who has joined, with their combat level, and you can open any member's worn gear and inventory to see what they are bringing. Eat, drink and swap gear in the lobby — the wait between bosses works the same way, 5 seconds while the next boss walks in.

Everyone but the host has a Ready button, and the roster shows who has pressed it. The host cannot start until the whole party is ready — the Start button counts who is still getting set. The host's own answer is pressing Start, and a member who died on the last run is not waited on. Readiness clears when the run starts and again when the party lands back in the lobby. Chat works in the lobby exactly as it does in the fight.

The raid itself is the group boss fight: the server runs every swing, and it plays exactly like a solo run — same tick speed, prayers, specials and combo eating. The bosses come in order, and only the last one pays. Deal at least 10% of the whole raid's hitpoints — counted across every boss, not reset between them — and you roll the raid's reward table yourself, with your own collection log entries and raid kill count. Miss the line and you get nothing from the clear.

Finishing the raid puts the party back in its lobby, so the host can start another run without everyone regrouping. If the whole party is wiped out, the run ends the same way. Dying costs what dying in a solo raid costs.
## Talking in a group fight

Group boss fights have chat. The bar at the foot of the fight is one line when closed — the newest message — and opens into a short log with an input. Everyone in your instance sees what you send, and you can still talk while dead or during the respawn wait. Messages are kept for safety review, so keep it civil.

Whenever anyone in your instance receives a drop worth over a million coins, the whole instance is told what it was and who got it. It reads in the fight chat in the idle game, and as a purple banner in the open world — where any kill counts, not just a boss.

## The Corporeal Horror

The Corporeal Horror is a 2,000-hitpoint boss at Edgevale, unlocked by the quest The Heart of Shadows. It halves every hit that is not dealt with a spear, so bringing one roughly doubles your damage — a Krylth Spear is the standard choice. It hits up to 55 with crush, and partway into the fight it spawns a Dread Core: a separate 180-hitpoint monster, not a phase. The Horror keeps attacking the whole time the Core is up, so you take hits from both, and every landed Core hit burns 8 prayer points. Switch targets to destroy the Core — it drops nothing and does not count as a kill — then switch back to the boss. Clear one and the Horror sends in another after a few more of its own attacks, so you are trading damage on the boss for control of your prayer pool all fight. Skipping the fight costs 5 credits.

Its drop table is the best shield source in the game. A Wraithbone Shield (1/64) plus a Sanctified Elixir (1/128) makes a Hallowed Wraithbone Shield; bind one of three sigils to that (each around 1/1,365) for the finished shield:

- **Runeward Wraithbone Shield** — +20 magic attack and +10% magic damage, the strongest magic shield in the realm.
- **Aegis Wraithbone Shield** — the heaviest defences of the three, and a 70% chance to turn aside a quarter of any incoming hit. The reduction works in PvE and PvP alike.
- **Vigil Wraithbone Shield** — halves how fast your prayers drain, in live and idle combat.

It also drops onyx bolts (e), charms, large rune stacks, herbs and elite clue scrolls.

## Zaryth

Zaryth is the hardest fight in the realm: 3,500 hitpoints at Faloden, and the throne the god wars were fought under. He opens only once you have killed all four generals — Warlord Grondar, Commander Zephyra, Krylth the Defiler and Skyrender Kharra — at least once each.

He attacks every three ticks and picks a new style for every single attack — the same style for everyone fighting him, so the whole party reads one prayer off the screen. Ranged hits for up to 60, magic for up to 40, melee for up to 35, and his defences shift with the style he is in, so there is no prayer you can set and forget. Every few attacks he summons a sentinel — a Blade, Bolt or Rune Sentinel, 150 hitpoints, hitting up to 15. Leave them standing and they pile up: he fields **up to four at once**, and every one of them is swinging at you. Sentinels drop nothing and do not count as kills, but clearing them is the only thing that keeps the incoming damage down, and another always follows.

Fight him as a group and he attacks **everybody at once**. There is no safe back line: each member rolls their own accuracy and protection prayer against the same swing, and only his sentinels stay on one target. You may only attack one enemy at a time, but every enemy attacks you — turning to cut down a sentinel does not stop Zaryth swinging. Skipping the fight costs 20 credits.

His table averages around a million coins a kill before uniques, in large rune stacks, food, potions, onyx dragon bolts (e), seraphic arrows, herbs, ore and master clue scrolls. The uniques are the best melee gear in the game:

- **Zaryth Helm, Platebody and Platelegs** (1/256 each) — best in slot for melee accuracy, defence and damage.
- **Zaryth Vambraces** (1/128) — the best ranged gloves in the realm, and the only Zaryth unique you can also pull from the Vaults of Xyren.
- **Zaryth Crossbow** (1/256) — the strongest crossbow in the realm. Its Empty Bolt special cannot be turned aside: it always hits, for up to 150% of your ranged max.
- **Zaryth Hilt** (1/256) — Zaryth never drops the godsword itself, only this. Attach it to all four other godswords at Smithing 99 to forge the **Zaryth Godsword**, the hardest-hitting two-handed weapon in the game. Its Empty Lord's Cleave strikes for up to 150% of your max hit and restores half the damage it deals. Forging consumes all four godswords, so it is a one-way trade.

Zaryth is modelled in 3D, and it is the one boss that animates differently depending on how it is attacking: it lunges when it comes at you in melee, and strikes from where it stands when it switches to ranged or magic. Watching which it does tells you the style of the swing before the damage lands. In the open world it also burns the colour of the phase it is about to swing with — red for melee, green for ranged, blue for magic — so you can set the prayer from across the room. It has an instanced open-world room there, the Empty Throne, where a group fights it live in its own private copy of the vault.

## Farming

Plant seeds in farming patches (herbs, trees, fruit trees and vegetables) at different locations, wait for them to grow in real time, then harvest for crops and Farming XP. Higher Farming levels unlock better seeds. Vegetable patches (Potato at level 1, Sweetcorn at level 9) yield 1-50 crops per harvest — a higher Farming level just weighs the roll toward a bigger harvest, it never guarantees one. Harvest everything at once with Harvest All. Magic Secateurs — the untradeable Lithe Farm reward — double the crop from every herb patch while wielded; they carry no combat stats. Seeds and saplings come from the General Store (basics), the Trading Post, and slayer monsters — the higher a monster's Slayer requirement, the better the seeds it drops; Potato and Sweetcorn seeds are common early drops from low-combat monsters and the Master Farmer.

## Magic

Magic is trained by casting combat spells, which need runes. Each spell has a level requirement, base damage, and rune cost per cast; you earn the spell's base XP plus 2 XP per damage dealt. Higher tiers (strike, bolt, blast and beyond) hit harder and cost pricier runes.

The Tomb of Fire is a shield-slot book earned from Autumntodt (Catherra, Firemaking 80) and worn at Magic 80. It supplies every fire rune your spells need, adds 10% magic damage to fire spells, and gives +15 magic attack with any spell. It carries no defence bonuses.

The Arcane Proving Grounds minigame (Edgevale, unlocked at Magic 50) is a timed grind for magic gear: the Boundless hat, robe top, robe bottom, boots and gloves (2 hours each), the Arcane Grimoire off-hand (4 hours) and the Archmage Wand (4 hours). The Duskmare boss (Canifel) drops the Duskmare Staff plus three orbs — Umbral, Attuned and Volatile. Attaching an orb to a Duskmare Staff forges a unique staff: Umbral's special restores Prayer points, Attuned casts standard spells one tick faster for the highest sustained DPS, and Volatile's special hits harder the higher your Magic level.

## Construction

Construction is trained by building with planks — each build consumes one plank and grants instant XP: Plank (level 1, 29 XP), Oak Plank (level 15, 60 XP), Teak Plank (level 35, 90 XP) and Mahogany Plank (level 70, 140 XP). High Construction also unlocks permanent perks: the Money Purse (level 70) lets you spend coins directly from your bank when shopping; at level 80 gathered loot banks automatically when your inventory fills during idle and offline play, so long gathering sessions never stall; and Master Rejuvenation (level 90) recharges your special attack energy twice as fast — 20% every 30 seconds during any fight, solo, group or open world. Perks are managed on the Character Unlocks screen.

## Dungeoneering

Dungeoneering is trained by clearing dungeons of increasing difficulty, from novice upward. Every clear grants Dungeoneering XP and also earns Dungeoneering tokens (0.15 tokens per XP, rounded up per clear). Spend tokens on exclusive rewards with level requirements — for example the Arcane Necklace at level 65 for 65,000 tokens, or the Chaotic weapons and kiteshields at level 80 for 300,000 tokens each. Claiming them is not the same as wielding them: the Chaotic Rapier, Longsword and Maul need Attack 80 and Strength 90, the Chaotic Crossbow needs Ranged 90 and the Chaotic Staff Magic 90, and both kiteshields need Defence 70 plus 90 in their combat skill. Dungeoneering rewards count toward your collection log.

## Summoning

Summoning lets you call a creature to fight alongside you in combat. Every non-boss monster can drop a charm scaled to its combat level — green charms below level 51, red charms up to level 100, and blue charms above — at a flat 5% chance. On the Summoning screen you infuse a charm, a secondary item, and an empty pouch into a creature pouch, and you can infuse one pouch into ten scrolls. Empty pouches are bought cheaply from the Skilling Equipment section of the shop. Both actions run one at a time, completing every two ticks, and draw their materials from your inventory and bank. Pouches and scrolls are named after their creature (for example a Steel Titan Pouch and Steel Titan Scroll).

The creatures, each with a Summoning level, its charm and secondary, and its combat power: Chicken (level 1, green charm + raw chicken, max hit 5, low accuracy), Dog (level 10, green charm + bones, max hit 7), Gargoyle Crab (level 25, green charm + gargoyle dust, max hit 10), Fire Giant (level 50, red charm + staff of fire, max hit 10, medium accuracy), Dragon (level 70, red charm + dragon bones, max hit 15, high accuracy) and Steel Titan (level 99, blue charm + steel platebody, max hit 25 and three hits per attack, medium accuracy).

During a live fight, tap Summon and pick a creature to spend one pouch and call it for 60 seconds. It attacks your target on its own with orange hit splats, spending one scroll per attack, and vanishes when the timer runs out — re-summon with another pouch. It keeps fighting across auto-fight kills until its 60 seconds are up. The combat summon works only in live PvE, not idle catch-up or PvP. Making pouches and infusing scrolls, however, trains like any production skill — the action keeps running while you're away and settles through idle catch-up and Skip 1h. Making pouches, infusing scrolls, and summoning a creature all grant Summoning XP, with higher-tier creatures worth more. Reach level 99 for the Summoning Cape.

## Skill capes and the Max cape

Reach level 99 in a skill and you can buy that skill's cape of accomplishment from the store — a prestige item showing off your mastery. The Max cape requires being fully maxed: 2,475 total level (99 in every skill). Skill capes and the Max cape are self-obtained prestige rewards, so Ironman characters can buy them too.

## Trading Post and shops

The General Store sells a fixed catalogue of basics at fixed prices. Everything else trades on the Trading Post, a player-to-player order book: list items to sell, place buy offers, instant-sell into existing offers, and collect your coins or items when offers fill. Ironman characters cannot trade with other players. The store's Slayer section sells slayer gear (Slayer Helmet, Slayer Defender, Gloves of Slaughter and the like) for coins at its shop value — but only after you've unlocked that piece once with slayer points on the Character Unlocks screen. Until then the row stays locked. This section is open to every account type, Ironman included.

## PvP — the Wilderness

PvP happens in one place: the Wilderness, an open-world area you enter from the Combat screen. There is no lobby and no matchmaking. You arrive in a walled border camp with a bank chest, where nothing can touch you. North through the gates is open PvP, and the game stops you at the line and asks you to confirm before you cross.

Out there, anyone within 10 combat levels of you can attack you, and you can attack them. It is single combat: one fight at a time, and nobody can jump in on a fight already under way. Eating, potions, prayers (protection prayers included), special attacks and spells all work exactly as they do anywhere else in the open world.

**If you die in the Wilderness you drop everything** — your whole inventory and every item you are wearing — on the ground for your killer. Bank what you cannot afford to lose. Untradeable items are the one exception, and not a kind one: they are destroyed rather than dropped, and your killer gets their shop value in coins instead. A one-life run ends there like it ends anywhere else.

You cannot log out of a fight, and closing the tab is not a fight plan. Anywhere in the open world, leaving is refused while you are in combat — the Log out button tells you so, and if you close the tab or lose connection your character stays standing there, unable to fight back and perfectly killable, until the fight has been over for ten seconds. Run, eat, or die like everyone else.

Outlaws roam the wastes when the map is quiet, so there is always something to fight. They carry a drop table of their own rather than the gear they wear, and they are the only source of the Zesta longsword, vest and skirt. Killing another player counts towards your PvP rank on the leaderboard; killing an outlaw does not.

Ironman characters can fight in the Wilderness and keep every outlaw drop, but can never pick up loot dropped by another player.

## Collection log

The collection log tracks every rare unique in the game — boss drops, raid uniques, clue rewards and minigame prizes. Each slot fills when you obtain that item for the first time. It is the long-term completionist goal.

## Leaderboard

The public leaderboard ranks characters by total level, and separately by kill counts for each boss and raid. Tap any player to view their profile and skill levels. It is a fun comparison, not a competition with prizes.

## Ironman and one-life modes

When creating a character you can pick special modes. Ironman characters are self-sufficient: no Trading Post trading with other players, and in the open world they can only pick up loot they earned themselves — another player's kill drops and dropped items never become visible to them. That extends to the Wilderness: an Ironman can fight there and keep every outlaw drop, but the pile a defeated player leaves behind stays on the ground. Fighting alongside others is fine, boss lairs included: a kill's drop belongs to whoever dealt the most damage, so an Ironman who leads the damage keeps the drop no matter how many people helped. One-life characters are hardcore — dying loses the one-life badge for good, reverting the character to a standard account (or a standard Ironman, if it was also an Ironman). Both modes are badges of honour on the leaderboard.

## Account, characters and saving

You sign in with GitHub or Google and can have multiple characters. Your game saves to the cloud automatically as you play; manual save is available from the Home screen. The server owns your account, credits, high-value drops and PvP results.

## Getting help

This assistant (the 💬 button) is the in-game help: it answers questions about PocketRPG — game mechanics, items, monsters, and your own character's progress. It can only talk about PocketRPG; it has no access to the internet and won't answer unrelated questions. The Settings screen holds game preferences, such as toggling info notifications.
