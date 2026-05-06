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
  'utils/formatters.js',
  'utils/itemValue.js',
  'utils/idleElapsed.js',
  'hooks/useActionTick.js',
  'hooks/useIsDesktop.js',
  'engine/experience.js',
  'engine/formulas.js',
  'engine/equipment.js',
  'engine/inventory.js',
  'engine/storeRules.js',
  'engine/agility.js',
  'engine/thieving.js',
  'engine/hunter.js',
  'engine/runes.js',
  'engine/slayerRewards.js',
  'engine/slayerTasks.js',
  'engine/slayerUnlocks.js',
  'engine/slayerCombatBonuses.js',
  'engine/itemSources.js',
  'engine/combat.js',
  'engine/combatant.js',
  'engine/combatPrimitives.js',
  'engine/pvpPotions.js',
  'engine/pvpCombatModifiers.js',
  'engine/pvpRisk.js',
  'engine/pvpState.js',
  'engine/pvpFood.js',
  'engine/pvpSpecialAttacks.js',
  'engine/pvpEndSummary.js',
  'engine/pvpEngine.js',
  'engine/lootTransfer.js',
  'engine/skilling.js',
  'engine/dungeoneeringTokens.js',
  'engine/idleSupplies.js',
  'engine/idleEngine.js',
  'engine/tick.js',
  'engine/farming.js',
  'engine/quests.js',
  'engine/questIdleCascade.js',
  'engine/clueScrolls.js',
  'engine/skipPreflight.js',
  'db/database.js',
  'db/stores.js',
  'db/saveload.js',
  'cloud/api.js',
  'cloud/idleState.js',
  'cloud/criticalSavePolicy.js',
  'cloud/sync.js',
  'cloud/pvp.js',
  'state/gameState.js',
  'state/pvpState.js',
  'components/Modal.js',
  'components/HPBar.js',
  'components/ProgressBar.js',
  'components/SkillBadge.js',
  'components/ItemSlot.js',
  'components/Toast.js',
  'components/Header.js',
  'components/navTabs.js',
  'components/BottomNav.js',
  'components/SideNav.js',
  'components/Card.js',
  'components/Panel.js',
  'components/Button.js',
  'components/SectionHeader.js',
  'components/BonusDisplay.js',
  'components/ItemDetailPanel.js',
  'components/TwoPaneLayout.js',
  'components/SharedItemModal.js',
  'components/QuestXpChoiceModal.js',
  'components/BuyCreditsModal.js',
  'components/IdleCombatSetupModal.js',
  'screens/HomeScreen.js',
  'screens/StatsScreen.js',
  'screens/InventoryScreen.js',
  'screens/BankScreen.js',
  'screens/PvpLobbyModal.js',
  'screens/PvpCombatScreen.js',
  'screens/CombatScreen.js',
  'screens/AgilityScreen.js',
  'screens/FarmingScreen.js',
  'screens/FarmLocationPicker.js',
  'screens/FarmPatchView.js',
  'screens/ThievingScreen.js',
  'screens/HunterScreen.js',
  'screens/SkillingScreen.js',
  'screens/ConstructionScreen.js',
  'screens/SlayerScreen.js',
  'screens/GatherScreen.js',
  'screens/GeneralStoreScreen.js',
  'screens/EquipmentScreen.js',
  'screens/QuestsScreen.js',
  'screens/LeaderboardScreen.js',
  'screens/AuthScreen.js',
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
const raidsJSON = readSrc('data/raids.json');
const farmingJSON = readSrc('data/farming.json');
const questsJSON = readSrc('data/quests.json');
const minigamesJSON = readSrc('data/minigames.json');
const cluesJSON = readSrc('data/clues.json');

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
import { h, render, Fragment, createContext, Component } from 'https://esm.sh/preact@10.25.4';
import { createPortal } from 'https://esm.sh/preact@10.25.4/compat';
import { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'https://esm.sh/preact@10.25.4/hooks';
import { openDB } from 'https://esm.sh/idb@8.0.2';

// ── Inline JSON Data ──
const itemsData = ${itemsJSON};
const monstersData = ${monstersJSON};
const skillsData = ${skillsJSON};
const spellsData = ${spellsJSON};
const prayersData = ${prayersJSON};
const raidsData = ${raidsJSON};
const farmingData = ${farmingJSON};
const questsData = ${questsJSON};
const minigamesData = ${minigamesJSON};
const cluesData = ${cluesJSON};

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
