import { monsterShapeFor, monsterBounds, hasMonsterArchetype } from './monsterShapes.js'

// ──────────────────────────────────────────────────────────────────────────
// Which creature a monster is drawn as, what colour it is, how big it stands,
// and how it moves when it attacks. Pure — utils/monsterShapes.js holds the
// geometry, index.css holds the paint, and this file is the only place that
// decides which of each a given monster gets.
//
// THE SHAPE IS PER ARCHETYPE; THE COLOUR IS PER MONSTER. That split is the
// whole design: 119 monsters share 22 drawn bodies, and a Green Dragon, a Red
// Dragon and a King Black Dragon are the same drawing in three palettes —
// which is not a compromise, it is what they actually are. utils/
// weaponShapes.js made the identical call for 151 weapons across 12 shapes
// and docs/action-animations.md records why the per-item alternative was
// built, reverted, and must not be tried a third time.
//
// The archetype table is EXPLICIT rather than derived, matching the
// MONSTER_ART table it sits alongside in utils/combatArt.js: a mis-derived
// archetype is silently wrong art with nothing to catch it, and "Sotetseg is
// a demon, Xarpus is an arachnid" is knowledge no regex holds. The name rules
// below are the fallback for content added later, so a new monster gets
// plausible art on the day it ships rather than none.
// ──────────────────────────────────────────────────────────────────────────

/** The player figure's drawn height, in stage units (InkwrightFigure: hair
 * top y=13 to the ground line y=108). Every archetype's `stature` is a
 * fraction of THIS, so "a chicken is 0.3" means something concrete. */
const PLAYER_HEIGHT = 95

// The stage box a creature has to stay inside, in the enemy's own local
// (unmirrored) coordinates. FOOT_X/GROUND_Y are where MonsterFigure plants
// it; the rest are the walls the fit solve clamps against.
export const FOOT_X = 76
export const GROUND_Y = 108
const CEILING_Y = 14       // clear of the mini HP bar drawn at y=6..11
const LANE_LIMIT = 54      // how far forward a creature may reach before it
                           // would overlap the player's own half of the lane
const BACK_LIMIT = 72      // how far back before it leaves the frame
// An ARMED monster's weapon reaches past its own body, and the fit solve
// above measures the body alone. The two weapons crossing in the middle of
// the lane is what a fight looks like and is left alone deliberately; this is
// only the rail that stops a colossal weapon-carrier planting its blade in
// the player's chest. Measured from the grip: the longest shape in
// utils/weaponShapes.js (a godsword) runs ~46 local units from the hand.
const WEAPON_REACH = 46
const WEAPON_LANE_LIMIT = 108

// ── Palettes ──────────────────────────────────────────────────────────────
//
// Every value is a CSS custom property, never a literal: the `--ink-*` family
// in index.css `:root` is a FIXED material palette (not theme-flipped), the
// same precedent `--tier-*` sets — a dragon's hide is the same green on
// parchment as on iron, because it describes a creature and not a surface.
//
// A palette names four things and inherits the rest:
//   hide   the main body
//   shade  its darker side, and (by default) wings, robes and membranes
//   belly  the lighter underside, throat and inner limbs
//   eye    the glow — the one part that is allowed to be bright
// `horn` (claws, teeth, beaks, bone) defaults to a shared bone tone, because
// a horn is horn whatever the animal is; a palette overrides it only when the
// creature is MADE of the material (a skeleton's claws are its own bone).

const BONE_HORN = 'var(--ink-hide-bone)'

function palette(name, eye, horn) {
  return {
    name,
    hide: `var(--ink-hide-${name})`,
    shade: `var(--ink-hide-${name}-shade)`,
    belly: `var(--ink-hide-${name}-light)`,
    horn: horn || BONE_HORN,
    eye: `var(--ink-glow-${eye})`,
  }
}

