// Shared marketing copy + data for the mobile and desktop landing screens.
// Kept in one module so the two screens never drift. Numbers are pulled from
// the live game data (world.json / quests.json / collectionLog UI total) —
// update here when that content changes. All identifiers are LANDING_-prefixed
// so the single-file build (which concatenates every module at top level) stays
// free of duplicate-identifier collisions.

// Headline proof points. Verified against src/data on 2026-07: 24 trainable
// skills, 168 quests, 14 settlements, 4 world raids, 221 collection-log slots
// (the server-authoritative total shown in-game).
export const LANDING_STATS = [
  ['600ms', 'World tick'],
  ['14', 'Settlements'],
  ['24', 'Skills to 99'],
  ['168', 'Quests'],
  ['4', 'Raids'],
  ['221', 'Collectibles'],
]

// Settlement tiers — matches world.json `tiers`. Colour keys reuse the theme
// tier accents so the legend reads the same as the in-game map medallions.
export const LANDING_TIERS = [
  { id: 'city',    label: 'City',    color: 'var(--color-gold-light)',    blurb: 'Raids, dungeons, bosses, quests, minigames & shops' },
  { id: 'town',    label: 'Town',    color: 'var(--color-mana-light)',    blurb: 'Dungeons, bosses, quests & minigames' },
  { id: 'village', label: 'Village', color: 'var(--color-emerald-light)', blurb: 'Monsters, gathering & quests' },
]

// The 14 places of Eldermoor. `img` keys the painted establishing scene in
// landingImages (lp-<id>). Blurbs are drawn from each place's in-game lore and
// what actually lives there (raids/bosses/skills), condensed for marketing.
export const LANDING_PLACES = [
  { id: 'varrick',    name: 'Varrick',    tier: 'city',    sub: 'Capital of the realm',        img: 'lp-varrick',    blurb: 'The great stone capital — grand smithy, God Wars generals, and the Crimson Night Theatre raid.' },
  { id: 'faloden',    name: 'Faloden',    tier: 'city',    sub: 'City of the White Order',      img: 'lp-faloden',    blurb: 'A walled city of knights and miners, furnaces never cold — home to the Vaults of Xyren raid.' },
  { id: 'ardounne',   name: 'Ardounne',   tier: 'city',    sub: 'The western city',             img: 'lp-ardounne',   blurb: 'Grand spires and crooked back-alleys — a thief’s paradise, and two raids to plunder.' },
  { id: 'lumbright',  name: 'Lumbright',  tier: 'town',    sub: 'The starter town',             img: 'lp-lumbright',  blurb: 'Where every adventurer’s tale begins — gentle foes, first rooftops, roads to everywhere.' },
  { id: 'alkarid',    name: 'Al-Karid',   tier: 'town',    sub: 'Gateway to the dunes',         img: 'lp-alkarid',    blurb: 'A sun-baked toll town at the desert’s edge, its great furnace roaring for the caravans.' },
  { id: 'edgevale',   name: 'Edgevale',   tier: 'town',    sub: 'Last town before the wilds',   img: 'lp-edgevale',   blurb: 'A rough frontier town on the edge of the lawless north. The gate locks after dark.' },
  { id: 'seerhold',   name: 'Seerhold',   tier: 'town',    sub: 'Town of the far-seers',        img: 'lp-seerhold',   blurb: 'Soothsayers and flax fields, its crystal halls humming with quiet magic.' },
  { id: 'brimhollow', name: 'Brimhollow', tier: 'town',    sub: 'Port of the south isle',       img: 'lp-brimhollow', blurb: 'A humid harbour town beneath a smoking volcano, bound for stranger shores.' },
  { id: 'camlann',    name: 'Camlann',    tier: 'town',    sub: 'Hall of the round table',      img: 'lp-camlann',    blurb: 'A noble hill-town of banners and knights-errant — the northern seat of honour.' },
  { id: 'portsarin',  name: 'Port Sarin', tier: 'town',    sub: 'The southern port',            img: 'lp-portsarin',  blurb: 'A salt-crusted harbour of fishmongers and smugglers; every ship south casts off here.' },
  { id: 'draynar',    name: 'Draynar',    tier: 'village', sub: 'Willow-shaded village',        img: 'lp-draynar',    blurb: 'Quiet willows and a watchful bank, where pickpockets practise before the city.' },
  { id: 'barlock',    name: 'Barlock',    tier: 'village', sub: 'Village of the war-clans',     img: 'lp-barlock',    blurb: 'Longhouses and anvils where the hill-clans mine, brawl, and hammer iron.' },
  { id: 'catherra',   name: 'Catherra',   tier: 'village', sub: 'Fishing village on the bay',   img: 'lp-catherra',   blurb: 'A calm coastal village beneath the northern hills — the catch is always fresh.' },
  { id: 'canifel',    name: 'Canifel',    tier: 'village', sub: 'Village of the haunted fens',  img: 'lp-canifel',    blurb: 'A shuttered village in the eastern marsh, where something always watches the road.' },
]

// Feature cards. `img` keys an in-game screenshot (ss-*).
export const LANDING_FEATURES = [
  {
    icon: 'crossed_swords', title: 'Bosses & Raids',
    desc: 'God Wars generals, dragons, and four end-game raids scattered across the realm. Set your loadout, then fight on autopilot while the ticks roll.',
    img: 'ss-combat', tags: ['Auto-combat', 'God Wars', '4 Raids'],
  },
  {
    icon: 'progression', title: '24 Skills to Master',
    desc: 'Train Attack, Thieving, Mining, Runecraft and more from 1 to 99. Every skill ticks live and idles offline — even with the screen off.',
    img: 'ss-home', tags: ['1 → 99', 'Idle XP', 'Offline-first'],
  },
  {
    icon: 'cash', title: 'A Deep Economy',
    desc: 'A bank with hundreds of slots, a live player-driven Trading Post, and 221 Collection Log slots to hunt down across every corner of Eldermoor.',
    img: 'ss-trading', tags: ['Trading Post', '221 collectibles', 'Hundreds of items'],
  },
  {
    icon: 'scroll', title: '168 Quests',
    desc: 'Quest chains from Novice to Grandmaster, each rewarding XP, rare items, and lore. Journeys plot their own route across the world map.',
    img: 'ss-collection', tags: ['Novice → Grandmaster', 'QP cape', 'Lore'],
  },
]
