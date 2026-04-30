export const makeItem = (overrides = {}) => ({ id: 'coins', name: 'Coins', stackable: true, ...overrides })
export const makeMonster = (overrides = {}) => ({ id: 'goblin', name: 'Goblin', combatLevel: 2, hitpoints: 5, attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1, drops: [], ...overrides })
export const makeInventory = (slots = []) => slots.map((slot, i) => ({ slot: i, ...slot }))