export const HIDE_PALETTES = {
  emerald:   palette('emerald', 'amber'),
  crimson:   palette('crimson', 'amber'),
  obsidian:  palette('obsidian', 'red'),
  azure:     palette('azure', 'pale'),
  verdigris: palette('verdigris', 'green'),
  bone:      palette('bone', 'pale', 'var(--ink-hide-bone-light)'),
  ash:       palette('ash', 'amber'),
  ember:     palette('ember', 'amber'),
  frost:     palette('frost', 'pale'),
  void:      palette('void', 'violet'),
  blight:    palette('blight', 'green'),
  blood:     palette('blood', 'red'),
  stone:     palette('stone', 'amber', 'var(--ink-hide-stone-light)'),
  iron:      palette('iron', 'pale', 'var(--ink-hide-iron-light)'),
  moss:      palette('moss', 'amber'),
  gold:      palette('gold', 'red'),
  sand:      palette('sand', 'amber'),
  brine:     palette('brine', 'green'),
  arcane:    palette('arcane', 'violet'),
  bark:      palette('bark', 'green'),
  flesh:     palette('flesh', 'pale'),
  dairy:     palette('dairy', 'pale'),
}

export const PALETTE_NAMES = Object.keys(HIDE_PALETTES)

/** Fallback palette per archetype, used when nothing in a monster's name says
 * what it is made of. Not a colour of last resort — for most of the bestiary
 * this IS the answer (a spider is not "ash-coloured", it is spider-coloured). */
const ARCHETYPE_PALETTE = {
  dragon: 'emerald', serpent: 'blight', lizardman: 'verdigris', beast: 'ash',
  bovine: 'flesh', fowl: 'bone', bird: 'ash', arachnid: 'obsidian',
  insect: 'gold', crab: 'crimson', kraken: 'brine', orb: 'arcane',
  toad: 'blight', humanoid: 'flesh', gladiator: 'gold', skeleton: 'bone', husk: 'blight',
  demon: 'crimson', imp: 'crimson', giant: 'stone', wraith: 'void',
  golem: 'stone', treant: 'bark',
}

// Material words, read off the monster's own id. Ordered — the first match
// wins — so a "Bone Wyvern" is bone before it is anything else.
const PALETTE_RULES = [
  // No bare `ossu`: "col-ossu-s" made every colossus a skeleton. Substring
  // rules over ids are exactly this accident waiting to happen, which is why
  // the override table above exists and why the archetype table is explicit.
  [/bone|skeletal|skeleton/, 'bone'],
  [/frost|ice|frozen|glacial|winter/, 'frost'],
  [/ember|cinder|pyre|flame|fire|molten|magma|volcan|scorch|burn/, 'ember'],
  [/ashen|ash_|_ash|dust|soot/, 'ash'],
  [/blood|sanguine|crimson|gore|vitur|maiden|bloodmoon/, 'blood'],
  [/void|umbral|shadow|dusk|night|nether|empty|shroud|wraith|spect|gloom|dark/, 'void'],
  [/blight|venom|toxic|pestilent|plague|infest|mire|marsh|fen|bog|swamp|rot|defiled|tainted|wretched|corrupted/, 'blight'],
  [/rune|astral|arcane|mystic|magi|warlock|sorcer|spell/, 'arcane'],
  [/iron|steel|ironclad|ironfang|adamant|metal|clad|forge/, 'iron'],
  [/stone|rock|granite|gargoyle|boulder|cliff|mountain/, 'stone'],
  [/gold|golden|sovereign|crown|king|queen|warlord|commander|regal|monarch/, 'gold'],
  [/sand|desert|dune|tomb|scarab|khepra|sebakh|arasmus|khareth|gorroth/, 'sand'],
  // No bare `reef`: "th-reef-ang" turned Threefang Cerberus into a sea
  // creature. Same accident as `ossu` above.
  [/tide|deep|kraken|brine|ocean|abyss|aqua/, 'brine'],
  [/thorn|briar|verdant|leaf|bark|tree|treant|wood|grove/, 'bark'],
  [/green|moss|goblin|verdi|fungal/, 'moss'],
  [/red|scarlet|ruby/, 'crimson'],
  [/black|obsidian|onyx|jet/, 'obsidian'],
  [/blue|azure|cobalt|sapphire/, 'azure'],
]

