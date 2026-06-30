/* PocketRPG — world model for the area-driven map prototype.
   Places are nodes on a road graph; edges carry a tick-distance (600ms/tick,
   compressed for the demo). Activities live AT places — you can only reach
   combat / dungeons / quests / minigames by travelling to where they are. */

window.WORLD = {
  // virtual board the map is laid out on (px). The view pans/zooms over this.
  board: { w: 1640, h: 1160 },

  // each tick is 600ms in the live game; compressed here so a leg is seconds.
  msPerTick: 90,

  // ── road network: [from, to, ticks] ──────────────────────────────────
  // travel time between any two places = shortest path over these weights,
  // so a far place composes out of several legs (as in the brief).
  edges: [
    ['emberhold', 'greyfen',   18],
    ['emberhold', 'saltmarket',22],
    ['emberhold', 'oakhollow', 16],
    ['emberhold', 'mudgate',   14],
    ['emberhold', 'ashenrest', 20],
    ['greyfen',   'thornwick', 12],
    ['greyfen',   'ashenrest', 13],
    ['thornwick', 'mudgate',   15],
    ['saltmarket','crowfoot',  17],
    ['saltmarket','ashenrest', 19],
    ['oakhollow', 'crowfoot',  14],
    ['oakhollow', 'mudgate',   18],
  ],

  // ── places ────────────────────────────────────────────────────────────
  places: {
    emberhold: {
      name: 'Emberhold', tier: 'city', x: 820, y: 590,
      accent: 'var(--fm-ember)', biome: 'forge-capital', icon: 'castle',
      sub: 'Capital of the Cinder Reach',
      lore: 'Smoke never leaves the spires of Emberhold; every road in the Reach ends at its gates.',
      activities: [
        { t:'raid',     name:'The Molten Vault',     icon:'flame',        lvl:'90+',     note:'8-player · weekly lockout' },
        { t:'boss',     name:'Ashmaw, the Forge-Wyrm',icon:'death_skull',  lvl:'Lv 84',   note:'Solo or duo · rare drops' },
        { t:'dungeon',  name:'The Undercinder',      icon:'dungeon_gate',  lvl:'70–88',   note:'3 floors · 24 monsters' },
        { t:'combat',   name:'Slag Pits',            icon:'crossed_swords',lvl:'62–75',   note:'Fire imps · cinder hounds' },
        { t:'quest',    name:'The Guildmaster\u2019s Debt', icon:'scroll', lvl:'Lv 60',   note:'Story · 3 stages' },
        { t:'minigame', name:'Anvil Rhythm',         icon:'anvil',         lvl:'Any',     note:'Smithing minigame' },
        { t:'shop',     name:'Grand Bazaar',         icon:'coins',         lvl:'\u2014',  note:'Trading Post · 40 stalls' },
      ],
    },
    greyfen: {
      name: 'Greyfen', tier: 'town', x: 470, y: 360,
      accent: 'var(--fm-verdigris)', biome: 'marsh', icon: 'home',
      sub: 'Fenland trading town',
      lore: 'Built on stilts above the mire, Greyfen runs on eels, peat and quiet bargains.',
      activities: [
        { t:'dungeon',  name:'Sunken Warrens',  icon:'dungeon_gate',  lvl:'40–58', note:'Flooded · 2 floors' },
        { t:'boss',     name:'The Bog Matron',  icon:'death_skull',   lvl:'Lv 52', note:'Weekly · poison fight' },
        { t:'combat',   name:'Reed Marshes',    icon:'crossed_swords',lvl:'32–48', note:'Marsh lurkers · leeches' },
        { t:'quest',    name:'Salt in the Water',icon:'scroll',       lvl:'Lv 38', note:'Story · 2 stages' },
        { t:'minigame', name:'Eel Trapping',    icon:'fishing_pole',  lvl:'Any',   note:'Fishing minigame' },
      ],
    },
    saltmarket: {
      name: 'Saltmarket', tier: 'town', x: 1190, y: 380,
      accent: 'var(--fm-woad)', biome: 'coast', icon: 'home',
      sub: 'Harbour town of the Pale Coast',
      lore: 'Where the tide brings cargo and the cartels bring trouble; salt cures both.',
      activities: [
        { t:'dungeon',  name:'The Brine Caves',  icon:'dungeon_gate',  lvl:'46–64', note:'Tidal · 3 floors' },
        { t:'boss',     name:'Captain Vorrl',    icon:'death_skull',   lvl:'Lv 58', note:'Drops cutlass set' },
        { t:'combat',   name:'Smugglers\u2019 Strand',icon:'crossed_swords',lvl:'38–55',note:'Pirates · sea wraiths' },
        { t:'quest',    name:'The Drowned Ledger',icon:'scroll',       lvl:'Lv 44', note:'Story · 3 stages' },
        { t:'minigame', name:'Cargo Run',        icon:'coins',         lvl:'Any',   note:'Trading minigame' },
      ],
    },
    thornwick: {
      name: 'Thornwick', tier: 'village', x: 330, y: 690,
      accent: 'var(--fm-verdigris)', biome: 'forest', icon: 'home',
      sub: 'Woodcutters\u2019 village',
      lore: 'A ring of timber halls under the old briarwood, far from any road that matters.',
      activities: [
        { t:'combat',   name:'Briarwood Glade', icon:'crossed_swords',lvl:'12–26', note:'Wolves · briar sprites' },
        { t:'quest',    name:'The Crooked Bough',icon:'scroll',       lvl:'Lv 16', note:'Story · 2 stages' },
        { t:'minigame', name:'Timber Felling',  icon:'wood_axe',      lvl:'Any',   note:'Woodcutting minigame' },
      ],
    },
    oakhollow: {
      name: 'Oakhollow', tier: 'village', x: 1080, y: 770,
      accent: 'var(--fm-verdigris)', biome: 'farmland', icon: 'home',
      sub: 'Farming village',
      lore: 'Golden terraces and a single tavern; Oakhollow measures the year in harvests.',
      activities: [
        { t:'combat',   name:'Scarecrow Fields',icon:'crossed_swords',lvl:'18–30', note:'Field husks · crows' },
        { t:'quest',    name:'A Poor Harvest',  icon:'scroll',        lvl:'Lv 22', note:'Story · 2 stages' },
        { t:'minigame', name:'Reaping Rush',    icon:'wheat',         lvl:'Any',   note:'Farming minigame' },
      ],
    },
    mudgate: {
      name: 'Mudgate', tier: 'hamlet', x: 640, y: 900,
      accent: 'var(--fm-ink-faint)', biome: 'crossroads', icon: 'door',
      sub: 'Roadside hamlet',
      lore: 'Three shacks and a well at the meeting of roads. Most travellers don\u2019t stop.',
      activities: [
        { t:'combat',   name:'The Ditches',     icon:'crossed_swords',lvl:'3–10',  note:'Rats · road bandits' },
      ],
    },
    crowfoot: {
      name: 'Crowfoot', tier: 'hamlet', x: 1360, y: 650,
      accent: 'var(--fm-ink-faint)', biome: 'moor', icon: 'door',
      sub: 'Moorland hamlet',
      lore: 'Wind, gorse and crows. The kind of place you pass through with a hand on your purse.',
      activities: [
        { t:'combat',   name:'Gorse Moor',      icon:'crossed_swords',lvl:'5–12',  note:'Moor wolves · crow swarms' },
      ],
    },
    ashenrest: {
      name: 'Ashen Rest', tier: 'hamlet', x: 760, y: 200,
      accent: 'var(--fm-ink-faint)', biome: 'ashlands', icon: 'door',
      sub: 'Waystation hamlet',
      lore: 'A shrine and a graveyard on the ash road north. People rest here. Some stay.',
      activities: [
        { t:'combat',   name:'The Ashen Field', icon:'crossed_swords',lvl:'8–15',  note:'Cinder ghouls · wisps' },
      ],
    },
  },

  // tier visual + content metadata
  tiers: {
    city:    { label:'City',    size:92, ring:'var(--fm-ember)',     blurb:'Raids · dungeons · bosses · quests · minigames · shops' },
    town:    { label:'Town',    size:72, ring:'var(--fm-woad)',      blurb:'Dungeons · bosses · quests · minigames' },
    village: { label:'Village', size:56, ring:'var(--fm-verdigris)', blurb:'Monsters · quests · minigames' },
    hamlet:  { label:'Hamlet',  size:46, ring:'var(--fm-brass)',     blurb:'Low-level monsters' },
  },

  // activity-type → tag colour + label
  kinds: {
    raid:    { label:'Raid',     cls:'royal'     },
    boss:    { label:'Boss',     cls:'blood'     },
    dungeon: { label:'Dungeon',  cls:'woad'      },
    combat:  { label:'Combat',   cls:'ember'     },
    quest:   { label:'Quest',    cls:'verdigris' },
    minigame:{ label:'Minigame', cls:'brass'     },
    shop:    { label:'Shop',     cls:'brass'     },
  },
};
