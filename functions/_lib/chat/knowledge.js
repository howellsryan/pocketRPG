// GENERATED FILE — do not edit by hand. Regenerate with: npm run gen:knowledge
// Source: docs/game-guide.md + src/data/*.json (see scripts/gen-chat-knowledge.cjs)
export const KNOWLEDGE_CHUNKS = [
 {
  "id": "guide_what_is_pocketrpg",
  "title": "What is PocketRPG?",
  "tags": [
   "guide"
  ],
  "text": "PocketRPG is a menu-driven, mobile-first fantasy idle RPG. You train skills, fight monsters and bosses, complete quests and slayer tasks, and collect rare drops. Progress continues while you are away: idle activities keep running and are caught up when you return. Playing requires an account (sign in with GitHub or Google) and an internet connection — your characters and progress are stored in the cloud."
 },
 {
  "id": "guide_game_tick_and_timing",
  "title": "Game tick and timing",
  "tags": [
   "guide"
  ],
  "text": "The game runs on a 600 millisecond tick. Combat attacks, skilling actions and most timers are measured in ticks. After you defeat a monster with auto-fight enabled, the next fight starts after a short 1.2 second delay. All gameplay maths rounds down (floor)."
 },
 {
  "id": "guide_xp_levels_and_the_skill_curve",
  "title": "XP, levels and the skill curve",
  "tags": [
   "guide"
  ],
  "text": "Every skill goes from level 1 to 99, and XP in a skill is capped at 200,000,000. The XP curve accelerates: each level needs more XP than the last, and level 99 needs about 13 million XP. Hitpoints starts at level 10. In combat you gain 4 XP per point of damage in the combat skill matching your attack style, plus 1.33 XP per damage to Hitpoints. Magic grants each spell's base XP plus 2 XP per point of damage dealt."
 },
 {
  "id": "guide_combat_basics",
  "title": "Combat basics",
  "tags": [
   "guide"
  ],
  "text": "Combat is tick-based. Your max hit and accuracy come from your effective levels and equipment bonuses: melee max hit is floor(0.5 + effectiveStrength × (strengthBonus + 64) / 640), and hit chance compares your attack roll against the target's defence roll. Choose a combat style before fighting: Accurate (+3 effective Attack), Aggressive (+3 effective Strength), Defensive (+3 effective Defence), or Controlled (+1 to Attack, Strength and Defence). Auto-fight keeps killing the same monster, banking loot as you go."
 },
 {
  "id": "guide_combat_level",
  "title": "Combat level",
  "tags": [
   "guide"
  ],
  "text": "Your combat level summarises your fighting power for quests and PvP matchmaking. It is 0.25 × (Defence + Hitpoints + half your Prayer level) plus 0.325 × your best attack contribution — Attack + Strength for melee, or 1.5 × Ranged, or 1.5 × Magic — rounded down, with a minimum of 3. Training any combat skill (including Prayer and Hitpoints) raises it."
 },
 {
  "id": "guide_equipment_and_gear",
  "title": "Equipment and gear",
  "tags": [
   "guide"
  ],
  "text": "You have 11 equipment slots: weapon, ammo, head, body, legs, shield, neck, gloves, boots, cape and ring. Each piece adds attack, strength and defence bonuses that feed directly into the combat formulas. Metal gear progresses through tiers — Bronze, Iron, Steel, Mithril, Adamant, Rune and Dragon — with level requirements to equip. Compare an item's stats before equipping, and remember special gear effects (like dragonfire protection) only work while the item is worn."
 },
 {
  "id": "guide_ranged_combat_and_ammunition",
  "title": "Ranged combat and ammunition",
  "tags": [
   "guide"
  ],
  "text": "Ranged weapons need matching ammunition equipped in your ammo slot (for example arrows for a bow), and ammunition is consumed as you shoot — in live and idle combat alike. If you run out mid-fight your attacks stop with a warning, so stock plenty before long idle sessions. A few special weapons use built-in charges instead of ammunition."
 },
 {
  "id": "guide_special_attacks",
  "title": "Special attacks",
  "tags": [
   "guide"
  ],
  "text": "Some weapons have a special attack, triggered manually with the ⚡ Special Attack button during a fight. Special attack energy runs 0–100: each fight starts at full energy, using a special drains its energy cost, and energy refills when you get a kill. Specials never fire automatically or while offline. Each weapon's special has its own effect — stuns, heals, bonus damage and more — shown on the button."
 },
 {
  "id": "guide_food_potions_and_combo_eating",
  "title": "Food, potions and combo eating",
  "tags": [
   "guide"
  ],
  "text": "Eating food during combat heals you but shares a cooldown, so spamming food delays nothing else — except combo consumables. Combo items (for example Karam, and every potion and brew) use a separate combo cooldown: you can use one combo item in the same tick as one normal food, and doing so never delays your next attack. Use this to burst-heal in dangerous fights."
 },
 {
  "id": "guide_prayer",
  "title": "Prayer",
  "tags": [
   "guide"
  ],
  "text": "Prayers give combat bonuses but drain a prayer pool while active. Your pool's maximum equals your Prayer level, starts each session full, and persists across auto-fight kills. Each prayer drains the pool over time — stronger prayers drain faster — and when the pool hits zero all prayers switch off. Prayer potions restore 20 prayer points and super restores 22, in both live and idle combat. In PvP, protection prayers are disabled (v1), so only offensive prayers drain there."
 },
 {
  "id": "guide_dragonfire",
  "title": "Dragonfire",
  "tags": [
   "guide"
  ],
  "text": "Dragons breathe fire: dragonfire has a 33% chance to proc and can hit up to 50. It is fully blocked by equipment with dragonfire protection (an anti-dragon shield effect) — bring one to any dragon fight or you will take heavy damage."
 },
 {
  "id": "guide_health_and_regeneration",
  "title": "Health and regeneration",
  "tags": [
   "guide"
  ],
  "text": "Your hitpoints regenerate naturally at +1 HP every 60 seconds, in and out of combat. For faster healing, eat food or use potions; some weapon specials also heal."
 },
 {
  "id": "guide_what_happens_when_you_die",
  "title": "What happens when you die",
  "tags": [
   "guide"
  ],
  "text": "Dying in PvE is forgiving: the fight ends, your hitpoints are restored to full, and you keep all your items and loot — nothing is dropped or lost. If you would die during idle combat or offline catch-up, the simulation stops at that point and you keep everything earned up to it; restock food and check your gear before restarting. One-life (hardcore) characters are the exception: death permanently revokes the one-life badge — an Ironman one-life character becomes a standard Ironman, and a non-Ironman one-life character becomes a standard account. The character itself, its level and all its items are untouched."
 },
 {
  "id": "guide_inventory_and_banking",
  "title": "Inventory and banking",
  "tags": [
   "guide"
  ],
  "text": "Your inventory holds a hard maximum of 28 slots, and you can drag items to rearrange it. Your bank stores everything else. While doing idle activities, loot is banked automatically when your inventory fills; the auto-bank delay scales with your Agility level, from 5 minutes at Agility 1 down to just 10 seconds at Agility 99 — a strong reason to train Agility. On mobile, the Bank button opens a hub with both the Bank and the Trading Post; on desktop each has its own entry in the navigation rail."
 },
 {
  "id": "guide_world_map_travel_and_town_maps",
  "title": "World map, travel and town maps",
  "tags": [
   "guide"
  ],
  "text": "The World Map shows every settlement in Eldermoor, joined by roads. Tap a settlement to open its hub — lore, facilities, travel and teleport options, and a browsable list of what's available there. Walking follows the roads and takes real time; teleporting is instant but needs the destination's Magic level plus runes, and grants Magic XP. Some settlements (starting with Varrick) have their own illustrated town map: when you're there, tapping the settlement opens the town map instead, and you start activities by tapping the markers placed on it — city gates for monsters, the rooftop course for Agility, and so on. The bank marker opens banking plus training for the crafts doable at any banked settlement (Crafting, Fletching, Firemaking, Herblore, Magic, Construction). Prayer, Cooking and Smithing are tied to their own facilities — an altar, a stove, and a furnace & anvil — found only in some settlements; on a town map each facility is its own marker (in Varrick: the Royal Chapel, the Market Stove, the Grand Smithy). Every settlement with a sawmill (Varrick, Faloden, Ardounne, Seerhold) converts all log types to planks — its sawmill marker lists every conversion; the trading post marker opens the Trading Post. For mapped places the hub's activity list is browse-only — visit the town and tap a marker to begin — and backing out of a skilling screen you entered from the town map returns you to that map."
 },
 {
  "id": "guide_idle_progress_and_offline_catch_up",
  "title": "Idle progress and offline catch-up",
  "tags": [
   "guide"
  ],
  "text": "Start a skilling task, gather task or auto-fight and it keeps running while the app is closed. When you come back, PocketRPG simulates the time you were away and awards the XP, loot and coins you earned. Supplies (food, potions, runes, ammunition) are consumed during idle combat exactly as they would be live — stock up before long sessions."
 },
 {
  "id": "guide_credits_and_skipping_time",
  "title": "Credits and skipping time",
  "tags": [
   "guide"
  ],
  "text": "Credits are a premium currency. You earn +1 credit for each daily task you complete, and can buy more in the store in packs of 10, 100 or 1,000 (real-money purchase via secure checkout). Spend credits to skip an hour of your current idle activity instantly (Skip 1h), to skip straight to a boss or raid kill while fighting one, or to skip a slayer task you don't like. Skip 1h also works on travel and journeys: it advances exactly one hour of trail time, so a longer journey continues from partway along. Credits are tracked server-side on each character."
 },
 {
  "id": "guide_daily_tasks",
  "title": "Daily tasks",
  "tags": [
   "guide"
  ],
  "text": "You get 5 daily tasks per day, one per difficulty tier from Novice up to Grandmaster. Tasks reset at 00:00 UTC and each completed task awards 1 credit. Progress is tracked automatically as you play (kills, skilling actions, and so on). Daily tasks are available on cloud accounts."
 },
 {
  "id": "guide_slayer",
  "title": "Slayer",
  "tags": [
   "guide"
  ],
  "text": "Slayer masters assign you a task to kill a set number of a specific monster. Each master lives at a world place — Torvak in Lumbright, Morven in Canifel, Valdrin in Edgevale, Caelira in Seerhold, Nyra in Camlann and Druven in Brimhollow — and getting a task is an action at that settlement: visit the master (the Slayer screen or the world map offers to travel there if you're elsewhere) to be assigned. Completing tasks earns slayer points and Slayer XP; higher-tier masters need higher combat and Slayer levels and pay more points. Killing your assigned monster is the only way to finish a task — you can also spend credits to skip a task, or slayer points to buy unlocks (found on the Character Unlocks screen) and rewards. Boss slayer tasks award a ×4 Slayer XP multiplier on kills. The Auto Slayer Task unlock (100 credits, on the Character Unlocks screen) keeps your slayer grind going while you're away: when you're idling on your assigned monster, finishing a task automatically takes the next one from the same master, so offline catch-up and Skip 1h can complete several tasks in a row instead of grinding the finished monster. A boss task can't be auto-fought, so the chain stops there and leaves it assigned for you. Every slayer monster also drops farming seeds and saplings, tiered by its Slayer requirement: low-level tasks drop basic herb seeds and oak saplings, while the toughest monsters and slayer bosses rarely drop rynarr seeds and yew, palm and magic saplings. Two extremely rare materials — the Imbued Crown and the Imbued Brain — can drop from any slayer-level-gated monster or boss, but **only while that monster is your currently assigned slayer task**; killing the same monster off-task never rolls them. Odds scale with the monster's Slayer requirement, from 1/25,000 (Imbued Crown) and 1/150,000 (Imbued Brain) at the lowest requirement up to 1/250 and 1/1,500 at the highest (Ashen Hydra). The Imbued Crown combines with a Slayer Helmet to forge the Imbued Slayer Crown, which extends the helmet's melee bonuses to ranged and magic as well. The Imbued Brain is an unlimited-use item — drinking it grants +18 Magic for 5 minutes without ever being consumed."
 },
 {
  "id": "guide_quests",
  "title": "Quests",
  "tags": [
   "guide"
  ],
  "text": "Quests are journeys across the world map: meet the requirements (skill levels, quest points, combat level or earlier quests), begin the quest, and follow its trail through several places — teleporting between waypoints finishes it faster. Quests live on the world map: every settlement offers a selection (from Novice quests in the starting hamlets up to Grandmaster quests in the cities) — tap a place, or the Quests Board in Varrick, to browse and begin its quests; the ⓘ button beside each quest shows its full requirements and rewards. Rewards include coins, XP (sometimes in a skill of your choice), quest points and item unlocks; longer, harder quests pay better."
 },
 {
  "id": "guide_kingdom_of_royals",
  "title": "Kingdom of Royals",
  "tags": [
   "guide"
  ],
  "text": "Completing the \"Crown Complications\" quest unlocks Kingdom of Royals on the Adventures screen. Deposit coins into the royal coffer (up to 100,000,000) to fund a kingdom that gathers resources for you, even while you're offline — a full coffer runs for about 10 days. Assign your 4 labour points across Mining, Fishing, Woodcutting and Farm Herbs (any split, e.g. 1 each or all 4 on one); each point works at half a real player's pace, producing ore, logs, fish or herbs weighted toward whatever your own skill level can reach — rarer, higher-level resources are less common than basic ones. Funding the kingdom costs a flat 10,000,000 coins per 24 hours regardless of how many points are allocated; the coffer stops draining and gathering stops the instant it runs dry. Gathered resources pile up as loot in the kingdom's treasury — they don't auto-bank, so check the Gathered Loot section on the Kingdom screen and withdraw it to your bank yourself. You can withdraw unspent coffer coins back to your bank at any time too."
 },
 {
  "id": "guide_clue_scrolls",
  "title": "Clue scrolls",
  "tags": [
   "guide"
  ],
  "text": "Clue scrolls drop from monsters and come in four tiers: medium, hard, elite and master. Solving a clue is a journey across the world map: follow the trail to 2–4 waypoints, searching each one, and the final search grants the reward. Searching takes about 5 minutes total for medium, 15 for hard, 30 for elite and 60 for master, plus road time — teleporting between waypoints finishes the trail faster, and if you have another scroll of the same tier the next journey starts automatically. Rewards are 1 to 4 rolls from that tier's loot table: runes, coins, gear and rare uniques (like the 2nd Age sets) that fill your collection log. Higher tiers roll rarer rewards."
 },
 {
  "id": "guide_minigames",
  "title": "Minigames",
  "tags": [
   "guide"
  ],
  "text": "Minigames are timed grinds for specific unique rewards — for example running Viking Assault until you earn a piece of the Fighter set. Each minigame task shows its expected duration and its reward. Minigame uniques are granted server-side when the grind completes and count toward your collection log."
 },
 {
  "id": "guide_raids_and_bosses",
  "title": "Raids and bosses",
  "tags": [
   "guide"
  ],
  "text": "Raids are multi-boss gauntlets (for example the Vaults of Xyren) with big reward tables: guaranteed loot plus a chance at rare uniques. Bosses are tougher single monsters with their own drop tables and kill counts. Boss and raid uniques are granted by the server when you complete the kill, and every kill is recorded — check the Collection Log and Leaderboard. You can spend credits to skip to a boss kill or pay a raid's skip cost."
 },
 {
  "id": "guide_farming",
  "title": "Farming",
  "tags": [
   "guide"
  ],
  "text": "Plant seeds in farming patches (herbs, trees, fruit trees and vegetables) at different locations, wait for them to grow in real time, then harvest for crops and Farming XP. Higher Farming levels unlock better seeds. Vegetable patches (Potato at level 1, Sweetcorn at level 9) yield 1-50 crops per harvest — a higher Farming level just weighs the roll toward a bigger harvest, it never guarantees one. Harvest everything at once with Harvest All. Seeds and saplings come from the General Store (basics), the Trading Post, and slayer monsters — the higher a monster's Slayer requirement, the better the seeds it drops; Potato and Sweetcorn seeds are common early drops from low-combat monsters and the Master Farmer."
 },
 {
  "id": "guide_magic",
  "title": "Magic",
  "tags": [
   "guide"
  ],
  "text": "Magic is trained by casting combat spells, which need runes. Each spell has a level requirement, base damage, and rune cost per cast; you earn the spell's base XP plus 2 XP per damage dealt. Higher tiers (strike, bolt, blast and beyond) hit harder and cost pricier runes. The Arcane Proving Grounds minigame (Edgevale, unlocked at Magic 50) is a timed grind for magic gear: the Boundless hat, robe top, robe bottom, boots and gloves (2 hours each), the Arcane Grimoire off-hand (4 hours) and the Archmage Wand (4 hours). The Duskmare boss (Canifel) drops the Duskmare Staff plus three orbs — Umbral, Attuned and Volatile. Attaching an orb to a Duskmare Staff forges a unique staff: Umbral's special restores Prayer points, Attuned casts standard spells one tick faster for the highest sustained DPS, and Volatile's special hits harder the higher your Magic level."
 },
 {
  "id": "guide_construction",
  "title": "Construction",
  "tags": [
   "guide"
  ],
  "text": "Construction is trained by building with planks — each build consumes one plank and grants instant XP: Plank (level 1, 29 XP), Oak Plank (level 15, 60 XP), Teak Plank (level 35, 90 XP) and Mahogany Plank (level 70, 140 XP). High Construction also unlocks permanent perks: the Money Purse (level 70) lets you spend coins directly from your bank when shopping; at level 80 gathered loot banks automatically when your inventory fills during idle and offline play, so long gathering sessions never stall; and Master Rejuvenation (level 90) passively refills your special attack bar to 100% whenever it empties during a fight. Perks are managed on the Character Unlocks screen."
 },
 {
  "id": "guide_dungeoneering",
  "title": "Dungeoneering",
  "tags": [
   "guide"
  ],
  "text": "Dungeoneering is trained by clearing dungeons of increasing difficulty, from novice upward. Every clear grants Dungeoneering XP and also earns Dungeoneering tokens (0.15 tokens per XP, rounded up per clear). Spend tokens on exclusive rewards with level requirements — for example the Arcane Necklace at level 65 for 65,000 tokens, or the Chaotic weapons and kiteshields at level 80 for 300,000 tokens each. Dungeoneering rewards count toward your collection log."
 },
 {
  "id": "guide_skill_capes_and_the_max_cape",
  "title": "Skill capes and the Max cape",
  "tags": [
   "guide"
  ],
  "text": "Reach level 99 in a skill and you can buy that skill's cape of accomplishment from the store — a prestige item showing off your mastery. The Max cape requires being fully maxed: 2,376 total level (99 in every skill). Skill capes and the Max cape are self-obtained prestige rewards, so Ironman characters can buy them too."
 },
 {
  "id": "guide_trading_post_and_shops",
  "title": "Trading Post and shops",
  "tags": [
   "guide"
  ],
  "text": "The General Store sells a fixed catalogue of basics at fixed prices. Everything else trades on the Trading Post, a player-to-player order book: list items to sell, place buy offers, instant-sell into existing offers, and collect your coins or items when offers fill. Ironman characters cannot trade with other players."
 },
 {
  "id": "guide_pvp",
  "title": "PvP",
  "tags": [
   "guide"
  ],
  "text": "PvP matches are run entirely on the server: matchmaking pairs you with an opponent (or a practice bot), and the fight plays out tick by tick with the same combat rules as PvE — same tick speed, special attacks and combo eating. Protection prayers are disabled in PvP (v1). Your save is locked during an active match, and wins earn PvP rank progress shown on the leaderboard."
 },
 {
  "id": "guide_collection_log",
  "title": "Collection log",
  "tags": [
   "guide"
  ],
  "text": "The collection log tracks every rare unique in the game — boss drops, raid uniques, clue rewards and minigame prizes. Each slot fills when you obtain that item for the first time. It is the long-term completionist goal."
 },
 {
  "id": "guide_leaderboard",
  "title": "Leaderboard",
  "tags": [
   "guide"
  ],
  "text": "The public leaderboard ranks characters by total level, and separately by kill counts for each boss and raid. Tap any player to view their profile and skill levels. It is a fun comparison, not a competition with prizes."
 },
 {
  "id": "guide_ironman_and_one_life_modes",
  "title": "Ironman and one-life modes",
  "tags": [
   "guide"
  ],
  "text": "When creating a character you can pick special modes. Ironman characters are self-sufficient: no Trading Post trading with other players. One-life characters are hardcore — dying loses the one-life badge for good, reverting the character to a standard account (or a standard Ironman, if it was also an Ironman). Both modes are badges of honour on the leaderboard."
 },
 {
  "id": "guide_account_characters_and_saving",
  "title": "Account, characters and saving",
  "tags": [
   "guide"
  ],
  "text": "You sign in with GitHub or Google and can have multiple characters. Your game saves to the cloud automatically as you play; manual save is available from the Home screen. The server owns your account, credits, high-value drops and PvP results."
 },
 {
  "id": "guide_getting_help",
  "title": "Getting help",
  "tags": [
   "guide"
  ],
  "text": "This assistant (the 💬 button) is the in-game help: it answers questions about PocketRPG — game mechanics, items, monsters, and your own character's progress. It can only talk about PocketRPG; it has no access to the internet and won't answer unrelated questions. The Settings screen holds game preferences, such as toggling info notifications."
 },
 {
  "id": "quest_a_realm_divided",
  "title": "Quest: A Realm Divided",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "A Realm Divided is a Master complexity, Long length quest taking 2.5h. Requirements: Agility 54, Thieving 52, Woodcutting 52, Smithing 50, Mining 50, Herblore 42, Crafting 42, Magic 38, quests: Story Of The Righteous, The Forsaken Spire. Rewards: 25,000 coins; 20,000 XP in a skill of your choice."
 },
 {
  "id": "quest_a_dusk_at_the_theater",
  "title": "Quest: A Dusk At the Theater",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "A Dusk At the Theater is a Master complexity, Medium length quest taking 1.3h. Requirements: none. Rewards: 25,000 coins; 40,000 Combat XP."
 },
 {
  "id": "quest_a_boarborn_of_interest",
  "title": "Quest: A Boarborn of Interest",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "A Boarborn of Interest is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Slayer XP."
 },
 {
  "id": "quest_a_spirit_s_bane",
  "title": "Quest: A Spirit's Bane",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "A Spirit's Bane is a Novice complexity, Medium length quest taking 15m. Requirements: none. Rewards: 1,000 coins; 500 Attack XP, 500 Hitpoints XP."
 },
 {
  "id": "quest_a_trail_of_two_cats",
  "title": "Quest: A Trail of Two Cats",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "A Trail of Two Cats is a Intermediate complexity, Medium length quest taking 23m. Requirements: quests: Icthlarin S Young Aide. Rewards: 5,000 coins; 2,500 Crafting XP, 2,500 Herblore XP."
 },
 {
  "id": "quest_a_savor_of_hope",
  "title": "Quest: A Savor of Hope",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "A Savor of Hope is a Experienced complexity, Medium length quest taking 30m. Requirements: Crafting 48, Agility 45, Attack 40, Herblore 40, Slayer 38, quests: Shadows Of Hallowvale. Rewards: 10,000 coins; 7,500 XP in a skill of your choice."
 },
 {
  "id": "quest_beast_magnetism",
  "title": "Quest: Beast Magnetism",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Beast Magnetism is a Intermediate complexity, Medium length quest taking 23m. Requirements: Slayer 18, Crafting 19, Ranged 30, Woodcutting 35, quests: Ernest And The Fowl Curse, The Wandering Spirit, Warden In Peril. Rewards: 5,000 coins; 1,000 Crafting XP, 1,000 Fletching XP, 2,500 Slayer XP, 2,500 Woodcutting XP; unlocks: Ava S Accumulator."
 },
 {
  "id": "quest_another_shard_of_h_a_m",
  "title": "Quest: Another Shard of H.A.M.",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Another Shard of H.A.M. is a Intermediate complexity, Medium length quest taking 23m. Requirements: Attack 15, Prayer 25, quests: Doom To The Dorgeshuun, The Giant Stonekin, The Excavation Grounds. Rewards: 5,000 coins; 3,000 Mining XP, 3,000 Prayer XP."
 },
 {
  "id": "quest_dawn_s_first_oath",
  "title": "Quest: Dawn's First Oath",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Dawn's First Oath is a Experienced complexity, Short length quest taking 10m. Requirements: Hunter 46, Herblore 30, Construction 27, quests: Heirs Of The Sun, Skyhawks Peak. Rewards: 10,000 coins; 5,000 Hunter XP."
 },
 {
  "id": "quest_beneath_ice_peak",
  "title": "Quest: Beneath Ice Peak",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Beneath Ice Peak is a Novice complexity, Short length quest taking 5m. Requirements: Mining 16, Smithing 10, 16 quest points. Rewards: 1,000 coins; 2,000 Mining XP, 2,000 Smithing XP."
 },
 {
  "id": "quest_beneath_blighted_sands",
  "title": "Quest: Beneath Blighted Sands",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Beneath Blighted Sands is a Master complexity, Long length quest taking 2.5h. Requirements: Agility 62, Crafting 55, Firemaking 55, quests: Desert Correspondence. Rewards: 25,000 coins; 20,000 Agility XP, 15,000 Crafting XP, 15,000 Firemaking XP."
 },
 {
  "id": "quest_between_stone_and_steel",
  "title": "Quest: Between Stone And Steel",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Between Stone And Steel is a Experienced complexity, Medium length quest taking 30m. Requirements: Defence 30, Mining 40, Smithing 50, quests: Angler Contest, Stonekin Cannon. Rewards: 10,000 coins; 5,000 Defence XP, 5,000 Mining XP, 5,000 Smithing XP."
 },
 {
  "id": "quest_big_chompy_wing_hunting",
  "title": "Quest: Big Chompy Wing Hunting",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Big Chompy Wing Hunting is a Intermediate complexity, Short length quest taking 8m. Requirements: Fletching 5, Cooking 30, Ranged 30. Rewards: 5,000 coins; 262 Fletching XP, 1,470 Cooking XP, 735 Ranged XP."
 },
 {
  "id": "quest_chemical_danger",
  "title": "Quest: Chemical Danger",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Chemical Danger is a Novice complexity, Short length quest taking 5m. Requirements: quests: Blight City. Rewards: 1,000 coins; 1,250 Thieving XP."
 },
 {
  "id": "quest_obsidian_sentinels_fortress",
  "title": "Quest: Obsidian Sentinels' Fortress",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Obsidian Sentinels' Fortress is a Novice complexity, Short length quest taking 5m. Requirements: 12 quest points. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_crimson_runs_deep",
  "title": "Quest: Crimson Runs Deep",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Crimson Runs Deep is a Master complexity, Medium length quest taking 1.3h. Requirements: Attack 75, Strength 75, quests: Vision Mentor. Rewards: 25,000 coins; 450,000 XP in a skill of your choice."
 },
 {
  "id": "quest_skeletal_passage",
  "title": "Quest: Skeletal Passage",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Skeletal Passage is a Novice complexity, Short length quest taking 5m. Requirements: quests: The Excavation Grounds. Rewards: 1,000 coins; 3,500 Construction XP, 2,000 Woodcutting XP."
 },
 {
  "id": "quest_harbor_fever",
  "title": "Quest: Harbor Fever",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Harbor Fever is a Experienced complexity, Medium length quest taking 30m. Requirements: Agility 42, Crafting 45, Smithing 50, quests: Pirate S Hoard, Spirits Bargain. Rewards: 10,000 coins; 7,000 Agility XP, 7,000 Crafting XP, 7,000 Smithing XP."
 },
 {
  "id": "quest_heirs_of_the_sun",
  "title": "Quest: Heirs of the Sun",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Heirs of the Sun is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_clock_spire",
  "title": "Quest: Clock Spire",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Clock Spire is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_frost_war",
  "title": "Quest: Frost War",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Frost War is a Intermediate complexity, Medium length quest taking 23m. Requirements: Hunter 10, Agility 30, Crafting 30, Construction 34, Thieving 15. Rewards: 5,000 coins; 5,000 Agility XP, 1,500 Construction XP, 2,000 Crafting XP, 1,500 Hunter XP, 1,500 Thieving XP."
 },
 {
  "id": "quest_desert_correspondence",
  "title": "Quest: Desert Correspondence",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Desert Correspondence is a Master complexity, Medium length quest taking 1.3h. Requirements: quests: Icthlarin S Young Aide, Heir Ali Rescue. Rewards: 25,000 coins; 2,000 Thieving XP, 14,000 Combat XP."
 },
 {
  "id": "quest_chef_s_assistant",
  "title": "Quest: Chef's Assistant",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Chef's Assistant is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 300 Cooking XP."
 },
 {
  "id": "quest_fenkenstrain_s_creation",
  "title": "Quest: Fenkenstrain's Creation",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Fenkenstrain's Creation is a Intermediate complexity, Medium length quest taking 23m. Requirements: Crafting 20, Thieving 25, quests: The Wandering Spirit, Warden In Peril. Rewards: 5,000 coins; 1,000 Thieving XP."
 },
 {
  "id": "quest_present_concerns",
  "title": "Quest: Present Concerns",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Present Concerns is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Agility XP."
 },
 {
  "id": "quest_shadows_of_hallowvale",
  "title": "Quest: Shadows of Hallowvale",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Shadows of Hallowvale is a Intermediate complexity, Long length quest taking 45m. Requirements: Construction 5, Mining 20, Thieving 22, Agility 26, Crafting 32, Magic 33, Strength 40, quests: Helping The Myreque. Rewards: 5,000 coins; 7,000 Agility XP, 2,000 Construction XP, 6,000 Thieving XP."
 },
 {
  "id": "quest_doom_plateau",
  "title": "Quest: Doom Plateau",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Doom Plateau is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 3,000 Attack XP."
 },
 {
  "id": "quest_doom_to_the_dorgeshuun",
  "title": "Quest: Doom To the Dorgeshuun",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Doom To the Dorgeshuun is a Intermediate complexity, Medium length quest taking 23m. Requirements: Agility 23, Thieving 23, quests: The Forsaken Tribe. Rewards: 5,000 coins; 2,000 Ranged XP, 2,000 Thieving XP."
 },
 {
  "id": "quest_guardian_of_varrock",
  "title": "Quest: Guardian of Varrock",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Guardian of Varrock is a Experienced complexity, Medium length quest taking 30m. Requirements: Hunter 55, Smithing 52, Agility 50, Thieving 50, quests: The Grove Of Doom, Aegis Of Arrav, Kin Crest. Rewards: 10,000 coins; 15,000 Mining XP, 10,000 Smithing XP, 10,000 Hunter XP."
 },
 {
  "id": "quest_fiend_slayer",
  "title": "Quest: Fiend Slayer",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Fiend Slayer is a Novice complexity, Medium length quest taking 15m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_sunscar_treasure_i",
  "title": "Quest: Sunscar Treasure I",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sunscar Treasure I is a Master complexity, Very Long length quest taking 5h. Requirements: Thieving 53, Firemaking 50, Magic 50, Slayer 10, quests: The Traveler Trap, Warden In Peril, Sanctum Of Ikov, The Excavation Grounds. Rewards: 25,000 coins; 20,000 Magic XP."
 },
 {
  "id": "quest_sunscar_treasure_ii_the_fallen_empire",
  "title": "Quest: Sunscar Treasure II the Fallen Empire",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sunscar Treasure II the Fallen Empire is a Grandmaster complexity, Very Long length quest taking 10h. Requirements: Firemaking 75, Magic 75, Thieving 70, Herblore 62, Runecraft 60, Construction 60, quests: Mysteries Of The North, The Grove Of Doom, Beneath Ice Peak, Sunscar Treasure I, Sanctum Of The Eye, Enakhra S Sorrow. Rewards: 50,000 coins; 300,000 XP in a skill of your choice."
 },
 {
  "id": "quest_cunning_intellects",
  "title": "Quest: Cunning Intellects",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Cunning Intellects is a Experienced complexity, Short length quest taking 10m. Requirements: Smithing 65, Fletching 50, Runecraft 50, quests: Brute Stronghold, Doric S Duty, Hunted. Rewards: 10,000 coins; 5,000 Fletching XP, 5,000 Runecraft XP, 6,500 Smithing XP."
 },
 {
  "id": "quest_doric_s_duty",
  "title": "Quest: Doric's Duty",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Doric's Duty is a Novice complexity, Short length quest taking 5m. Requirements: Mining 15. Rewards: 1,000 coins; 1,300 Mining XP."
 },
 {
  "id": "quest_dragon_slayer_i",
  "title": "Quest: Dragon Slayer I",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Dragon Slayer I is a Experienced complexity, Long length quest taking 1h. Requirements: 32 quest points. Rewards: 10,000 coins; 18,650 Strength XP, 18,650 Defence XP; unlocks: Anti Dragon Shield."
 },
 {
  "id": "quest_dragon_slayer_ii",
  "title": "Quest: Dragon Slayer II",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Dragon Slayer II is a Grandmaster complexity, Very Long length quest taking 10h. Requirements: Magic 75, Smithing 70, Mining 68, Crafting 62, Agility 60, Thieving 60, Construction 50, Hitpoints 50, 200 quest points, quests: A Trail Of Two Cats, Beast Magnetism, Legacies Quest, Vision Mentor, Skeletal Passage, Essences Ahoy. Rewards: 50,000 coins; 25,000 Smithing XP, 15,000 Mining XP, 15,000 Agility XP, 15,000 Thieving XP; unlocks: Ava S Assembler."
 },
 {
  "id": "quest_vision_mentor",
  "title": "Quest: Vision Mentor",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Vision Mentor is a Master complexity, Short length quest taking 25m. Requirements: combat level 85, quests: Moon Diplomacy, Eadgar S Gambit. Rewards: 25,000 coins; 15,000 Hitpoints XP, 10,000 Magic XP."
 },
 {
  "id": "quest_verdant_ritual",
  "title": "Quest: Verdant Ritual",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Verdant Ritual is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 250 Herblore XP."
 },
 {
  "id": "quest_stonekin_cannon",
  "title": "Quest: Stonekin Cannon",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Stonekin Cannon is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 750 Crafting XP."
 },
 {
  "id": "quest_eadgar_s_gambit",
  "title": "Quest: Eadgar's Gambit",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Eadgar's Gambit is a Experienced complexity, Medium length quest taking 30m. Requirements: Herblore 31, quests: Brute Stronghold. Rewards: 10,000 coins; 11,000 Herblore XP."
 },
 {
  "id": "quest_skyhawks_peak",
  "title": "Quest: Skyhawks Peak",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Skyhawks Peak is a Novice complexity, Medium length quest taking 15m. Requirements: Hunter 27. Rewards: 1,000 coins; 2,500 Hunter XP."
 },
 {
  "id": "quest_arcane_workshop_i",
  "title": "Quest: Arcane Workshop I",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Arcane Workshop I is a Novice complexity, Short length quest taking 5m. Requirements: Mining 20, Smithing 20, Crafting 20. Rewards: 1,000 coins; 5,000 Crafting XP, 5,000 Smithing XP."
 },
 {
  "id": "quest_arcane_workshop_ii",
  "title": "Quest: Arcane Workshop II",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Arcane Workshop II is a Intermediate complexity, Short length quest taking 8m. Requirements: Smithing 30, Magic 20, quests: Arcane Workshop I. Rewards: 5,000 coins; 7,500 Smithing XP, 7,500 Crafting XP."
 },
 {
  "id": "quest_enakhra_s_sorrow",
  "title": "Quest: Enakhra's Sorrow",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Enakhra's Sorrow is a Experienced complexity, Medium length quest taking 30m. Requirements: Crafting 50, Firemaking 45, Prayer 43, Magic 39. Rewards: 10,000 coins; 7,000 Crafting XP, 7,000 Firemaking XP, 7,000 Magic XP, 7,000 Mining XP."
 },
 {
  "id": "quest_illuminated_expedition",
  "title": "Quest: Illuminated Expedition",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Illuminated Expedition is a Intermediate complexity, Short length quest taking 8m. Requirements: Firemaking 20, Farming 30, Crafting 36. Rewards: 5,000 coins; 2,000 Crafting XP, 3,000 Farming XP, 4,000 Firemaking XP, 1,500 Woodcutting XP."
 },
 {
  "id": "quest_ernest_and_the_fowl_curse",
  "title": "Quest: Ernest and the Fowl Curse",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Ernest and the Fowl Curse is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_creed_of_arceuus",
  "title": "Quest: Creed of Arceuus",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Creed of Arceuus is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 500 Magic XP, 500 Prayer XP."
 },
 {
  "id": "quest_feytale_i_growing_pains",
  "title": "Quest: Feytale I Growing Pains",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Feytale I Growing Pains is a Experienced complexity, Medium length quest taking 30m. Requirements: quests: Wild Spirit, Forsaken City. Rewards: 10,000 coins; 3,500 Farming XP, 2,000 Attack XP, 1,000 Magic XP."
 },
 {
  "id": "quest_feytale_ii_cure_a_queen",
  "title": "Quest: Feytale II Cure A Queen",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Feytale II Cure A Queen is a Experienced complexity, Short length quest taking 10m. Requirements: Thieving 40, Farming 49, Herblore 57. Rewards: 10,000 coins; 2,500 Thieving XP, 3,500 Herblore XP."
 },
 {
  "id": "quest_kin_crest",
  "title": "Quest: Kin Crest",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Kin Crest is a Experienced complexity, Medium length quest taking 30m. Requirements: Mining 40, Smithing 40, Crafting 40, Magic 59. Rewards: 10,000 coins; 3,125 Mining XP, 3,125 Smithing XP, 3,125 Crafting XP, 3,125 Magic XP."
 },
 {
  "id": "quest_duel_arena",
  "title": "Quest: Duel Arena",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Duel Arena is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 12,175 Attack XP, 2,175 Thieving XP."
 },
 {
  "id": "quest_angler_contest",
  "title": "Quest: Angler Contest",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Angler Contest is a Novice complexity, Short length quest taking 5m. Requirements: Fishing 10. Rewards: 1,000 coins; 2,437 Fishing XP."
 },
 {
  "id": "quest_unforgotten_story",
  "title": "Quest: Unforgotten Story",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Unforgotten Story is a Intermediate complexity, Medium length quest taking 23m. Requirements: Cooking 22, Farming 17, quests: Angler Contest, The Giant Stonekin. Rewards: 5,000 coins; 5,000 Cooking XP, 5,000 Farming XP."
 },
 {
  "id": "quest_grove_of_tranquillity",
  "title": "Quest: Grove of Tranquillity",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Grove of Tranquillity is a Intermediate complexity, Long length quest taking 45m. Requirements: Farming 25, quests: Fenkenstrain S Creation. Rewards: 5,000 coins; 5,000 Farming XP."
 },
 {
  "id": "quest_gertrude_s_lost_cat",
  "title": "Quest: Gertrude's Lost Cat",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Gertrude's Lost Cat is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,525 Cooking XP."
 },
 {
  "id": "quest_staying_ahead",
  "title": "Quest: Staying Ahead",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Staying Ahead is a Novice complexity, Short length quest taking 5m. Requirements: Crafting 30, Construction 26. Rewards: 1,000 coins; 4,000 Crafting XP, 3,200 Construction XP."
 },
 {
  "id": "quest_essences_ahoy",
  "title": "Quest: Essences Ahoy",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Essences Ahoy is a Intermediate complexity, Medium length quest taking 23m. Requirements: Agility 25, Cooking 20, quests: Warden In Peril. Rewards: 5,000 coins; 2,400 Prayer XP."
 },
 {
  "id": "quest_gloomkin_diplomacy",
  "title": "Quest: Gloomkin Diplomacy",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Gloomkin Diplomacy is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Crafting XP."
 },
 {
  "id": "quest_farewell_grubby",
  "title": "Quest: Farewell, Grubby",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Farewell, Grubby is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Herblore XP."
 },
 {
  "id": "quest_gloam_tales",
  "title": "Quest: Gloam Tales",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Gloam Tales is a Master complexity, Medium length quest taking 1.3h. Requirements: Woodcutting 71, Thieving 58, Herblore 52, Farming 45, Agility 59, quests: Hex S House. Rewards: 25,000 coins; 4,000 Farming XP, 5,000 Herblore XP, 6,000 Thieving XP, 6,000 Agility XP, 14,000 Woodcutting XP."
 },
 {
  "id": "quest_cursed_mine",
  "title": "Quest: Cursed Mine",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Cursed Mine is a Experienced complexity, Medium length quest taking 30m. Requirements: Agility 15, Crafting 35, quests: Warden In Peril. Rewards: 10,000 coins; 22,000 Strength XP."
 },
 {
  "id": "quest_hazeel_conspiracy",
  "title": "Quest: Hazeel Conspiracy",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Hazeel Conspiracy is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,500 Thieving XP."
 },
 {
  "id": "quest_champions_quest",
  "title": "Quest: Champions Quest",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Champions Quest is a Experienced complexity, Long length quest taking 1h. Requirements: Cooking 53, Fishing 53, Mining 50, Herblore 25, 55 quest points, quests: Merlin S Shard, Dragon Slayer I, Aegis Of Arrav, Forsaken City. Rewards: 10,000 coins; 3,075 Attack XP, 3,075 Defence XP, 3,075 Strength XP, 3,075 Hitpoints XP, 2,075 Ranged XP, 2,725 Firemaking XP, 2,725 Fishing XP, 2,825 Cooking XP, 2,257 Smithing XP, 2,575 Mining XP, 1,325 Herblore XP."
 },
 {
  "id": "quest_sacred_grail",
  "title": "Quest: Sacred Grail",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sacred Grail is a Intermediate complexity, Medium length quest taking 23m. Requirements: Attack 20, quests: Merlin S Shard. Rewards: 5,000 coins; 15,300 Defence XP, 11,000 Prayer XP."
 },
 {
  "id": "quest_terror_from_the_deep",
  "title": "Quest: Terror From the Deep",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Terror From the Deep is a Experienced complexity, Short length quest taking 10m. Requirements: Agility 35. Rewards: 10,000 coins; 4,662 Magic XP, 4,662 Ranged XP, 4,662 Strength XP."
 },
 {
  "id": "quest_icthlarin_s_young_aide",
  "title": "Quest: Icthlarin's Young Aide",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Icthlarin's Young Aide is a Intermediate complexity, Medium length quest taking 23m. Requirements: quests: Gertrude S Lost Cat. Rewards: 5,000 coins; 4,000 Agility XP, 4,000 Prayer XP, 4,000 Thieving XP."
 },
 {
  "id": "quest_sprite_catcher",
  "title": "Quest: Sprite Catcher",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sprite Catcher is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 875 Magic XP."
 },
 {
  "id": "quest_helping_the_myreque",
  "title": "Quest: Helping the Myreque",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Helping the Myreque is a Intermediate complexity, Medium length quest taking 23m. Requirements: Crafting 25, Mining 15, Magic 7, quests: Hunt For The Myreque. Rewards: 5,000 coins; 2,000 Attack XP, 2,000 Defence XP, 2,000 Strength XP, 2,000 Hitpoints XP, 2,000 Crafting XP."
 },
 {
  "id": "quest_hunt_for_the_myreque",
  "title": "Quest: Hunt for the Myreque",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Hunt for the Myreque is a Intermediate complexity, Short length quest taking 8m. Requirements: Agility 25, quests: Wild Spirit. Rewards: 5,000 coins; 600 Attack XP, 600 Defence XP, 600 Strength XP, 600 Hitpoints XP, 600 Agility XP."
 },
 {
  "id": "quest_wildwood_potion",
  "title": "Quest: Wildwood Potion",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Wildwood Potion is a Novice complexity, Short length quest taking 5m. Requirements: Herblore 3, quests: Verdant Ritual. Rewards: 1,000 coins; 775 Herblore XP."
 },
 {
  "id": "quest_crown_s_ransom",
  "title": "Quest: Crown's Ransom",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Crown's Ransom is a Experienced complexity, Medium length quest taking 30m. Requirements: Defence 65, Magic 45, quests: Obsidian Sentinels Fortress, One Modest Favor, Bloodline Mystery, Sacred Grail. Rewards: 10,000 coins; 20,000 Defence XP, 5,000 Magic XP."
 },
 {
  "id": "quest_sanctum_of_tarn_razorlor",
  "title": "Quest: Sanctum of Tarn Razorlor",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sanctum of Tarn Razorlor is a Experienced complexity, Short length quest taking 10m. Requirements: Slayer 50, quests: Cursed Mine. Rewards: 10,000 coins; 5,000 Slayer XP."
 },
 {
  "id": "quest_realm_of_the_goblins",
  "title": "Quest: Realm of the Goblins",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Realm of the Goblins is a Experienced complexity, Medium length quest taking 30m. Requirements: Agility 38, Fishing 40, Thieving 45, Herblore 48, quests: Another Shard Of H A M. Rewards: 10,000 coins; 3,000 Agility XP, 3,000 Fishing XP, 3,000 Thieving XP, 3,000 Herblore XP."
 },
 {
  "id": "quest_legacies_quest",
  "title": "Quest: Legacies Quest",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Legacies Quest is a Master complexity, Very Long length quest taking 5h. Requirements: Agility 50, Crafting 50, Smithing 50, Woodcutting 50, Prayer 50, Magic 50, Thieving 50, Mining 50, Herblore 50, 107 quest points, quests: Underpath Pass, Cascade Quest, Champions Quest, Shroud Village, Kin Crest. Rewards: 25,000 coins; 30,600 XP in a skill of your choice."
 },
 {
  "id": "quest_forsaken_city",
  "title": "Quest: Forsaken City",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Forsaken City is a Experienced complexity, Short length quest taking 10m. Requirements: Crafting 31, Woodcutting 36. Rewards: 10,000 coins; 6,250 Crafting XP, 6,250 Woodcutting XP; unlocks: Dragon Dagger."
 },
 {
  "id": "quest_moon_diplomacy",
  "title": "Quest: Moon Diplomacy",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Moon Diplomacy is a Experienced complexity, Long length quest taking 1h. Requirements: Crafting 61, Mining 60, Woodcutting 55, Firemaking 49, Herblore 5, Magic 65, quests: The Fremennik Challenges, Shroud Village, Forsaken City. Rewards: 10,000 coins; 5,000 Magic XP, 5,000 Runecraft XP."
 },
 {
  "id": "quest_forging_friends_with_my_arm",
  "title": "Quest: Forging Friends With My Arm",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Forging Friends With My Arm is a Master complexity, Medium length quest taking 1.3h. Requirements: Agility 68, Firemaking 66, Mining 72, Construction 35, quests: My Arm S Grand Expedition, Romeo And Juliet, Frost War. Rewards: 25,000 coins; 10,000 Agility XP, 5,000 Firemaking XP, 10,000 Mining XP, 2,000 Construction XP."
 },
 {
  "id": "quest_forging_history",
  "title": "Quest: Forging History",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Forging History is a Intermediate complexity, Medium length quest taking 23m. Requirements: quests: Warden In Peril. Rewards: 5,000 coins; 1,000 Crafting XP, 1,000 Prayer XP."
 },
 {
  "id": "quest_merlin_s_shard",
  "title": "Quest: Merlin's Shard",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Merlin's Shard is a Intermediate complexity, Medium length quest taking 23m. Requirements: none. Rewards: 5,000 coins; 5,000 Hitpoints XP."
 },
 {
  "id": "quest_misthalin_enigma",
  "title": "Quest: Misthalin Enigma",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Misthalin Enigma is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 600 Crafting XP."
 },
 {
  "id": "quest_a_monk_s_ally",
  "title": "Quest: A Monk's Ally",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "A Monk's Ally is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 2,000 Woodcutting XP."
 },
 {
  "id": "quest_gorilla_slayer_i",
  "title": "Quest: Gorilla Slayer I",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Gorilla Slayer I is a Master complexity, Long length quest taking 2.5h. Requirements: quests: Grove Gnome Village, The Grand Grove. Rewards: 25,000 coins; 100,000 Combat XP; unlocks: Dragon Scimitar."
 },
 {
  "id": "quest_gorilla_slayer_ii",
  "title": "Quest: Gorilla Slayer II",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Gorilla Slayer II is a Grandmaster complexity, Very Long length quest taking 10h. Requirements: Crafting 70, Agility 69, Hunter 60, Thieving 55, Firemaking 60, Slayer 60, quests: Glouphrie S Gaze, Illuminated Expedition, Banquet For Disaster, Gorilla Slayer I, Brute Stronghold, Wardspire. Rewards: 50,000 coins; 20,000 Agility XP, 15,000 Thieving XP, 25,000 Slayer XP, 15,000 Hunter XP."
 },
 {
  "id": "quest_peak_daughter",
  "title": "Quest: Peak Daughter",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Peak Daughter is a Intermediate complexity, Medium length quest taking 23m. Requirements: Agility 20. Rewards: 5,000 coins; 1,000 Attack XP, 2,000 Prayer XP."
 },
 {
  "id": "quest_mourning_s_finale_part_i",
  "title": "Quest: Mourning's Finale Part I",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Mourning's Finale Part I is a Master complexity, Long length quest taking 2.5h. Requirements: Ranged 60, Thieving 50, quests: Big Chompy Wing Hunting, Wandering Elves. Rewards: 25,000 coins; 25,000 Hitpoints XP, 25,000 Thieving XP."
 },
 {
  "id": "quest_mourning_s_finale_part_ii",
  "title": "Quest: Mourning's Finale Part II",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Mourning's Finale Part II is a Master complexity, Long length quest taking 2.5h. Requirements: quests: Mourning S Finale Part I. Rewards: 25,000 coins; 20,000 Agility XP."
 },
 {
  "id": "quest_bloodline_mystery",
  "title": "Quest: Bloodline Mystery",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Bloodline Mystery is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,406 Crafting XP."
 },
 {
  "id": "quest_my_arm_s_grand_expedition",
  "title": "Quest: My Arm's Grand Expedition",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "My Arm's Grand Expedition is a Intermediate complexity, Medium length quest taking 23m. Requirements: Farming 60, Herblore 10, quests: Eadgar S Gambit, The Rivalry. Rewards: 5,000 coins; 5,000 Farming XP, 10,000 Herblore XP."
 },
 {
  "id": "quest_wild_spirit",
  "title": "Quest: Wild Spirit",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Wild Spirit is a Novice complexity, Medium length quest taking 15m. Requirements: quests: Warden In Peril. Rewards: 1,000 coins; 2,000 Crafting XP, 3,000 Hitpoints XP, 2,000 Defence XP."
 },
 {
  "id": "quest_starwatch_quest",
  "title": "Quest: Starwatch Quest",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Starwatch Quest is a Novice complexity, Medium length quest taking 15m. Requirements: Crafting 10. Rewards: 1,000 coins; 1,000 Crafting XP."
 },
 {
  "id": "quest_olaf_s_journey",
  "title": "Quest: Olaf's Journey",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Olaf's Journey is a Intermediate complexity, Short length quest taking 8m. Requirements: Firemaking 40, Woodcutting 50. Rewards: 5,000 coins; 12,000 Defence XP."
 },
 {
  "id": "quest_one_modest_favor",
  "title": "Quest: One Modest Favor",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "One Modest Favor is a Experienced complexity, Very Long length quest taking 2h. Requirements: Agility 36, Crafting 25, Herblore 18, Smithing 30, quests: Sigil Mysteries, Shroud Village. Rewards: 10,000 coins; 20,000 XP in a skill of your choice."
 },
 {
  "id": "quest_road_of_glouphrie",
  "title": "Quest: Road of Glouphrie",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Road of Glouphrie is a Experienced complexity, Medium length quest taking 30m. Requirements: Strength 60, Slayer 56, Thieving 56, Ranged 47, Agility 45, quests: Glouphrie S Gaze. Rewards: 10,000 coins; 30,000 Strength XP, 20,000 Slayer XP, 5,000 Thieving XP, 5,000 Ranged XP, 5,000 Magic XP."
 },
 {
  "id": "quest_hazardous_moons",
  "title": "Quest: Hazardous Moons",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Hazardous Moons is a Master complexity, Medium length quest taking 1.3h. Requirements: Slayer 48, Fishing 20, Hunter 20, Runecraft 20, combat level 75, quests: Twilight S Vow. Rewards: 25,000 coins; 40,000 Hunter XP, 40,000 Runecraft XP, 40,000 Fishing XP."
 },
 {
  "id": "quest_pirate_s_hoard",
  "title": "Quest: Pirate's Hoard",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Pirate's Hoard is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_blight_city",
  "title": "Quest: Blight City",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Blight City is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 2,425 Mining XP."
 },
 {
  "id": "quest_warden_in_peril",
  "title": "Quest: Warden In Peril",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Warden In Peril is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,406 Prayer XP."
 },
 {
  "id": "quest_heir_ali_rescue",
  "title": "Quest: Heir Ali Rescue",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Heir Ali Rescue is a Novice complexity, Medium length quest taking 15m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_rag_and_bone_collector_i",
  "title": "Quest: Rag and Bone Collector I",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Rag and Bone Collector I is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 500 Prayer XP, 500 Slayer XP."
 },
 {
  "id": "quest_rag_and_bone_collector_ii",
  "title": "Quest: Rag and Bone Collector II",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Rag and Bone Collector II is a Intermediate complexity, Long length quest taking 45m. Requirements: Slayer 40, quests: Fenkenstrain S Creation, Rag And Bone Collector I, Bogre Flesh Eaters. Rewards: 5,000 coins; 5,000 Prayer XP."
 },
 {
  "id": "quest_vermin_hunters",
  "title": "Quest: Vermin Hunters",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Vermin Hunters is a Intermediate complexity, Medium length quest taking 23m. Requirements: quests: Icthlarin S Young Aide, Gertrude S Lost Cat. Rewards: 5,000 coins; 4,500 Thieving XP."
 },
 {
  "id": "quest_banquet_for_disaster",
  "title": "Quest: Banquet For Disaster",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Banquet For Disaster is a Special complexity, Very Long length quest taking 10h. Requirements: Cooking 70, Agility 48, Mining 50, Thieving 53, Magic 59, Smithing 40, 175 quest points, quests: Terror From The Deep, Umbral Of The Storm, Sunscar Treasure I, Chef S Assistant, Gloomkin Diplomacy, Angler Contest, Gertrude S Lost Cat. Rewards: 50,000 coins; 12,500 Cooking XP, 12,500 Agility XP, 12,500 Mining XP, 12,500 Thieving XP, 12,500 Magic XP, 12,500 Smithing XP; unlocks: Cryptbound Gloves."
 },
 {
  "id": "quest_mustering_drive",
  "title": "Quest: Mustering Drive",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Mustering Drive is a Novice complexity, Short length quest taking 5m. Requirements: 12 quest points, quests: Obsidian Sentinels Fortress, Verdant Ritual. Rewards: 1,000 coins; 1,000 Prayer XP, 1,000 Agility XP, 1,000 Herblore XP."
 },
 {
  "id": "quest_royal_assassination",
  "title": "Quest: Royal Assassination",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Royal Assassination is a Master complexity, Long length quest taking 2.5h. Requirements: Agility 56, Crafting 10, quests: Underpath Pass. Rewards: 25,000 coins; 13,750 Agility XP."
 },
 {
  "id": "quest_romeo_and_juliet",
  "title": "Quest: Romeo and Juliet",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Romeo and Juliet is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_wandering_elves",
  "title": "Quest: Wandering Elves",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Wandering Elves is a Experienced complexity, Short length quest taking 10m. Requirements: quests: Cascade Quest, Royal Assassination. Rewards: 10,000 coins; 10,000 Strength XP."
 },
 {
  "id": "quest_crown_complications",
  "title": "Quest: Crown Complications",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Crown Complications is a Experienced complexity, Medium length quest taking 30m. Requirements: Agility 40, Slayer 40, quests: Crown Of Miscellania. Rewards: 10,000 coins; 5,000 Agility XP, 2,000 Hitpoints XP."
 },
 {
  "id": "quest_spirits_bargain",
  "title": "Quest: Spirits Bargain",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Spirits Bargain is a Experienced complexity, Medium length quest taking 30m. Requirements: Crafting 42, Farming 40, Prayer 47, Slayer 42, Fishing 40, quests: Bogre Flesh Eaters, Warden In Peril. Rewards: 10,000 coins; 7,000 Farming XP, 7,000 Fishing XP, 7,000 Prayer XP."
 },
 {
  "id": "quest_sigil_mysteries",
  "title": "Quest: Sigil Mysteries",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sigil Mysteries is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_sting_catcher",
  "title": "Quest: Sting Catcher",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sting Catcher is a Intermediate complexity, Short length quest taking 8m. Requirements: none. Rewards: 5,000 coins; 6,625 Strength XP."
 },
 {
  "id": "quest_tide_slug",
  "title": "Quest: Tide Slug",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Tide Slug is a Novice complexity, Short length quest taking 5m. Requirements: Firemaking 30. Rewards: 1,000 coins; 7,175 Fishing XP."
 },
 {
  "id": "quest_mysteries_of_the_north",
  "title": "Quest: Mysteries of the North",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Mysteries of the North is a Master complexity, Medium length quest taking 1.3h. Requirements: Agility 69, Thieving 64, Hunter 56, quests: Forging History, Hazeel Conspiracy. Rewards: 25,000 coins; 60,000 Agility XP, 40,000 Thieving XP, 40,000 Hunter XP."
 },
 {
  "id": "quest_wraiths_of_mortton",
  "title": "Quest: Wraiths of Mortton",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Wraiths of Mortton is a Intermediate complexity, Short length quest taking 8m. Requirements: Crafting 20, Herblore 15, Firemaking 5. Rewards: 5,000 coins; 2,000 Crafting XP, 2,000 Herblore XP, 2,000 Firemaking XP."
 },
 {
  "id": "quest_umbral_of_the_storm",
  "title": "Quest: Umbral of the Storm",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Umbral of the Storm is a Intermediate complexity, Medium length quest taking 23m. Requirements: Crafting 30, quests: Fiend Slayer, The Stone Guardian. Rewards: 5,000 coins; 10,000 Combat XP."
 },
 {
  "id": "quest_wool_herder",
  "title": "Quest: Wool Herder",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Wool Herder is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_wool_shearer",
  "title": "Quest: Wool Shearer",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Wool Shearer is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 150 Crafting XP."
 },
 {
  "id": "quest_aegis_of_arrav",
  "title": "Quest: Aegis of Arrav",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Aegis of Arrav is a Novice complexity, Medium length quest taking 15m. Requirements: none. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_shroud_village",
  "title": "Quest: Shroud Village",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Shroud Village is a Experienced complexity, Medium length quest taking 30m. Requirements: Agility 32, Crafting 20, quests: Wildwood Potion. Rewards: 10,000 coins; 3,875 Crafting XP."
 },
 {
  "id": "quest_vices_of_the_father",
  "title": "Quest: Vices of the Father",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Vices of the Father is a Master complexity, Long length quest taking 2.5h. Requirements: Woodcutting 62, Fletching 60, Crafting 56, Agility 52, Slayer 50, Smithing 50, Magic 49, quests: A Savor Of Hope, Nightborn Slayer. Rewards: 25,000 coins; 150,000 Attack XP."
 },
 {
  "id": "quest_stone_skippers",
  "title": "Quest: Stone Skippers",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Stone Skippers is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 500 Agility XP, 500 Fishing XP."
 },
 {
  "id": "quest_slumbering_giants",
  "title": "Quest: Slumbering Giants",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Slumbering Giants is a Intermediate complexity, Short length quest taking 8m. Requirements: Smithing 15. Rewards: 5,000 coins; 6,000 Smithing XP."
 },
 {
  "id": "quest_hymn_of_the_elves",
  "title": "Quest: Hymn of the Elves",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Hymn of the Elves is a Grandmaster complexity, Very Long length quest taking 10h. Requirements: Agility 70, Construction 70, Farming 70, Herblore 70, Hunter 70, Mining 70, Smithing 70, Woodcutting 70, quests: Mourning S Finale Part Ii, Glouphrie S Gaze, Enakhra S Sorrow, Forging History. Rewards: 50,000 coins; 20,000 Agility XP, 20,000 Construction XP, 20,000 Farming XP, 20,000 Herblore XP, 20,000 Hunter XP, 20,000 Mining XP, 20,000 Smithing XP, 20,000 Woodcutting XP."
 },
 {
  "id": "quest_essences_of_the_elid",
  "title": "Quest: Essences of the Elid",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Essences of the Elid is a Intermediate complexity, Medium length quest taking 23m. Requirements: Magic 33, Ranged 37, Mining 37, Thieving 37. Rewards: 5,000 coins; 8,000 Magic XP, 8,000 Ranged XP, 8,000 Thieving XP."
 },
 {
  "id": "quest_silverwing_hymn",
  "title": "Quest: Silverwing Hymn",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Silverwing Hymn is a Master complexity, Medium length quest taking 1.3h. Requirements: Magic 66, Cooking 62, Fishing 62, Smithing 45, Firemaking 42, Crafting 40, quests: Grove Of Tranquillity, One Modest Favor. Rewards: 25,000 coins; 15,000 Magic XP, 10,000 Prayer XP, 10,000 Fishing XP."
 },
 {
  "id": "quest_tai_bwo_wannai_three",
  "title": "Quest: Tai Bwo Wannai Three",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Tai Bwo Wannai Three is a Intermediate complexity, Medium length quest taking 23m. Requirements: Agility 15, Cooking 30, Fishing 5, quests: Wildwood Potion. Rewards: 5,000 coins; 5,000 Cooking XP, 5,000 Fishing XP."
 },
 {
  "id": "quest_story_of_the_righteous",
  "title": "Quest: Story of the Righteous",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Story of the Righteous is a Novice complexity, Short length quest taking 5m. Requirements: Strength 16, Mining 10. Rewards: 1,000 coins; 500 Strength XP, 500 Mining XP."
 },
 {
  "id": "quest_echoes_of_guthix",
  "title": "Quest: Echoes of Guthix",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Echoes of Guthix is a Novice complexity, Short length quest taking 5m. Requirements: Firemaking 49, Crafting 20, Mining 20, 43 quest points. Rewards: 1,000 coins; 1,000 Crafting XP, 1,000 Mining XP, 1,000 Firemaking XP."
 },
 {
  "id": "quest_sanctum_of_ikov",
  "title": "Quest: Sanctum of Ikov",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sanctum of Ikov is a Experienced complexity, Medium length quest taking 30m. Requirements: Thieving 42, Ranged 40. Rewards: 10,000 coins; 10,500 Ranged XP, 8,000 Fletching XP."
 },
 {
  "id": "quest_sanctum_of_the_eye",
  "title": "Quest: Sanctum of the Eye",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Sanctum of the Eye is a Intermediate complexity, Medium length quest taking 23m. Requirements: Runecraft 10. Rewards: 5,000 coins; 5,000 Runecraft XP."
 },
 {
  "id": "quest_the_hex_of_arrav",
  "title": "Quest: The Hex of Arrav",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Hex of Arrav is a Master complexity, Medium length quest taking 1.3h. Requirements: Mining 64, Ranged 62, Thieving 62, Agility 61, Strength 58, Slayer 37, quests: Guardian Of Varrock, Brute Romance. Rewards: 25,000 coins; 35,000 XP in a skill of your choice."
 },
 {
  "id": "quest_the_excavation_grounds",
  "title": "Quest: The Excavation Grounds",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Excavation Grounds is a Intermediate complexity, Long length quest taking 45m. Requirements: Agility 10, Herblore 10, Thieving 25. Rewards: 5,000 coins; 15,300 Mining XP, 2,000 Herblore XP."
 },
 {
  "id": "quest_glouphrie_s_gaze",
  "title": "Quest: Glouphrie's Gaze",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Glouphrie's Gaze is a Intermediate complexity, Short length quest taking 8m. Requirements: Construction 5, Magic 46, Runecraft 22, quests: The Grand Grove. Rewards: 5,000 coins; 2,500 Construction XP, 12,000 Magic XP, 6,000 Runecraft XP."
 },
 {
  "id": "quest_the_rivalry",
  "title": "Quest: The Rivalry",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Rivalry is a Intermediate complexity, Medium length quest taking 23m. Requirements: Thieving 30. Rewards: 5,000 coins; 15,000 Thieving XP."
 },
 {
  "id": "quest_the_forsaken_spire",
  "title": "Quest: The Forsaken Spire",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Forsaken Spire is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 500 Mining XP, 500 Smithing XP."
 },
 {
  "id": "quest_the_fremennik_outcasts",
  "title": "Quest: The Fremennik Outcasts",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Fremennik Outcasts is a Master complexity, Long length quest taking 2.5h. Requirements: Crafting 65, Slayer 60, Smithing 60, Fishing 60, Runecraft 55, quests: The Fremennik Archipelago, Peak Daughter, Moon Diplomacy, Champions Quest. Rewards: 25,000 coins; 15,000 Crafting XP, 15,000 Slayer XP, 15,000 Smithing XP."
 },
 {
  "id": "quest_the_fremennik_archipelago",
  "title": "Quest: The Fremennik Archipelago",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Fremennik Archipelago is a Experienced complexity, Long length quest taking 1h. Requirements: Construction 20, Agility 40, Crafting 46, Woodcutting 56, quests: The Fremennik Challenges. Rewards: 10,000 coins; 5,000 Crafting XP, 10,000 Woodcutting XP."
 },
 {
  "id": "quest_the_fremennik_challenges",
  "title": "Quest: The Fremennik Challenges",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Fremennik Challenges is a Intermediate complexity, Medium length quest taking 23m. Requirements: Crafting 40, Fletching 40, Woodcutting 25. Rewards: 5,000 coins; 2,812 Agility XP, 2,812 Attack XP, 2,812 Crafting XP, 2,812 Defence XP, 2,812 Fishing XP, 2,812 Fletching XP, 2,812 Hitpoints XP, 2,812 Smithing XP, 2,812 Strength XP, 2,812 Thieving XP, 2,812 Woodcutting XP."
 },
 {
  "id": "quest_the_grove_of_doom",
  "title": "Quest: The Grove of Doom",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Grove of Doom is a Intermediate complexity, Short length quest taking 8m. Requirements: Farming 20. Rewards: 5,000 coins; 10,000 Farming XP."
 },
 {
  "id": "quest_the_giant_stonekin",
  "title": "Quest: The Giant Stonekin",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Giant Stonekin is a Intermediate complexity, Medium length quest taking 23m. Requirements: Crafting 12, Firemaking 16, Magic 14, Thieving 12. Rewards: 5,000 coins; 2,500 Crafting XP, 2,500 Firemaking XP, 1,500 Magic XP, 2,500 Mining XP, 2,500 Smithing XP, 2,500 Thieving XP."
 },
 {
  "id": "quest_the_stone_guardian",
  "title": "Quest: The Stone Guardian",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Stone Guardian is a Intermediate complexity, Medium length quest taking 23m. Requirements: Crafting 20, Thieving 25. Rewards: 5,000 coins; 1,000 Crafting XP, 1,000 Thieving XP."
 },
 {
  "id": "quest_the_grand_grove",
  "title": "Quest: The Grand Grove",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Grand Grove is a Intermediate complexity, Medium length quest taking 23m. Requirements: Agility 25. Rewards: 5,000 coins; 18,400 Attack XP, 7,900 Agility XP, 2,150 Magic XP."
 },
 {
  "id": "quest_the_palm_in_the_dunes",
  "title": "Quest: The Palm in the Dunes",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Palm in the Dunes is a Intermediate complexity, Medium length quest taking 23m. Requirements: Crafting 49, Thieving 17. Rewards: 5,000 coins; 9,000 Crafting XP, 1,000 Thieving XP."
 },
 {
  "id": "quest_the_heart_of_shadows",
  "title": "Quest: The Heart of Shadows",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Heart of Shadows is a Master complexity, Long length quest taking 2.5h. Requirements: Agility 60, Thieving 55, Slayer 52, quests: Heirs Of The Sun, Twilight S Vow. Rewards: 25,000 coins; 15,000 Hunter XP, 10,000 Thieving XP, 10,000 Agility XP."
 },
 {
  "id": "quest_the_sentinels_sword",
  "title": "Quest: The Sentinels' Sword",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Sentinels' Sword is a Intermediate complexity, Medium length quest taking 23m. Requirements: Mining 10. Rewards: 5,000 coins; 12,725 Smithing XP."
 },
 {
  "id": "quest_the_forsaken_tribe",
  "title": "Quest: The Forsaken Tribe",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Forsaken Tribe is a Intermediate complexity, Medium length quest taking 23m. Requirements: Agility 13, Mining 17, Thieving 13, quests: Gloomkin Diplomacy. Rewards: 5,000 coins; 3,000 Mining XP."
 },
 {
  "id": "quest_the_thieves_queen",
  "title": "Quest: The Thieves' Queen",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Thieves' Queen is a Intermediate complexity, Short length quest taking 8m. Requirements: Thieving 20. Rewards: 5,000 coins; 2,000 Thieving XP."
 },
 {
  "id": "quest_the_wandering_spirit",
  "title": "Quest: The Wandering Spirit",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Wandering Spirit is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,125 Prayer XP."
 },
 {
  "id": "quest_the_croaking_tale_of_a_lily_pad_worker",
  "title": "Quest: The Croaking Tale of a Lily Pad Worker",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Croaking Tale of a Lily Pad Worker is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 500 Farming XP, 500 Fishing XP."
 },
 {
  "id": "quest_the_traveler_trap",
  "title": "Quest: The Traveler Trap",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "The Traveler Trap is a Intermediate complexity, Medium length quest taking 23m. Requirements: Fletching 10, Smithing 20. Rewards: 5,000 coins; 9,300 XP in a skill of your choice."
 },
 {
  "id": "quest_crown_of_miscellania",
  "title": "Quest: Crown of Miscellania",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Crown of Miscellania is a Intermediate complexity, Medium length quest taking 23m. Requirements: quests: The Giant Stonekin, Champions Quest. Rewards: 5,000 coins; 5,000 Hitpoints XP."
 },
 {
  "id": "quest_spire_of_life",
  "title": "Quest: Spire of Life",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Spire of Life is a Novice complexity, Short length quest taking 5m. Requirements: Construction 10. Rewards: 1,000 coins; 1,000 Construction XP."
 },
 {
  "id": "quest_grove_gnome_village",
  "title": "Quest: Grove Gnome Village",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Grove Gnome Village is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 11,450 Attack XP."
 },
 {
  "id": "quest_clan_totem",
  "title": "Quest: Clan Totem",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Clan Totem is a Intermediate complexity, Short length quest taking 8m. Requirements: Thieving 21. Rewards: 5,000 coins; 1,775 Thieving XP."
 },
 {
  "id": "quest_brute_romance",
  "title": "Quest: Brute Romance",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Brute Romance is a Experienced complexity, Medium length quest taking 30m. Requirements: Agility 28, quests: Brute Stronghold. Rewards: 10,000 coins; 8,000 Agility XP, 4,000 Strength XP."
 },
 {
  "id": "quest_brute_stronghold",
  "title": "Quest: Brute Stronghold",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Brute Stronghold is a Experienced complexity, Medium length quest taking 30m. Requirements: Agility 15, quests: Doom Plateau. Rewards: 10,000 coins; 12,500 Agility XP."
 },
 {
  "id": "quest_twilight_s_vow",
  "title": "Quest: Twilight's Vow",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Twilight's Vow is a Novice complexity, Short length quest taking 5m. Requirements: quests: Heirs Of The Sun. Rewards: 1,000 coins; 1,000 Hitpoints XP."
 },
 {
  "id": "quest_underpath_pass",
  "title": "Quest: Underpath Pass",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Underpath Pass is a Experienced complexity, Very Long length quest taking 2h. Requirements: Agility 25, quests: Chemical Danger. Rewards: 10,000 coins; 3,000 Agility XP, 3,000 Attack XP."
 },
 {
  "id": "quest_nightborn_slayer",
  "title": "Quest: Nightborn Slayer",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Nightborn Slayer is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 4,825 Attack XP."
 },
 {
  "id": "quest_taking_the_hound_for_a_walk",
  "title": "Quest: Taking the Hound for a Walk",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Taking the Hound for a Walk is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 1,000 Agility XP."
 },
 {
  "id": "quest_hunted",
  "title": "Quest: Hunted",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Hunted is a Intermediate complexity, Long length quest taking 45m. Requirements: 33 quest points, quests: Mustering Drive, Warden In Peril, The Forsaken Tribe. Rewards: 5,000 coins; 5,000 Hitpoints XP."
 },
 {
  "id": "quest_wardspire",
  "title": "Quest: Wardspire",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Wardspire is a Intermediate complexity, Long length quest taking 45m. Requirements: Magic 15, Thieving 15, Agility 25, Herblore 14, Mining 40. Rewards: 5,000 coins; 15,250 Magic XP."
 },
 {
  "id": "quest_cascade_quest",
  "title": "Quest: Cascade Quest",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Cascade Quest is a Intermediate complexity, Medium length quest taking 23m. Requirements: none. Rewards: 5,000 coins; 13,750 Attack XP, 13,750 Strength XP."
 },
 {
  "id": "quest_which_lies_beneath",
  "title": "Quest: Which Lies Beneath",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Which Lies Beneath is a Intermediate complexity, Medium length quest taking 23m. Requirements: Runecraft 35, Mining 42. Rewards: 5,000 coins; 8,000 Runecraft XP, 2,000 Defence XP."
 },
 {
  "id": "quest_when_guthix_sleeps",
  "title": "Quest: When Guthix Sleeps",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "When Guthix Sleeps is a Grandmaster complexity, Very Long length quest taking 10h. Requirements: Thieving 75, Firemaking 75, Magic 75, Agility 71, Farming 70, Herblore 70, Hunter 65, 265 quest points, quests: Mourning S Finale Part Ii, Guardian Of Varrock, Banquet For Disaster, Road Of Glouphrie, Legacies Quest, Crown S Ransom, Vision Mentor, Silverwing Hymn. Rewards: 50,000 coins; 400,000 XP in a skill of your choice."
 },
 {
  "id": "quest_hex_s_house",
  "title": "Quest: Hex's House",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Hex's House is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 6,325 Hitpoints XP."
 },
 {
  "id": "quest_hex_s_potion",
  "title": "Quest: Hex's Potion",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Hex's Potion is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 325 Magic XP."
 },
 {
  "id": "quest_cross_marks_the_spot",
  "title": "Quest: Cross Marks the Spot",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Cross Marks the Spot is a Novice complexity, Short length quest taking 5m. Requirements: none. Rewards: 1,000 coins; 300 XP in a skill of your choice."
 },
 {
  "id": "quest_bogre_flesh_eaters",
  "title": "Quest: Bogre Flesh Eaters",
  "tags": [
   "quest",
   "quests"
  ],
  "text": "Bogre Flesh Eaters is a Intermediate complexity, Medium length quest taking 23m. Requirements: Herblore 8, Ranged 30, Fletching 30, Smithing 4, quests: Wildwood Potion. Rewards: 5,000 coins; 2,000 Fletching XP, 2,000 Ranged XP, 2,000 Smithing XP, 2,000 Herblore XP."
 },
 {
  "id": "data_prayers",
  "title": "Prayer list: levels, effects and drain rates",
  "tags": [
   "prayer",
   "prayers"
  ],
  "text": "All prayers, with Prayer level required, effect and pool drain per minute. Thick Skin (level 1): +5% Defence, drains 3/min. Burst of Strength (level 4): +5% Strength, drains 3/min. Clarity of Thought (level 7): +5% Attack, drains 3/min. Sharp Eye (level 8): +5% Ranged, drains 3/min. Mystic Will (level 9): +5% Magical attack and defence, drains 3/min. Rock Skin (level 10): +10% Defence, drains 6/min. Superhuman Strength (level 13): +10% Strength, drains 6/min. Improved Reflexes (level 16): +10% Attack, drains 6/min. Hawk Eye (level 26): +10% Ranged, drains 6/min. Mystic Lore (level 27): +10% Magical attack and defence, drains 6/min. Steel Skin (level 28): +15% Defence, drains 12/min. Ultimate Strength (level 31): +15% Strength, drains 12/min. Incredible Reflexes (level 34): +15% Attack, drains 12/min. Protect from Magic (level 37): Blocks Magic damage, drains 20/min. Protect from Missiles (level 40): Blocks Ranged damage, drains 20/min. Protect from Melee (level 43): Blocks Melee damage, drains 20/min. Eagle Eye (level 44): +15% Ranged, drains 12/min. Chivalry (level 60): +15% Attack, +18% Strength, +20% Defence, drains 24/min. Piety (level 70): +20% Attack, +23% Strength, +25% Defence, drains 40/min. Rigour (level 74): +20% Ranged attack, +23% Ranged strength, +25% Defence, drains 40/min. Augury (level 77): +25% Magic, +25% Defence, drains 40/min."
 },
 {
  "id": "data_spells",
  "title": "Spellbook: spells, levels, damage and rune costs",
  "tags": [
   "magic",
   "spells",
   "spell",
   "runes"
  ],
  "text": "All combat spells. Wind Strike (Magic 1, strike): base damage 2, 5 base XP, runes 1 Air Rune + 1 Mind Rune. Water Strike (Magic 5, strike): base damage 4, 7 base XP, runes 1 Water Rune + 1 Air Rune + 1 Mind Rune. Earth Strike (Magic 9, strike): base damage 6, 9 base XP, runes 1 Earth Rune + 1 Air Rune + 1 Mind Rune. Fire Strike (Magic 13, strike): base damage 8, 11 base XP, runes 3 Fire Rune + 1 Air Rune + 1 Mind Rune. Wind Bolt (Magic 17, bolt): base damage 9, 13 base XP, runes 2 Air Rune + 1 Chaos Rune. Water Bolt (Magic 23, bolt): base damage 10, 16 base XP, runes 2 Water Rune + 2 Air Rune + 1 Chaos Rune. Earth Bolt (Magic 29, bolt): base damage 11, 19 base XP, runes 2 Earth Rune + 2 Air Rune + 1 Chaos Rune. Fire Bolt (Magic 35, bolt): base damage 12, 22 base XP, runes 5 Fire Rune + 2 Air Rune + 1 Chaos Rune. Wind Blast (Magic 41, blast): base damage 13, 25 base XP, runes 3 Air Rune + 1 Death Rune. Water Blast (Magic 47, blast): base damage 14, 28 base XP, runes 3 Water Rune + 3 Air Rune + 1 Death Rune. Earth Blast (Magic 53, blast): base damage 15, 31 base XP, runes 3 Earth Rune + 3 Air Rune + 1 Death Rune. Fire Blast (Magic 59, blast): base damage 16, 34 base XP, runes 5 Fire Rune + 3 Air Rune + 1 Death Rune. Wind Wave (Magic 62, wave): base damage 17, 36 base XP, runes 5 Air Rune + 1 Blood Rune. Water Wave (Magic 65, wave): base damage 18, 37 base XP, runes 5 Water Rune + 5 Air Rune + 1 Blood Rune. Earth Wave (Magic 70, wave): base damage 19, 40 base XP, runes 5 Earth Rune + 5 Air Rune + 1 Blood Rune. Fire Wave (Magic 75, wave): base damage 20, 42 base XP, runes 7 Fire Rune + 5 Air Rune + 1 Blood Rune. Wind Surge (Magic 81, surge): base damage 24, 36 base XP, runes 7 Air Rune + 1 Wrath Rune. Water Surge (Magic 85, surge): base damage 26, 38 base XP, runes 7 Water Rune + 7 Air Rune + 1 Wrath Rune. Earth Surge (Magic 90, surge): base damage 28, 40 base XP, runes 10 Earth Rune + 7 Air Rune + 1 Wrath Rune. Fire Surge (Magic 95, surge): base damage 30, 42 base XP, runes 7 Fire Rune + 7 Air Rune + 1 Wrath Rune."
 },
 {
  "id": "raid_vaults_of_xyren",
  "title": "Raid: Vaults of Xyren — bosses and unique rewards",
  "tags": [
   "raid",
   "raids",
   "boss",
   "uniques",
   "drops"
  ],
  "text": "Vaults of Xyren: Delve into Xeric's mountain stronghold. Defeat Tecton, Vespara, the Mudtadile and the Grand Olm to claim your reward. Bosses fought in sequence: Tekton, Vespula, Muttadile, The Great Olm. Credit skip cost: 10. Completing the raid rolls its reward chest: guaranteed loot (coins, runes, supplies) plus about 1 in 10 chance at one unique. These uniques come from the raid reward chest itself, not from any individual boss inside the raid: Warped Buckler, Dragon Slayer Crossbow, Durn's Bulwark, Kodai Hat, Kodai Robe Top, Kodai Robe Bottom, Dragon Claws, Ancient Maul, Zaryth Vambraces, Ancestral Wand, Twisted Longbow."
 },
 {
  "id": "raid_crimson_night_theatre",
  "title": "Raid: Crimson Night Theatre — bosses and unique rewards",
  "tags": [
   "raid",
   "raids",
   "boss",
   "uniques",
   "drops"
  ],
  "text": "Crimson Night Theatre: Fight through six deadly bosses in Verzik Vitura's theatre. Defeat them all to claim your reward. Bosses fought in sequence: The Maiden Of Sugadinti, Pestilent Bloat, Nylocas Vasilias, Sotetseg, Xarpus, Verzik Vitur. Credit skip cost: 10. Completing the raid rolls its reward chest: guaranteed loot (coins, runes, supplies) plus about 1 in 7 chance at one unique. These uniques come from the raid reward chest itself, not from any individual boss inside the raid: Avernal Defender, Ghraxis Rapier, Sanguine Staff, Justicar Faceguard, Justicar Chestguard, Justicar Legguards, Scythe of Vythar."
 },
 {
  "id": "raid_cryptbound_champions",
  "title": "Raid: Cryptbound Champions — bosses and unique rewards",
  "tags": [
   "raid",
   "raids",
   "boss",
   "uniques",
   "drops"
  ],
  "text": "Cryptbound Champions: Descend into the ancient crypt and defeat all six champions to claim their treasures. Bosses fought in sequence: Morvyn The Blighted, Dravok The Wretched, Gorath The Infested, Kaelor The Tainted, Torvek The Corrupted, Verin The Defiled. Credit skip cost: 2. Completing the raid rolls its reward chest: guaranteed loot (coins, runes, supplies) plus about 1 in 4 chance at one unique. These uniques come from the raid reward chest itself, not from any individual boss inside the raid: Morvyn's Hood, Morvyn's Robetop, Morvyn's Robeskirt, Morvyn's Staff, Dravok's Helm, Dravok's Platebody, Dravok's Platelegs, Dravok's Greataxe, Gorath's Helm, Gorath's Platebody, Gorath's Chainskirt, Gorath's Warspear, Kaelor's Coif, Kaelor's Leathertop, Kaelor's Leatherskirt, Kaelor's Crossbow, Torvek's Helm, Torvek's Platebody, Torvek's Platelegs, Torvek's Hammers, Verin's Helm, Verin's Brassard, Verin's Plateskirt, Verin's Flail."
 },
 {
  "id": "raid_tomb_of_arasmus",
  "title": "Raid: Tomb of Arasmus — bosses and unique rewards",
  "tags": [
   "raid",
   "raids",
   "boss",
   "uniques",
   "drops"
  ],
  "text": "Tomb of Arasmus: Brave the cursed tomb of the god-king Arasmus. Defeat his four guardians and the Warden to claim the treasures within. Bosses fought in sequence: Khareth The Shadowbound, Gorroth The Mountain Ape, Khepra The Scarab Matron, Sebakh The Devourer, Warden Of Arasmus. Credit skip cost: 10. Completing the raid rolls its reward chest: guaranteed loot (coins, runes, supplies) plus about 1 in 15 chance at one unique. These uniques come from the raid reward chest itself, not from any individual boss inside the raid: Fang Of Osmun, Sunbearer Ring, Ward Of Elidria, Masari Mask, Masari Body, Masari Chaps, Shadow Of Tumaken."
 },
 {
  "id": "data_minigames",
  "title": "Minigame grinds and their rewards",
  "tags": [
   "minigame",
   "minigames"
  ],
  "text": "Available minigame tasks. Grind for Fighter Body (5h): Run Viking Assault until you earn a Fighter Body. (one-time reward). Grind for Fighter Helm (2h): Run Viking Assault until you earn a Fighter Helm. (one-time reward). Grind for Rune Defender (3h): Slay Cyclopes in the Champion's Hall basement until one drops a Rune Defender. (one-time reward). Grind for Dragon Defender (2h): Slay Cyclopes wielding your Rune Defender until one drops a Dragon Defender. (one-time reward). Grind for Halo (3h): Play Fortress Clash matches until you can purchase a Halo. (one-time reward). Obtain decorative armour (2h): Play Fortress Clash until you can purchase a Decorative Top. (one-time reward). Grind Angler Net (5h): Play Fortress Clash until you can purchase an Angler Net. (one-time reward). Obtain Imbued God Cape (2h): Play Fortress Clash until you can purchase an Imbued God Cape. (one-time reward). Grind for Void King Set (6h): Play Void Breach until you earn the full Void King set. (one-time reward). Enchant the Boundless Hat (2h): Run Arcane Proving Grounds trials until you earn the Boundless Hat. (one-time reward). Enchant the Boundless Robe Top (2h): Run Arcane Proving Grounds trials until you earn the Boundless Robe Top. (one-time reward). Enchant the Boundless Robe Bottom (2h): Run Arcane Proving Grounds trials until you earn the Boundless Robe Bottom. (one-time reward). Enchant the Boundless Boots (2h): Run Arcane Proving Grounds trials until you earn the Boundless Boots. (one-time reward). Enchant the Boundless Gloves (2h): Run Arcane Proving Grounds trials until you earn the Boundless Gloves. (one-time reward). Bind the Arcane Grimoire (4h): Run Arcane Proving Grounds trials until you can bind the Arcane Grimoire. (one-time reward). Forge the Archmage Wand (4h): Run Arcane Proving Grounds trials until you can forge the Archmage Wand. (one-time reward)."
 },
 {
  "id": "farming_herbs",
  "title": "Farming: Herbs",
  "tags": [
   "farming",
   "seeds",
   "crops"
  ],
  "text": "Herbs you can grow. Greenthorn (Farming 1): 11 XP to plant, 12.5 XP per harvest, grows in 1.3h. Miremint (Farming 14): 14 XP to plant, 16 XP per harvest, grows in 1.3h. Duskroot (Farming 19): 17 XP to plant, 19.5 XP per harvest, grows in 1.3h. Kingsherb (Farming 25): 23 XP to plant, 26 XP per harvest, grows in 1.3h. Graysage (Farming 32): 30 XP to plant, 34.5 XP per harvest, grows in 1.3h. Bogtuber (Farming 36): 35 XP to plant, 40 XP per harvest, grows in 1.3h. Rynarr (Farming 52): 64 XP to plant, 73.5 XP per harvest, grows in 1.3h."
 },
 {
  "id": "farming_trees",
  "title": "Farming: Trees",
  "tags": [
   "farming",
   "seeds",
   "crops"
  ],
  "text": "Trees you can grow. Oak (Farming 15): 14 XP to plant, 4500 XP per harvest, grows in 2.5h. Willow (Farming 30): 27 XP to plant, 8150 XP per harvest, grows in 2.5h. Maple (Farming 45): 45 XP to plant, 13500 XP per harvest, grows in 2.5h. Yew (Farming 60): 81 XP to plant, 24000 XP per harvest, grows in 2.5h. Magic (Farming 75): 145 XP to plant, 43700 XP per harvest, grows in 2.5h."
 },
 {
  "id": "farming_fruittrees",
  "title": "Farming: Fruit trees",
  "tags": [
   "farming",
   "seeds",
   "crops"
  ],
  "text": "Fruit trees you can grow. Apple (Farming 27): 22.5 XP to plant, 28.5 XP per harvest, grows in 16h. Banana (Farming 33): 32.5 XP to plant, 4100 XP per harvest, grows in 2.1h. Orange (Farming 39): 39.5 XP to plant, 4900 XP per harvest, grows in 2.1h. Curry (Farming 42): 42.5 XP to plant, 5300 XP per harvest, grows in 2.1h. Papaya (Farming 57): 81 XP to plant, 10200 XP per harvest, grows in 2.1h. Palm (Farming 68): 110 XP to plant, 13800 XP per harvest, grows in 2.1h."
 },
 {
  "id": "skill_mining",
  "title": "Skill training options: Mining",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "mining"
  ],
  "text": "Mining training options with level requirements, XP per action and any ingredients required to make each item: Mine tin ore (level 1, 17 XP), Mine copper ore (level 1, 17 XP), Mine clay (level 1, 5 XP), Mine rune essence (level 1, 5 XP), Mine iron ore (level 15, 35 XP), Mine coal (level 30, 50 XP), Mine gold ore (level 40, 65 XP), Mine mithril ore (level 55, 80 XP), Mine adamantite ore (level 70, 95 XP), Mine runeforged ore (level 85, 420 XP), Mine gems (level 75, 65 XP)."
 },
 {
  "id": "skill_woodcutting",
  "title": "Skill training options: Woodcutting",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "woodcutting"
  ],
  "text": "Woodcutting training options with level requirements, XP per action and any ingredients required to make each item: Chop tree (level 1, 25 XP), Chop oak (level 15, 37 XP), Chop willow (level 30, 67 XP), Chop maple (level 45, 100 XP), Chop yew (level 60, 175 XP), Chop teak (level 35, 85 XP), Chop mahogany (level 50, 157 XP), Chop magic (level 75, 250 XP), Chop redwood (level 90, 300 XP)."
 },
 {
  "id": "skill_fishing",
  "title": "Skill training options: Fishing",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "fishing"
  ],
  "text": "Fishing training options with level requirements, XP per action and any ingredients required to make each item: Fish Shrimps (level 1, 10 XP), Fish Trout (level 20, 50 XP), Fish Tuna (level 35, 75 XP), Fish Crab (level 40, 90 XP), Fish Eel (level 50, 100 XP), Fish Karam (level 65, 105 XP), Fish Shark (level 76, 110 XP), Fish Manta Ray (level 85, 180 XP), Fish Anglerfish (level 90, 200 XP)."
 },
 {
  "id": "skill_smithing",
  "title": "Skill training options: Smithing",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "smithing"
  ],
  "text": "Smithing training options with level requirements, XP per action and any ingredients required to make each item: Smelt bronze bar (level 1, 6 XP; needs 1 Tin Ore + 1 Copper Ore → Bronze Bar), Smith bronze dagger (level 1, 12 XP; needs 1 Bronze Bar → Bronze Dagger), Smith bronze axe (level 4, 12 XP; needs 1 Bronze Bar → Bronze Axe), Smith bronze pickaxe (level 4, 12 XP; needs 1 Bronze Bar → Bronze Pickaxe), Smith bronze scimitar (level 4, 25 XP; needs 2 Bronze Bar → Bronze Scimitar), Smelt iron bar (level 15, 12 XP; needs 1 Iron Ore → Iron Bar), Smith iron axe (level 16, 25 XP; needs 1 Iron Bar → Iron Axe), Smith iron pickaxe (level 16, 25 XP; needs 1 Iron Bar → Iron Pickaxe), Smith iron scimitar (level 19, 50 XP; needs 2 Iron Bar → Iron Scimitar), Smelt steel bar (level 30, 17 XP; needs 1 Iron Ore + 2 Coal → Steel Bar), Smith steel axe (level 31, 37 XP; needs 1 Steel Bar → Steel Axe), Smith steel pickaxe (level 31, 37 XP; needs 1 Steel Bar → Steel Pickaxe), Smith steel scimitar (level 34, 75 XP; needs 2 Steel Bar → Steel Scimitar), Smelt gold bar (level 40, 22 XP; needs 1 Gold Ore → Gold Bar), Smelt mithril bar (level 50, 30 XP; needs 1 Mithril Ore + 4 Coal → Mithril Bar), Smith mithril axe (level 51, 50 XP; needs 1 Mithril Bar → Mithril Axe), Smith mithril pickaxe (level 51, 50 XP; needs 1 Mithril Bar → Mithril Pickaxe), Smith mithril scimitar (level 54, 100 XP; needs 2 Mithril Bar → Mithril Scimitar), Smelt adamant bar (level 70, 37 XP; needs 1 Adamantite Ore + 6 Coal → Adamant Bar), Smith adamant axe (level 71, 62 XP; needs 1 Adamant Bar → Adamant Axe), Smith adamant pickaxe (level 71, 62 XP; needs 1 Adamant Bar → Adamant Pickaxe), Smith adamant scimitar (level 74, 125 XP; needs 2 Adamant Bar → Adamant Scimitar), Smelt runeforged bar (level 75, 50 XP; needs 1 Runeforged Ore + 8 Coal → Runeforged Bar), Smith runeforged axe (level 76, 75 XP; needs 1 Runeforged Bar → Runeforged Axe), Smith runeforged pickaxe (level 76, 75 XP; needs 1 Runeforged Bar → Runeforged Pickaxe), Smith runeforged scimitar (level 79, 150 XP; needs 2 Runeforged Bar → Runeforged Scimitar), Smith iron dagger (level 15, 25 XP; needs 1 Iron Bar → Iron Dagger), Smith iron mace (level 16, 25 XP; needs 1 Iron Bar → Iron Mace), Smith iron sword (level 18, 25 XP; needs 1 Iron Bar → Iron Sword), Smith iron longsword (level 20, 50 XP; needs 2 Iron Bar → Iron Longsword), Smith iron full helm (level 21, 50 XP; needs 2 Iron Bar → Iron Full Helm), Smith iron chainbody (level 25, 75 XP; needs 3 Iron Bar → Iron Chainbody), Smith iron kiteshield (level 26, 75 XP; needs 3 Iron Bar → Iron Kiteshield), Smith iron platelegs (level 30, 75 XP; needs 3 Iron Bar → Iron Platelegs), Smith iron platebody (level 32, 125 XP; needs 5 Iron Bar → Iron Platebody), Smith steel dagger (level 30, 37 XP; needs 1 Steel Bar → Steel Dagger), Smith steel mace (level 31, 37 XP; needs 1 Steel Bar → Steel Mace), Smith steel sword (level 33, 37 XP; needs 1 Steel Bar → Steel Sword), Smith steel longsword (level 35, 75 XP; needs 2 Steel Bar → Steel Longsword), Smith steel full helm (level 36, 75 XP; needs 2 Steel Bar → Steel Full Helm) …and 49 more."
 },
 {
  "id": "skill_cooking",
  "title": "Skill training options: Cooking",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "cooking"
  ],
  "text": "Cooking training options with level requirements, XP per action and any ingredients required to make each item: Cook Shrimps (level 1, 30 XP; needs 1 Raw Shrimps → Shrimps), Cook Chicken (level 1, 30 XP; needs 1 Raw Chicken → Cooked Chicken), Cook Meat (level 1, 30 XP; needs 1 Raw Beef → Cooked Meat), Cook Trout (level 15, 70 XP; needs 1 Raw Trout → Trout), Cook Tuna (level 35, 100 XP; needs 1 Raw Tuna → Tuna), Cook Crab (level 40, 120 XP; needs 1 Raw Crab → Crab), Cook Eel (level 45, 140 XP; needs 1 Raw Eel → Eel), Cook Karam (level 65, 190 XP; needs 1 Raw Karam → Karam), Cook Shark (level 80, 210 XP; needs 1 Raw Shark → Shark), Cook Manta Ray (level 91, 250 XP; needs 1 Raw Manta Ray → Manta Ray), Cook Anglerfish (level 93, 270 XP; needs 1 Raw Anglerfish → Anglerfish), Cook Tuna Potato (level 95, 260 XP; needs 1 Tuna + 1 Sweetcorn + 1 Potato → Tuna Potato)."
 },
 {
  "id": "skill_fletching",
  "title": "Skill training options: Fletching",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "fletching"
  ],
  "text": "Fletching training options with level requirements, XP per action and any ingredients required to make each item: Cut arrow shafts (15) (level 1, 5 XP; needs 1 Logs → Arrow Shaft), Attach feather (15) (level 1, 15 XP; needs 15 Arrow Shaft + 15 Feather → Headless Arrow), Make bronze arrows (15) (level 1, 20 XP; needs 15 Headless Arrow + 15 Bronze Arrowtips → Bronze Arrow), Cut shortbow (u) (level 5, 5 XP; needs 1 Logs → Shortbow (U)), String shortbow (level 5, 10 XP; needs 1 Shortbow (U) + 1 Bowstring → Shortbow), Make iron arrows (15) (level 15, 37 XP; needs 15 Headless Arrow + 15 Iron Arrowtips → Iron Arrow), Cut oak shortbow (u) (level 20, 16 XP; needs 1 Oak Logs → Oak Shortbow (U)), String oak shortbow (level 20, 25 XP; needs 1 Oak Shortbow (U) + 1 Bowstring → Oak Shortbow), Make steel arrows (15) (level 30, 55 XP; needs 15 Headless Arrow + 15 Steel Arrowtips → Steel Arrow), Cut willow shortbow (u) (level 35, 33 XP; needs 1 Willow Logs → Willow Shortbow (U)), String willow shortbow (level 35, 50 XP; needs 1 Willow Shortbow (U) + 1 Bowstring → Willow Shortbow), Make mithril arrows (15) (level 45, 75 XP; needs 15 Headless Arrow + 15 Mithril Arrowtips → Mithril Arrow), Cut maple shortbow (u) (level 50, 50 XP; needs 1 Maple Logs → Maple Shortbow (U)), String maple shortbow (level 50, 75 XP; needs 1 Maple Shortbow (U) + 1 Bowstring → Maple Shortbow), Make adamant arrows (15) (level 60, 105 XP; needs 15 Headless Arrow + 15 Adamant Arrowtips → Adamant Arrow), Cut yew shortbow (u) (level 65, 67 XP; needs 1 Yew Logs → Yew Shortbow (U)), String yew shortbow (level 65, 100 XP; needs 1 Yew Shortbow (U) + 1 Bowstring → Yew Shortbow), Make runeforged arrows (15) (level 75, 150 XP; needs 15 Headless Arrow + 15 Runeforged Arrowtips → Runeforged Arrow), Cut magic shortbow (u) (level 80, 83 XP; needs 1 Magic Logs → Magic Shortbow (U)), String magic shortbow (level 80, 125 XP; needs 1 Magic Shortbow (U) + 1 Bowstring → Magic Shortbow), Cut wooden stocks (10) (level 9, 6 XP; needs 1 Logs → Wooden Stock), Make bronze bolts (10) (level 9, 25 XP; needs 10 Feather + 10 Bronze Bolt (Unf) → Bronze Bolt), Make iron bolts (10) (level 39, 50 XP; needs 10 Feather + 10 Iron Bolt (Unf) → Iron Bolt), Make steel bolts (10) (level 46, 175 XP; needs 10 Feather + 10 Steel Bolt (Unf) → Steel Bolt), Make mithril bolts (10) (level 54, 250 XP; needs 10 Feather + 10 Mithril Bolt (Unf) → Mithril Bolt), Make adamant bolts (10) (level 61, 350 XP; needs 10 Feather + 10 Adamant Bolt (Unf) → Adamant Bolt), Make runeforged bolts (10) (level 69, 500 XP; needs 10 Feather + 10 Runeforged Bolt (Unf) → Runeforged Bolt), Make dragon bolts (10) (level 84, 600 XP; needs 10 Feather + 10 Dragon Bolt (Unf) → Dragon Bolt), Cut ruby bolt tips (12) (level 63, 6 XP; needs 1 Ruby → Ruby Bolt Tips), Cut diamond bolt tips (12) (level 65, 7 XP; needs 1 Diamond → Diamond Bolt Tips), Cut dragonstone bolt tips (12) (level 71, 8 XP; needs 1 Dragonstone → Dragonstone Bolt Tips), Cut onyx bolt tips (12) (level 73, 9 XP; needs 1 Onyx → Onyx Bolt Tips), Tip ruby bolts (10) (level 63, 630 XP; needs 10 Adamant Bolt + 10 Ruby Bolt Tips → Ruby Bolt), Tip diamond bolts (10) (level 65, 700 XP; needs 10 Adamant Bolt + 10 Diamond Bolt Tips → Diamond Bolt), Tip dragonstone bolts (10) (level 71, 820 XP; needs 10 Runeforged Bolt + 10 Dragonstone Bolt Tips → Dragonstone Bolt), Tip onyx bolts (10) (level 73, 940 XP; needs 10 Runeforged Bolt + 10 Onyx Bolt Tips → Onyx Bolt), Tip ruby dragon bolts (10) (level 84, 700 XP; needs 10 Dragon Bolt + 10 Ruby Bolt Tips → Ruby Dragon Bolt), Tip diamond dragon bolts (10) (level 84, 750 XP; needs 10 Dragon Bolt + 10 Diamond Bolt Tips → Diamond Dragon Bolt), Tip dragonstone dragon bolts (10) (level 84, 900 XP; needs 10 Dragon Bolt + 10 Dragonstone Bolt Tips → Dragonstone Dragon Bolt), Tip onyx dragon bolts (10) (level 84, 1000 XP; needs 10 Dragon Bolt + 10 Onyx Bolt Tips → Onyx Dragon Bolt)."
 },
 {
  "id": "skill_crafting",
  "title": "Skill training options: Crafting",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "crafting"
  ],
  "text": "Crafting training options with level requirements, XP per action and any ingredients required to make each item: Tan cowhide (level 1, 1 XP; needs 1 Cowhide → Leather), Tan cowhide (hard) (level 1, 1 XP; needs 1 Cowhide → Hard Leather), Tan green dragon hide (level 55, 25 XP; needs 1 Green Dragonhide → Green Dragon Leather), Craft leather gloves (level 1, 14 XP; needs 1 Leather → Leather Gloves), Make molten glass (level 1, 20 XP; needs 1 Soda Ash + 1 Bucket of Sand → Molten Glass), Craft leather boots (level 7, 16 XP; needs 1 Leather → Leather Boots), Craft leather cowl (level 9, 18 XP; needs 1 Leather → Leather Cowl), Craft leather body (level 14, 25 XP; needs 1 Leather → Leather Body), Craft leather chaps (level 18, 27 XP; needs 1 Leather → Leather Chaps), Cut sapphire (level 20, 50 XP; needs 1 Uncut Sapphire → Sapphire), String sapphire amulet (level 24, 65 XP; needs 1 Sapphire + 1 Gold Bar → Sapphire Amulet), Cut emerald (level 27, 67 XP; needs 1 Uncut Emerald → Emerald), Craft hard leather body (level 28, 35 XP; needs 1 Hard Leather → Hard Leather Body), String emerald amulet (level 31, 80 XP; needs 1 Emerald + 1 Gold Bar → Emerald Amulet), Cut ruby (level 34, 85 XP; needs 1 Uncut Ruby → Ruby), Cut diamond (level 43, 107 XP; needs 1 Uncut Diamond → Diamond), Cut dragonstone (level 55, 137 XP; needs 1 Uncut Dragonstone → Dragonstone), Cut onyx (level 72, 167 XP; needs 1 Uncut Onyx → Onyx), Cut zyrite (level 89, 200 XP; needs 1 Uncut Zyrite → Zyrite), String ruby amulet (level 50, 100 XP; needs 1 Ruby + 1 Gold Bar → Ruby Amulet), Craft green d'hide chaps (level 57, 62 XP; needs 2 Green Dragon Leather → Green D'Hide Chaps), Craft green d'hide body (level 63, 186 XP; needs 3 Green Dragon Leather → Green D'Hide Body), Craft red d'hide body (level 75, 225 XP; needs 4 Red Dragon Leather → Red D'Hide Body), Craft red d'hide chaps (level 73, 124 XP; needs 2 Red Dragon Leather → Red D'Hide Chaps), Craft black d'hide chaps (level 79, 172 XP; needs 2 Black Dragon Leather → Black D'Hide Chaps), Craft black d'hide body (level 84, 258 XP; needs 3 Black Dragon Leather → Black D'Hide Body), String diamond amulet (level 70, 130 XP; needs 1 Diamond + 1 Gold Bar → Diamond Amulet), String dragonstone amulet (level 80, 150 XP; needs 1 Dragonstone + 1 Gold Bar → Dragonstone Amulet), String onyx amulet (level 90, 165 XP; needs 1 Onyx + 1 Gold Bar → Onyx Amulet), String zyrite amulet (level 98, 200 XP; needs 1 Zyrite + 1 Gold Bar → Zyrite Amulet), Craft zyrite bracelet (level 98, 200 XP; needs 1 Zyrite + 1 Gold Bar → Zyrite Bracelet), String zyrite necklace (level 98, 200 XP; needs 1 Zyrite + 1 Gold Bar → Zyrite Necklace), Craft zyrite ring (level 98, 200 XP; needs 1 Zyrite + 1 Gold Bar → Zyrite Ring), Craft ferocious gloves (level 80, 250 XP; needs 1 Ashen Hydra Leather → Ferocious Gloves)."
 },
 {
  "id": "skill_herblore",
  "title": "Skill training options: Herblore",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "herblore"
  ],
  "text": "Herblore training options with level requirements, XP per action and any ingredients required to make each item: Make attack potion (level 1, 25 XP; needs 1 Greenthorn Leaf + 1 Eye of Newt → Attack Potion), Make strength potion (level 12, 40 XP; needs 1 Duskroot + 1 Limpwurt Root → Strength Potion), Make defence potion (level 30, 55 XP; needs 1 Rynarr Weed + 1 White Berries → Defence Potion), Make combat potion (level 36, 70 XP; needs 1 Sunblossom + 1 Goat Horn Dust → Combat Potion), Make prayer potion (level 38, 75 XP; needs 1 Rynarr Weed + 1 Snape Grass → Prayer Potion), Make super attack (level 45, 90 XP; needs 1 Emberleaf + 1 Eye of Newt → Super Attack), Make super strength (level 55, 110 XP; needs 1 Wyrmspice + 1 Limpwurt Root → Super Strength), Make super restore (level 63, 130 XP; needs 1 Snapdrake + 1 Red Spiders' Eggs → Super Restore), Make super defence (level 66, 140 XP; needs 1 Cinderbloom + 1 White Berries → Super Defence), Make ranging potion (level 72, 160 XP; needs 1 Stonefern + 1 Wine of Krylth → Ranging Potion), Make magic potion (level 76, 180 XP; needs 1 Mistvine + 1 Potato Cactus → Magic Potion), Make Lumira Brew (level 81, 200 XP; needs 1 Marshflax + 1 Crushed Bird's Nest → Lumira Brew), Make super combat potion (level 90, 500 XP; needs 1 Thornspire + 1 Super Attack + 1 Super Strength + 1 Super Defence + 1 Ranging Potion + 1 Magic Potion → Super Combat)."
 },
 {
  "id": "skill_agility",
  "title": "Skill training options: Agility",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "agility"
  ],
  "text": "Agility training options with level requirements, XP per action and any ingredients required to make each item: Lumbright Training Course (level 1, 86 XP), Draynar Rooftop (level 10, 120 XP), Al-Karid Rooftop (level 20, 175 XP), Varrick Rooftop (level 30, 190 XP), Canifel Rooftop (level 40, 240 XP), Faloden Rooftop (level 50, 440 XP), Seerhold Rooftop (level 60, 500 XP), Brimhollow Rooftop (level 70, 550 XP), Catherra Rooftop (level 80, 600 XP), Ardounne Rooftop (level 90, 700 XP)."
 },
 {
  "id": "skill_prayer",
  "title": "Skill training options: Prayer",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "prayer"
  ],
  "text": "Prayer training options with level requirements, XP per action and any ingredients required to make each item: Bury bones (level 1, 5 XP; needs 1 Bones), Bury big bones (level 5, 15 XP; needs 1 Big Bones), Bury dragon bones (level 35, 72 XP; needs 1 Dragon Bones), Use gilded altar (bones) (level 1, 17 XP; needs 1 Bones), Use gilded altar (big bones) (level 5, 52 XP; needs 1 Big Bones), Use gilded altar (dragon bones) (level 35, 252 XP; needs 1 Dragon Bones), Bury nagadoth bones (level 40, 125 XP; needs 1 Nagadoth Bones), Use gilded altar (nagadoth bones) (level 40, 437 XP; needs 1 Nagadoth Bones), Scatter Gargoyle Dust (level 20, 125 XP; needs 1 Gargoyle Dust)."
 },
 {
  "id": "skill_magic",
  "title": "Skill training options: Magic",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "magic"
  ],
  "text": "Magic training options with level requirements, XP per action and any ingredients required to make each item: Curse (level 19, 29 XP), High Alchemy (level 55, 65 XP), Superheat Item (iron ore) (level 43, 53 XP; needs 1 Iron Ore + 1 Coal → Iron Bar), Enchant Sapphire (level 7, 170 XP; needs 1 Sapphire Amulet → Amulet of Magic), Enchant Ruby (level 49, 590 XP; needs 1 Ruby Amulet → Amulet of Strength), Enchant Diamond (level 57, 670 XP; needs 1 Diamond Amulet → Amulet of Power), Enchant Dragonstone (level 68, 780 XP; needs 1 Dragonstone Amulet → Amulet of Glory), Stun (level 80, 90 XP), Enchant Onyx (level 87, 970 XP; needs 1 Onyx Amulet → Amulet of Fury), Enchant Zyrite Amulet (level 93, 1100 XP; needs 1 Zyrite Amulet → Amulet of Torment), Enchant Zyrite Bracelet (level 93, 1100 XP; needs 1 Zyrite Bracelet → Afflicted Bracelet), Enchant Zyrite Necklace (level 93, 1100 XP; needs 1 Zyrite Necklace → Necklace of Agony), Enchant Zyrite Ring (level 93, 1100 XP; needs 1 Zyrite Ring → Ring of Affliction), Enchant Ruby Bolts (10) (level 49, 590 XP; needs 10 Ruby Bolt → Ruby Bolt (E)), Enchant Ruby Dragon Bolts (10) (level 49, 590 XP; needs 10 Ruby Dragon Bolt → Ruby Dragon Bolt (E)), Enchant Diamond Bolts (10) (level 57, 670 XP; needs 10 Diamond Bolt → Diamond Bolt (E)), Enchant Diamond Dragon Bolts (10) (level 57, 670 XP; needs 10 Diamond Dragon Bolt → Diamond Dragon Bolt (E)), Enchant Dragonstone Bolts (10) (level 68, 780 XP; needs 10 Dragonstone Bolt → Dragonstone Bolt (E)), Enchant Dragonstone Dragon Bolts (10) (level 68, 780 XP; needs 10 Dragonstone Dragon Bolt → Dragonstone Dragon Bolt (E)), Enchant Onyx Bolts (10) (level 87, 970 XP; needs 10 Onyx Bolt → Onyx Bolt (E)), Enchant Onyx Dragon Bolts (10) (level 87, 970 XP; needs 10 Onyx Dragon Bolt → Onyx Dragon Bolt (E)), Tan Leather (level 78, 81 XP; needs 1 Cowhide → Leather), Plank Make (level 86, 90 XP; needs 1 Logs → Plank)."
 },
 {
  "id": "skill_thieving",
  "title": "Skill training options: Thieving",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "thieving"
  ],
  "text": "Thieving training options with level requirements, XP per action and any ingredients required to make each item: ."
 },
 {
  "id": "skill_firemaking",
  "title": "Skill training options: Firemaking",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "firemaking"
  ],
  "text": "Firemaking training options with level requirements, XP per action and any ingredients required to make each item: Burn logs (level 1, 40 XP; needs 1 Logs), Burn oak logs (level 15, 60 XP; needs 1 Oak Logs), Burn willow logs (level 30, 90 XP; needs 1 Willow Logs), Burn maple logs (level 45, 135 XP; needs 1 Maple Logs), Burn yew logs (level 60, 203 XP; needs 1 Yew Logs), Burn magic logs (level 75, 304 XP; needs 1 Magic Logs), Burn redwood logs (level 90, 350 XP; needs 1 Redwood Logs)."
 },
 {
  "id": "skill_farming",
  "title": "Skill training options: Farming",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "farming"
  ],
  "text": "Farming training options with level requirements, XP per action and any ingredients required to make each item: ."
 },
 {
  "id": "skill_hunter",
  "title": "Skill training options: Hunter",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "hunter"
  ],
  "text": "Hunter training options with level requirements, XP per action and any ingredients required to make each item: Hunt Cow (level 1, 150 XP), Hunt Wizard (level 15, 300 XP), Hunt Jeweller (level 35, 500 XP), Hunt Merchant (level 50, 800 XP), Hunt Grim Reaper (level 60, 1000 XP), Hunt Herbi (level 70, 1250 XP), Hunt Master Trader (level 85, 1500 XP)."
 },
 {
  "id": "skill_dungeoneering",
  "title": "Skill training options: Dungeoneering",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "dungeoneering"
  ],
  "text": "Dungeoneering training options with level requirements, XP per action and any ingredients required to make each item: Clear novice dungeon (level 1, 1000 XP), Clear apprentice dungeon (level 10, 2000 XP), Clear adept dungeon (level 20, 3000 XP), Clear journeyman dungeon (level 30, 4000 XP), Clear expert dungeon (level 40, 5000 XP), Clear veteran dungeon (level 50, 6000 XP), Clear master dungeon (level 60, 7000 XP), Clear grandmaster dungeon (level 70, 8000 XP), Clear legendary dungeon (level 80, 9000 XP), Clear mythic dungeon (level 90, 10000 XP), Claim arcane necklace (level 65, 0 XP), Claim chaotic rapier (level 80, 0 XP), Claim chaotic longsword (level 80, 0 XP), Claim chaotic maul (level 80, 0 XP), Claim chaotic crossbow (level 80, 0 XP), Claim chaotic staff (level 80, 0 XP), Claim eagle eyed kiteshield (level 80, 0 XP), Claim arcane kiteshield (level 80, 0 XP)."
 },
 {
  "id": "skill_runecraft",
  "title": "Skill training options: Runecrafting",
  "tags": [
   "skill",
   "skills",
   "training",
   "ingredients",
   "materials",
   "recipe",
   "runecraft"
  ],
  "text": "Runecrafting training options with level requirements, XP per action and any ingredients required to make each item: Craft air rune (level 1, 10 XP; needs 1 Rune Essence → Air Rune), Craft mind rune (level 2, 11 XP; needs 1 Rune Essence → Mind Rune), Craft water rune (level 5, 12 XP; needs 1 Rune Essence → Water Rune), Craft earth rune (level 9, 13 XP; needs 1 Rune Essence → Earth Rune), Craft fire rune (level 14, 14 XP; needs 1 Rune Essence → Fire Rune), Craft body rune (level 20, 15 XP; needs 1 Rune Essence → Body Rune), Craft cosmic rune (level 27, 16 XP; needs 1 Rune Essence → Cosmic Rune), Craft chaos rune (level 35, 17 XP; needs 1 Rune Essence → Chaos Rune), Craft astral rune (level 40, 17.4 XP; needs 1 Rune Essence → Astral Rune), Craft nature rune (level 44, 18 XP; needs 1 Rune Essence → Nature Rune), Craft law rune (level 54, 19 XP; needs 1 Rune Essence → Law Rune), Craft death rune (level 65, 25 XP; needs 1 Rune Essence → Death Rune), Craft blood rune (level 77, 30 XP; needs 1 Rune Essence → Blood Rune), Craft soul rune (level 90, 35 XP; needs 1 Rune Essence → Soul Rune), Craft wrath rune (level 95, 40 XP; needs 1 Rune Essence → Wrath Rune)."
 },
 {
  "id": "data_potions",
  "title": "Potions: stat boosts, heals and durations",
  "tags": [
   "potion",
   "potions",
   "boost",
   "buff",
   "super combat",
   "super strength",
   "super attack",
   "super defence"
  ],
  "text": "All potions and what they do. Stat-boost potions last a limited time, stack additively with other active potions on the same stat, and never delay your next attack (they're combo consumables). Attack Potion: +13 Attack for 5m. Strength Potion: +13 Strength for 5m. Defence Potion: +13 Defence for 5m. Combat Potion: +13 Attack, +13 Strength, +13 Defence, +14 Ranged, +4 Magic for 5m. Prayer Potion: instantly restores 20 Prayer points, no timed buff. Super Attack: +18 Attack for 5m. Super Strength: +18 Strength for 5m. Super Restore: instantly restores 22 Prayer points, no timed buff. Super Defence: +18 Defence for 5m. Ranging Potion: +14 Ranged for 5m. Magic Potion: +4 Magic for 5m. Imbued Brain: +18 Magic for 5m. Lumira Brew: instantly heals 22 HP; also clears every other active potion buff, no timed stat buff. Super Combat: +18 Attack, +18 Strength, +18 Defence, +14 Ranged, +4 Magic for 5m."
 },
 {
  "id": "data_gathering_tool_speed",
  "title": "Gathering tool speed: woodcutting axes, mining pickaxes and fishing tools",
  "tags": [
   "tool",
   "tools",
   "axe",
   "pickaxe",
   "dragon axe",
   "dragon pickaxe",
   "shardglass",
   "shardglass pickaxe",
   "shardglass axe",
   "speed",
   "woodcutting",
   "mining",
   "fishing"
  ],
  "text": "Woodcutting, Mining and Fishing can always be done bare-handed, but holding no tool at all takes twice as long as even the most basic tool tier. Better tool tiers cut the action time further; each tier needs the shown skill (and sometimes Attack) level to use. The Shardglass Pickaxe and Shardglass Axe match the Dragon tools for speed and additionally double gathered ore/logs while charged with Shardglass Shards (loaded like any other scale-charged weapon); once their charges run out they stop counting as a tool at all until recharged. Woodcutting axes, on trees — Bronze Axe (requires Woodcutting 1): no speed bonus (baseline). Iron Axe (requires Woodcutting 1): 10% faster action time. Steel Axe (requires Woodcutting 5): 15% faster action time. Mithril Axe (requires Woodcutting 20): 25% faster action time. Adamant Axe (requires Woodcutting 30): 30% faster action time. Runeforged Axe (requires Woodcutting 40): 38% faster action time. Dragon Axe (requires Attack 60 + Woodcutting 60): 44% faster action time. Shardglass Axe (requires Attack 60 + Woodcutting 70): 50% faster action time; while charged with Shardglass Shards, also doubles the ore/log yield per action (burns 2 shards from the tool's own charge each time). 2nd Age Axe (requires Attack 65 + Woodcutting 61): 50% faster action time. Mining pickaxes, on ore — Bronze Pickaxe (requires Mining 1): no speed bonus (baseline). Iron Pickaxe (requires Mining 1): 10% faster action time. Steel Pickaxe (requires Mining 5): 15% faster action time. Mithril Pickaxe (requires Mining 20): 20% faster action time. Adamant Pickaxe (requires Mining 30): 30% faster action time. Runeforged Pickaxe (requires Mining 40): 40% faster action time. Dragon Pickaxe (requires Attack 60 + Mining 60): 50% faster action time. Shardglass Pickaxe (requires Attack 60 + Mining 70): 50% faster action time; while charged with Shardglass Shards, also doubles the ore/log yield per action (burns 2 shards from the tool's own charge each time). Fishing tools — Fishing Net (requires Fishing 1): no speed bonus (baseline). Fishing Rod (requires Fishing 20): 10% faster action time. Lobster Cage (requires Fishing 40): 20% faster action time. Harpoon (requires Fishing 50): 30% faster action time. Angler Net: 30% faster action time."
 },
 {
  "id": "data_special_attacks",
  "title": "Weapon special attacks: which weapons have one and what they do",
  "tags": [
   "special attack",
   "special",
   "weapon",
   "weapons"
  ],
  "text": "Every weapon with a special attack, its energy cost and effect. Special attacks are triggered manually with the ⚡ Special Attack button, never automatically or offline; special energy runs 0-100, starts each fight at 100, drains on use and refills on a kill. Magic Shortbow (55% energy): Snapshot: Fires two arrows in rapid succession, each dealing up to 75% of your normal max hit.. Nether Demon Whip (50% energy): Energy Drain: Lashes at the target — if it connects, the creature is stunned for one attack cycle, skipping its next hit.. Dragon Dagger (25% energy): Puncture: Strikes twice in rapid succession, each hit capable of dealing up to 115% of your normal max hit.. Dragon Scimitar (55% energy): Sever: A precise strike that completely bypasses the target's defences, rolling against zero defence.. Grondar Godsword (50% energy): Warstrike: A crushing blow that deals damage and permanently weakens the target's defences for the rest of the fight by the amount of damage dealt.. Zephyra Godsword (50% energy): The Judgement: A devastating strike rolled at 125% accuracy and capable of hitting up to 125% of your normal max damage.. Lumira Godsword (50% energy): Healing Blade: Strikes with divine power, restoring your HP by half the damage dealt (minimum 10 HP healed).. Krylth Godsword (50% energy): Ice Cleave: Strikes with chaotic energy, dealing damage and freezing the target for ~20 seconds (33 ticks), preventing it from attacking.. Lumira Sword (100% energy): Lumina Lightning: A two-hit attack — a melee strike followed by a divine lightning bolt dealing 1–16 magic damage (always hits).. Zephyra Crossbow (40% energy): Pebble Shot: Fires a bolt that never misses, dealing up to 125% of your normal ranged max hit.. Krylth Spear (25% energy): Shove: A powerful stab rolled at 175% accuracy that staggers the target, skipping their next 2 attacks.. Venom Blowpipe (50% energy): Toxic Siphon: Guaranteed hit at 150% max hit. Heals you for half the damage dealt.. Durn's Bulwark (50% energy): The Block: Slam your bulwark with unstoppable force — guaranteed 40–64 damage. No accuracy roll. Cannot be blocked.. Dragon Claws (50% energy): Slice and Dice: Four rapid slashes — each hit is half the previous. Exceptional burst damage.. Fang Of Osmun (25% energy): Strikes with deadly precision — rolls accuracy twice and avoids low hits, dealing 15%–85% of max.. Zul-Kaar's Blade (50% energy): Disrupt: consumes 50% special energy. Deals guaranteed Magic damage (50-150% of max melee hit). Grants 2 Magic XP per damage dealt. Nullified against magic-immune monsters.. Dragon Mace (50% energy): Overpower: A brutal crushing blow dealing 150% of your normal max hit.. Abyssal Tentacle (50% energy): Energy Drain: Lashes at the target — if it connects, the creature is stunned for one attack cycle, skipping its next hit.. Dragon Warhammer (50% energy): Smash for 50% additional damage. On a hit, reduces the target's Defence level by 30% of its current value (rounded down). Stacks with itself.. Gargoyle Maul (100% energy): Quake: Smashes the target three times in a single attack, each strike rolling its own damage.. Nightfang Bow (100% energy): Descent of Darkness: Fires two arrows simultaneously, each hitting up to 150% of your normal max hit.. Boneclaw Rapier (50% energy): Soul Leech: Strikes twice at full power; the second hit heals you for 100% of its damage dealt.. Stonegale Bow (55% energy): Gale Shot: A guaranteed arrow strike at 140% max hit that staggers the target, delaying its next attack by one cycle.. Cindermaw Maul (50% energy): Molten Crush: A searing blow at 125% max hit that shatters the target's armour, reducing its Defence level by 20%.. Thornspine Shortbow (65% energy): Volley: Unleashes three rapid thorn-shots in quick succession, each dealing up to 70% of your max hit.. Zesta Longsword (25% energy): Overpower: A devastating slash dealing up to 150% of your normal max hit.. Umbral Duskmare Staff (55% energy): Soul Drain: a magic blast that restores Prayer points equal to half the damage dealt.. Volatile Duskmare Staff (55% energy): Volatile Surge: a high-accuracy blast whose max hit scales with your Magic level.."
 },
 {
  "id": "data_bosses",
  "title": "Boss list: combat levels, HP and Slayer requirements",
  "tags": [
   "boss",
   "bosses",
   "slayer"
  ],
  "text": "All bosses with combat level, hitpoints and Slayer level requirement where one applies. Bosses marked as raid bosses are only fought inside their raid and have no personal drop table. Deepmaw Kraken (combat level 291, 255 HP, Slayer 87 required). Warlord Grondar (combat level 624, 255 HP). Commander Zephyra (combat level 596, 255 HP). Krylth the Defiler (combat level 650, 255 HP). Skyrender Kharra (combat level 580, 255 HP). Nagadoth Rex (combat level 303, 150 HP). Nagadoth Prime (combat level 303, 150 HP). Nagadoth Supreme (combat level 303, 150 HP). King Black Dragon (combat level 276, 150 HP). Venomcoil Matriarch (combat level 725, 500 HP). Ember Tyrant (combat level 702, 250 HP). Ashen Crucible (combat level 1400, 600 HP). Blighted Gauntlet (combat level 894, 1000 HP). The Grand Olm (combat level 1000, 800 HP, fought inside the Vaults of Xyren raid). Hellbound Gorilla (combat level 275, 205 HP, Slayer 70 required). The Matron of Sugadinti (combat level 940, 2625 HP, fought inside the Crimson Night Theatre raid). Pestilent Blight (combat level 870, 1500 HP, fought inside the Crimson Night Theatre raid). Nylocas Vashilias (combat level 800, 1875 HP, fought inside the Crimson Night Theatre raid). Sotethseg (combat level 995, 3000 HP, fought inside the Crimson Night Theatre raid). Xarphus (combat level 960, 2250 HP, fought inside the Crimson Night Theatre raid). Verzik Vitura (combat level 1040, 2000 HP, fought inside the Crimson Night Theatre raid). Tecton (combat level 149, 500 HP, fought inside the Vaults of Xyren raid). Vespara (combat level 202, 400 HP, fought inside the Vaults of Xyren raid). Mudtadile (combat level 170, 450 HP, fought inside the Vaults of Xyren raid). Khareth the Shadowbound (combat level 700, 520 HP, fought inside the Tomb of Arasmus raid). Gorroth, the Mountain-Ape (combat level 650, 600 HP, fought inside the Tomb of Arasmus raid). Khepra, the Scarab Matron (combat level 680, 500 HP, fought inside the Tomb of Arasmus raid). Sebakh the Devourer (combat level 720, 580 HP, fought inside the Tomb of Arasmus raid). Warden of Arasmus (combat level 900, 700 HP, fought inside the Tomb of Arasmus raid). Morvyn the Blighted (combat level 115, 100 HP, fought inside the Cryptbound Champions raid). Dravok the Wretched (combat level 115, 100 HP, fought inside the Cryptbound Champions raid). Gorath the Infested (combat level 115, 100 HP, fought inside the Cryptbound Champions raid). Kaelor the Tainted (combat level 115, 100 HP, fought inside the Cryptbound Champions raid). Torvek the Corrupted (combat level 115, 100 HP, fought inside the Cryptbound Champions raid). Verin the Defiled (combat level 115, 100 HP, fought inside the Cryptbound Champions raid). Threefang Cerberus (combat level 318, 600 HP, Slayer 91 required). Ashen Hydra (combat level 194, 320 HP, Slayer 95 required). Sovrathar, the Ashen Sovereign (combat level 250, 480 HP, Slayer 80 required). Gravehusk Brute (combat level 82, 60 HP). Boneclaw Revenant (combat level 98, 75 HP). Shroudwraith Specter (combat level 115, 90 HP). Stonegale Elemental (combat level 100, 80 HP). Cindermaw Serpent (combat level 120, 100 HP). Thornhide Colossus (combat level 140, 120 HP). Gravethorn Drake (combat level 110, 90 HP). Ironclad Guardian (combat level 130, 110 HP). Emberhowl Warlord (combat level 155, 150 HP). Razorwing Harpy (combat level 150, 140 HP). The Duskmare (combat level 470, 1500 HP)."
 },
 {
  "id": "monster_field_chicken",
  "title": "Monster: Field Chicken — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Field Chicken is a monster at combat level 1 with 3 HP, attacking with crush. Drops: Clue Scroll Medium (1 in 50), Bones (always), Raw Chicken (always), Feather (always)."
 },
 {
  "id": "monster_cave_goblin",
  "title": "Monster: Cave Goblin — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Cave Goblin is a monster at combat level 5 with 5 HP, attacking with crush. Drops: Marshflax (1 in 2,000), Mistvine (1 in 1,000), Stonefern (1 in 333), Cinderbloom (1 in 250), Snapdrake (1 in 200), Wyrmspice (1 in 167), Emberleaf (1 in 125), Sunblossom (1 in 100), Rynarr Weed (1 in 83), Duskroot (1 in 67), Greenthorn Leaf (1 in 50), Clue Scroll Medium (1 in 50), Bronze Spear (1 in 20), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_pasture_bull",
  "title": "Monster: Pasture Bull — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Pasture Bull is a monster at combat level 8 with 8 HP, attacking with crush. Drops: Clue Scroll Medium (1 in 50), Bones (always), Raw Beef (always), Cowhide (always)."
 },
 {
  "id": "monster_broodfang_spider",
  "title": "Monster: Broodfang Spider — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Broodfang Spider is a monster at combat level 27 with 26 HP, attacking with stab. Drops: Marshflax (1 in 2,000), Mistvine (1 in 1,000), Stonefern (1 in 333), Cinderbloom (1 in 250), Snapdrake (1 in 200), Wyrmspice (1 in 167), Emberleaf (1 in 125), Sunblossom (1 in 100), Rynarr Weed (1 in 83), Duskroot (1 in 67), Greenthorn Leaf (1 in 50), Clue Scroll Medium (1 in 50), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_lesser_fiend",
  "title": "Monster: Lesser Fiend — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Lesser Fiend is a monster at combat level 82 with 79 HP, attacking with crush. Drops: Marshflax (1 in 1,000), Mistvine (1 in 500), Stonefern (1 in 167), Cinderbloom (1 in 125), Snapdrake (1 in 100), Wyrmspice (1 in 83), Emberleaf (1 in 63), Runeforged Med Helm (1 in 50), Sunblossom (1 in 50), Clue Scroll Elite (1 in 50), Rynarr Weed (1 in 42), Duskroot (1 in 33), Greenthorn Leaf (1 in 25), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_stoneback_crab",
  "title": "Monster: Stoneback Crab — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Stoneback Crab is a monster at combat level 13 with 50 HP, attacking with crush. Drops: Marshflax (1 in 2,000), Mistvine (1 in 1,000), Stonefern (1 in 333), Cinderbloom (1 in 250), Snapdrake (1 in 200), Wyrmspice (1 in 167), Emberleaf (1 in 125), Sunblossom (1 in 100), Rynarr Weed (1 in 83), Duskroot (1 in 67), Greenthorn Leaf (1 in 50), Clue Scroll Medium (1 in 50), Nature Rune (1 in 13), Iron Ore (1 in 10), Fire Rune (1 in 8), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_duneback_crab",
  "title": "Monster: Duneback Crab — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Duneback Crab is a monster at combat level 15 with 60 HP, attacking with crush. Drops: Marshflax (1 in 2,000), Mistvine (1 in 1,000), Stonefern (1 in 333), Cinderbloom (1 in 250), Snapdrake (1 in 200), Wyrmspice (1 in 167), Emberleaf (1 in 125), Sunblossom (1 in 100), Rynarr Weed (1 in 83), Duskroot (1 in 67), Greenthorn Leaf (1 in 50), Clue Scroll Medium (1 in 50), Nature Rune (1 in 10), Iron Ore (1 in 8), Fire Rune (1 in 8), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_highland_giant",
  "title": "Monster: Highland Giant — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Highland Giant is a monster at combat level 28 with 35 HP, attacking with crush. Drops: Marshflax (1 in 2,000), Mistvine (1 in 1,000), Stonefern (1 in 333), Cinderbloom (1 in 250), Snapdrake (1 in 200), Wyrmspice (1 in 167), Emberleaf (1 in 125), Sunblossom (1 in 100), Rynarr Weed (1 in 83), Duskroot (1 in 67), Greenthorn Leaf (1 in 50), Clue Scroll Medium (1 in 50), Death Rune (1 in 25), Steel Longsword (1 in 25), Iron Full Helm (1 in 20), Chaos Rune (1 in 17), Limpwurt Root (1 in 10), Nature Rune (1 in 10), Water Rune (1 in 7), Fire Rune (1 in 7), Iron Arrow (1 in 3), Coins (1 in 2), Big Bones (always)."
 },
 {
  "id": "monster_briar_giant",
  "title": "Monster: Briar Giant — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Briar Giant is a monster at combat level 42 with 60 HP, attacking with crush. Drops: Marshflax (1 in 2,000), Mistvine (1 in 1,000), Stonefern (1 in 333), Cinderbloom (1 in 250), Snapdrake (1 in 200), Wyrmspice (1 in 167), Emberleaf (1 in 125), Sunblossom (1 in 100), Rynarr Weed (1 in 83), Duskroot (1 in 67), Mithril Scimitar (1 in 50), Greenthorn Leaf (1 in 50), Clue Scroll Hard (1 in 50), Iron Platelegs (1 in 25), Steel Full Helm (1 in 25), Death Rune (1 in 20), Law Rune (1 in 17), Limpwurt Root (1 in 10), Chaos Rune (1 in 10), Nature Rune (1 in 8), Fire Rune (1 in 5), Coins (1 in 2), Big Bones (always)."
 },
 {
  "id": "monster_ember_giant",
  "title": "Monster: Ember Giant — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Ember Giant is a monster at combat level 86 with 111 HP, attacking with slash. Drops: Runeforged Scimitar (1 in 128), Clue Scroll Hard (1 in 67), Mithril Kiteshield (1 in 50), Mithril Chainbody (1 in 50), Staff Of Fire (1 in 40), Mithril Platelegs (1 in 40), Rynarr Weed (1 in 40), Mithril Full Helm (1 in 33), Duskroot Seed (1 in 33), Duskroot (1 in 33), Miremint Seed (1 in 25), Greenthorn Leaf (1 in 25), Greenthorn Seed (1 in 20), Cosmic Rune (1 in 13), Law Rune (1 in 10), Chaos Rune (1 in 8), Nature Rune (1 in 7), Fire Rune (1 in 3), Coins (1 in 2), Big Bones (always)."
 },
 {
  "id": "monster_arcane_adept",
  "title": "Monster: Arcane Adept — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Arcane Adept is a monster at combat level 9 with 17 HP, attacking with magic. Drops: Clue Scroll Medium (1 in 50), Nature Rune (1 in 13), Wizard Robe Top (1 in 13), Chaos Rune (1 in 10), Wizard Hat (1 in 10), Staff (1 in 10), Body Rune (1 in 4), Mind Rune (1 in 3), Water Rune (1 in 3), Earth Rune (1 in 3), Fire Rune (1 in 3), Air Rune (1 in 3), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_umbral_adept",
  "title": "Monster: Umbral Adept — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Umbral Adept is a monster at combat level 20 with 24 HP, attacking with magic. Drops: Clue Scroll Medium (1 in 50), Blood Rune (1 in 25), Magic Staff (1 in 25), Death Rune (1 in 17), Staff Of Water (1 in 17), Staff Of Earth (1 in 17), Staff Of Fire (1 in 17), Law Rune (1 in 13), Staff Of Air (1 in 13), Black Wizard Robe (1 in 10), Cosmic Rune (1 in 8), Black Wizard Hat (1 in 8), Nature Rune (1 in 5), Chaos Rune (1 in 4), Water Rune (1 in 2), Earth Rune (1 in 2), Fire Rune (1 in 2), Air Rune (1 in 2), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_nether_demon",
  "title": "Monster: Nether Demon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Nether Demon is a monster at combat level 124 with 150 HP, attacking with slash. Requires Slayer level 85. Drops: Imbued Brain (1 in 2,448), Magic Sapling (1 in 667), Nether Demon Whip (1 in 500), Imbued Crown (1 in 408), Marshflax (1 in 200), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Runeforged Platelegs (1 in 100), Mistvine (1 in 100), Clue Scroll Hard (1 in 50), Papaya Sapling (1 in 50), Adamant Platelegs (1 in 33), Stonefern (1 in 33), Bogtuber Seed (1 in 33), Cinderbloom (1 in 25), Runeforged Chainbody (1 in 20), Runeforged Med Helm (1 in 20), Snapdrake (1 in 20), Wyrmspice (1 in 17), Emberleaf (1 in 13), Blood Rune (1 in 10), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Duskroot (1 in 7), Death Rune (1 in 5), Chaos Rune (1 in 5), Greenthorn Leaf (1 in 5), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_sanguine_veld",
  "title": "Monster: Sanguine Veld — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Sanguine Veld is a monster at combat level 76 with 75 HP, attacking with stab. Requires Slayer level 50. Drops: Imbued Brain (1 in 13,600), Imbued Crown (1 in 2,267), Rynarr Seed (1 in 500), Runeforged Med Helm (1 in 125), Clue Scroll Hard (1 in 100), Maple Sapling (1 in 100), Banana Sapling (1 in 50), Orange Sapling (1 in 50), Graysage Seed (1 in 33), Bogtuber Seed (1 in 33), Emberleaf (1 in 25), Kingsherb Seed (1 in 25), Rynarr Weed (1 in 20), Sunblossom (1 in 17), Blood Rune (1 in 13), Duskroot (1 in 13), Greenthorn Leaf (1 in 10), Death Rune (1 in 8), Fire Rune (1 in 7), Chaos Rune (1 in 6), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_nether_wraith",
  "title": "Monster: Nether Wraith — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Nether Wraith is a monster at combat level 115 with 105 HP, attacking with slash. Requires Slayer level 80. Drops: Imbued Brain (1 in 3,128), Magic Sapling (1 in 667), Imbued Crown (1 in 521), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Runeforged Chainbody (1 in 83), Clue Scroll Hard (1 in 83), Papaya Sapling (1 in 50), Adamant Platelegs (1 in 40), Cinderbloom (1 in 33), Bogtuber Seed (1 in 33), Snapdrake (1 in 25), Wyrmspice (1 in 20), Rynarr Weed (1 in 13), Blood Rune (1 in 8), Chaos Rune (1 in 7), Death Rune (1 in 6), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_bone_wyvern",
  "title": "Monster: Bone Wyvern — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Bone Wyvern is a monster at combat level 140 with 130 HP, attacking with stab. Requires Slayer level 72. Drops: Imbued Brain (1 in 4,629), Imbued Crown (1 in 771), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Runeforged Chainbody (1 in 100), Papaya Sapling (1 in 83), Runeforged Platelegs (1 in 67), Maple Sapling (1 in 67), Clue Scroll Elite (1 in 56), Curry Sapling (1 in 50), Adamant Platelegs (1 in 33), Mistvine (1 in 33), Stonefern (1 in 25), Bogtuber Seed (1 in 25), Snapdrake (1 in 20), Rynarr Weed (1 in 13), Blood Rune (1 in 7), Death Rune (1 in 6), Chaos Rune (1 in 6), Coins (1 in 1), Dragon Bones (always)."
 },
 {
  "id": "monster_cinder_devil",
  "title": "Monster: Cinder Devil — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Cinder Devil is a monster at combat level 160 with 95 HP, attacking with ranged. Requires Slayer level 85. Drops: Imbued Brain (1 in 2,448), Occult Necklace (1 in 667), Magic Sapling (1 in 667), Imbued Crown (1 in 408), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Runeforged Chainbody (1 in 83), Clue Scroll Elite (1 in 67), Papaya Sapling (1 in 50), Bogtuber Seed (1 in 33), Snapdrake (1 in 25), Wyrmspice (1 in 20), Rynarr Weed (1 in 13), Blood Rune (1 in 7), Fire Rune (1 in 7), Death Rune (1 in 5), Chaos Rune (1 in 5), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_deepmaw_kraken",
  "title": "Boss: Deepmaw Kraken — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Deepmaw Kraken is a boss at combat level 291 with 255 HP, attacking with magic. Requires Slayer level 87. Drops: Imbued Brain (1 in 2,220), Imbued Crown (1 in 370), Deepmaw Kraken Tentacle (1 in 303), Magic Sapling (1 in 125), Clue Scroll Elite (1 in 50), Yew Sapling (1 in 50), Palm Sapling (1 in 50), Papaya Sapling (1 in 33), Mistvine (1 in 25), Rynarr Seed (1 in 25), Snapdrake (1 in 17), Rynarr Weed (1 in 13), Chaos Rune (1 in 6), Blood Rune (1 in 5), Death Rune (1 in 4), Big Bones (always), Coins (always)."
 },
 {
  "id": "monster_warlord_grondar",
  "title": "Boss: Warlord Grondar — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Warlord Grondar is a boss at combat level 624 with 255 HP, attacking with crush. Drops: Grondar Hilt (1 in 508), Grondar Chestplate (1 in 382), Grondar Tassets (1 in 382), Grondar Boots (1 in 382), Godsword Shard (1 in 254), Marshflax (1 in 200), Runeforged Platelegs (1 in 127), Runeforged Plateskirt (1 in 127), Runeforged 2h Sword (1 in 127), Runeforged Pickaxe (1 in 127), Mistvine (1 in 100), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Snapdrake (1 in 20), Wyrmspice (1 in 17), Soul Rune (1 in 13), Emberleaf (1 in 13), Blood Rune (1 in 10), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Death Rune (1 in 7), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Big Bones (always), Coins (always)."
 },
 {
  "id": "monster_commander_zephyra",
  "title": "Boss: Commander Zephyra — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Commander Zephyra is a boss at combat level 596 with 255 HP, attacking with slash. Drops: Zephyra Crossbow (1 in 508), Lumira Hilt (1 in 508), Godsword Shard (1 in 254), Marshflax (1 in 200), Runeforged Platelegs (1 in 127), Runeforged Plateskirt (1 in 127), Lumira Sword (1 in 127), Mistvine (1 in 100), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Snapdrake (1 in 20), Wyrmspice (1 in 17), Soul Rune (1 in 13), Emberleaf (1 in 13), Blood Rune (1 in 10), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Death Rune (1 in 7), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Big Bones (always), Coins (always)."
 },
 {
  "id": "monster_krylth_the_defiler",
  "title": "Boss: Krylth the Defiler — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Krylth the Defiler is a boss at combat level 650 with 255 HP, attacking with slash. Drops: Staff Of The Dead (1 in 508), Krylth Hilt (1 in 508), Godsword Shard (1 in 254), Marshflax (1 in 200), Runeforged Platelegs (1 in 127), Runeforged Plateskirt (1 in 127), Runeforged 2h Sword (1 in 127), Krylth Spear (1 in 127), Mistvine (1 in 100), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Snapdrake (1 in 20), Wyrmspice (1 in 17), Soul Rune (1 in 13), Emberleaf (1 in 13), Blood Rune (1 in 10), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Death Rune (1 in 7), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Big Bones (always), Coins (always)."
 },
 {
  "id": "monster_skyrender_kharra",
  "title": "Boss: Skyrender Kharra — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Skyrender Kharra is a boss at combat level 580 with 255 HP, attacking with ranged. Drops: Zephyra Hilt (1 in 508), Zephyra Helmet (1 in 382), Zephyra Chestplate (1 in 382), Zephyra Chainskirt (1 in 382), Godsword Shard (1 in 254), Marshflax (1 in 200), Runeforged Platelegs (1 in 127), Runeforged Crossbow (1 in 127), Mistvine (1 in 100), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Snapdrake (1 in 20), Wyrmspice (1 in 17), Soul Rune (1 in 13), Emberleaf (1 in 13), Blood Rune (1 in 10), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Death Rune (1 in 7), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Big Bones (always), Coins (always)."
 },
 {
  "id": "monster_green_dragon",
  "title": "Monster: Green Dragon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Green Dragon is a monster at combat level 79 with 75 HP, attacking with slash. Drops: Marshflax (1 in 200), Runeforged Full Helm (1 in 100), Mistvine (1 in 100), Clue Scroll Elite (1 in 50), Stonefern (1 in 33), Adamant Full Helm (1 in 25), Cinderbloom (1 in 25), Snapdrake (1 in 20), Wyrmspice (1 in 17), Law Rune (1 in 13), Emberleaf (1 in 13), Nature Rune (1 in 10), Mithril Arrow (1 in 10), Sunblossom (1 in 10), Chaos Rune (1 in 8), Rynarr Weed (1 in 8), Duskroot (1 in 7), Iron Arrow (1 in 5), Greenthorn Leaf (1 in 5), Coins (1 in 2), Dragon Bones (always), Green Dragonhide (always)."
 },
 {
  "id": "monster_red_dragon",
  "title": "Monster: Red Dragon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Red Dragon is a monster at combat level 152 with 140 HP, attacking with slash. Drops: Marshflax (1 in 200), Mistvine (1 in 100), Runeforged Full Helm (1 in 50), Runeforged Platelegs (1 in 50), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Adamant Full Helm (1 in 20), Snapdrake (1 in 20), Wyrmspice (1 in 17), Emberleaf (1 in 13), Law Rune (1 in 10), Death Rune (1 in 10), Sunblossom (1 in 10), Nature Rune (1 in 8), Rynarr Weed (1 in 8), Chaos Rune (1 in 7), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Coins (1 in 2), Dragon Bones (always), Red Dragon Leather (always)."
 },
 {
  "id": "monster_black_dragon",
  "title": "Monster: Black Dragon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Black Dragon is a monster at combat level 227 with 200 HP, attacking with slash. Drops: Dragon Full Helm (1 in 25,000), Dragon Visage (1 in 20,000), Marshflax (1 in 200), Mistvine (1 in 100), Dragon Platelegs (1 in 83), Dragon Plateskirt (1 in 83), Runeforged Full Helm (1 in 50), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Snapdrake (1 in 20), Wyrmspice (1 in 17), Emberleaf (1 in 13), Law Rune (1 in 10), Death Rune (1 in 10), Sunblossom (1 in 10), Nature Rune (1 in 8), Rynarr Weed (1 in 8), Chaos Rune (1 in 7), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Coins (1 in 2), Dragon Bones (always), Black Dragon Leather (always)."
 },
 {
  "id": "monster_nagadoth_rex",
  "title": "Boss: Nagadoth Rex — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Nagadoth Rex is a boss at combat level 303 with 150 HP, attacking with crush. Drops: Marshflax (1 in 200), Berserker Ring (1 in 128), Warriors Ring (1 in 128), Mistvine (1 in 100), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Runeforged Platelegs (1 in 20), Runeforged Platebody (1 in 20), Dragon Axe (1 in 20), Snapdrake (1 in 20), Wyrmspice (1 in 17), Emberleaf (1 in 13), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Nagadoth Bones (always), Coins (always)."
 },
 {
  "id": "monster_nagadoth_prime",
  "title": "Boss: Nagadoth Prime — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Nagadoth Prime is a boss at combat level 303 with 150 HP, attacking with magic. Drops: Marshflax (1 in 200), Seers Ring (1 in 128), Mistvine (1 in 100), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Runeforged Platelegs (1 in 20), Runeforged Platebody (1 in 20), Dragon Axe (1 in 20), Snapdrake (1 in 20), Wyrmspice (1 in 17), Emberleaf (1 in 13), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Nagadoth Bones (always), Coins (always)."
 },
 {
  "id": "monster_nagadoth_supreme",
  "title": "Boss: Nagadoth Supreme — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Nagadoth Supreme is a boss at combat level 303 with 150 HP, attacking with ranged. Drops: Marshflax (1 in 200), Archers Ring (1 in 128), Mistvine (1 in 100), Clue Scroll Master (1 in 50), Stonefern (1 in 33), Cinderbloom (1 in 25), Runeforged Platelegs (1 in 20), Runeforged Platebody (1 in 20), Dragon Axe (1 in 20), Snapdrake (1 in 20), Wyrmspice (1 in 17), Emberleaf (1 in 13), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Nagadoth Bones (always), Coins (always)."
 },
 {
  "id": "monster_crazy_archaeologist",
  "title": "Monster: Crazy Archaeologist — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Crazy Archaeologist is a monster at combat level 204 with 225 HP, attacking with melee. Drops: Clue Scroll Master (1 in 50), Red D Hide Body (1 in 32), Runeforged Crossbow (1 in 25), Amulet Of Power (1 in 20), White Berries (1 in 20), Sunblossom (1 in 10), Rynarr Weed (1 in 8), Duskroot (1 in 7), Greenthorn Leaf (1 in 5), Bones (always)."
 },
 {
  "id": "monster_king_black_dragon",
  "title": "Boss: King Black Dragon — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "King Black Dragon is a boss at combat level 276 with 150 HP, attacking with slash. Drops: Dragon Visage (1 in 2,000), Dragon Pickaxe (1 in 400), Clue Scroll Master (1 in 50), Soul Rune (1 in 10), Death Rune (1 in 8), Blood Rune (1 in 7), Runeforged Ore (1 in 5), Coins (1 in 2), Dragon Bones (always)."
 },
 {
  "id": "monster_adamant_dragon",
  "title": "Monster: Adamant Dragon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Adamant Dragon is a monster at combat level 338 with 240 HP, attacking with slash. Drops: Uncut Onyx (1 in 1,000), Dragon Visage (1 in 1,000), Dragon Chainbody (1 in 67), Dragon Platelegs (1 in 50), Dragon Plateskirt (1 in 50), Dragon Longsword (1 in 50), Clue Scroll Master (1 in 50), Onyx Bolt Tips (1 in 25), Soul Rune (1 in 10), Nature Rune (1 in 10), Chaos Rune (1 in 8), Blood Rune (1 in 7), Death Rune (1 in 7), Runeforged Ore (1 in 7), Coins (1 in 2), Dragon Bones (always), Runeforged Bar (always)."
 },
 {
  "id": "monster_rune_dragon",
  "title": "Monster: Rune Dragon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Rune Dragon is a monster at combat level 380 with 330 HP, attacking with slash. Drops: Dragon Full Helm (1 in 16,000), Dragon Kiteshield (1 in 16,000), Uncut Onyx (1 in 1,000), Dragon Visage (1 in 1,000), Dragon Chainbody (1 in 50), Clue Scroll Master (1 in 50), Dragon Platelegs (1 in 40), Dragon Plateskirt (1 in 40), Dragon Longsword (1 in 40), Dragon Javelin (1 in 33), Onyx Bolt Tips (1 in 25), Soul Rune (1 in 10), Law Rune (1 in 10), Nature Rune (1 in 10), Blood Rune (1 in 7), Death Rune (1 in 7), Runeforged Ore (1 in 5), Coins (1 in 2), Dragon Bones (always), Runeforged Bar (always)."
 },
 {
  "id": "monster_venomcoil_matriarch",
  "title": "Boss: Venomcoil Matriarch — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Venomcoil Matriarch is a boss at combat level 725 with 500 HP, attacking with ranged. Drops: Venom Blowpipe (1 in 250), Trident Of Venom (1 in 250), Serpentine Helm (1 in 250), Uncut Onyx (1 in 250), Clue Scroll Master (1 in 50), Snapdrake (1 in 10), Rynarr Weed (1 in 7), Dragon Bones (1 in 7), Death Rune (1 in 5), Blood Rune (1 in 5), Chaos Rune (1 in 5), Coins (1 in 1), Venomcoil Scales (always)."
 },
 {
  "id": "monster_ember_tyrant",
  "title": "Boss: Ember Tyrant — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Ember Tyrant is a boss at combat level 702 with 250 HP, attacking with melee. Drops: Clue Scroll Master (1 in 50), Fire Cape (always)."
 },
 {
  "id": "monster_ashen_crucible",
  "title": "Boss: Ashen Crucible — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Ashen Crucible is a boss at combat level 1400 with 600 HP, attacking with melee. Drops: Clue Scroll Master (1 in 50), Infernal Cape (always)."
 },
 {
  "id": "monster_blighted_gauntlet",
  "title": "Boss: Blighted Gauntlet — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Blighted Gauntlet is a boss at combat level 894 with 1000 HP, attacking with crush. Drops: Shardglass Helmet (1 in 250), Shardglass Plate Body (1 in 250), Shardglass Platelegs (1 in 250), Bow Of Faerdhinen (1 in 250), Blade Of Saeldor (1 in 250), Uncut Onyx (1 in 100), Shardglass Pickaxe (1 in 100), Shardglass Axe (1 in 100), Clue Scroll Master (1 in 50), Uncut Dragonstone (1 in 13), Runeforged Med Helm (1 in 10), Uncut Diamond (1 in 8), Snapdrake (1 in 8), Dragon Scimitar (1 in 8), Runeforged Platelegs (1 in 7), Rynarr Weed (1 in 7), Dragon Dagger (1 in 7), Uncut Ruby (1 in 6), Stonefern (1 in 6), Runeforged Platebody (1 in 6), Uncut Emerald (1 in 6), Cinderbloom (1 in 6), Runeforged Full Helm (1 in 6), Blood Rune (1 in 6), Uncut Sapphire (1 in 5), Wyrmspice (1 in 5), Nagadoth Bones (1 in 5), Death Rune (1 in 5), Emberleaf (1 in 5), Duskroot (1 in 4), Greenthorn Leaf (1 in 4), Dragon Bones (1 in 4), Coins (1 in 1), Shardglass Shards (always)."
 },
 {
  "id": "monster_the_great_olm",
  "title": "Raid boss: The Grand Olm (Vaults of Xyren)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "The Grand Olm is a boss fought only inside the Vaults of Xyren raid, at combat level 1000 with 800 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Vaults of Xyren reward chest when the raid is completed."
 },
 {
  "id": "monster_hellbound_gorilla",
  "title": "Boss: Hellbound Gorilla — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Hellbound Gorilla is a boss at combat level 275 with 205 HP, attacking with crush. Requires Slayer level 70. Drops: Imbued Brain (1 in 5,105), Imbued Crown (1 in 851), Uncut Zyrite (1 in 300), Colossal Ballista (1 in 200), Magic Sapling (1 in 125), Clue Scroll Master (1 in 50), Yew Sapling (1 in 50), Palm Sapling (1 in 50), Papaya Sapling (1 in 33), Rynarr Seed (1 in 25), Snapdrake (1 in 7), Soul Rune (1 in 7), Dragon Javelin (1 in 7), Blood Rune (1 in 5), Death Rune (1 in 3), Rynarr Weed (1 in 3), Coins (always), Dragon Bones (always)."
 },
 {
  "id": "monster_the_maiden_of_sugadinti",
  "title": "Raid boss: The Matron of Sugadinti (Crimson Night Theatre)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "The Matron of Sugadinti is a boss fought only inside the Crimson Night Theatre raid, at combat level 940 with 2625 HP, attacking with magic. It has no personal drop table — all raid loot, including uniques, comes from the Crimson Night Theatre reward chest when the raid is completed."
 },
 {
  "id": "monster_pestilent_bloat",
  "title": "Raid boss: Pestilent Blight (Crimson Night Theatre)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Pestilent Blight is a boss fought only inside the Crimson Night Theatre raid, at combat level 870 with 1500 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Crimson Night Theatre reward chest when the raid is completed."
 },
 {
  "id": "monster_nylocas_vasilias",
  "title": "Raid boss: Nylocas Vashilias (Crimson Night Theatre)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Nylocas Vashilias is a boss fought only inside the Crimson Night Theatre raid, at combat level 800 with 1875 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Crimson Night Theatre reward chest when the raid is completed."
 },
 {
  "id": "monster_sotetseg",
  "title": "Raid boss: Sotethseg (Crimson Night Theatre)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Sotethseg is a boss fought only inside the Crimson Night Theatre raid, at combat level 995 with 3000 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Crimson Night Theatre reward chest when the raid is completed."
 },
 {
  "id": "monster_xarpus",
  "title": "Raid boss: Xarphus (Crimson Night Theatre)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Xarphus is a boss fought only inside the Crimson Night Theatre raid, at combat level 960 with 2250 HP, attacking with ranged. It has no personal drop table — all raid loot, including uniques, comes from the Crimson Night Theatre reward chest when the raid is completed."
 },
 {
  "id": "monster_verzik_vitur",
  "title": "Raid boss: Verzik Vitura (Crimson Night Theatre)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Verzik Vitura is a boss fought only inside the Crimson Night Theatre raid, at combat level 1040 with 2000 HP, attacking with magic. It has no personal drop table — all raid loot, including uniques, comes from the Crimson Night Theatre reward chest when the raid is completed."
 },
 {
  "id": "monster_tekton",
  "title": "Raid boss: Tecton (Vaults of Xyren)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Tecton is a boss fought only inside the Vaults of Xyren raid, at combat level 149 with 500 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Vaults of Xyren reward chest when the raid is completed."
 },
 {
  "id": "monster_vespula",
  "title": "Raid boss: Vespara (Vaults of Xyren)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Vespara is a boss fought only inside the Vaults of Xyren raid, at combat level 202 with 400 HP, attacking with ranged. It has no personal drop table — all raid loot, including uniques, comes from the Vaults of Xyren reward chest when the raid is completed."
 },
 {
  "id": "monster_muttadile",
  "title": "Raid boss: Mudtadile (Vaults of Xyren)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Mudtadile is a boss fought only inside the Vaults of Xyren raid, at combat level 170 with 450 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Vaults of Xyren reward chest when the raid is completed."
 },
 {
  "id": "monster_khareth_the_shadowbound",
  "title": "Raid boss: Khareth the Shadowbound (Tomb of Arasmus)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Khareth the Shadowbound is a boss fought only inside the Tomb of Arasmus raid, at combat level 700 with 520 HP, attacking with magic. It has no personal drop table — all raid loot, including uniques, comes from the Tomb of Arasmus reward chest when the raid is completed."
 },
 {
  "id": "monster_gorroth_the_mountain_ape",
  "title": "Raid boss: Gorroth, the Mountain-Ape (Tomb of Arasmus)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Gorroth, the Mountain-Ape is a boss fought only inside the Tomb of Arasmus raid, at combat level 650 with 600 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Tomb of Arasmus reward chest when the raid is completed."
 },
 {
  "id": "monster_khepra_the_scarab_matron",
  "title": "Raid boss: Khepra, the Scarab Matron (Tomb of Arasmus)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Khepra, the Scarab Matron is a boss fought only inside the Tomb of Arasmus raid, at combat level 680 with 500 HP, attacking with ranged. It has no personal drop table — all raid loot, including uniques, comes from the Tomb of Arasmus reward chest when the raid is completed."
 },
 {
  "id": "monster_sebakh_the_devourer",
  "title": "Raid boss: Sebakh the Devourer (Tomb of Arasmus)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Sebakh the Devourer is a boss fought only inside the Tomb of Arasmus raid, at combat level 720 with 580 HP, attacking with magic. It has no personal drop table — all raid loot, including uniques, comes from the Tomb of Arasmus reward chest when the raid is completed."
 },
 {
  "id": "monster_warden_of_arasmus",
  "title": "Raid boss: Warden of Arasmus (Tomb of Arasmus)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Warden of Arasmus is a boss fought only inside the Tomb of Arasmus raid, at combat level 900 with 700 HP, attacking with magic. It has no personal drop table — all raid loot, including uniques, comes from the Tomb of Arasmus reward chest when the raid is completed."
 },
 {
  "id": "monster_morvyn_the_blighted",
  "title": "Raid boss: Morvyn the Blighted (Cryptbound Champions)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Morvyn the Blighted is a boss fought only inside the Cryptbound Champions raid, at combat level 115 with 100 HP, attacking with magic. It has no personal drop table — all raid loot, including uniques, comes from the Cryptbound Champions reward chest when the raid is completed."
 },
 {
  "id": "monster_dravok_the_wretched",
  "title": "Raid boss: Dravok the Wretched (Cryptbound Champions)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Dravok the Wretched is a boss fought only inside the Cryptbound Champions raid, at combat level 115 with 100 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Cryptbound Champions reward chest when the raid is completed."
 },
 {
  "id": "monster_gorath_the_infested",
  "title": "Raid boss: Gorath the Infested (Cryptbound Champions)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Gorath the Infested is a boss fought only inside the Cryptbound Champions raid, at combat level 115 with 100 HP, attacking with stab. It has no personal drop table — all raid loot, including uniques, comes from the Cryptbound Champions reward chest when the raid is completed."
 },
 {
  "id": "monster_kaelor_the_tainted",
  "title": "Raid boss: Kaelor the Tainted (Cryptbound Champions)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Kaelor the Tainted is a boss fought only inside the Cryptbound Champions raid, at combat level 115 with 100 HP, attacking with ranged. It has no personal drop table — all raid loot, including uniques, comes from the Cryptbound Champions reward chest when the raid is completed."
 },
 {
  "id": "monster_torvek_the_corrupted",
  "title": "Raid boss: Torvek the Corrupted (Cryptbound Champions)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Torvek the Corrupted is a boss fought only inside the Cryptbound Champions raid, at combat level 115 with 100 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Cryptbound Champions reward chest when the raid is completed."
 },
 {
  "id": "monster_verin_the_defiled",
  "title": "Raid boss: Verin the Defiled (Cryptbound Champions)",
  "tags": [
   "monster",
   "boss",
   "raid"
  ],
  "text": "Verin the Defiled is a boss fought only inside the Cryptbound Champions raid, at combat level 115 with 100 HP, attacking with crush. It has no personal drop table — all raid loot, including uniques, comes from the Cryptbound Champions reward chest when the raid is completed."
 },
 {
  "id": "monster_marshscale_shaman",
  "title": "Monster: Marshscale Shaman — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Marshscale Shaman is a monster at combat level 150 with 150 HP, attacking with ranged. Requires Slayer level 80. Drops: Imbued Brain (1 in 3,128), Dragon Warhammer (1 in 3,000), Magic Sapling (1 in 667), Imbued Crown (1 in 521), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Papaya Sapling (1 in 50), Bogtuber Seed (1 in 33), Runeforged Chainbody (1 in 20), Rynarr Weed (1 in 10), Snapdrake (1 in 10), Wyrmspice (1 in 10), Runeforged Arrow (1 in 7), Chaos Rune (1 in 7), Death Rune (1 in 7), Blood Rune (1 in 7), Coins (1 in 4), Big Bones (always)."
 },
 {
  "id": "monster_wailing_banshee",
  "title": "Monster: Wailing Banshee — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Wailing Banshee is a monster at combat level 23 with 22 HP, attacking with magic. Requires Slayer level 1. Drops: Imbued Brain (1 in 150,000), Imbued Crown (1 in 25,000), Clue Scroll Medium (1 in 67), Emberleaf (1 in 50), Steel Dagger (1 in 50), Oak Sapling (1 in 50), Duskroot Seed (1 in 40), Rynarr Weed (1 in 33), Miremint Seed (1 in 33), Sunblossom (1 in 25), Death Rune (1 in 20), Duskroot (1 in 20), Iron Dagger (1 in 20), Greenthorn Seed (1 in 20), Greenthorn Leaf (1 in 17), Chaos Rune (1 in 10), Mind Rune (1 in 5), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_warped_spectre",
  "title": "Monster: Warped Spectre — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Warped Spectre is a monster at combat level 96 with 90 HP, attacking with magic. Requires Slayer level 60. Drops: Imbued Brain (1 in 8,332), Imbued Crown (1 in 1,389), Arcanist Robe Top (1 in 500), Arcanist Robe Bottom (1 in 333), Yew Sapling (1 in 250), Arcanist Hat (1 in 200), Arcanist Gloves (1 in 200), Arcanist Boots (1 in 200), Papaya Sapling (1 in 83), Clue Scroll Hard (1 in 67), Maple Sapling (1 in 67), Mistvine (1 in 50), Stonefern (1 in 50), Curry Sapling (1 in 50), Rynarr Seed (1 in 25), Cinderbloom (1 in 25), Bogtuber Seed (1 in 25), Snapdrake (1 in 20), Wyrmspice (1 in 20), Rynarr Weed (1 in 13), Blood Rune (1 in 8), Death Rune (1 in 6), Chaos Rune (1 in 6), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_ash_wyrm",
  "title": "Monster: Ash Wyrm — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Ash Wyrm is a monster at combat level 99 with 130 HP, attacking with magic. Requires Slayer level 62. Drops: Imbued Brain (1 in 7,555), Imbued Crown (1 in 1,259), Arcanist Robe Top (1 in 667), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Clue Scroll Hard (1 in 67), Maple Sapling (1 in 67), Curry Sapling (1 in 50), Mistvine (1 in 33), Snapdrake (1 in 25), Bogtuber Seed (1 in 25), Rynarr Weed (1 in 17), Death Rune (1 in 8), Chaos Rune (1 in 7), Earth Rune (1 in 6), Fire Rune (1 in 6), Coins (1 in 1), Bones (always), Gargoyle Dust (always)."
 },
 {
  "id": "monster_astral_warrior",
  "title": "Monster: Astral Warrior — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Astral Warrior is a monster at combat level 134 with 145 HP, attacking with stab. Requires Slayer level 68. Drops: Imbued Brain (1 in 5,631), Imbued Crown (1 in 938), Dragon Boots (1 in 250), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Runeforged Platelegs (1 in 125), Runeforged Full Helm (1 in 100), Runeforged Chainbody (1 in 83), Clue Scroll Elite (1 in 83), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Curry Sapling (1 in 50), Bogtuber Seed (1 in 25), Snapdrake (1 in 20), Rynarr Weed (1 in 14), Shark (1 in 10), Blood Rune (1 in 7), Death Rune (1 in 6), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_astral_mage",
  "title": "Monster: Astral Mage — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Astral Mage is a monster at combat level 120 with 115 HP, attacking with magic. Requires Slayer level 83. Drops: Imbued Brain (1 in 2,700), Arcanist Robe Top (1 in 667), Magic Sapling (1 in 667), Arcanist Robe Bottom (1 in 500), Imbued Crown (1 in 450), Arcanist Hat (1 in 333), Dragon Boots (1 in 250), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Clue Scroll Elite (1 in 83), Papaya Sapling (1 in 50), Mistvine (1 in 33), Bogtuber Seed (1 in 33), Snapdrake (1 in 25), Rynarr Weed (1 in 17), Blood Rune (1 in 6), Chaos Rune (1 in 6), Death Rune (1 in 5), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_astral_ranger",
  "title": "Monster: Astral Ranger — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Astral Ranger is a monster at combat level 113 with 105 HP, attacking with ranged. Requires Slayer level 63. Drops: Imbued Brain (1 in 7,194), Imbued Crown (1 in 1,199), Dragon Boots (1 in 250), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Clue Scroll Elite (1 in 83), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Curry Sapling (1 in 50), Snapdrake (1 in 25), Bogtuber Seed (1 in 25), Blue Dragon Leather (1 in 20), Rynarr Weed (1 in 17), Green Dragon Leather (1 in 10), Blood Rune (1 in 8), Runeforged Arrow (1 in 7), Death Rune (1 in 7), Chaos Rune (1 in 7), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_runestone_gargoyle",
  "title": "Monster: Runestone Gargoyle — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Runestone Gargoyle is a monster at combat level 111 with 105 HP, attacking with crush. Requires Slayer level 75. Drops: Imbued Brain (1 in 3,996), Gargoyle Maul (1 in 1,333), Magic Sapling (1 in 667), Imbued Crown (1 in 666), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Runeforged Full Helm (1 in 125), Rynarr Seed (1 in 125), Runeforged Chainbody (1 in 83), Clue Scroll Hard (1 in 67), Papaya Sapling (1 in 50), Bogtuber Seed (1 in 33), Snapdrake (1 in 25), Wyrmspice (1 in 20), Rynarr Weed (1 in 14), Blood Rune (1 in 8), Death Rune (1 in 7), Chaos Rune (1 in 7), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_vicious_black_dragon",
  "title": "Monster: Vicious Black Dragon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Vicious Black Dragon is a monster at combat level 318 with 315 HP, attacking with ranged. Requires Slayer level 77. Drops: Imbued Brain (1 in 3,623), Dragon Visage (1 in 1,000), Magic Sapling (1 in 667), Imbued Crown (1 in 604), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Clue Scroll Elite (1 in 56), Papaya Sapling (1 in 50), Thornspire (1 in 33), Bogtuber Seed (1 in 33), Dragon Arrow (1 in 20), Snapdrake (1 in 17), Rynarr Weed (1 in 13), Soul Rune (1 in 8), Runeforged Ore (1 in 7), Runeforged Arrow (1 in 6), Blood Rune (1 in 6), Death Rune (1 in 5), Coins (1 in 2), Dragon Bones (always), Black Dragon Leather (always)."
 },
 {
  "id": "monster_nightfang_beast",
  "title": "Monster: Nightfang Beast — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Nightfang Beast is a monster at combat level 182 with 220 HP, attacking with ranged. Requires Slayer level 90. Drops: Imbued Brain (1 in 1,916), Nightfang Bow (1 in 1,250), Magic Sapling (1 in 667), Imbued Crown (1 in 319), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Runeforged Chainbody (1 in 83), Clue Scroll Elite (1 in 56), Papaya Sapling (1 in 50), Bogtuber Seed (1 in 33), Thornspire (1 in 25), Snapdrake (1 in 17), Rynarr Weed (1 in 13), Runeforged Ore (1 in 8), Blood Rune (1 in 7), Chaos Rune (1 in 7), Runeforged Arrow (1 in 6), Death Rune (1 in 5), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_threefang_cerberus",
  "title": "Boss: Threefang Cerberus — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Threefang Cerberus is a boss at combat level 318 with 600 HP, attacking with crush. Requires Slayer level 91. Drops: Imbued Brain (1 in 1,825), Primeval Crystal (1 in 650), Skyfury Crystal (1 in 650), Evermore Crystal (1 in 650), Imbued Crown (1 in 304), Magic Sapling (1 in 125), Runeforged Platebody (1 in 83), Runeforged 2h Sword (1 in 83), Yew Sapling (1 in 50), Palm Sapling (1 in 50), Clue Scroll Elite (1 in 40), Papaya Sapling (1 in 33), Rynarr Seed (1 in 25), Thornspire (1 in 20), Snapdrake (1 in 13), Rynarr Weed (1 in 10), Soul Rune (1 in 8), Death Rune (1 in 5), Blood Rune (1 in 5), Coins (1 in 2), Dragon Bones (always)."
 },
 {
  "id": "monster_ashen_hydra",
  "title": "Boss: Ashen Hydra — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Ashen Hydra is a boss at combat level 194 with 320 HP, attacking with slash. Requires Slayer level 95. Drops: Imbued Brain (1 in 1,500), Ashen Hydra Claw (1 in 500), Imbued Crown (1 in 250), Ashen Hydra Leather (1 in 200), Magic Sapling (1 in 125), Clue Scroll Elite (1 in 50), Yew Sapling (1 in 50), Palm Sapling (1 in 50), Papaya Sapling (1 in 33), Thornspire (1 in 25), Rynarr Seed (1 in 25), Snapdrake (1 in 17), Rynarr Weed (1 in 13), Runeforged Ore (1 in 10), Soul Rune (1 in 8), Runeforged Arrow (1 in 7), Blood Rune (1 in 6), Death Rune (1 in 5), Coins (1 in 1), Ashen Hydra Bones (always)."
 },
 {
  "id": "monster_dustpaw_rat",
  "title": "Monster: Dustpaw Rat — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Dustpaw Rat is a monster at combat level 4 with 6 HP, attacking with stab. Requires Slayer level 1. Drops: Imbued Brain (1 in 150,000), Imbued Crown (1 in 25,000), Clue Scroll Medium (1 in 200), Oak Sapling (1 in 50), Duskroot Seed (1 in 40), Miremint Seed (1 in 33), Raw Chicken (1 in 20), Greenthorn Seed (1 in 20), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_bogling_sprite",
  "title": "Monster: Bogling Sprite — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Bogling Sprite is a monster at combat level 12 with 14 HP, attacking with magic. Requires Slayer level 3. Drops: Imbued Brain (1 in 136,000), Imbued Crown (1 in 22,667), Clue Scroll Medium (1 in 100), Oak Sapling (1 in 50), Duskroot Seed (1 in 40), Miremint Seed (1 in 33), Iron Dagger (1 in 25), Greenthorn Seed (1 in 20), Greenthorn Leaf (1 in 17), Water Rune (1 in 3), Air Rune (1 in 3), Mind Rune (1 in 3), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_frostbite_imp",
  "title": "Monster: Frostbite Imp — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Frostbite Imp is a monster at combat level 25 with 22 HP, attacking with magic. Requires Slayer level 8. Drops: Imbued Brain (1 in 106,452), Imbued Crown (1 in 17,742), Clue Scroll Medium (1 in 100), Oak Sapling (1 in 50), Duskroot Seed (1 in 40), Miremint Seed (1 in 33), Bronze Kiteshield (1 in 25), Bronze Full Helm (1 in 20), Greenthorn Seed (1 in 20), Duskroot (1 in 10), Chaos Rune (1 in 7), Water Rune (1 in 3), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_marshfen_toad",
  "title": "Monster: Marshfen Toad — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Marshfen Toad is a monster at combat level 30 with 35 HP, attacking with crush. Requires Slayer level 12. Drops: Imbued Brain (1 in 87,508), Imbued Crown (1 in 14,585), Clue Scroll Medium (1 in 67), Oak Sapling (1 in 50), Duskroot Seed (1 in 40), Miremint Seed (1 in 33), Greenthorn Seed (1 in 20), Rynarr Weed (1 in 10), Nature Rune (1 in 10), Duskroot (1 in 7), Iron Arrow (1 in 7), Greenthorn Leaf (1 in 5), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_cinderpaw_cub",
  "title": "Monster: Cinderpaw Cub — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Cinderpaw Cub is a monster at combat level 36 with 40 HP, attacking with slash. Requires Slayer level 15. Drops: Imbued Brain (1 in 75,547), Imbued Crown (1 in 12,591), Clue Scroll Medium (1 in 67), Apple Sapling (1 in 67), Graysage Seed (1 in 50), Willow Sapling (1 in 50), Kingsherb Seed (1 in 33), Steel Dagger (1 in 25), Duskroot Seed (1 in 25), Iron Full Helm (1 in 20), Sunblossom (1 in 8), Emberleaf (1 in 7), Fire Rune (1 in 3), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_glaive_skeleton",
  "title": "Monster: Glaive Skeleton — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Glaive Skeleton is a monster at combat level 45 with 48 HP, attacking with slash. Requires Slayer level 20. Drops: Imbued Brain (1 in 59,134), Imbued Crown (1 in 9,856), Apple Sapling (1 in 67), Clue Scroll Medium (1 in 50), Graysage Seed (1 in 50), Willow Sapling (1 in 50), Steel Scimitar (1 in 40), Kingsherb Seed (1 in 33), Duskroot Seed (1 in 25), Iron Scimitar (1 in 20), Iron Bar (1 in 10), Chaos Rune (1 in 7), Mind Rune (1 in 5), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_mirebound_husk",
  "title": "Monster: Mirebound Husk — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Mirebound Husk is a monster at combat level 52 with 60 HP, attacking with magic. Requires Slayer level 22. Drops: Imbued Brain (1 in 53,615), Imbued Crown (1 in 8,936), Apple Sapling (1 in 67), Clue Scroll Medium (1 in 50), Graysage Seed (1 in 50), Willow Sapling (1 in 50), Kingsherb Seed (1 in 33), Duskroot Seed (1 in 25), Snapdrake (1 in 10), Duskroot (1 in 7), Rynarr Weed (1 in 6), Chaos Rune (1 in 5), Nature Rune (1 in 4), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_verdant_stalker",
  "title": "Monster: Verdant Stalker — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Verdant Stalker is a monster at combat level 58 with 55 HP, attacking with ranged. Requires Slayer level 25. Drops: Imbued Brain (1 in 46,286), Imbued Crown (1 in 7,714), Apple Sapling (1 in 67), Clue Scroll Medium (1 in 50), Graysage Seed (1 in 50), Willow Sapling (1 in 50), Kingsherb Seed (1 in 33), Duskroot Seed (1 in 25), Shortbow (1 in 20), Emberleaf (1 in 7), Greenthorn Leaf (1 in 5), Iron Arrow (1 in 3), Feather (1 in 3), Coins (1 in 2), Bones (always)."
 },
 {
  "id": "monster_stoneglare_basilisk",
  "title": "Monster: Stoneglare Basilisk — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Stoneglare Basilisk is a monster at combat level 62 with 70 HP, attacking with slash. Requires Slayer level 28. Drops: Imbued Brain (1 in 39,960), Imbued Crown (1 in 6,660), Clue Scroll Hard (1 in 83), Apple Sapling (1 in 67), Graysage Seed (1 in 50), Willow Sapling (1 in 50), Uncut Emerald (1 in 33), Kingsherb Seed (1 in 33), Duskroot Seed (1 in 25), Uncut Sapphire (1 in 20), Mithril Bar (1 in 20), Nature Rune (1 in 5), Earth Rune (1 in 3), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_embertongue_lizard",
  "title": "Monster: Embertongue Lizard — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Embertongue Lizard is a monster at combat level 68 with 75 HP, attacking with magic. Requires Slayer level 32. Drops: Imbued Brain (1 in 32,849), Imbued Crown (1 in 5,475), Clue Scroll Hard (1 in 67), Apple Sapling (1 in 67), Graysage Seed (1 in 50), Willow Sapling (1 in 50), Kingsherb Seed (1 in 33), Uncut Ruby (1 in 25), Duskroot Seed (1 in 25), Wyrmspice (1 in 8), Sunblossom (1 in 8), Emberleaf (1 in 6), Nature Rune (1 in 5), Fire Rune (1 in 3), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_hollow_reaver",
  "title": "Monster: Hollow Reaver — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Hollow Reaver is a monster at combat level 75 with 85 HP, attacking with slash. Requires Slayer level 38. Drops: Imbued Brain (1 in 24,483), Imbued Crown (1 in 4,080), Rynarr Seed (1 in 500), Maple Sapling (1 in 100), Clue Scroll Hard (1 in 56), Banana Sapling (1 in 50), Orange Sapling (1 in 50), Graysage Seed (1 in 33), Bogtuber Seed (1 in 33), Adamant Scimitar (1 in 25), Kingsherb Seed (1 in 25), Snapdrake (1 in 8), Death Rune (1 in 6), Rynarr Weed (1 in 6), Chaos Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_briarheart_treant",
  "title": "Monster: Briarheart Treant — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Briarheart Treant is a monster at combat level 82 with 110 HP, attacking with crush. Requires Slayer level 42. Drops: Imbued Brain (1 in 20,126), Imbued Crown (1 in 3,354), Rynarr Seed (1 in 500), Maple Sapling (1 in 100), Clue Scroll Hard (1 in 50), Banana Sapling (1 in 50), Orange Sapling (1 in 50), Graysage Seed (1 in 33), Bogtuber Seed (1 in 33), Uncut Emerald (1 in 25), Kingsherb Seed (1 in 25), Yew Logs (1 in 10), Rynarr Weed (1 in 7), Maple Logs (1 in 5), Greenthorn Leaf (1 in 5), Willow Logs (1 in 3), Oak Logs (1 in 3), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_frostmaw_direwolf",
  "title": "Monster: Frostmaw Direwolf — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Frostmaw Direwolf is a monster at combat level 85 with 95 HP, attacking with slash. Requires Slayer level 45. Drops: Imbued Brain (1 in 17,375), Imbued Crown (1 in 2,896), Rynarr Seed (1 in 500), Maple Sapling (1 in 100), Clue Scroll Hard (1 in 50), Banana Sapling (1 in 50), Orange Sapling (1 in 50), Graysage Seed (1 in 33), Bogtuber Seed (1 in 33), Uncut Ruby (1 in 25), Kingsherb Seed (1 in 25), Adamant Scimitar (1 in 20), Adamant Bar (1 in 13), Iron Bar (1 in 7), Raw Beef (1 in 5), Cowhide (1 in 4), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_pyreclaw_demon",
  "title": "Monster: Pyreclaw Demon — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Pyreclaw Demon is a monster at combat level 88 with 100 HP, attacking with magic. Requires Slayer level 50. Drops: Imbued Brain (1 in 13,600), Imbued Crown (1 in 2,267), Rynarr Seed (1 in 500), Maple Sapling (1 in 100), Banana Sapling (1 in 50), Orange Sapling (1 in 50), Clue Scroll Hard (1 in 45), Graysage Seed (1 in 33), Bogtuber Seed (1 in 33), Kingsherb Seed (1 in 25), Runeforged Ore (1 in 13), Wyrmspice (1 in 7), Emberleaf (1 in 6), Death Rune (1 in 5), Chaos Rune (1 in 4), Fire Rune (1 in 3), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_wraithgale_specter",
  "title": "Monster: Wraithgale Specter — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Wraithgale Specter is a monster at combat level 92 with 95 HP, attacking with magic. Requires Slayer level 55. Drops: Imbued Brain (1 in 10,645), Imbued Crown (1 in 1,774), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Curry Sapling (1 in 50), Clue Scroll Hard (1 in 45), Uncut Diamond (1 in 33), Bogtuber Seed (1 in 25), Blood Rune (1 in 7), Snapdrake (1 in 7), Death Rune (1 in 5), Nature Rune (1 in 5), Rynarr Weed (1 in 5), Chaos Rune (1 in 4), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_bloodmoon_stalker",
  "title": "Monster: Bloodmoon Stalker — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Bloodmoon Stalker is a monster at combat level 93 with 90 HP, attacking with ranged. Requires Slayer level 58. Drops: Imbued Brain (1 in 9,190), Imbued Crown (1 in 1,532), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Curry Sapling (1 in 50), Clue Scroll Hard (1 in 45), Uncut Dragonstone (1 in 40), Bogtuber Seed (1 in 25), Magic Shortbow (1 in 20), Thornspire (1 in 10), Runeforged Ore (1 in 10), Runeforged Arrow (1 in 3), Feather (1 in 3), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_ironfang_drake",
  "title": "Monster: Ironfang Drake — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Ironfang Drake is a monster at combat level 96 with 130 HP, attacking with slash. Requires Slayer level 60. Drops: Imbued Brain (1 in 8,332), Dragon Visage (1 in 5,000), Imbued Crown (1 in 1,389), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Clue Scroll Elite (1 in 56), Curry Sapling (1 in 50), Uncut Dragonstone (1 in 29), Bogtuber Seed (1 in 25), Thornspire (1 in 10), Runeforged Ore (1 in 7), Wyrmspice (1 in 7), Runeforged Arrow (1 in 4), Coins (1 in 1), Dragon Bones (always)."
 },
 {
  "id": "monster_shadeglass_golem",
  "title": "Monster: Shadeglass Golem — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Shadeglass Golem is a monster at combat level 97 with 140 HP, attacking with crush. Requires Slayer level 65. Drops: Imbued Brain (1 in 6,522), Imbued Crown (1 in 1,087), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Clue Scroll Elite (1 in 56), Curry Sapling (1 in 50), Uncut Diamond (1 in 33), Runeforged Med Helm (1 in 25), Bogtuber Seed (1 in 25), Runeforged Bar (1 in 10), Runeforged Ore (1 in 7), Soft Clay (1 in 4), Molten Glass (1 in 3), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_tidereaper_crab",
  "title": "Monster: Tidereaper Crab — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Tidereaper Crab is a monster at combat level 98 with 130 HP, attacking with crush. Requires Slayer level 68. Drops: Imbued Brain (1 in 5,631), Imbued Crown (1 in 938), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Clue Scroll Elite (1 in 50), Curry Sapling (1 in 50), Uncut Dragonstone (1 in 40), Bogtuber Seed (1 in 25), Thornspire (1 in 13), Runeforged Ore (1 in 10), Uncut Sapphire (1 in 7), Raw Eel (1 in 4), Raw Crab (1 in 3), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_voidweave_stalker",
  "title": "Monster: Voidweave Stalker — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Voidweave Stalker is a monster at combat level 99 with 120 HP, attacking with magic. Requires Slayer level 70. Drops: Imbued Brain (1 in 5,105), Imbued Crown (1 in 851), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Clue Scroll Elite (1 in 50), Curry Sapling (1 in 50), Uncut Diamond (1 in 25), Bogtuber Seed (1 in 25), Snapdrake (1 in 7), Soul Rune (1 in 6), Rynarr Weed (1 in 5), Blood Rune (1 in 4), Chaos Rune (1 in 4), Death Rune (1 in 3), Coins (1 in 1), Bones (always)."
 },
 {
  "id": "monster_drakthul_wyrmling",
  "title": "Monster: Drakthul Wyrmling — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Drakthul Wyrmling is a monster at combat level 99 with 135 HP, attacking with magic. Requires Slayer level 73. Drops: Dragon Visage (1 in 5,000), Imbued Brain (1 in 4,407), Imbued Crown (1 in 735), Yew Sapling (1 in 250), Rynarr Seed (1 in 200), Papaya Sapling (1 in 83), Maple Sapling (1 in 67), Curry Sapling (1 in 50), Clue Scroll Elite (1 in 45), Uncut Dragonstone (1 in 25), Runeforged Chainbody (1 in 25), Bogtuber Seed (1 in 25), Thornspire (1 in 8), Runeforged Ore (1 in 7), Wyrmspice (1 in 6), Fire Rune (1 in 3), Coins (1 in 1), Dragon Bones (always)."
 },
 {
  "id": "monster_bonelight_pyromancer",
  "title": "Monster: Bonelight Pyromancer — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Bonelight Pyromancer is a monster at combat level 99 with 110 HP, attacking with magic. Requires Slayer level 75. Drops: Imbued Brain (1 in 3,996), Magic Sapling (1 in 667), Imbued Crown (1 in 666), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Papaya Sapling (1 in 50), Clue Scroll Elite (1 in 45), Bogtuber Seed (1 in 33), Uncut Diamond (1 in 29), Snapdrake (1 in 7), Soul Rune (1 in 6), Nature Rune (1 in 5), Rynarr Weed (1 in 5), Death Rune (1 in 4), Fire Rune (1 in 3), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_cinderfang_reaver",
  "title": "Monster: Cinderfang Reaver — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Cinderfang Reaver is a monster at combat level 99 with 130 HP, attacking with slash. Requires Slayer level 77. Drops: Imbued Brain (1 in 3,623), Magic Sapling (1 in 667), Imbued Crown (1 in 604), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Papaya Sapling (1 in 50), Clue Scroll Elite (1 in 45), Uncut Dragonstone (1 in 33), Bogtuber Seed (1 in 33), Runeforged Scimitar (1 in 22), Runeforged Ore (1 in 7), Wyrmspice (1 in 7), Emberleaf (1 in 6), Runeforged Arrow (1 in 4), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_ashen_marauder",
  "title": "Monster: Ashen Marauder — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Ashen Marauder is a monster at combat level 99 with 140 HP, attacking with crush. Requires Slayer level 79. Drops: Imbued Brain (1 in 3,285), Magic Sapling (1 in 667), Imbued Crown (1 in 547), Yew Sapling (1 in 167), Palm Sapling (1 in 167), Rynarr Seed (1 in 125), Papaya Sapling (1 in 50), Clue Scroll Elite (1 in 45), Bogtuber Seed (1 in 33), Uncut Dragonstone (1 in 29), Runeforged 2h Sword (1 in 25), Amulet Of Strength (1 in 17), Runeforged Bar (1 in 8), Wyrmspice (1 in 7), Runeforged Ore (1 in 6), Emberleaf (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_sovrathar_the_ashen_sovereign",
  "title": "Boss: Sovrathar, the Ashen Sovereign — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Sovrathar, the Ashen Sovereign is a boss at combat level 250 with 480 HP, attacking with slash. Requires Slayer level 80. Drops: Imbued Brain (1 in 3,128), Imbued Crown (1 in 521), Ashen Sovereigns Edge (1 in 250), Sovereigns Cinderplate (1 in 150), Sovereigns Cindergreaves (1 in 150), Cinderforged Helm (1 in 125), Magic Sapling (1 in 125), Yew Sapling (1 in 50), Palm Sapling (1 in 50), Sovrathar Ashen Hilt (1 in 45), Clue Scroll Master (1 in 33), Papaya Sapling (1 in 33), Rynarr Seed (1 in 25), Thornspire (1 in 8), Runeforged Bar (1 in 7), Snapdrake (1 in 7), Runeforged Ore (1 in 5), Rynarr Weed (1 in 5), Soul Rune (1 in 5), Blood Rune (1 in 4), Death Rune (1 in 3), Coins (1 in 1), Dragon Bones (always)."
 },
 {
  "id": "monster_gravehusk_brute",
  "title": "Boss: Gravehusk Brute — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Gravehusk Brute is a boss at combat level 82 with 60 HP, attacking with crush. Drops: Gravehusk Platebody (1 in 250), Gravehusk Helm (1 in 167), Clue Scroll Hard (1 in 40), Rynarr Weed (1 in 10), Earth Rune (1 in 5), Chaos Rune (1 in 4), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_boneclaw_revenant",
  "title": "Boss: Boneclaw Revenant — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Boneclaw Revenant is a boss at combat level 98 with 75 HP, attacking with stab. Drops: Boneclaw Rapier (1 in 200), Boneclaw Shield (1 in 167), Clue Scroll Hard (1 in 40), Rynarr Weed (1 in 10), Blood Rune (1 in 8), Chaos Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_shroudwraith_specter",
  "title": "Boss: Shroudwraith Specter — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Shroudwraith Specter is a boss at combat level 115 with 90 HP, attacking with magic. Drops: Shroud Robes Top (1 in 200), Shroud Staff (1 in 200), Clue Scroll Hard (1 in 40), Snapdrake (1 in 13), Soul Rune (1 in 7), Death Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_stonegale_elemental",
  "title": "Boss: Stonegale Elemental — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Stonegale Elemental is a boss at combat level 100 with 80 HP, attacking with magic. Drops: Stonegale Bow (1 in 200), Stonegale Coif (1 in 167), Clue Scroll Hard (1 in 40), Rynarr Weed (1 in 10), Earth Rune (1 in 5), Air Rune (1 in 4), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_cindermaw_serpent",
  "title": "Boss: Cindermaw Serpent — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Cindermaw Serpent is a boss at combat level 120 with 100 HP, attacking with crush. Drops: Cindermaw Maul (1 in 250), Cindermaw Scale Body (1 in 200), Clue Scroll Hard (1 in 45), Snapdrake (1 in 13), Chaos Rune (1 in 6), Fire Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_thornhide_colossus",
  "title": "Boss: Thornhide Colossus — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Thornhide Colossus is a boss at combat level 140 with 120 HP, attacking with slash. Drops: Thornhide Platelegs (1 in 250), Thornhide Gauntlets (1 in 167), Clue Scroll Hard (1 in 45), Thornspire (1 in 13), Rynarr Weed (1 in 8), Nature Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_gravethorn_drake",
  "title": "Boss: Gravethorn Drake — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Gravethorn Drake is a boss at combat level 110 with 90 HP, attacking with ranged. Drops: Thornspine Shortbow (1 in 250), Drake Leather Body (1 in 200), Clue Scroll Hard (1 in 40), Rynarr Weed (1 in 10), Nature Rune (1 in 5), Earth Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_ironclad_guardian",
  "title": "Boss: Ironclad Guardian — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Ironclad Guardian is a boss at combat level 130 with 110 HP, attacking with stab. Drops: Ironclad Longsword (1 in 250), Ironclad Helm (1 in 200), Clue Scroll Hard (1 in 45), Snapdrake (1 in 13), Blood Rune (1 in 8), Death Rune (1 in 6), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_emberhowl_warlord",
  "title": "Boss: Emberhowl Warlord — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Emberhowl Warlord is a boss at combat level 155 with 150 HP, attacking with crush. Drops: Emberhowl Axe (1 in 250), Emberhowl Boots (1 in 200), Clue Scroll Hard (1 in 50), Thornspire (1 in 10), Chaos Rune (1 in 6), Fire Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_razorwing_harpy",
  "title": "Boss: Razorwing Harpy — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "Razorwing Harpy is a boss at combat level 150 with 140 HP, attacking with ranged. Drops: Razorwing Crossbow (1 in 250), Razorwing Vambraces (1 in 200), Clue Scroll Hard (1 in 50), Snapdrake (1 in 13), Blood Rune (1 in 7), Death Rune (1 in 5), Coins (1 in 1), Big Bones (always)."
 },
 {
  "id": "monster_elder_tree_spirit",
  "title": "Monster: Elder Tree Spirit — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Elder Tree Spirit is a monster at combat level 70 with 200 HP, attacking with magic. Drops: Magic Sapling (1 in 128), Yew Sapling (1 in 64), Runeforged Axe (1 in 64), Clue Scroll Medium (1 in 50), Maple Sapling (1 in 32), Adamant Axe (1 in 32), Willow Sapling (1 in 16), Mithril Axe (1 in 16), Steel Axe (1 in 12), Crushed Bird S Nest (1 in 10), Oak Sapling (1 in 8), Iron Axe (1 in 8), Bronze Axe (1 in 4), Coins (1 in 1)."
 },
 {
  "id": "monster_elder_rock_golem",
  "title": "Monster: Elder Rock Golem — stats and drops",
  "tags": [
   "monster",
   "drops"
  ],
  "text": "Elder Rock Golem is a monster at combat level 70 with 200 HP, attacking with crush. Drops: Uncut Diamond (1 in 128), Uncut Ruby (1 in 64), Runeforged Pickaxe (1 in 64), Clue Scroll Medium (1 in 50), Adamantite Ore (1 in 32), Uncut Emerald (1 in 32), Adamant Pickaxe (1 in 32), Mithril Ore (1 in 16), Uncut Sapphire (1 in 16), Mithril Pickaxe (1 in 16), Steel Pickaxe (1 in 12), Coal (1 in 10), Iron Ore (1 in 8), Iron Pickaxe (1 in 8), Copper Ore (1 in 5), Tin Ore (1 in 5), Bronze Pickaxe (1 in 4), Coins (1 in 1)."
 },
 {
  "id": "monster_duskmare",
  "title": "Boss: The Duskmare — stats and drops",
  "tags": [
   "monster",
   "drops",
   "boss"
  ],
  "text": "The Duskmare is a boss at combat level 470 with 1500 HP, attacking with magic. Drops: Umbral Orb (1 in 100), Attuned Orb (1 in 100), Volatile Orb (1 in 100), Clue Scroll Master (1 in 50), Duskmare Staff (1 in 45), Wrath Rune (1 in 17), Soul Rune (1 in 10), Blood Rune (1 in 7), Death Rune (1 in 5), Big Bones (always), Coins (always)."
 },
 {
  "id": "clue_medium",
  "title": "Clue scroll tier: medium",
  "tags": [
   "clue",
   "clues",
   "clue scroll"
  ],
  "text": "A medium clue scroll takes about 5 minutes to complete and rewards 1 to 4 rolls from a table of 45 possible rewards (runes, coins and gear). Rare uniques: Pathfinder Boots, Spellweaver Boots, Holy Sandals, Spiked Manacles, Climbing Boots G, Lumira Mitre, Verdant Mitre, Krylth Mitre, Ancient Mitre, Zephyra Mitre, Grondar Mitre, Sacred Charm, Peace Blessing, Profane Charm, Honorable Blessing, Battle Charm, Elder Charm, Lumira Stole, Verdant Stole, Krylth Stole, Ancient Stole, Zephyra Stole, Grondar Stole, Robin Hood Hat."
 },
 {
  "id": "clue_hard",
  "title": "Clue scroll tier: hard",
  "tags": [
   "clue",
   "clues",
   "clue scroll"
  ],
  "text": "A hard clue scroll takes about 15 minutes to complete and rewards 1 to 4 rolls from a table of 70 possible rewards (runes, coins and gear). Rare uniques: Lumira D Hide Body, Lumira D Hide Chaps, Lumira D Hide Boots, Lumira D Hide Bracers, Lumira Coif, Verdant D Hide Body, Verdant D Hide Chaps, Verdant D Hide Boots, Verdant D Hide Bracers, Verdant Coif, Krylth D Hide Body, Krylth D Hide Chaps, Krylth D Hide Boots, Krylth D Hide Bracers, Krylth Coif, Ancient D Hide Body, Ancient D Hide Chaps, Ancient D Hide Boots, Ancient D Hide Bracers, Ancient Coif, Zephyra D Hide Body, Zephyra D Hide Chaps, Zephyra D Hide Boots, Zephyra D Hide Bracers, Zephyra Coif, Grondar D Hide Body, Grondar D Hide Chaps, Grondar D Hide Boots, Grondar D Hide Bracers, Grondar Coif, Amulet Of Glory T, 2nd Age Full Helm, 2nd Age Platebody, 2nd Age Platelegs, 2nd Age Plateskirt, 2nd Age Kiteshield, 2nd Age Range Coif, 2nd Age Range Top, 2nd Age Range Legs, 2nd Age Vambraces, 2nd Age Mage Hat, 2nd Age Robe Top, 2nd Age Robe Legs, 2nd Age Amulet, Lumira D Hide Shield, Verdant D Hide Shield, Krylth D Hide Shield, Ancient D Hide Shield, Zephyra D Hide Shield, Grondar D Hide Shield."
 },
 {
  "id": "clue_elite",
  "title": "Clue scroll tier: elite",
  "tags": [
   "clue",
   "clues",
   "clue scroll"
  ],
  "text": "A elite clue scroll takes about 30 minutes to complete and rewards 1 to 4 rolls from a table of 30 possible rewards (runes, coins and gear). Rare uniques: 2nd Age Longsword, 2nd Age Bow, 2nd Age Wand, 2nd Age Cloak."
 },
 {
  "id": "clue_master",
  "title": "Clue scroll tier: master",
  "tags": [
   "clue",
   "clues",
   "clue scroll"
  ],
  "text": "A master clue scroll takes about 60 minutes to complete and rewards 1 to 4 rolls from a table of 22 possible rewards (runes, coins and gear). Rare uniques: 2nd Age Druidic Robe Top, 2nd Age Druidic Robe Bottoms, 2nd Age Druidic Cloak, 2nd Age Druidic Staff, 2nd Age Pickaxe, 2nd Age Axe, Gold Pickaxe, Gold Axe, Gold Spade, Fancy Tiara."
 },
 {
  "id": "daily_tasks_novice",
  "title": "Daily tasks: Novice tier pool",
  "tags": [
   "daily",
   "daily tasks",
   "tasks"
  ],
  "text": "Novice daily tasks — one is assigned each day from this pool of 28: Craft Leather Gloves, Cut a Sapphire, Mine Iron Ore, Chop Oak Logs, Cook Shrimps, Catch Shrimps, Cull the Field Chickens, Rout the Cave Goblins, Smelt Bronze Bars, Craft a Leather Body, Defeat Pasture Bulls, Earn Mining XP, Earn Prayer XP, Cook Chicken, Mine Tin Ore, Chop Logs, Smith a Bronze Dagger, Craft Leather Boots, Craft a Leather Cowl, Fletch Arrow Shafts, Fletch Headless Arrows, Brew an Attack Potion, Craft Air Runes, Craft Fire Runes, Cull the Dustpaw Rats, Scatter the Bogling Sprites, Complete a Medium Clue, Hunt Cows."
 },
 {
  "id": "daily_tasks_intermediate",
  "title": "Daily tasks: Intermediate tier pool",
  "tags": [
   "daily",
   "daily tasks",
   "tasks"
  ],
  "text": "Intermediate daily tasks — one is assigned each day from this pool of 29: Cull the Lesser Fiends, Crack the Stoneback Crabs, Mine Mithril Ore, Cook Trout, Chop Willow Logs, Catch Trout, Smelt Iron Bars, Smith an Iron Scimitar, Craft a Hard Leather Body, Cut an Emerald, Slay the Highland Giants, Exterminate Broodfang Spiders, Complete a Slayer Task, Hunt the Duneback Crabs, Mine Coal, Mine Gold Ore, Chop Teak Logs, Chop Maple Logs, Catch Crabs, Brew Defence Potions, Brew a Prayer Potion, Craft Chaos Runes, Smelt Steel Bars, Fletch Willow Shortbows, Craft a Sapphire Amulet, Silence the Wailing Banshees, Banish Frostbite Imps, Hunt the Jeweller, Complete a Hard Clue."
 },
 {
  "id": "daily_tasks_experienced",
  "title": "Daily tasks: Experienced tier pool",
  "tags": [
   "daily",
   "daily tasks",
   "tasks"
  ],
  "text": "Experienced daily tasks — one is assigned each day from this pool of 29: Banish Arcane Adepts, Dispel Umbral Adepts, Mine Adamantite Ore, Cook Sharks, Chop Yew Logs, Catch Sharks, Smelt Adamant Bars, Cut a Ruby, Bind the Nether Demons, Topple the Briar Giants, Complete a Quest, Earn Agility XP, Slay the Sanguine Veld, Smith a Runeforged Scimitar, Slay the King Black Dragon, Slay the Deepmaw Kraken, Chop Mahogany Logs, Catch Raw Eels, Cook Karam, Fletch Yew Shortbows, Brew Super Strength, Brew a Ranging Potion, Craft Nature Runes, Craft Death Runes, Cut Down the Hollow Reavers, Slay Green Dragons, Complete a Minigame, Hunt the Grim Reaper, Complete an Elite Clue."
 },
 {
  "id": "daily_tasks_master",
  "title": "Daily tasks: Master tier pool",
  "tags": [
   "daily",
   "daily tasks",
   "tasks"
  ],
  "text": "Master daily tasks — one is assigned each day from this pool of 24: Slay Warlord Grondar, Slay Commander Zephyra, Slay Skyrender Kharra, Slay Krylth the Defiler, Conquer the Vaults of Xyren, Conquer the Cryptbound Champions, Mine Runite Ore, Chop Redwood Logs, Catch Anglerfish, Cook Anglerfish, Forge a Godsword Blade, Banish Nether Wraiths, Craft a Black D'hide Body, Catch Manta Rays, Cook Manta Rays, Fletch a Magic Shortbow, Brew a Lumira Brew, Craft Blood Runes, Craft a Dragonstone Amulet, Slay Black Dragons, Fell the Bone Wyverns, Defeat the Cinder Devils, Slay Nagadoth Rex, Smith a Runeforged Platebody."
 },
 {
  "id": "daily_tasks_grandmaster",
  "title": "Daily tasks: Grandmaster tier pool",
  "tags": [
   "daily",
   "daily tasks",
   "tasks"
  ],
  "text": "Grandmaster daily tasks — one is assigned each day from this pool of 24: Conquer the Crimson Night Theatre, Conquer the Tomb of Arasmus, Vanquish Warlord Grondar, Vanquish Commander Zephyra, Slay the Venomcoil Matriarch, Conquer the Blighted Gauntlet, Slay the Ember Tyrant, Slay the Ashen Crucible, Craft an Onyx Amulet, Cut a Zyrite, Craft Soul Runes, Forge a Visage Shield, Slay the Hellbound Gorilla, Brew Super Combat Potions, Craft Wrath Runes, Fletch Onyx Dragon Bolts, Hunt Master Trader, Cut an Onyx, Slay Nagadoth Prime, Slay Nagadoth Supreme, Slay the Threefang Cerberus, Conquer the Vaults of Xyren, Complete a Master Clue, Conquer the Cryptbound Champions."
 },
 {
  "id": "collection_log_monsters",
  "title": "Collection log: Monsters slots",
  "tags": [
   "collection log",
   "collection",
   "uniques"
  ],
  "text": "The Monsters collection log has 98 slots. The Duskmare: Duskmare Staff, Umbral Orb, Attuned Orb, Volatile Orb. Nether Demon: Nether Demon Whip. Adamant Dragon: Uncut Onyx, Dragon Visage. Vicious Black Dragon: Dragon Visage. Threefang Cerberus: Primeval Crystal, Skyfury Crystal, Evermore Crystal, Imbued Crown, Imbued Brain. Commander Zephyra: Lumira Sword, Zephyra Crossbow, Lumira Hilt. Blighted Gauntlet: Uncut Onyx, Shardglass Pickaxe, Shardglass Axe, Shardglass Helmet, Shardglass Plate Body, Shardglass Platelegs, Bow Of Faerdhinen, Blade Of Saeldor. Nagadoth Prime: Dragon Axe, Seers Ring. Nagadoth Rex: Dragon Axe, Berserker Ring, Warriors Ring. Nagadoth Supreme: Dragon Axe, Archers Ring. Nightfang Beast: Nightfang Bow. Hellbound Gorilla: Uncut Zyrite, Colossal Ballista, Imbued Crown, Imbued Brain. Runestone Gargoyle: Gargoyle Maul. Warlord Grondar: Grondar Chestplate, Grondar Tassets, Grondar Boots, Grondar Hilt. Ashen Hydra: Ashen Hydra Leather, Ashen Hydra Claw, Imbued Crown, Imbued Brain. Krylth the Defiler: Krylth Spear, Staff Of The Dead, Krylth Hilt. King Black Dragon: Dragon Pickaxe, Dragon Visage. Black Dragon: Dragon Visage, Dragon Full Helm. Deepmaw Kraken: Deepmaw Kraken Tentacle, Imbued Crown, Imbued Brain. Skyrender Kharra: Zephyra Helmet, Zephyra Chestplate, Zephyra Chainskirt, Zephyra Hilt. Marshscale Shaman: Dragon Warhammer. Runeforged Dragon: Uncut Onyx, Dragon Visage. Cinder Devil: Occult Necklace. Astral Mage: Dragon Boots. Astral Ranger: Dragon Boots. Astral Warrior: Dragon Boots. Venomcoil Matriarch: Venom Blowpipe, Trident Of Venom, Serpentine Helm, Uncut Onyx. Sovrathar, the Ashen Sovereign: Sovrathar Ashen Hilt, Cinderforged Helm, Sovereigns Cinderplate, Sovereigns Cindergreaves, Ashen Sovereigns Edge, Ashen Slayer Helm, Imbued Crown, Imbued Brain. Gravehusk Brute: Gravehusk Helm, Gravehusk Platebody. Boneclaw Revenant: Boneclaw Rapier, Boneclaw Shield. Shroudwraith Specter: Shroud Robes Top, Shroud Staff. Stonegale Elemental: Stonegale Bow, Stonegale Coif. Cindermaw Serpent: Cindermaw Maul, Cindermaw Scale Body. Thornhide Colossus: Thornhide Platelegs, Thornhide Gauntlets. Gravethorn Drake: Thornspine Shortbow, Drake Leather Body. Ironclad Guardian: Ironclad Longsword, Ironclad Helm. Emberhowl Warlord: Emberhowl Axe, Emberhowl Boots. Razorwing Harpy: Razorwing Crossbow, Razorwing Vambraces."
 },
 {
  "id": "collection_log_raids",
  "title": "Collection log: Raids slots",
  "tags": [
   "collection log",
   "collection",
   "uniques"
  ],
  "text": "The Raids collection log has 49 slots. Cryptbound Champions: Morvyn S Hood, Morvyn S Robetop, Morvyn S Robeskirt, Morvyn S Staff, Dravok S Helm, Dravok S Platebody, Dravok S Platelegs, Dravok S Greataxe, Gorath S Helm, Gorath S Platebody, Gorath S Chainskirt, Gorath S Warspear, Kaelor S Coif, Kaelor S Leathertop, Kaelor S Leatherskirt, Kaelor S Crossbow, Torvek S Helm, Torvek S Platebody, Torvek S Platelegs, Torvek S Hammers, Verin S Helm, Verin S Brassard, Verin S Plateskirt, Verin S Flail. Vaults of Xyren: Warped Buckler, Dragon Slayer Crossbow, Durn S Bulwark, Kodai Hat, Kodai Robe Top, Kodai Robe Bottom, Dragon Claws, Ancient Maul, Zaryth Vambraces, Ancestral Wand, Twisted Longbow. Tomb of Arasmus: Fang Of Osmun, Sunbearer Ring, Ward Of Elidria, Masari Mask, Masari Body, Masari Chaps, Shadow Of Tumaken. Crimson Night Theatre: Avernal Defender, Ghraxis Rapier, Sanguine Staff, Justicar Faceguard, Justicar Chestguard, Justicar Legguards, Scythe Of Vythar."
 },
 {
  "id": "collection_log_minigames",
  "title": "Collection log: Minigames slots",
  "tags": [
   "collection log",
   "collection",
   "uniques"
  ],
  "text": "The Minigames collection log has 19 slots. Arcane Proving Grounds: Boundless Hat, Boundless Robe Top, Boundless Robe Bottom, Boundless Boots, Boundless Gloves, Arcane Grimoire, Archmage Wand. Viking Assault: Fighter Body, Fighter Helm. Fortress Clash: Halo, Decorative Top. Champion's Hall: Runeforged Defender, Dragon Defender. Deepsea Haul: Angler Net. Arcane Crucible: Imbued God Cape. Void Breach: Void King Helm, Void King Top, Void King Robe, Void King Gloves."
 },
 {
  "id": "collection_log_clues",
  "title": "Collection log: Clue Scrolls slots",
  "tags": [
   "collection log",
   "collection",
   "uniques"
  ],
  "text": "The Clue Scrolls collection log has 91 slots. Medium Clue: Pathfinder Boots, Spellweaver Boots, Holy Sandals, Spiked Manacles, Climbing Boots G, Lumira Mitre, Verdant Mitre, Krylth Mitre, Ancient Mitre, Zephyra Mitre, Grondar Mitre, Sacred Charm, Peace Blessing, Profane Charm, Honorable Blessing, Battle Charm, Elder Charm, Lumira Stole, Verdant Stole, Krylth Stole, Ancient Stole, Zephyra Stole, Grondar Stole, Robin Hood Hat. Hard Clue: Lumira D Hide Body, Lumira D Hide Chaps, Lumira D Hide Boots, Lumira D Hide Bracers, Lumira Coif, Verdant D Hide Body, Verdant D Hide Chaps, Verdant D Hide Boots, Verdant D Hide Bracers, Verdant Coif, Krylth D Hide Body, Krylth D Hide Chaps, Krylth D Hide Boots, Krylth D Hide Bracers, Krylth Coif, Ancient D Hide Body, Ancient D Hide Chaps, Ancient D Hide Boots, Ancient D Hide Bracers, Ancient Coif, Zephyra D Hide Body, Zephyra D Hide Chaps, Zephyra D Hide Boots, Zephyra D Hide Bracers, Zephyra Coif, Grondar D Hide Body, Grondar D Hide Chaps, Grondar D Hide Boots, Grondar D Hide Bracers, Grondar Coif, Amulet Of Glory T, 2nd Age Full Helm, 2nd Age Platebody, 2nd Age Platelegs, 2nd Age Plateskirt, 2nd Age Kiteshield, 2nd Age Range Coif, 2nd Age Range Top, 2nd Age Range Legs, 2nd Age Vambraces, 2nd Age Mage Hat, 2nd Age Robe Top, 2nd Age Robe Legs, 2nd Age Amulet, Lumira D Hide Shield, Verdant D Hide Shield, Krylth D Hide Shield, Ancient D Hide Shield, Zephyra D Hide Shield, Grondar D Hide Shield. Elite Clue: Rangers Tunic, Holy Wraps, Freminnik Kilt, 2nd Age Longsword, 2nd Age Bow, 2nd Age Wand, 2nd Age Cloak. Master Clue: 2nd Age Druidic Robe Top, 2nd Age Druidic Robe Bottoms, 2nd Age Druidic Cloak, 2nd Age Druidic Staff, 2nd Age Pickaxe, 2nd Age Axe, Gold Pickaxe, Gold Axe, Gold Spade, Fancy Tiara."
 },
 {
  "id": "collection_log_skilling",
  "title": "Collection log: Skilling slots",
  "tags": [
   "collection log",
   "collection",
   "uniques"
  ],
  "text": "The Skilling collection log has 14 slots. Construction Unlocks: Money Purse, Master Rejuvenation. Dungeoneering Rewards: Arcane Necklace, Chaotic Rapier, Chaotic Longsword, Chaotic Maul, Chaotic Crossbow, Chaotic Staff, Eagle Eyed Kiteshield, Arcane Kiteshield. Slayer Unlocks: Slayer Helmet, Slayer Defender, Gloves Of Slaughter, Zul Kaars Blade."
 },
 {
  "id": "collection_log_pvp",
  "title": "Collection log: PvP slots",
  "tags": [
   "collection log",
   "collection",
   "uniques"
  ],
  "text": "The PvP collection log has 3 slots. Bot Rewards: Zesta Longsword, Zesta Vest, Zesta Skirt."
 }
]