/** Monsters whose colour is their IDENTITY rather than a word in their name —
 * every one is a case where the rules above would land somewhere plausible
 * and wrong. The dragons are the reason this table exists at all: "all the
 * dragons are one dragon in different colours" only works if the colours are
 * the right ones. */
const PALETTE_OVERRIDE = {
  green_dragon: 'emerald',
  red_dragon: 'crimson',
  black_dragon: 'obsidian',
  vicious_black_dragon: 'obsidian',
  king_black_dragon: 'obsidian',
  adamant_dragon: 'verdigris',
  rune_dragon: 'azure',
  bone_wyvern: 'bone',
  ashen_hydra: 'ash',
  // The Nagadoth kings are one silhouette per king already (their bespoke
  // inventory icons work the same way); these are those icons' own colours.
  nagadoth_rex: 'crimson', nagadoth_rex_summon: 'crimson',
  nagadoth_prime: 'arcane', nagadoth_prime_summon: 'arcane',
  nagadoth_supreme: 'emerald', nagadoth_supreme_summon: 'emerald',
  nagadoth_queen: 'void',
  field_chicken: 'bone',
  pasture_bull: 'dairy',
  cave_goblin: 'moss',
  lesser_fiend: 'crimson',
  dustpaw_rat: 'ash',
  marshfen_toad: 'blight',
  hellbound_gorilla: 'obsidian',
  gorroth_the_mountain_ape: 'sand',
  the_great_olm: 'crimson',
  tekton: 'ember',
  vespula: 'gold',
  muttadile: 'blight',
  xarpus: 'blight',
  sotetseg: 'void',
  nylocas_vasilias: 'arcane',
  verzik_vitur: 'blood',
  zaryth_the_empty_lord: 'void',
  dread_core: 'void',
  corporeal_horror: 'arcane',
  deepmaw_kraken: 'brine',
  crazy_archaeologist: 'flesh',
  blighted_gauntlet: 'azure',
  duskmare: 'void',
  threefang_cerberus: 'obsidian',
  // Zaryth's sentinels wear their master's colour — they are pieces of it.
  zaryth_blade_sentinel: 'void',
  zaryth_bolt_sentinel: 'void',
  zaryth_rune_sentinel: 'void',
  // An archer in green, not a person made of wood: "verdant" is what they
  // wear, and the bark rule cannot tell those apart.
  verdant_stalker: 'moss',
  sunclaw_gladiator: 'gold',
  dawnlance_colossus: 'gold',
  triune_chimera: 'arcane',
  resonance_colossus: 'arcane',
  hornwarden: 'ember',
  sunspire_healing_totem: 'gold',
  aurelios_the_unbroken: 'gold',
}

// ── Archetypes ────────────────────────────────────────────────────────────

/** Every monster in monsters.json, by hand. See the header for why this is a
 * table and not a derivation. Grouped by what they are, not alphabetically,
 * so a missing entry is obvious to a reader who knows the bestiary. */
