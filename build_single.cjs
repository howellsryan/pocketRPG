#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('esbuild');

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
  'utils/itemIcons.js',
  'utils/skillArt.js',
  'utils/combatArt.js',
  'utils/prayerIcons.js',
  'utils/bonusLabels.js',
  'utils/oneLifeDeath.js',
  'utils/rewardReveal.js',
  'hooks/useActionTick.js',
  'hooks/useIsDesktop.js',
  'hooks/useEscapeKey.js',
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
  'engine/slayerMasters.js',
  'engine/slayerUnlocks.js',
  'engine/slayerCombatBonuses.js',
  'engine/itemSources.js',
  'engine/combatSetBonuses.js',
  'engine/itemMigrations.js',
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
  'engine/collectionLog.js',
  'engine/leaderboardFilters.js',
  'engine/activityRegistry.js',
  'engine/activityRunner.js',
  'engine/skipPreflight.js',
  'db/database.js',
  'db/stores.js',
  'db/saveload.js',
  'cloud/apiBase.js',
  'cloud/api.js',
  'cloud/idleState.js',
  'cloud/activityProgress.js',
  'cloud/criticalSavePolicy.js',
  'cloud/sync.js',
  'cloud/pvp.js',
  'cloud/collectionLog.js',
  'cloud/killCounts.js',
  'state/gameState.js',
  'state/pvpState.js',
  'components/Modal.js',
  'components/HPBar.js',
  'components/ProgressBar.js',
  'components/SkillBadge.js',
  'components/GameIcon.js',
  'components/SkillEmblem.js',
  'components/SkillIcon.js',
  'components/ItemSlot.js',
  'components/Toast.js',
  'components/ActivityIndicator.js',
  'components/XpDropOverlay.js',
  'components/RewardRevealOverlay.js',
  'components/Header.js',
  'components/navTabs.js',
  'components/BurgerMenu.js',
  'components/SideNav.js',
  'components/Card.js',
  'components/Panel.js',
  'components/Button.js',
  'components/SectionHeader.js',
  'components/BonusDisplay.js',
  'components/ItemDetailPanel.js',
  'components/TwoPaneLayout.js',
  'components/SharedItemModal.js',
  'components/TradingPostSellForm.js',
  'components/QuestXpChoiceModal.js',
  'components/BuyCreditsModal.js',
  'components/IdleCombatSetupModal.js',
  'components/EquipmentPaperdoll.js',
  'components/CollectionLogPanel.js',
  'components/FilterToggleBar.js',
  'screens/HomeScreen.js',
  'screens/StatsScreen.js',
  'screens/InventoryScreen.js',
  'screens/BankScreen.js',
  'screens/PvpLobbyModal.js',
  'screens/PvpCombatScreen.js',
  'screens/CombatMobileSelect.js',
  'screens/CombatMobileSheets.js',
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
  'screens/TradingPostScreen.js',
  'screens/EquipmentScreen.js',
  'screens/QuestsScreen.js',
  'screens/CluesScreen.js',
  'screens/MinigamesScreen.js',
  'screens/CollectionLogScreen.js',
  'screens/LeaderboardScreen.js',
  'screens/HelpScreen.js',
  'screens/DesktopLandingScreen.js',
  'screens/LandingScreen.js',
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
const gameIconsJSON = readSrc('data/gameIcons.json');
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
const collectionLogJSON = readSrc('data/collectionLog.json');

// Landing screen images. Served as external files from /public/landing/ (the
// Cloudflare Pages output dir is the repo root) and referenced by URL rather
// than base64-inlined — this keeps them out of the render-blocking HTML and
// lets them load lazily/in parallel. Keys must match the `landingImages` map
// in src/screens/landingImages.js, whose import is stripped from this bundle
// in favour of the global injected below.
const landingDir = path.join(__dirname, 'public', 'landing');
const landingImagesObj = {};
for (const file of fs.readdirSync(landingDir)) {
  if (!file.endsWith('.webp')) continue;
  const key = file.replace(/\.webp$/, '');
  landingImagesObj[key] = `/public/landing/${file}`;
}
const landingImagesJSON = JSON.stringify(landingImagesObj);

// Optional Home Screen hero logo, served externally from /public. Falls back
// to null — and the crossed-swords crest — when the file is absent.
const logoPath = path.join(__dirname, 'public', 'pocketrpg-logo.png');
const homeLogoJSON = fs.existsSync(logoPath)
  ? JSON.stringify('/public/pocketrpg-logo.png')
  : 'null';

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

// ── Compile Tailwind CSS ──
fs.mkdirSync(path.join(__dirname, '.tmp'), { recursive: true });
const twBin = path.join(__dirname, 'node_modules', '.bin', 'tailwindcss');
const twResult = spawnSync(twBin, [
  '-i', path.join(__dirname, 'src', 'index.css'),
  '-o', path.join(__dirname, '.tmp', 'app.css'),
  '--minify',
], { stdio: 'inherit', cwd: __dirname });
if (twResult.status !== 0) {
  console.error('Tailwind CLI failed. Ensure @tailwindcss/cli is installed.');
  process.exit(1);
}
const compiledTailwindCSS = fs.readFileSync(path.join(__dirname, '.tmp', 'app.css'), 'utf-8');

