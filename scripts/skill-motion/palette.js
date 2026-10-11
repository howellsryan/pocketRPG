// The authored material palette reads the game's fixed CSS tokens.
const skillPaletteSource = await (await fetch(new URL('../../src/index.css', import.meta.url))).text()
export const palette = Object.fromEntries([...skillPaletteSource.matchAll(/(--[a-zA-Z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m=>[m[1],m[2]]))