const MONSTER_ARCHETYPE = {
  // Dragons and their kin — one body, many colours.
  green_dragon: 'dragon', red_dragon: 'dragon', black_dragon: 'dragon',
  vicious_black_dragon: 'dragon', adamant_dragon: 'dragon', rune_dragon: 'dragon',
  king_black_dragon: 'dragon', bone_wyvern: 'dragon', ashen_hydra: 'dragon',
  ironfang_drake: 'dragon', gravethorn_drake: 'dragon', drakthul_wyrmling: 'dragon',

  // Legless.
  ash_wyrm: 'serpent', cindermaw_serpent: 'serpent', venomcoil_matriarch: 'serpent',

  // Upright reptiles, including the four Nagadoth kings and their summons.
  nagadoth_rex: 'lizardman', nagadoth_prime: 'lizardman', nagadoth_supreme: 'lizardman',
  nagadoth_queen: 'lizardman', nagadoth_rex_summon: 'lizardman',
  nagadoth_prime_summon: 'lizardman', nagadoth_supreme_summon: 'lizardman',
  marshscale_shaman: 'lizardman', embertongue_lizard: 'lizardman',
  stoneglare_basilisk: 'lizardman', sebakh_the_devourer: 'lizardman',

  // Four-legged.
  dustpaw_rat: 'beast', cinderpaw_cub: 'beast', frostmaw_direwolf: 'beast',
  threefang_cerberus: 'beast', bloodmoon_stalker: 'beast', muttadile: 'beast',
  pasture_bull: 'bovine',

  // Feathered and winged.
  field_chicken: 'fowl',
  skyrender_kharra: 'bird', razorwing_harpy: 'bird', nightfang_beast: 'bird',

  // Many-legged.
  broodfang_spider: 'arachnid', voidweave_stalker: 'arachnid',
  nylocas_vasilias: 'arachnid', xarpus: 'arachnid', verzik_vitur: 'arachnid',
  vespula: 'insect', khepra_the_scarab_matron: 'insect',
  stoneback_crab: 'crab', duneback_crab: 'crab', tidereaper_crab: 'crab',
  marshfen_toad: 'toad',

  // Things from the deep, and things that are only an eye.
  deepmaw_kraken: 'kraken', the_great_olm: 'kraken', corporeal_horror: 'kraken',
  dread_core: 'orb',

  // People, and things shaped like people.
  cave_goblin: 'humanoid', arcane_adept: 'humanoid', umbral_adept: 'humanoid',
  astral_warrior: 'humanoid', astral_mage: 'humanoid', astral_ranger: 'humanoid',
  verdant_stalker: 'humanoid', bonelight_pyromancer: 'humanoid',
  cinderfang_reaver: 'humanoid', ashen_marauder: 'humanoid',
  crazy_archaeologist: 'humanoid', warlord_grondar: 'humanoid',
  commander_zephyra: 'humanoid', emberhowl_warlord: 'humanoid',
  torvek_the_corrupted: 'humanoid', zaryth_blade_sentinel: 'humanoid',
  zaryth_bolt_sentinel: 'humanoid', zaryth_rune_sentinel: 'humanoid',

  // Sunspire is explicit rather than name-guessed: a varied arena bestiary.
  ashen_warband_blade: 'gladiator', ashen_warband_bow: 'gladiator',
  ashen_warband_magus: 'gladiator', ashen_warband_bulwark: 'gladiator',
  sunclaw_gladiator: 'gladiator', aurelios_the_unbroken: 'gladiator',
  embercoil_shaman: 'lizardman',
  dawnlance_colossus: 'giant',
  triune_chimera: 'dragon',
  resonance_colossus: 'golem',
  hornwarden: 'demon',
  ember_swarm: 'imp',
  sunspire_healing_totem: 'orb',

  // The dead.
  glaive_skeleton: 'skeleton', boneclaw_revenant: 'skeleton',
  verin_the_defiled: 'skeleton', kaelor_the_tainted: 'skeleton',
  mirebound_husk: 'husk', gravehusk_brute: 'husk', pestilent_bloat: 'husk',
  gorath_the_infested: 'husk', dravok_the_wretched: 'husk',
  wailing_banshee: 'wraith', warped_spectre: 'wraith', wraithgale_specter: 'wraith',
  shroudwraith_specter: 'wraith', nether_wraith: 'wraith', hollow_reaver: 'wraith',
  duskmare: 'wraith', khareth_the_shadowbound: 'wraith',
  the_maiden_of_sugadinti: 'wraith', morvyn_the_blighted: 'wraith',

  // The horned.
  lesser_fiend: 'demon', nether_demon: 'demon', pyreclaw_demon: 'demon',
  cinder_devil: 'demon', krylth_the_defiler: 'demon', sanguine_veld: 'demon',
  runestone_gargoyle: 'demon', ember_tyrant: 'demon', ashen_crucible: 'demon',
  sovrathar_the_ashen_sovereign: 'demon', sotetseg: 'demon',
  zaryth_the_empty_lord: 'demon',
  frostbite_imp: 'imp', bogling_sprite: 'imp', ember_minion: 'imp',

  // The enormous.
  highland_giant: 'giant', briar_giant: 'giant', ember_giant: 'giant',
  hellbound_gorilla: 'giant', gorroth_the_mountain_ape: 'giant',

  // Made, not born.
  elder_rock_golem: 'golem', shadeglass_golem: 'golem', stonegale_elemental: 'golem',
  ironclad_guardian: 'golem', tekton: 'golem', blighted_gauntlet: 'golem',
  warden_of_arasmus: 'golem',

  // Rooted.
  elder_tree_spirit: 'treant', briarheart_treant: 'treant', thornhide_colossus: 'treant',
}

