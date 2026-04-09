#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist_tmp');
const SRC = path.join(__dirname, 'src');

function readDist(rel) { return fs.readFileSync(path.join(DIST, rel), 'utf-8'); }
function readSrc(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf-8'); }

// Source file order (from dist_tmp, already transpiled)
const sourceFiles = [
  'utils/constants.js',
  'utils/helpers.js',
  'engine/experience.js',
  'engine/formulas.js',
  'engine/equipment.js',
  'engine/inventory.js',
  'engine/agility.js',
  'engine/combat.js',
  'engine/skilling.js',
  'engine/idleEngine.js',
  'engine/tick.js',
  'db/database.js',
  'db/stores.js',
  'db/saveload.js',
  'state/gameState.js',
  'components/Modal.js',
  'components/HPBar.js',
  'components/ProgressBar.js',
  'components/SkillBadge.js',
  'components/ItemSlot.js',
  'components/Toast.js',
  'components/Header.js',
  'components/BottomNav.js',
  'screens/HomeScreen.js',
  'screens/StatsScreen.js',
  'screens/InventoryScreen.js',
  'screens/BankScreen.js',
  'screens/CombatScreen.js',
  'screens/AgilityScreen.js',
  'screens/SkillingScreen.js',
  'screens/SlayerScreen.js',
  'screens/GatherScreen.js',
  'screens/GeneralStoreScreen.js',
  'screens/EquipmentScreen.js',
  'App.js',
];

function processFile(relPath) {
  let code = readDist(relPath);
  
  // Strip all import lines
  code = code.replace(/^import\s+.*$/gm, '');
  
  // Strip export default
  code = code.replace(/^export default\s+/gm, '');
  
  // Strip export { ... } lines
  code = code.replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  
  // Strip 'export ' prefix from declarations
  code = code.replace(/^export\s+(function|const|let|async|class)\s/gm, '$1 ');
  
  // Fix dynamic imports — replace with direct global calls
  code = code.replace(/const\s*\{\s*getDB:\s*getNewDB\s*\}\s*=\s*await\s+import\([^)]+\);/g, '// dynamic import removed — getDB is global');
  code = code.replace(/getNewDB\(\)/g, 'getDB()');
  
  return `// ── ${relPath} ──\n${code}\n`;
}

// Read JSON data
const itemsJSON = readSrc('data/items.json');
const monstersJSON = readSrc('data/monsters.json');
const skillsJSON = readSrc('data/skills.json');
const spellsJSON = readSrc('data/spells.json');
const prayersJSON = readSrc('data/prayers.json');

// Concatenate all JS
let allJS = '';
for (const f of sourceFiles) {
  try {
    allJS += processFile(f);
  } catch(e) {
    console.error(`Error: ${f}: ${e.message}`);
    process.exit(1);
  }
}

// CSS
const css = readSrc('index.css').replace('@import "tailwindcss";', '').trim();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>PocketRPG</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Nunito:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
import { h, render, Fragment, createContext } from 'https://esm.sh/preact@10.25.4';
import { useState, useEffect, useRef, useCallback, useContext } from 'https://esm.sh/preact@10.25.4/hooks';
import { openDB } from 'https://esm.sh/idb@8.0.2';

// ── Inline JSON Data ──
const itemsData = ${itemsJSON};
const monstersData = ${monstersJSON};
const skillsData = ${skillsJSON};
const spellsData = ${spellsJSON};
const prayersData = ${prayersJSON};

${allJS}

// ── Bootstrap ──
render(h(App, null), document.getElementById('app'));
<\/script>
</body>
</html>`;

// Always write to project root (the served/committed artifact)
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('✅ Built index.html (' + (html.length / 1024).toFixed(1) + ' KB)');

// Also write to /mnt/user-data/outputs/ if it exists (legacy path)
const outDir = '/mnt/user-data/outputs';
if (fs.existsSync(outDir)) {
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}
