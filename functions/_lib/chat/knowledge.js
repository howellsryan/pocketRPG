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
  "id": "guide_inventory_and_banking",
  "title": "Inventory and banking",
  "tags": [
   "guide"
  ],
  "text": "Your inventory holds a hard maximum of 28 slots. Your bank stores everything else. While doing idle activities, loot is banked automatically when your inventory fills; the auto-bank delay scales with your Agility level, from 5 minutes at Agility 1 down to just 10 seconds at Agility 99 — a strong reason to train Agility."
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
  "text": "Credits are a premium currency. You earn +1 credit for each daily task you complete, and can buy more in the store. Spend credits to skip an hour of your current idle activity instantly (Skip 1h), to skip straight to a boss or raid kill while fighting one, or to skip a slayer task you don't like. Credits are tracked server-side on each character."
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
  "text": "Slayer masters assign you a task to kill a set number of a specific monster. Completing tasks earns slayer points and Slayer XP; higher-tier masters need higher combat and Slayer levels and pay more points. Killing your assigned monster is the only way to finish a task — you can also spend credits to skip a task, or slayer points to buy unlocks and rewards. Boss slayer tasks award a ×4 Slayer XP multiplier on kills."
 },
 {
  "id": "guide_quests",
  "title": "Quests",
  "tags": [
   "guide"
  ],
  "text": "Quests are timed adventures: meet the requirements (skill levels, quest points, combat level or earlier quests), start the quest, and it completes after its duration — you can queue several. Rewards include coins, XP (sometimes in a skill of your choice), quest points and item unlocks. Quest complexity ranges from Novice to Master; longer, harder quests pay better."
 },
 {
  "id": "guide_clue_scrolls",
  "title": "Clue scrolls",
  "tags": [
   "guide"
  ],
  "text": "Clue scrolls come in four tiers: medium, hard, elite and master. Completing a clue takes time and rewards you from that tier's loot table — runes, coins, gear and rare cosmetic uniques that fill your collection log. Higher tiers roll rarer rewards."
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
  "text": "Plant seeds in farming patches (herbs, trees and fruit trees) at different locations, wait for them to grow in real time, then harvest for crops and Farming XP. Higher Farming levels unlock better seeds. Harvest everything at once with Harvest All."
 },
 {
  "id": "guide_magic",
  "title": "Magic",
  "tags": [
   "guide"
  ],
  "text": "Magic is trained by casting combat spells, which need runes. Each spell has a level requirement, base damage, and rune cost per cast; you earn the spell's base XP plus 2 XP per damage dealt. Higher tiers (strike, bolt, blast and beyond) hit harder and cost pricier runes."
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
  "text": "The public leaderboard ranks characters by total level, and separately by kill counts for each boss and raid. It is a fun comparison, not a competition with prizes."
 },
 {
  "id": "guide_ironman_and_one_life_modes",
  "title": "Ironman and one-life modes",
  "tags": [
   "guide"
  ],
  "text": "When creating a character you can pick special modes. Ironman characters are self-sufficient: no Trading Post trading with other players. One-life characters are hardcore — death is permanent (the character can be reset). Both modes are badges of honour on the leaderboard."
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
  "id": "guide_ai_assistant_connections_mcp",
  "title": "AI assistant connections (MCP)",
  "tags": [
   "guide"
  ],
  "text": "PocketRPG has an AI connector: from the Connect AI screen you can link AI assistants (like Claude) to your account via MCP. A connected assistant can check your stats, start activities, manage your bank and more, using the same rules as the game. Tokens expire automatically and can be revoked from your AI client."
 },
 {
  "id": "guide_getting_help",
  "title": "Getting help",
  "tags": [
   "guide"
  ],
  "text": "The in-game Help screen covers the basics, and this assistant (the 💬 button) answers questions about PocketRPG — game mechanics, items, monsters, and your own character's progress. It can only talk about PocketRPG; it has no access to the internet and won't answer unrelated questions."
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
  "title": "Raid: Vaults of Xyren",
  "tags": [
   "raid",
   "raids",
   "boss"
  ],
  "text": "Vaults of Xyren: Delve into Xeric's mountain stronghold. Defeat Tecton, Vespara, the Mudtadile and the Grand Olm to claim your reward. Bosses: Tekton, Vespula, Muttadile, The Great Olm. Credit skip cost: 10."
 },
 {
  "id": "raid_crimson_night_theatre",
  "title": "Raid: Crimson Night Theatre",
  "tags": [
   "raid",
   "raids",
   "boss"
  ],
  "text": "Crimson Night Theatre: Fight through six deadly bosses in Verzik Vitura's theatre. Defeat them all to claim your reward. Bosses: The Maiden Of Sugadinti, Pestilent Bloat, Nylocas Vasilias, Sotetseg, Xarpus, Verzik Vitur. Credit skip cost: 10."
 },
 {
  "id": "raid_cryptbound_champions",
  "title": "Raid: Cryptbound Champions",
  "tags": [
   "raid",
   "raids",
   "boss"
  ],
  "text": "Cryptbound Champions: Descend into the ancient crypt and defeat all six champions to claim their treasures. Bosses: Morvyn The Blighted, Dravok The Wretched, Gorath The Infested, Kaelor The Tainted, Torvek The Corrupted, Verin The Defiled. Credit skip cost: 2."
 },
 {
  "id": "raid_tomb_of_arasmus",
  "title": "Raid: Tomb of Arasmus",
  "tags": [
   "raid",
   "raids",
   "boss"
  ],
  "text": "Tomb of Arasmus: Brave the cursed tomb of the god-king Arasmus. Defeat his four guardians and the Warden to claim the treasures within. Bosses: Khareth The Shadowbound, Gorroth The Mountain Ape, Khepra The Scarab Matron, Sebakh The Devourer, Warden Of Arasmus. Credit skip cost: 10."
 },
 {
  "id": "data_minigames",
  "title": "Minigame grinds and their rewards",
  "tags": [
   "minigame",
   "minigames"
  ],
  "text": "Available minigame tasks. Grind for Fighter Body (5h): Run Viking Assault until you earn a Fighter Body. (one-time reward). Grind for Fighter Helm (2h): Run Viking Assault until you earn a Fighter Helm. (one-time reward). Grind for Rune Defender (3h): Slay Cyclopes in the Champion's Hall basement until one drops a Rune Defender. (one-time reward). Grind for Dragon Defender (2h): Slay Cyclopes wielding your Rune Defender until one drops a Dragon Defender. (one-time reward). Grind for Halo (3h): Play Fortress Clash matches until you can purchase a Halo. (one-time reward). Obtain decorative armour (2h): Play Fortress Clash until you can purchase a Decorative Top. (one-time reward). Grind Angler Net (5h): Play Fortress Clash until you can purchase an Angler Net. (one-time reward). Obtain Imbued God Cape (2h): Play Fortress Clash until you can purchase an Imbued God Cape. (one-time reward). Grind for Void King Set (6h): Play Void Breach until you earn the full Void King set. (one-time reward)."
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
   "mining"
  ],
  "text": "Mining training options with level requirements and XP per action: Mine tin ore (level 1, 17 XP), Mine copper ore (level 1, 17 XP), Mine clay (level 1, 5 XP), Mine rune essence (level 1, 5 XP), Mine iron ore (level 15, 35 XP), Mine coal (level 30, 50 XP), Mine gold ore (level 40, 65 XP), Mine mithril ore (level 55, 80 XP), Mine adamantite ore (level 70, 95 XP), Mine runeforged ore (level 85, 420 XP), Mine gems (level 75, 65 XP)."
 },
 {
  "id": "skill_woodcutting",
  "title": "Skill training options: Woodcutting",
  "tags": [
   "skill",
   "skills",
   "training",
   "woodcutting"
  ],
  "text": "Woodcutting training options with level requirements and XP per action: Chop tree (level 1, 25 XP), Chop oak (level 15, 37 XP), Chop willow (level 30, 67 XP), Chop maple (level 45, 100 XP), Chop yew (level 60, 175 XP), Chop teak (level 35, 85 XP), Chop mahogany (level 50, 157 XP), Chop magic (level 75, 250 XP), Chop redwood (level 90, 300 XP)."
 },
 {
  "id": "skill_fishing",
  "title": "Skill training options: Fishing",
  "tags": [
   "skill",
   "skills",
   "training",
   "fishing"
  ],
  "text": "Fishing training options with level requirements and XP per action: Fish Shrimps (level 1, 10 XP), Fish Trout (level 20, 50 XP), Fish Crab (level 40, 90 XP), Fish Eel (level 50, 100 XP), Fish Karam (level 65, 105 XP), Fish Shark (level 76, 110 XP), Fish Manta Ray (level 85, 180 XP), Fish Anglerfish (level 90, 200 XP)."
 },
 {
  "id": "skill_smithing",
  "title": "Skill training options: Smithing",
  "tags": [
   "skill",
   "skills",
   "training",
   "smithing"
  ],
  "text": "Smithing training options with level requirements and XP per action: Smelt bronze bar (level 1, 6 XP), Smith bronze dagger (level 1, 12 XP), Smith bronze axe (level 4, 12 XP), Smith bronze pickaxe (level 4, 12 XP), Smith bronze scimitar (level 4, 25 XP), Smelt iron bar (level 15, 12 XP), Smith iron axe (level 16, 25 XP), Smith iron pickaxe (level 16, 25 XP), Smith iron scimitar (level 19, 50 XP), Smelt steel bar (level 30, 17 XP), Smith steel axe (level 31, 37 XP), Smith steel pickaxe (level 31, 37 XP), Smith steel scimitar (level 34, 75 XP), Smelt gold bar (level 40, 22 XP), Smelt mithril bar (level 50, 30 XP), Smith mithril axe (level 51, 50 XP), Smith mithril pickaxe (level 51, 50 XP), Smith mithril scimitar (level 54, 100 XP), Smelt adamant bar (level 70, 37 XP), Smith adamant axe (level 71, 62 XP), Smith adamant pickaxe (level 71, 62 XP), Smith adamant scimitar (level 74, 125 XP), Smelt runeforged bar (level 75, 50 XP), Smith runeforged axe (level 76, 75 XP), Smith runeforged pickaxe (level 76, 75 XP), Smith runeforged scimitar (level 79, 150 XP), Smith iron dagger (level 15, 25 XP), Smith iron mace (level 16, 25 XP), Smith iron sword (level 18, 25 XP), Smith iron longsword (level 20, 50 XP), Smith iron full helm (level 21, 50 XP), Smith iron chainbody (level 25, 75 XP), Smith iron kiteshield (level 26, 75 XP), Smith iron platelegs (level 30, 75 XP), Smith iron platebody (level 32, 125 XP), Smith steel dagger (level 30, 37 XP), Smith steel mace (level 31, 37 XP), Smith steel sword (level 33, 37 XP), Smith steel longsword (level 35, 75 XP), Smith steel full helm (level 36, 75 XP) …and 43 more."
 },
 {
  "id": "skill_cooking",
  "title": "Skill training options: Cooking",
  "tags": [
   "skill",
   "skills",
   "training",
   "cooking"
  ],
  "text": "Cooking training options with level requirements and XP per action: Cook Shrimps (level 1, 30 XP), Cook Chicken (level 1, 30 XP), Cook Meat (level 1, 30 XP), Cook Trout (level 15, 70 XP), Cook Crab (level 40, 120 XP), Cook Eel (level 45, 140 XP), Cook Karam (level 65, 190 XP), Cook Shark (level 80, 210 XP), Cook Manta Ray (level 91, 250 XP), Cook Anglerfish (level 93, 270 XP)."
 },
 {
  "id": "skill_fletching",
  "title": "Skill training options: Fletching",
  "tags": [
   "skill",
   "skills",
   "training",
   "fletching"
  ],
  "text": "Fletching training options with level requirements and XP per action: Cut arrow shafts (15) (level 1, 5 XP), Attach feather (15) (level 1, 15 XP), Make bronze arrows (15) (level 1, 20 XP), Cut shortbow (u) (level 5, 5 XP), String shortbow (level 5, 10 XP), Make iron arrows (15) (level 15, 37 XP), Cut oak shortbow (u) (level 20, 16 XP), String oak shortbow (level 20, 25 XP), Make steel arrows (15) (level 30, 55 XP), Cut willow shortbow (u) (level 35, 33 XP), String willow shortbow (level 35, 50 XP), Make mithril arrows (15) (level 45, 75 XP), Cut maple shortbow (u) (level 50, 50 XP), String maple shortbow (level 50, 75 XP), Make adamant arrows (15) (level 60, 105 XP), Cut yew shortbow (u) (level 65, 67 XP), String yew shortbow (level 65, 100 XP), Make runeforged arrows (15) (level 75, 150 XP), Cut magic shortbow (u) (level 80, 83 XP), String magic shortbow (level 80, 125 XP), Cut wooden stocks (10) (level 9, 6 XP), Make bronze bolts (10) (level 9, 25 XP), Make iron bolts (10) (level 39, 50 XP), Make steel bolts (10) (level 46, 175 XP), Make mithril bolts (10) (level 54, 250 XP), Make adamant bolts (10) (level 61, 350 XP), Make runeforged bolts (10) (level 69, 500 XP), Make dragon bolts (10) (level 84, 600 XP), Cut ruby bolt tips (12) (level 63, 6 XP), Cut diamond bolt tips (12) (level 65, 7 XP), Cut dragonstone bolt tips (12) (level 71, 8 XP), Cut onyx bolt tips (12) (level 73, 9 XP), Tip ruby bolts (10) (level 63, 630 XP), Tip diamond bolts (10) (level 65, 700 XP), Tip dragonstone bolts (10) (level 71, 820 XP), Tip onyx bolts (10) (level 73, 940 XP), Tip ruby dragon bolts (10) (level 84, 700 XP), Tip diamond dragon bolts (10) (level 84, 750 XP), Tip dragonstone dragon bolts (10) (level 84, 900 XP), Tip onyx dragon bolts (10) (level 84, 1000 XP)."
 },
 {
  "id": "skill_crafting",
  "title": "Skill training options: Crafting",
  "tags": [
   "skill",
   "skills",
   "training",
   "crafting"
  ],
  "text": "Crafting training options with level requirements and XP per action: Tan cowhide (level 1, 1 XP), Tan cowhide (hard) (level 1, 1 XP), Tan green dragon hide (level 55, 25 XP), Craft leather gloves (level 1, 14 XP), Make molten glass (level 1, 20 XP), Craft leather boots (level 7, 16 XP), Craft leather cowl (level 9, 18 XP), Craft leather body (level 14, 25 XP), Craft leather chaps (level 18, 27 XP), Cut sapphire (level 20, 50 XP), String sapphire amulet (level 24, 65 XP), Cut emerald (level 27, 67 XP), Craft hard leather body (level 28, 35 XP), String emerald amulet (level 31, 80 XP), Cut ruby (level 34, 85 XP), Cut diamond (level 43, 107 XP), Cut dragonstone (level 55, 137 XP), Cut onyx (level 72, 167 XP), Cut zyrite (level 89, 200 XP), String ruby amulet (level 50, 100 XP), Craft green d'hide chaps (level 57, 62 XP), Craft green d'hide body (level 63, 186 XP), Craft red d'hide body (level 75, 225 XP), Craft red d'hide chaps (level 73, 124 XP), Craft black d'hide chaps (level 79, 172 XP), Craft black d'hide body (level 84, 258 XP), String diamond amulet (level 70, 130 XP), String dragonstone amulet (level 80, 150 XP), String onyx amulet (level 90, 165 XP), String zyrite amulet (level 98, 200 XP), Craft zyrite bracelet (level 98, 200 XP), String zyrite necklace (level 98, 200 XP), Craft zyrite ring (level 98, 200 XP), Craft ferocious gloves (level 80, 250 XP)."
 },
 {
  "id": "skill_herblore",
  "title": "Skill training options: Herblore",
  "tags": [
   "skill",
   "skills",
   "training",
   "herblore"
  ],
  "text": "Herblore training options with level requirements and XP per action: Make attack potion (level 1, 25 XP), Make strength potion (level 12, 40 XP), Make defence potion (level 30, 55 XP), Make combat potion (level 36, 70 XP), Make prayer potion (level 38, 75 XP), Make super attack (level 45, 90 XP), Make super strength (level 55, 110 XP), Make super restore (level 63, 130 XP), Make super defence (level 66, 140 XP), Make ranging potion (level 72, 160 XP), Make magic potion (level 76, 180 XP), Make Lumira Brew (level 81, 200 XP), Make super combat potion (level 90, 500 XP)."
 },
 {
  "id": "skill_agility",
  "title": "Skill training options: Agility",
  "tags": [
   "skill",
   "skills",
   "training",
   "agility"
  ],
  "text": "Agility training options with level requirements and XP per action: Spryroot Grounds (level 1, 86 XP), Brambleford Rooftop (level 10, 120 XP), Sunspire Rooftop (level 20, 175 XP), Stonewatch Rooftop (level 30, 190 XP), Duskmire Rooftop (level 40, 240 XP), Ironhold Rooftop (level 50, 440 XP), Starweaver Hamlet Rooftop (level 60, 500 XP), Dunescale Rooftop (level 70, 550 XP), Frostharbor Rooftop (level 80, 600 XP), Silverkeep Rooftop (level 90, 700 XP)."
 },
 {
  "id": "skill_prayer",
  "title": "Skill training options: Prayer",
  "tags": [
   "skill",
   "skills",
   "training",
   "prayer"
  ],
  "text": "Prayer training options with level requirements and XP per action: Bury bones (level 1, 5 XP), Bury big bones (level 5, 15 XP), Bury dragon bones (level 35, 72 XP), Use gilded altar (bones) (level 1, 17 XP), Use gilded altar (big bones) (level 5, 52 XP), Use gilded altar (dragon bones) (level 35, 252 XP), Bury nagadoth bones (level 40, 125 XP), Use gilded altar (nagadoth bones) (level 40, 437 XP), Scatter Gargoyle Dust (level 20, 125 XP)."
 },
 {
  "id": "skill_magic",
  "title": "Skill training options: Magic",
  "tags": [
   "skill",
   "skills",
   "training",
   "magic"
  ],
  "text": "Magic training options with level requirements and XP per action: Curse (level 19, 29 XP), High Alchemy (level 55, 65 XP), Superheat Item (iron ore) (level 43, 53 XP), Enchant Sapphire (level 7, 170 XP), Enchant Ruby (level 49, 590 XP), Enchant Diamond (level 57, 670 XP), Enchant Dragonstone (level 68, 780 XP), Stun (level 80, 90 XP), Enchant Onyx (level 87, 970 XP), Enchant Zyrite Amulet (level 93, 1100 XP), Enchant Zyrite Bracelet (level 93, 1100 XP), Enchant Zyrite Necklace (level 93, 1100 XP), Enchant Zyrite Ring (level 93, 1100 XP), Enchant Ruby Bolts (10) (level 49, 590 XP), Enchant Ruby Dragon Bolts (10) (level 49, 590 XP), Enchant Diamond Bolts (10) (level 57, 670 XP), Enchant Diamond Dragon Bolts (10) (level 57, 670 XP), Enchant Dragonstone Bolts (10) (level 68, 780 XP), Enchant Dragonstone Dragon Bolts (10) (level 68, 780 XP), Enchant Onyx Bolts (10) (level 87, 970 XP), Enchant Onyx Dragon Bolts (10) (level 87, 970 XP), Tan Leather (level 78, 81 XP), Plank Make (level 86, 90 XP)."
 },
 {
  "id": "skill_thieving",
  "title": "Skill training options: Thieving",
  "tags": [
   "skill",
   "skills",
   "training",
   "thieving"
  ],
  "text": "Thieving training options with level requirements and XP per action: ."
 },
 {
  "id": "skill_firemaking",
  "title": "Skill training options: Firemaking",
  "tags": [
   "skill",
   "skills",
   "training",
   "firemaking"
  ],
  "text": "Firemaking training options with level requirements and XP per action: Burn logs (level 1, 40 XP), Burn oak logs (level 15, 60 XP), Burn willow logs (level 30, 90 XP), Burn maple logs (level 45, 135 XP), Burn yew logs (level 60, 203 XP), Burn magic logs (level 75, 304 XP), Burn redwood logs (level 90, 350 XP)."
 },
 {
  "id": "skill_farming",
  "title": "Skill training options: Farming",
  "tags": [
   "skill",
   "skills",
   "training",
   "farming"
  ],
  "text": "Farming training options with level requirements and XP per action: ."
 },
 {
  "id": "skill_hunter",
  "title": "Skill training options: Hunter",
  "tags": [
   "skill",
   "skills",
   "training",
   "hunter"
  ],
  "text": "Hunter training options with level requirements and XP per action: Hunt Cow (level 1, 150 XP), Hunt Wizard (level 15, 300 XP), Hunt Jeweller (level 35, 500 XP), Hunt Merchant (level 50, 800 XP), Hunt Grim Reaper (level 60, 1000 XP), Hunt Master Trader (level 85, 1500 XP)."
 },
 {
  "id": "skill_dungeoneering",
  "title": "Skill training options: Dungeoneering",
  "tags": [
   "skill",
   "skills",
   "training",
   "dungeoneering"
  ],
  "text": "Dungeoneering training options with level requirements and XP per action: Clear novice dungeon (level 1, 1000 XP), Clear apprentice dungeon (level 10, 2000 XP), Clear adept dungeon (level 20, 3000 XP), Clear journeyman dungeon (level 30, 4000 XP), Clear expert dungeon (level 40, 5000 XP), Clear veteran dungeon (level 50, 6000 XP), Clear master dungeon (level 60, 7000 XP), Clear grandmaster dungeon (level 70, 8000 XP), Clear legendary dungeon (level 80, 9000 XP), Clear mythic dungeon (level 90, 10000 XP), Claim arcane necklace (level 65, 0 XP), Claim chaotic rapier (level 80, 0 XP), Claim chaotic longsword (level 80, 0 XP), Claim chaotic maul (level 80, 0 XP), Claim chaotic crossbow (level 80, 0 XP), Claim chaotic staff (level 80, 0 XP), Claim eagle eyed kiteshield (level 80, 0 XP), Claim arcane kiteshield (level 80, 0 XP)."
 },
 {
  "id": "skill_runecraft",
  "title": "Skill training options: Runecrafting",
  "tags": [
   "skill",
   "skills",
   "training",
   "runecraft"
  ],
  "text": "Runecrafting training options with level requirements and XP per action: Craft air rune (level 1, 10 XP), Craft mind rune (level 2, 11 XP), Craft water rune (level 5, 12 XP), Craft earth rune (level 9, 13 XP), Craft fire rune (level 14, 14 XP), Craft body rune (level 20, 15 XP), Craft cosmic rune (level 27, 16 XP), Craft chaos rune (level 35, 17 XP), Craft astral rune (level 40, 17.4 XP), Craft nature rune (level 44, 18 XP), Craft law rune (level 54, 19 XP), Craft death rune (level 65, 25 XP), Craft blood rune (level 77, 30 XP), Craft soul rune (level 90, 35 XP), Craft wrath rune (level 95, 40 XP)."
 }
]