/** Fallback for monsters added after this table was written. Ordered, first
 * match wins; ordering carries real weight (a "wyrmling" is a dragon, a
 * "wyrm" is a serpent, and both contain the same four letters). */
const ARCHETYPE_RULES = [
  [/chicken|rooster|fowl|hen(?:_|$)/, 'fowl'],
  [/crab|lobster|crustac/, 'crab'],
  [/kraken|olm|tentacle|corporeal|squid/, 'kraken'],
  [/spider|arachnid|nylocas|scorpion|widow|weaver/, 'arachnid'],
  [/wasp|hornet|scarab|beetle|locust|mantis/, 'insect'],
  [/toad|frog|newt/, 'toad'],
  [/bull|cow|cattle|ox(?:_|$)|bison/, 'bovine'],
  [/harpy|raptor|eagle|raven|crow|bat(?:_|$)|winged/, 'bird'],
  [/wyrmling|dragon|drake|wyvern|hydra/, 'dragon'],
  [/wyrm|serpent|snake|cobra|viper|python|coil/, 'serpent'],
  [/treant|dryad|ent(?:_|$)|tree|briar|thorn/, 'treant'],
  [/golem|elemental|construct|guardian|sentinel|automat|warden/, 'golem'],
  [/imp(?:_|$)|sprite|pixie|minion|gremlin/, 'imp'],
  [/gargoyle|demon|fiend|devil|abyssal|balrog|tyrant/, 'demon'],
  [/giant|ogre|ape|gorilla|troll|titan|colossus|behemoth/, 'giant'],
  [/wraith|spect|ghost|banshee|phantom|shade(?:_|$)|nightmare|revenant|reaper|shroud/, 'wraith'],
  [/skeleton|skeletal|bone|lich|ossu/, 'skeleton'],
  [/husk|zombie|ghoul|rot|bloat|infest|corpse/, 'husk'],
  [/lizard|basilisk|saurian|reptil|naga|croc/, 'lizardman'],
  [/wolf|hound|cerberus|rat(?:_|$)|cub|tiger|lion|bear|boar|beast|jackal/, 'beast'],
  [/core(?:_|$)|orb|eye(?:_|$)|watcher|beholder/, 'orb'],
]

/** Which creature this monster is drawn as. Table first, name rules second,
 * and a plain humanoid last — an unrecognised monster gets a person with a
 * weapon, which is wrong far less often than any other guess. */
export function monsterArchetypeFor(monster) {
  const id = String(monster?.id || '')
  const named = MONSTER_ARCHETYPE[id]
  if (named && hasMonsterArchetype(named)) return named
  for (const [pattern, archetype] of ARCHETYPE_RULES) {
    if (pattern.test(id)) return archetype
  }
  return 'humanoid'
}

/** What this monster is made of. Override, then material words in its own
 * name, then whatever its archetype is by default. */
export function monsterPaletteNameFor(monster, archetype) {
  const id = String(monster?.id || '')
  if (PALETTE_OVERRIDE[id] && HIDE_PALETTES[PALETTE_OVERRIDE[id]]) return PALETTE_OVERRIDE[id]
  for (const [pattern, name] of PALETTE_RULES) {
    if (pattern.test(id)) return name
  }
  return ARCHETYPE_PALETTE[archetype] || 'flesh'
}

// ── Size ──────────────────────────────────────────────────────────────────

/** Combat level -> how the creature is presented. Size is the obvious half;
 * the other half is that from `large` up a monster stops making its light
 * attack and starts making its heavy one, so a level-600 boss and a level-6
 * one never swing the same way even when they share an archetype. */
