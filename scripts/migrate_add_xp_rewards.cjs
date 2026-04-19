#!/usr/bin/env node
/**
 * One-time migration: inserts an `xp_rewards` column (as column 4, after duration)
 * into quest_list.csv.
 *
 * Format: space-separated `skill=amount` pairs (no commas), e.g. `attack=500 strength=500`
 * Use "None" to delegate XP to the auto-split-from-skill-prerequisites logic.
 *
 * Only quests with no skill prerequisites need explicit overrides — quests that
 * already have skill requirements will continue to auto-split.
 */
const fs = require('fs')
const path = require('path')

const CSV_PATH = path.join(__dirname, '..', 'quest_list.csv')

// Explicit XP rewards for all quests that have no skill prerequisites.
// Keys are the quest slug (lowercase, spaces→underscores, apostrophes removed).
// Values sum to the XP_REWARD for the quest's complexity tier:
//   Novice=1000, Intermediate=5000, Experienced=12500, Master=35000
const XP_OVERRIDES = {
  // Master quests (35000 total)
  'a_night_at_the_theatre':     'attack=8750 strength=8750 defence=8750 hitpoints=8750',
  'contact':                    'slayer=17500 thieving=17500',
  'dream_mentor':               'attack=8750 strength=8750 defence=8750 hitpoints=8750',
  'monkey_madness_i':           'attack=8750 strength=8750 defence=8750 hitpoints=8750',
  'mournings_end_part_ii':      'magic=11667 ranged=11667 agility=11666',

  // Experienced quests (12500 total)
  'dragon_slayer_i':            'strength=6250 defence=6250',
  'fairytale_i_growing_pains':  'farming=6250 crafting=6250',
  'roving_elves':               'crafting=6250 prayer=6250',

  // Intermediate quests (5000 total)
  'a_tail_of_two_cats':         'crafting=2500 herblore=2500',
  'icthlarins_little_helper':   'prayer=2500 crafting=2500',
  'making_history':             'crafting=2500 prayer=2500',
  'merlins_crystal':            'magic=2500 attack=2500',
  'ratcatchers':                'thieving=2500 agility=2500',
  'scorpion_catcher':           'strength=2500 thieving=2500',
  'throne_of_miscellania':      'woodcutting=2500 mining=2500',
  'wanted':                     'thieving=2500 slayer=2500',
  'waterfall_quest':            'attack=2500 strength=2500',

  // Novice quests (1000 total)
  'a_porcine_of_interest':      'slayer=500 farming=500',
  'a_souls_bane':               'attack=500 strength=500',
  'biohazard':                  'thieving=1000',
  'black_knights_fortress':     'attack=500 hitpoints=500',
  'bone_voyage':                'agility=500 woodcutting=500',
  'children_of_the_sun':        'agility=500 hitpoints=500',
  'clock_tower':                'prayer=1000',
  'cooks_assistant':            'cooking=1000',
  'current_affairs':            'fishing=500 agility=500',
  'death_plateau':              'agility=500 attack=500',
  'demon_slayer':               'attack=500 strength=500',
  'druidic_ritual':             'herblore=1000',
  'dwarf_cannon':               'ranged=1000',
  'ernest_the_chicken':         'crafting=1000',
  'ethos_of_arceuus':           'magic=500 prayer=500',
  'fight_arena':                'attack=500 strength=500',
  'gertrudes_cat':              'cooking=1000',
  'goblin_diplomacy':           'crafting=1000',
  'goodbye_grubby':             'herblore=1000',
  'hazeel_cult':                'thieving=1000',
  'imp_catcher':                'magic=1000',
  'misthalin_mystery':          'crafting=1000',
  'monks_friend':               'woodcutting=500 cooking=500',
  'murder_mystery':             'crafting=1000',
  'nature_spirit':              'prayer=500 crafting=500',
  'pirates_treasure':           'thieving=500 fishing=500',
  'plague_city':                'crafting=1000',
  'priest_in_peril':            'prayer=1000',
  'prince_ali_rescue':          'thieving=500 crafting=500',
  'rag_and_bone_man_i':         'prayer=500 slayer=500',
  'recruitment_drive':          'prayer=500 defence=500',
  'romeo_juliet':               'crafting=1000',
  'rune_mysteries':             'runecraft=1000',
  'sheep_herder':               'farming=500 firemaking=500',
  'sheep_shearer':              'crafting=1000',
  'shield_of_arrav':            'attack=500 defence=500',
  'skipping_stones':            'agility=500 fishing=500',
  'the_forsaken_tower':         'crafting=500 smithing=500',
  'the_restless_ghost':         'prayer=1000',
  'the_ribbiting_tale_of_a_lily_pad_laborer': 'farming=500 fishing=500',
  'tree_gnome_village':         'attack=500 strength=500',
  'twilights_promise':          'agility=500 thieving=500',
  'vampyre_slayer':             'attack=500 strength=500',
  'walking_the_dog':            'agility=1000',
  'witch_s_house':              'hitpoints=500 crafting=500',
  'witchs_house':               'hitpoints=500 crafting=500',
  'witch_s_potion':             'magic=1000',
  'witchs_potion':              'magic=1000',
  'x_marks_the_spot':           'thieving=500 woodcutting=500',
}

function slug(name) {
  return name.toLowerCase()
    .replace(/[''']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const csv = fs.readFileSync(CSV_PATH, 'utf-8')
const lines = csv.split(/\r?\n/).filter(Boolean)

const newLines = []

// Insert 'xp_rewards' as the 4th column in the header
const headerParts = lines[0].split(',')
headerParts.splice(3, 0, 'xp_rewards')
newLines.push(headerParts.join(','))

let inserted = 0
for (let i = 1; i < lines.length; i++) {
  const line = lines[i]
  const parts = line.split(',')
  const name = parts[0].trim()
  const questSlug = slug(name)
  const xpReward = XP_OVERRIDES[questSlug] || 'None'
  if (xpReward !== 'None') inserted++
  // Insert xp_rewards as column index 3 (after name, complexity, duration)
  parts.splice(3, 0, xpReward)
  newLines.push(parts.join(','))
}

fs.writeFileSync(CSV_PATH, newLines.join('\n') + '\n')
console.log(`✓ Updated ${path.basename(CSV_PATH)} — inserted xp_rewards for ${inserted} quests`)
