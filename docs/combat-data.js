// PocketRPG — Combat data.
// Mirrors the live game's "Choose a Monster" system: combat areas (some expand into
// multiple monsters), per-monster stats + drop tables, raids with staged rooms, and
// the idle consumable pools (food / potions / prayers) + attack styles.
// All icons are VERIFIED game-icons (Iconify) names reused from the existing PocketRPG files.
(function () {
  if (!window.iconUrl) {
    window.iconUrl = function (name, color) {
      const c = color ? '?color=' + encodeURIComponent(color) : '';
      return 'https://api.iconify.design/game-icons/' + name + '.svg' + c;
    };
  }
  if (!window.formatNum) {
    window.formatNum = function (n) {
      if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'M';
      if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'k';
      return n.toLocaleString('en-US');
    };
  }

  // ── Attack styles (segmented selector) ──
  const STYLES = [
    { id: 'accurate',   name: 'Accurate',   trains: 'Attack',   icon: 'gladius' },
    { id: 'aggressive', name: 'Aggressive', trains: 'Strength', icon: 'muscle-up' },
    { id: 'defensive',  name: 'Defensive',  trains: 'Defence',  icon: 'shield' },
  ];

  // ── Combat styles a monster can use / be weak to ──
  const STYLE_META = {
    Melee:  { icon: 'gladius',      color: '#e0564b' },
    Ranged: { icon: 'high-shot',    color: '#7bbf52' },
    Magic:  { icon: 'crystal-ball', color: '#9b6cff' },
  };

  // ── Idle consumables ──
  const FOOD = [
    { name: 'King Crab',   icon: 'crab',       heal: 22, own: 312 },
    { name: 'Cooked Shark', icon: 'fried-fish', heal: 20, own: 996 },
    { name: 'Prime Steak', icon: 'steak',      heal: 14, own: 5085 },
    { name: 'Skewered Shrimp', icon: 'shrimp', heal: 7,  own: 2935 },
    { name: 'Cooked Meat', icon: 'meat',       heal: 3,  own: 1225 },
  ];
  const POTIONS = [
    { name: 'Super Combat',  icon: 'potion-ball',        effect: '+19% melee', own: 84 },
    { name: 'Sacred Brew',   icon: 'round-bottom-flask', effect: '+16 HP / sip', own: 140 },
    { name: 'Elixir of Renewal', icon: 'standing-potion', effect: 'Restores stats', own: 73 },
    { name: 'Dragonfire Tonic', icon: 'drink-me',        effect: 'Negates dragonfire', own: 21 },
  ];
  const PRAYERS = [
    { name: 'Protect from Melee', icon: 'shield',      drain: 'High',  desc: 'Blocks melee damage' },
    { name: 'Piety',              icon: 'muscle-up',   drain: 'High',  desc: '+23% Att, +23% Str, +25% Def' },
    { name: 'Rigour',             icon: 'high-shot',   drain: 'High',  desc: '+20% Ranged, +23% Ranged Str' },
    { name: 'Augury',             icon: 'crystal-ball', drain: 'High', desc: '+25% Magic, +25% Mage Def' },
    { name: 'Eagle Eye',          icon: 'high-shot',   drain: 'Med',   desc: '+15% Ranged accuracy & damage' },
  ];

  // helper to build a drop table
  function drop(name, icon, chance, min, max) { return { name, icon, chance, min, max }; }

  // ── Combat areas. type 'area' expands into monsters; 'raid' opens a raid sheet. ──
  const AREAS = [
    {
      id: 'training', type: 'area', name: 'Training', icon: 'crossed-swords', accent: '#cdd6e0',
      blurb: 'Cut your teeth on the weak',
      monsters: [
        {
          name: 'Training Dummy', icon: 'crossed-swords', cb: 1, hp: 25, att: 0, def: 1, maxHit: 0,
          style: 'Melee', weakness: 'Melee', kc: 412,
          drops: [drop('Coins', 'cash', 100, 1, 5)], unique: null,
        },
        {
          name: 'Cave Goblin', icon: 'goblin-head', cb: 5, hp: 35, att: 4, def: 3, maxHit: 2,
          style: 'Melee', weakness: 'Magic', kc: 168,
          drops: [drop('Coins', 'cash', 90, 3, 12), drop('Goblin Mail', 'leather-armor', 14, 1, 1), drop('Bronze Spear', 'spear-hook', 6, 1, 1)],
          unique: null,
        },
        {
          name: 'Hill Giant', icon: 'ogre', cb: 28, hp: 70, att: 18, def: 14, maxHit: 8,
          style: 'Melee', weakness: 'Ranged', kc: 54,
          drops: [drop('Big Bones', 'dinosaur-bones', 100, 1, 1), drop('Coins', 'cash', 80, 20, 90), drop('Limpwurt Root', 'cut-palm', 12, 1, 2), drop('Giant Key', 'key', 4, 1, 1)],
          unique: null,
        },
      ],
    },
    {
      id: 'slayer', type: 'area', name: 'Slayer', icon: 'death-skull', accent: '#c0453b',
      blurb: 'Tasks from the Slayer Master',
      monsters: [
        {
          name: 'Gargoyle', icon: 'gargoyle', cb: 111, hp: 105, att: 60, def: 80, maxHit: 12,
          style: 'Melee', weakness: 'Melee', kc: 1240,
          drops: [drop('Coins', 'cash', 90, 200, 900), drop('Rune Full Helm', 'helmet', 8, 1, 1), drop('Mystic Robe', 'leather-armor', 6, 1, 1), drop('Granite Maul', 'spiked-mace', 3, 1, 1)],
          unique: { chance: 0.5, items: [['Gargoyle Smasher', 'spiked-mace']] },
        },
        {
          name: 'Abyssal Demon', icon: 'spectre', cb: 124, hp: 150, att: 97, def: 135, maxHit: 8,
          style: 'Melee', weakness: 'Magic', kc: 2870,
          drops: [drop('Ashes', 'powder', 100, 1, 1), drop('Coins', 'cash', 85, 300, 1400), drop('Rune Chainbody', 'leather-armor', 5, 1, 1), drop('Blood Rune', 'rune-stone', 18, 7, 70)],
          unique: { chance: 1.0, items: [['Abyssal Whip', 'dripping-sword'], ['Abyssal Dagger', 'bone-knife']] },
        },
        {
          name: 'Acidic Hydra', icon: 'wyvern', cb: 194, hp: 300, att: 170, def: 220, maxHit: 24,
          style: 'Magic', weakness: 'Ranged', kc: 96,
          drops: [drop('Hydra Bones', 'dinosaur-bones', 100, 1, 1), drop('Coins', 'cash', 80, 1000, 5000), drop('Dragon Knife', 'bone-knife', 6, 5, 30)],
          unique: { chance: 2.0, items: [['Hydra Tail', 'dripping-sword'], ["Hydra's Eye", 'glowing-artifact'], ['Brimstone Ring', 'ring']] },
        },
      ],
    },
    {
      id: 'godwars', type: 'area', name: 'God Wars Dungeon', icon: 'crowned-skull', accent: '#d8b13a',
      blurb: 'Generals of the eternal war',
      monsters: [
        {
          name: 'Warchief Grakkar', icon: 'minotaur', cb: 624, hp: 510, att: 350, def: 250, maxHit: 60,
          style: 'Melee', weakness: 'Ranged', kc: 38,
          drops: [drop('Big Bones', 'dinosaur-bones', 100, 1, 1), drop('Coins', 'cash', 75, 8000, 24000), drop('Rune Longsword', 'broadsword', 10, 1, 3)],
          unique: { chance: 4.0, items: [['Bandos Chestplate', 'leather-armor'], ['Bandos Tassets', 'leather-armor'], ['Bandos Hilt', 'two-handed-sword']] },
        },
        {
          name: 'Skyfeather Matron', icon: 'griffin-symbol', cb: 580, hp: 420, att: 300, def: 240, maxHit: 47,
          style: 'Ranged', weakness: 'Magic', kc: 21,
          drops: [drop('Coins', 'cash', 75, 8000, 22000), drop('Adamant Arrow', 'arrow-cluster', 40, 50, 250)],
          unique: { chance: 4.0, items: [['Armadyl Chestplate', 'leather-armor'], ['Armadyl Helmet', 'helmet'], ['Armadyl Hilt', 'high-shot']] },
        },
      ],
    },
    {
      id: 'nagadoth', type: 'area', name: 'Nagadoth Kings', icon: 'horned-skull', accent: '#e0564b',
      blurb: 'The three crowned tyrants',
      monsters: [
        {
          name: 'Nagadoth Rex', icon: 'dragon-head', cb: 303, hp: 150, att: 90, def: 100, maxHit: 31,
          style: 'Melee', weakness: 'Ranged', kc: 0,
          drops: [drop('Dragon Bones', 'dinosaur-bones', 100, 1, 1), drop('Coins', 'cash', 80, 4000, 12000), drop('Onyx Bolt Tips', 'arrow-cluster', 12, 5, 20)],
          unique: { chance: 3.0, items: [['Rex Warspear', 'spear-hook'], ['Draconic Visage', 'dragon-head'], ['Tyrant Crown', 'crown']] },
        },
        {
          name: 'Nagadoth Prime', icon: 'horned-skull', cb: 303, hp: 150, att: 1, def: 100, maxHit: 36,
          style: 'Magic', weakness: 'Melee', kc: 1,
          drops: [drop('Infernal Ashes', 'powder', 100, 1, 1), drop('Coins', 'cash', 80, 4000, 12000), drop('Soul Rune', 'rune-stone', 16, 20, 90)],
          unique: { chance: 3.0, items: [['Prime Scepter', 'fairy-wand'], ['Skeletal Visage', 'horned-skull'], ['Tyrant Crown', 'crown']] },
        },
        {
          name: 'Nagadoth Supreme', icon: 'high-shot', cb: 303, hp: 150, att: 1, def: 100, maxHit: 33,
          style: 'Ranged', weakness: 'Magic', kc: 2,
          drops: [drop('Dragon Bones', 'dinosaur-bones', 100, 1, 1), drop('Coins', 'cash', 80, 4000, 12000), drop('Dragon Dart', 'arrow-cluster', 14, 20, 60)],
          unique: { chance: 3.0, items: [['Supreme Longbow', 'high-shot'], ['Wyvern Visage', 'wyvern'], ['Tyrant Crown', 'crown']] },
        },
      ],
    },
    {
      id: 'wilderness', type: 'area', name: 'Wilderness', icon: 'spectre', accent: '#8a7ae6',
      blurb: 'High risk, high reward',
      monsters: [
        {
          name: 'Crazy Archaeologist', icon: 'scroll-unfurled', cb: 204, hp: 225, att: 160, def: 240, maxHit: 26,
          style: 'Magic', weakness: 'Ranged', kc: 12,
          drops: [drop('Coins', 'cash', 90, 2000, 8000), drop('Ancient Page', 'scroll-unfurled', 30, 1, 1), drop('Rune Sword', 'broadsword', 8, 1, 1)],
          unique: { chance: 2.5, items: [['Fedora', 'helmet'], ['Odium Ward', 'shield'], ['Malediction Ward', 'shield']] },
        },
        {
          name: 'Spectral Wraith', icon: 'raven', cb: 260, hp: 240, att: 200, def: 180, maxHit: 30,
          style: 'Magic', weakness: 'Magic', kc: 5,
          drops: [drop('Ectoplasm', 'powder', 100, 1, 1), drop('Coins', 'cash', 88, 3000, 9000), drop('Blood Rune', 'rune-stone', 20, 30, 120)],
          unique: { chance: 2.0, items: [['Wraith Sigil', 'spectre'], ['Voidwoven Cape', 'cape']] },
        },
      ],
    },
    {
      id: 'dragons', type: 'area', name: "Dragon's Lair", icon: 'dragon-head', accent: '#46a7c4',
      blurb: 'Where the great wyrms sleep',
      monsters: [
        {
          name: 'Frost Wyvern', icon: 'wyvern', cb: 210, hp: 200, att: 140, def: 190, maxHit: 28,
          style: 'Ranged', weakness: 'Melee', kc: 44,
          drops: [drop('Wyvern Bones', 'dinosaur-bones', 100, 1, 1), drop('Coins', 'cash', 82, 2000, 7000), drop('Frozen Shard', 'frozen-orb', 18, 1, 3)],
          unique: { chance: 2.0, items: [['Wyvern Visage', 'wyvern'], ['Heart of Winter', 'frozen-orb']] },
        },
        {
          name: 'Elder Dragon', icon: 'dragon-head', cb: 415, hp: 330, att: 240, def: 260, maxHit: 50,
          style: 'Magic', weakness: 'Ranged', kc: 17,
          drops: [drop('Dragon Bones', 'dinosaur-bones', 100, 1, 1), drop('Dragonhide', 'leather-armor', 100, 1, 1), drop('Coins', 'cash', 80, 5000, 15000)],
          unique: { chance: 3.5, items: [['Draconic Visage', 'dragon-head'], ['Dragonfire Shield', 'dragon-shield'], ['Aegis of Flame', 'dragon-shield']] },
        },
      ],
    },
    {
      id: 'venomcoil', type: 'area', name: 'Venomcoil Matriarch', icon: 'wyvern', accent: '#3fb56b',
      blurb: 'The serpent queen of the marsh',
      boss: true,
      monsters: [
        {
          name: 'Venomcoil Matriarch', icon: 'wyvern', cb: 725, hp: 500, att: 1, def: 300, maxHit: 44,
          style: 'Ranged', weakness: 'Magic', kc: 4,
          drops: [drop('Snake Hide', 'leather-armor', 100, 1, 2), drop('Coins', 'cash', 78, 10000, 30000), drop('Venom Sac', 'potion-ball', 24, 1, 4)],
          unique: { chance: 5.0, items: [["Matriarch's Fang", 'dripping-sword'], ['Coil of Venom', 'wyvern'], ['Serpentine Helm', 'horned-helm'], ['Toxic Blowpipe', 'high-shot']] },
        },
      ],
    },
    {
      id: 'emberpits', type: 'area', name: 'Ember Pits', icon: 'flame', accent: '#ef6b3a',
      blurb: 'Demons of the molten deep',
      monsters: [
        {
          name: 'Lava Imp', icon: 'fire-bowl', cb: 96, hp: 90, att: 70, def: 60, maxHit: 14,
          style: 'Magic', weakness: 'Ranged', kc: 220,
          drops: [drop('Infernal Ashes', 'powder', 100, 1, 1), drop('Coins', 'cash', 86, 400, 1800), drop('Fire Rune', 'rune-stone', 30, 20, 80)],
          unique: null,
        },
        {
          name: 'Ember Colossus', icon: 'minotaur', cb: 388, hp: 360, att: 250, def: 230, maxHit: 42,
          style: 'Melee', weakness: 'Magic', kc: 9,
          drops: [drop('Big Bones', 'dinosaur-bones', 100, 1, 1), drop('Coins', 'cash', 80, 4000, 13000), drop('Soul Rune', 'rune-stone', 20, 30, 100)],
          unique: { chance: 3.0, items: [['Infernal Brazier', 'fire-bowl'], ['Colossus Grasp', 'monster-grasp'], ['Cape of Flame', 'cape']] },
        },
      ],
    },
    // ── RAIDS ──
    {
      id: 'xyren', type: 'raid', name: 'Vaults of Xyren', icon: 'temple-gate', accent: '#9b6cff',
      blurb: 'A three-chamber descent into the buried treasury',
      raid: {
        scale: '1–5 players', cb: 'Recommended CB 600+', kc: 28,
        bestTime: '14:32', avgTime: '21:08',
        require: ['Combat 600+', '10+ Sharks or better', 'Anti-venom'],
        rooms: [
          { name: 'The Antechamber', icon: 'dungeon-gate', boss: 'Vault Sentry', hp: 320, style: 'Melee', cleared: true },
          { name: 'Hall of Echoes', icon: 'ancient-columns', boss: 'Twin Shades', hp: 440, style: 'Magic', cleared: true },
          { name: 'Throne of Xyren', icon: 'stone-tower', boss: 'Xyren, the Hoarder', hp: 900, style: 'Ranged', cleared: false },
        ],
        drops: [
          drop('Death Rune', 'rune-stone', 40, 100, 250),
          drop('Blood Rune', 'rune-stone', 35, 100, 200),
          drop('Soul Rune', 'rune-stone', 30, 50, 150),
          drop('Snapdrake Herb', 'cut-palm', 25, 10, 30),
          drop('Dragon Bones', 'dinosaur-bones', 22, 5, 15),
        ],
        unique: {
          chance: 10.0,
          items: [
            ['Warped Buckler', 'shield'], ['Dragon Slayer Crossbow', 'crossbow'], ["Durn's Bulwark", 'shield'],
            ['Kodai Hat', 'helmet'], ['Kodai Robe Top', 'leather-armor'], ['Kodai Robe Bottom', 'leather-armor'],
            ['Dragon Claws', 'monster-grasp'], ['Ancient Maul', 'spiked-mace'], ['Zaryth Vambraces', 'gauntlet'],
            ['Ancestral Wand', 'fairy-wand'], ['Twisted Longbow', 'high-shot'],
          ],
        },
      },
    },
    {
      id: 'amascut', type: 'raid', name: 'Sepulchre of Aether', icon: 'ancient-columns', accent: '#e0b765',
      blurb: 'Four invocations guard the godkings tomb',
      raid: {
        scale: '1–8 players', cb: 'Recommended CB 700+', kc: 6,
        bestTime: '23:47', avgTime: '31:20',
        require: ['Combat 700+', 'Saradomin Brews', 'Magic 90+'],
        rooms: [
          { name: 'Path of Scarabs', icon: 'scorpion', boss: 'Scarab Swarmlord', hp: 500, style: 'Melee', cleared: true },
          { name: 'Path of Crondis', icon: 'wyvern', boss: 'Crocodile Warden', hp: 620, style: 'Ranged', cleared: false },
          { name: 'Path of Het', icon: 'glowing-artifact', boss: 'Mirror of Het', hp: 700, style: 'Magic', cleared: false },
          { name: 'The Wardens', icon: 'ancient-columns', boss: 'Twin Wardens', hp: 1200, style: 'Magic', cleared: false },
        ],
        drops: [
          drop('Blood Rune', 'rune-stone', 38, 150, 300),
          drop('Coins', 'cash', 90, 20000, 60000),
          drop('Sapphire', 'emerald', 24, 2, 8),
          drop('Snapdrake Herb', 'cut-palm', 20, 10, 30),
        ],
        unique: {
          chance: 8.0,
          items: [
            ["Tumeken's Shadow", 'fairy-wand'], ["Elidinis' Ward", 'shield'], ['Masori Mask', 'helmet'],
            ['Masori Body', 'leather-armor'], ['Masori Chaps', 'leather-armor'], ['Lightbearer Ring', 'ring'],
            ['Osmumten Fang', 'dripping-sword'],
          ],
        },
      },
    },
  ];

  // ── Inventory: weapons (single-equip) + armour (multi-equip) for in-combat quick actions ──
  const WEAPONS = [
    { name: 'Abyssal Whip',    icon: 'dripping-sword',   style: 'Melee',  tier: 82, own: 1 },
    { name: 'Dragon Scimitar', icon: 'broadsword',       style: 'Melee',  tier: 60, own: 1 },
    { name: 'Saradomin Sword', icon: 'two-handed-sword', style: 'Melee',  tier: 75, own: 1 },
    { name: 'Magic Shortbow',  icon: 'high-shot',        style: 'Ranged', tier: 50, own: 1 },
    { name: 'Trident of Seas', icon: 'fairy-wand',       style: 'Magic',  tier: 75, own: 1 },
    { name: 'Granite Maul',    icon: 'spiked-mace',      style: 'Melee',  tier: 50, own: 1 },
  ];
  const ARMOUR = [
    { name: 'Neitiznot Helm',  icon: 'helmet',        slot: 'Head',   def: 31, own: 1 },
    { name: 'Fighter Torso',   icon: 'leather-armor', slot: 'Body',   def: 42, own: 1 },
    { name: 'Dragon Defender', icon: 'shield',        slot: 'Shield', def: 25, own: 1 },
    { name: 'Barrows Gloves',  icon: 'gauntlet',      slot: 'Hands',  def: 12, own: 1 },
    { name: 'Fire Cape',       icon: 'cape',          slot: 'Cape',   def: 11, own: 1 },
    { name: 'Berserker Ring',  icon: 'ring',          slot: 'Ring',   def: 4,  own: 1 },
  ];

  // ── Player snapshot (matches the reference screenshots) ──
  const PLAYER = {
    name: 'Immortal', maxHp: 92, hp: 92, gems: 144,
    levels: { attack: 80, strength: 95, defence: 42, hitpoints: 92, ranged: 95, magic: 40, prayer: 99 },
    prayerPoints: 99, maxPrayer: 99,
  };

  // Total monsters across combat areas (for header stat)
  const monsterCount = AREAS.filter(a => a.type === 'area').reduce((s, a) => s + a.monsters.length, 0);
  const raidCount = AREAS.filter(a => a.type === 'raid').length;

  window.CBT = {
    AREAS, STYLES, STYLE_META, FOOD, POTIONS, PRAYERS, WEAPONS, ARMOUR, PLAYER,
    monsterCount, raidCount,
  };
})();