const WEIGHT_CLASSES = [
  { key: 'small', maxLevel: 14, size: 0.78 },
  { key: 'normal', maxLevel: 69, size: 1 },
  { key: 'large', maxLevel: 199, size: 1.12 },
  { key: 'huge', maxLevel: 499, size: 1.22 },
  { key: 'colossal', maxLevel: Infinity, size: 1.32 },
]
// A monster starts making its HEAVY attack here — level 200, which is where
// the bestiary's bosses and great beasts begin. Tying it to the same ladder
// as size is the point: the thing that looks like it hits harder is the thing
// that hits harder.
const HEAVY_FROM_INDEX = 3  // 'huge'

/** How far a hovering creature floats above the ground line, in stage units.
 * Fixed rather than scaled: it is a property of the STAGE (how high off this
 * floor a thing hangs), not of the creature's own size. */
export const HOVER_LIFT = 12

export function monsterWeightClass(combatLevel) {
  const lvl = Number(combatLevel) || 0
  return WEIGHT_CLASSES.find(w => lvl <= w.maxLevel) || WEIGHT_CLASSES[WEIGHT_CLASSES.length - 1]
}

function weightIndex(key) {
  return WEIGHT_CLASSES.findIndex(w => w.key === key)
}

/**
 * The render scale, solved rather than authored.
 *
 * An archetype declares how tall it STANDS relative to a person at NORMAL
 * weight (`stature`),
 * never how big its paths happen to be drawn — so a body can be redrawn at
 * whatever size is convenient to author without anyone re-tuning a magic
 * number to match. The solve turns that into a scale against the drawing's
 * own measured height, applies the weight class on top, and then clamps
 * against all four walls of the stage.
 *
 * The clamp is not a safety rail, it is load-bearing: a colossal dragon wants
 * 1.27 x 1.15 of a person, which is taller than the frame, and a creature
 * whose head is cropped off the top is at its least readable in exactly the
 * fight where reading it matters most.
 */
function solveScale(archetype, sizeFactor) {
  const shape = monsterShapeFor(archetype)
  const b = monsterBounds(archetype)
  const drawnHeight = Math.max(1, b.maxY - b.minY)
  let s = (shape.stature * PLAYER_HEIGHT / drawnHeight) * sizeFactor
  // A hovering creature is lifted off the floor, so its lift eats into the
  // headroom the ceiling clamp has to work with — measured in stage units,
  // which is why it is applied to the ceiling rather than to the scale.
  const lift = shape.hover ? HOVER_LIFT : 0
  if (b.minY < 0) s = Math.min(s, (GROUND_Y - lift - CEILING_Y) / -b.minY)
  if (b.maxX > 0) s = Math.min(s, LANE_LIMIT / b.maxX)
  if (b.minX < 0) s = Math.min(s, BACK_LIMIT / -b.minX)
  if (shape.armed && shape.grip) s = Math.min(s, WEAPON_LANE_LIMIT / (shape.grip[0] + WEAPON_REACH))
  return Math.max(0.2, Number(s.toFixed(3)))
}

// ── Motion ────────────────────────────────────────────────────────────────

// Every motion an archetype may name, and which drawn group it animates.
// The renderer never guesses: an archetype with no `arm` group cannot be
// given an arm motion, and this table is what tests/monsterFigures.test.ts
// checks that against.
export const MONSTER_MOTIONS = {
  swing: 'arm', claw: 'arm', slam: 'arm', hurl: 'arm', shoot: 'arm',
  cast: 'arm', pinch: 'arm', lash: 'arm',
  bite: 'head', maul: 'head', spit: 'head', breath: 'head', peck: 'head',
  gore: 'head',
  sting: 'tail',
}

/** Motions that carry a whole-body lurch as well as the limb — the "heavier
 * swing" a big monster makes. Kept as a set here rather than a class the
 * renderer derives, so the CSS and this file cannot disagree about which
 * attacks shake the ground. */
const HEAVY_MOTIONS = new Set(['slam', 'maul', 'gore'])

export function isHeavyMotion(motion) {
  return HEAVY_MOTIONS.has(motion)
}