// ── External @font-face blocks from @fontsource (latin subset, no CDN) ──
// Copy the woff2 files to public/fonts/ (served at /public/fonts/) and
// reference them by URL instead of base64. This keeps the render-blocking
// <style> tiny and lets fonts load in parallel (font-display:swap). The
// copied files are a build artifact (gitignored); the deploy's rebuild
// regenerates them, mirroring how index.html itself is produced.
const FONT_FACES = [
  { pkg: '@fontsource/cinzel',         family: 'Cinzel',         weights: [400, 700, 900] },
  { pkg: '@fontsource/nunito',          family: 'Nunito',         weights: [400, 600, 700] },
  { pkg: '@fontsource/jetbrains-mono', family: 'JetBrains Mono', weights: [400, 700]      },
];
const fontsOutDir = path.join(__dirname, 'public', 'fonts');
fs.mkdirSync(fontsOutDir, { recursive: true });
let fontFaceCSS = '';
for (const { pkg, family, weights } of FONT_FACES) {
  const fontName = pkg.split('/')[1];
  for (const weight of weights) {
    const fname = `${fontName}-latin-${weight}-normal.woff2`;
    const fpath = path.join(__dirname, 'node_modules', pkg, 'files', fname);
    if (!fs.existsSync(fpath)) {
      console.error(`Missing font: ${fpath}`);
      process.exit(1);
    }
    fs.copyFileSync(fpath, path.join(fontsOutDir, fname));
    fontFaceCSS +=
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
      `font-display:swap;src:url('/public/fonts/${fname}') format('woff2')}\n`;
  }
}

// ── Bundle preact + idb via esbuild (eliminates esm.sh network dependency chain) ──
const vendorBuildResult = esbuild.buildSync({
  stdin: {
    contents: [
      `export{h,render,Fragment,createContext,Component}from'preact';`,
      `export{createPortal}from'preact/compat';`,
      `export{useState,useEffect,useRef,useMemo,useCallback,useContext}from'preact/hooks';`,
      `export{openDB}from'idb';`,
    ].join('\n'),
    resolveDir: __dirname,
    loader: 'js',
  },
  bundle: true,
  // IIFE (not ESM): minify renames internal bindings, and an inline module's
  // `export { x as h }` would NOT expose `h` as a usable binding to the
  // concatenated app code. IIFE + globalName assigns the exports object to
  // `__vendor`, which we then destructure into real top-level const bindings.
  format: 'iife',
  globalName: '__vendor',
  minify: true,
  platform: 'browser',
  target: 'es2020',
  write: false,
});
if (vendorBuildResult.errors.length > 0) {
  console.error('esbuild vendor bundle failed:', vendorBuildResult.errors);
  process.exit(1);
}
const vendorBundle = vendorBuildResult.outputFiles[0].text;
const vendorDestructure =
  'const { h, render, Fragment, createContext, Component, createPortal, ' +
  'useState, useEffect, useRef, useMemo, useCallback, useContext, openDB } = __vendor;';

// CSS
const customCSS = readSrc('index.css').replace('@import "tailwindcss";', '').trim();
const css = fontFaceCSS + compiledTailwindCSS + '\n' + customCSS;

// ── Assemble the inline module script, then minify it as one unit ──
// The app modules are concatenated raw (transpiled TS) and are the dominant
// payload. esbuild minifies the whole script (vendor + data + app) — safe
// because everything shares one top-level scope and there are no dynamic
// identifier lookups (window[…], eval, Function, .name dispatch).
const moduleScript = `${vendorBundle}
${vendorDestructure}

const gameIconsData = ${gameIconsJSON};
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
const collectionLogData = ${collectionLogJSON};
const landingImages = ${landingImagesJSON};
const homeLogo = ${homeLogoJSON};

${allJS}

render(h(App, null), document.getElementById('app') || document.querySelector('main'));
document.getElementById('app-splash')?.remove();`;

const minified = esbuild.transformSync(moduleScript, {
  minify: true,
  target: 'es2020',
  legalComments: 'none',
});
const inlineScript = minified.code.trim();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>PocketRPG</title>
<meta name="description" content="PocketRPG — a tick-based idle fantasy RPG. Train 24 skills, fight bosses, and complete quests — progress continues whether the app is open or not.">
<!-- LCP image: the hero screenshot is rendered by JS, so preload it here to
     make the request discoverable from the initial document and fetch it at
     high priority. Same asset is the hero on both mobile and desktop layouts.
     Fonts are intentionally NOT preloaded — they use font-display:swap, so
     they paint in fallback immediately and must not compete with the LCP. -->
<link rel="preload" href="/public/landing/ss-stats.webp" as="image" type="image/webp" fetchpriority="high">
<style>
${css}
</style>
</head>
<body>
<div id="app-splash"><div class="app-splash__brand">PocketRPG</div><div class="app-splash__sub">Loading your adventure…</div></div>
<main id="app"></main>
<script type="module">
${inlineScript}
<\/script>
</body>
</html>`;

// Always write to project root (the served/committed artifact)
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('✅ Built index.html (' + (html.length / 1024).toFixed(1) + ' KB)');