/** Which projectile leaves the creature, or null for an attack that connects
 * in reach. Derived from the MOTION rather than the style, because that is
 * what the animation actually shows: a dragon's magic is a gout of fire, a
 * serpent's is a spat glob, a shaman's is a conjured orb. */
export function monsterShotKind(motion, archetype) {
  if (motion === 'breath') return 'flame'
  if (motion === 'spit') return 'glob'
  if (motion === 'shoot') return 'arrow'
  if (motion === 'hurl') return monsterShapeFor(archetype).armed ? 'arrow' : 'glob'
  if (motion === 'cast') return 'orb'
  return null
}

// Weapon shapes for the archetypes that carry one, by what the monster is
// called. Same idea as actionSprites.js's `weaponIconTypeFor`, over a much
// smaller vocabulary — a monster's weapon is flavour, not an equipped item
// with stats to respect.
// Ordered, and the ordering is the whole rule: a word naming the WEAPON beats
// a word naming the monster's ROLE. "Zaryth Bolt Sentinel" is both a sentinel
// and a bolt-thrower, and read the other way round it draws a swordsman
// shooting at a player standing across the lane.
const MONSTER_WEAPON_RULES = [
  [/crossbow|bolt(?:_|$)/, 'crossbow'],
  [/bow(?!yer)/, 'longbow'],
  [/staff|stave|wand/, 'staff'],
  [/glaive|halberd|spear|pike/, 'sword'],
  [/scimitar/, 'scimitar'],
  [/axe|maul|hammer/, 'maul'],
  [/blade|sword/, 'sword'],
  // Roles, only once no weapon has been named outright.
  [/archer|ranger|hunt|stalker/, 'longbow'],
  [/mage|wizard|shaman|adept|sorcer|warlock|rune|pyroman|archaeolog/, 'staff'],
  [/warlord|brute|tekton/, 'maul'],
  [/reaver|marauder/, 'scimitar'],
  [/warrior|knight|sentinel|champion/, 'sword'],
]

/** The weapon an armed monster is drawn holding. Style decides when the name
 * says nothing — and it must, or a ranged skeleton swings a sword at a player
 * standing across the lane. */
export function monsterWeaponTypeFor(monster, style) {
  const id = String(monster?.id || '')
  for (const [pattern, type] of MONSTER_WEAPON_RULES) {
    if (pattern.test(id)) {
      // A name rule may not contradict the style the monster actually fights
      // with: "bolt sentinel" matches `sentinel` (sword) before `bolt`, and
      // it shoots.
      const melee = type !== 'longbow' && type !== 'crossbow' && type !== 'staff'
      if (style === 'ranged' && melee) return 'longbow'
      if (style === 'magic' && melee) return 'staff'
      if (style !== 'ranged' && style !== 'magic' && !melee) return 'sword'
      return type
    }
  }
  if (style === 'ranged') return 'longbow'
  if (style === 'magic') return 'staff'
  return 'sword'
}

// A multi-form boss's CURRENT form is readable off the creature itself: its
// eyes and aura take the style's own colour. That is the only per-phase
// recolour, and it is deliberately the EYES — the one part of every archetype
// that is already allowed to be bright, so no body needs a second palette.
const PHASE_GLOW = {
  melee: 'var(--ink-glow-red)',
  ranged: 'var(--ink-glow-green)',
  magic: 'var(--ink-glow-blue)',
}

export function phaseGlowFor(style) {
  return PHASE_GLOW[style] || null
}

// ── The resolved figure ───────────────────────────────────────────────────

/**
 * Everything MonsterFigure needs to draw one monster, resolved in one call.
 *
 * `style` comes from the SPRITE, not from the monster record: a multi-form
 * boss's current form decides how it attacks, and reading `monster.attackStyle`
 * here would reintroduce exactly the bug CLAUDE.md §4 records for the open
 * world — Zaryth permanently ranged, its melee and magic animations never
 * playing. `monsterCombatSprite` (utils/actionSprites.js) already resolves the
 * form; this takes its answer.
 */
export function monsterFigureFor(monster, style) {
  const archetype = monsterArchetypeFor(monster)
  const shape = monsterShapeFor(archetype)
  const paletteName = monsterPaletteNameFor(monster, archetype)
  const weight = monsterWeightClass(monster?.combatLevel)
  const heavy = weightIndex(weight.key) >= HEAVY_FROM_INDEX

  const styleKey = style === 'ranged' || style === 'magic' ? style : 'melee'
  const declared = shape.attacks[styleKey] || shape.attacks.melee
  // Only a MELEE attack upgrades with weight: a heavier creature hits harder
  // in reach, but it does not fire a heavier arrow. `heavy` is also declared
  // per archetype rather than assumed — a chicken has no heavier way to peck,
  // and giving it one would be the animation lying about the fight.
  const motion = (styleKey === 'melee' && heavy && shape.heavy) ? shape.heavy : declared

  return {
    archetype,
    label: shape.label,
    palette: HIDE_PALETTES[paletteName] || HIDE_PALETTES.flesh,
    paletteName,
    scale: solveScale(archetype, weight.size),
    lift: shape.hover ? HOVER_LIFT : 0,
    weight: weight.key,
    heavy,
    motion,
    heavyMotion: isHeavyMotion(motion),
    death: shape.death || 'topple',
    rigid: !!shape.rigid,
    flier: !!shape.flier,
    armed: !!shape.armed,
    weaponIconType: shape.armed ? monsterWeaponTypeFor(monster, styleKey) : null,
    shotKind: monsterShotKind(motion, archetype),
    phaseGlow: monster?.multiForm ? phaseGlowFor(styleKey) : null,
  }
}

/** Where a monster's projectile leaves it, in the STAGE's own (unmirrored)
 * enemy-side coordinates — the archetype's local muzzle, placed exactly the
 * way MonsterFigure places the drawing itself. Derived from the same three
 * numbers as the render, so the fire cannot start somewhere the jaw isn't. */
export function monsterMuzzle(figure) {
  const shape = monsterShapeFor(figure.archetype)
  const source = figure.armed && shape.grip ? shape.grip : shape.muzzle
  if (!source) return null
  return {
    x: FOOT_X + source[0] * figure.scale,
    y: GROUND_Y - figure.lift + source[1] * figure.scale,
  }
}

/**
 * The contact shadow under a monster, in the stage's own (unmirrored)
 * enemy-side coordinates.
 *
 * Sized from the creature, not fixed: the enemy is now scaled per monster
 * (0.37 for a chicken, 1.03 for a kraken) and a single 42-unit ellipse read
 * as a chicken standing on a manhole cover and a dragon floating over a
 * puddle. It is centred under the creature's OWN footprint rather than under
 * the placement point, because a body is not symmetrical about its feet — a
 * serpent's coil and a spider's abdomen both sit well behind theirs.
 *
 * Narrower than the silhouette that casts it (0.42, not 0.5): a shadow is
 * where the creature TOUCHES the ground, and a wing or a raised tail touches
 * nothing. A hovering creature keeps a shadow — losing it entirely is what
 * makes a floating thing read as pasted on rather than airborne — but a
 * smaller, fainter one.
 */
export function monsterShadow(figure) {
  const b = monsterBounds(figure.archetype)
  const hover = figure.lift > 0
  const width = (b.maxX - b.minX) * figure.scale
  const rx = Math.max(5, width * 0.42 * (hover ? 0.68 : 1))
  return {
    cx: FOOT_X + ((b.minX + b.maxX) / 2) * figure.scale,
    rx,
    ry: Math.max(1.6, rx * 0.16),
    hover,
  }
}

/** Where hit splats and the mini HP bar sit — the creature's own mass, not
 * the middle of the frame. A crab's torso is 22 units up and a demon's is 56;
 * anchoring both at one height put a splat over empty floor for one and over
 * a horn for the other. */
export function monsterTorso(figure) {
  const shape = monsterShapeFor(figure.archetype)
  const [tx, ty] = shape.torso || [0, -40]
  return {
    x: FOOT_X + tx * figure.scale,
    y: GROUND_Y - figure.lift + ty * figure.scale,
  }
}
