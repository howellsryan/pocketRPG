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
  'utils/theme.js',
  'utils/constants.js',
  'utils/combatWindup.js',
  // Ahead of helpers.js, which calls into it (openWorld) — dependency-free by
  // design so it can sit this early.
  'cloud/worldHandoff.js',
  'utils/helpers.js',
  'utils/complexityColors.js',
  'utils/completion.js',
  'utils/formatters.js',
  'utils/itemValue.js',
  'utils/hitSplats.js',
  'utils/actionSprites.js',
  'utils/weaponShapes.js',
  'utils/monsterShapes.js',
  'utils/monsterFigures.js',
  'utils/inkwright.js',
  'utils/xpDrops.js',
  'utils/lootModal.js',
  'utils/coopChat.js',
  'utils/coopPolling.js',
  'utils/killCountMerge.js',
  'utils/toastTypes.js',
  'utils/idleElapsed.js',
  'utils/itemIcons.js',
  'utils/iconTints.js',
  'utils/itemIconResolve.js', // shared with the open world client — see its header
  'utils/skillArt.js',
  'utils/monsterIcons.js',
  'utils/combatArt.js',
  'utils/combatOrder.js',
  'utils/prayerIcons.js',
  'utils/bonusLabels.js',
  'utils/armoury.js',
  'utils/oneLifeDeath.js',
  'utils/rewardReveal.js',
  'utils/three3d.js',     // core: lazy three.js loader (landing hero only)
  'hooks/useActionTick.js',
  'hooks/useIsDesktop.js',
  'hooks/useEscapeKey.js',
  'hooks/useActionSwings.js',
  'hooks/usePanZoomStage.js',
  'hooks/useTravelStatus.js',
  'engine/experience.js',
  'engine/combatLevel.js',
  'engine/world.js',
  'engine/travel.js',
  'engine/journeys.js',
  'engine/seedDrops.js',
  'engine/formulas.js',
  'engine/equipment.js',
  'engine/equipmentPresets.js',
  'engine/inventory.js',
  'engine/summoning.js',
  'engine/createDefaultSave.js',
  'engine/storeRules.js',
  'engine/agility.js',
  'engine/thieving.js',
  'engine/hunter.js',
  'engine/runes.js',
  'engine/teleports.js',
  'engine/slayerRewards.js',
  'engine/slayerTasks.js',
  'engine/slayerMasters.js',
  'engine/slayerTaskBlocks.js',
  'engine/slayerKillCredit.js',
  'engine/slayerUnlocks.js',
  'engine/specialAttackEnergy.js',
  'engine/specialRegen.js',
  'engine/pvpBotRewards.js',
  'engine/slayerCombatBonuses.js',
  'engine/prayerCombatBonuses.js',
  'engine/itemSources.js',
  'engine/combatSetBonuses.js',
  'engine/itemMigrations.js',
  'engine/bankCharges.js',
  'engine/bankMutations.js',
  'engine/chargeRecipes.js',
  'engine/lossLedger.js',
  'engine/killCredit.js',
  'engine/killCountReports.js',
  'engine/killTally.js',
  'engine/holdingsReconcile.js',
  'engine/prayerDrain.js',
  'engine/monsterDamageRules.js',
  'engine/damageReduction.js',
  'engine/bossForms.js',
  'engine/bossAdds.js',
  'engine/monsterClips.js',
  'engine/monsterMaxHit.js',
  'engine/hardMode.js',
  'engine/grimReaper.js',
  'engine/grindman.js',
  'engine/notedDrops.js',
  'engine/dropRateDisplay.js',
  'engine/xpBank.js',
  'engine/roomWideAttacks.js',
  'engine/consumables.js',
  'engine/combat.js',
  'engine/combatRequirements.js',
  'engine/dpsCalculator.js',
  'engine/gearOptimizer.js',
  'engine/combatant.js',
  'engine/combatPrimitives.js',
  'engine/pvpCombatModifiers.js',
  'engine/pvpSpecialAttacks.js',
  'engine/pvpEngine.js',
  'engine/coopRaidEngine.js',
  'engine/coopBossEngine.js',
  'engine/coopSocketProtocol.js',
  'engine/playerChat.js',
  'engine/worldLairs.js',
  'engine/lootTransfer.js',
  'engine/skilling.js',
  'engine/skillingPerks.js',
  'engine/dungeoneeringTokens.js',
  'engine/idleSupplies.js',
  'engine/gatherTasks.js',
  'engine/kingdomResources.js',
  'engine/kingdomEngine.js',
  'engine/construction.js',
  'engine/minigameGates.js',
  'engine/worldContent.js',
  'engine/placeMaps.js',
  'engine/idleEngine.js',
  'engine/idleSlayerLoop.js',
  'engine/applyTaskResult.js',
  'engine/tick.js',
  'engine/farming.js',
  'engine/questGates.js',
  'engine/quests.js',
  'engine/questIdleCascade.js',
  'engine/clueScrolls.js',
  'engine/dailyTasks.js',
  'engine/collectionLog.js',
  'engine/leaderboardFilters.js',
  'engine/activityRegistry.js',
  'engine/backgroundCombat.js',
  'engine/activitySession.js',
  'engine/activityRunner.js',
  'engine/skipPreflight.js',
  'engine/autoStartTask.js',
  'db/dirtyFlags.js',
  'db/database.js',
  'db/stores.js',
  'db/saveload.js',
  'cloud/apiBase.js',
  'cloud/api.js',
  'cloud/idleState.js',
  'cloud/activityProgress.js',
  'cloud/criticalSavePolicy.js',
  'cloud/saveErrors.js',
  'cloud/sync.js',
  'cloud/saveDurability.js',
  'cloud/coop.js',
  'cloud/coopFeed.js',
  'cloud/collectionLog.js',
  'cloud/killCounts.js',
  'cloud/hardMode.js',
  'cloud/slayerTaskBlocks.js',
  // Boot-path only (runs before the cloud phase goes ready), so core — never
  // the game chunk.
  'cloud/bootstrap.js',
  'state/gameState.js',
  'components/Modal.js',
  'components/BackLink.js', // -> game chunk (only chunk screens use it)
  'components/PlaceArt.js', // -> game chunk (map art; only WorldMapScreen renders it)
  'components/TeleportRuneCost.js', // -> game chunk (world map teleport buttons)
  'components/ActivityPickerModal.js', // -> game chunk (world map / place map only)
  'components/ActivityIcon.js', // -> game chunk (world map / place map only)
  'components/PlaceMapView.js', // -> game chunk (world map / place map only)
  'components/SlayerMasterModal.js', // -> game chunk (world map / place map only)
  'components/TravelStatusContent.js',
  'components/TravelPrompt.js',
  'components/TravelStatusModal.js',
  'components/InventoryFullPrompt.js',
  'components/HPBar.js',
  'components/HitSplat.js',
  'components/InkwrightFigure.js',
  'components/MonsterFigure.js',
  'components/InkwrightStage.js',
  'components/InkwrightCombatStage.js',
  'components/ActivePotionBadges.js',
  'components/LootResultModal.js',
  'components/ProgressBar.js',
  'components/SkillBadge.js',
  'components/GameIcon.js',
  'components/CollapseChevron.js',
  'components/CombatQuickActions.js',
  'components/CombatHud.js',
  'components/OneLifeIcon.js',
  'components/HardMode.js',
  'components/CoopSessionBrowser.js',
  'components/CoopRaidPartyList.js',
  'components/CoopRaidLobby.js',
  'components/CoopLootShare.js',
  'components/CoopChatPanel.js',
  'components/QuickPrayerConfigModal.js',
  'components/SpellSelectGrid.js',
  'components/SkillEmblem.js',
  'components/SkillIcon.js',
  'components/ItemSlot.js',
  'components/InventoryGrid.js',
  'components/Toast.js',
  'components/XpDropOverlay.js',
  'components/RewardRevealOverlay.js',
  'components/LevelUpOverlay.js',
  'components/ChatWidget.js',
  'components/ActivityIndicator.js',
  'components/Header.js',
  'components/GameFrameBar.js',
  'components/navTabs.js',
  'components/SideNav.js',
  'components/Card.js',
  'components/Panel.js',
  'components/Button.js',
  'components/IronFrame.js',
  'components/WaxSeal.js',
  'components/WeaponChargePanel.js',
  'components/SectionHeader.js',
  'components/BonusDisplay.js',
  'components/ItemDetailPanel.js',
  'components/TwoPaneLayout.js',
  'components/SharedItemModal.js',
  'components/SellConfirmModal.js',
  'components/TradingPostSellForm.js',
  'components/QuestXpChoiceModal.js',
  'components/BuyCreditsModal.js',
  'components/DailyTasksModal.js',
  'components/DiscordButton.js',
  'components/IntroTourModal.js',
  'components/IdleCombatSetupModal.js',
  'components/EquipmentPaperdoll.js',
  'components/CollectionLogPanel.js',
  'components/GildedComplete.js',
  'components/FilterToggleBar.js',
  'components/Pagination.js',
  'components/SkillScreenHeader.js',
  'components/SkillInfoBanner.js',
  'components/SkillActionRow.js',
  'components/SkillActivePanel.js',
  'screens/HomeScreen.js',
  'screens/StatsScreen.js',
  'screens/InventoryScreen.js',
  'screens/BankScreen.js',
  'screens/WildernessEntryModal.js',
  'screens/CoopBossScreen.js',
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
  'screens/SummoningScreen.js',
  'screens/MagicScreen.js',
  'screens/WorldMapScreen.js',
  'screens/SlayerScreen.js',
  'screens/GatherScreen.js',
  'screens/TradingPostScreen.js',
  'screens/BankHubScreen.js',
  'screens/EquipmentScreen.js',
  'screens/ArmouryScreen.js',
  'screens/AdventuresScreen.js',
  'screens/KingdomScreen.js',
  'screens/QuestsScreen.js',
  'screens/CluesScreen.js',
  'screens/MinigamesScreen.js',
  'screens/CollectionLogScreen.js',
  'screens/LeaderboardScreen.js',
  'screens/HelpScreen.js',
  'screens/CharacterUnlockScreen.js',
  'screens/GrimReaperScreen.js',
  'screens/SlayerTaskBlockScreen.js',
  'screens/DemoLockedScreen.js',
  'screens/landingContent.js',
  'components/LandingHero3D.js',
  'screens/LandingScreen.js',
  'screens/AuthScreen.js',
  'screens/OAuthConsentScreen.js',
  'App.js',
];

// ── Code-split: lazily loaded in-game screens ────────────────────────────────
// These screen modules only render once the player is in the game
// (App.renderScreen, gated behind cloudPhase === 'ready'). They are the bulk of
// the "unused JavaScript" on the landing/login page, so they are emitted into a
// separate `game-<hash>.js` chunk that App.jsx fetches on demand via
// globalThis.__loadGameChunk. Everything else — vendor, data, engine, utils,
// components, state, db, App, and the landing/auth screens — stays in the inline
// core script.
//
// Both scripts are emitted as CLASSIC scripts (not type="module") so they share
// the global lexical environment: the game chunk can reference core's top-level
// bindings (h, render, itemsData, helpers, …) and App can reference the game
// screens — all by their source names. That cross-script name stability is why
// the bundles are minified with `minifyIdentifiers: false` below; only the
// self-contained vendor IIFE is fully minified. The landing/auth screens MUST
// stay in core (App's pre-game render path uses them), and nothing in core may
// reference a game screen at module-evaluation time (App only does so inside
// renderScreen, which runs after the chunk has loaded).
const GAME_CHUNK_FILES = new Set([
  'components/BackLink.js',
  'components/PlaceArt.js',
  'components/TeleportRuneCost.js',
  'components/ActivityPickerModal.js',
  'components/ActivityIcon.js',
  'components/PlaceMapView.js',
  'components/SlayerMasterModal.js',
  'utils/actionSprites.js', // -> game chunk (only the combat screens use it today; skilling screens are chunked too)
  'utils/weaponShapes.js', // -> game chunk, with the CombatTool that maps it (§12)
  'utils/monsterShapes.js', // -> game chunk, with the MonsterFigure that maps it (§12)
  'utils/monsterFigures.js', // -> game chunk, with the shapes it resolves against (§12)
  'utils/inkwright.js', // -> game chunk, with the actionSprites law it reads (§12)
  'components/InkwrightFigure.js',
  'components/MonsterFigure.js',
  'components/InkwrightStage.js',
  'components/InkwrightCombatStage.js',
  'hooks/useActionSwings.js', // -> game chunk, with the SWING_MAX_MS it reads (§12)
  'utils/combatArt.js', // -> game chunk (reads placeMapsData for monster locations; only combat/place-map screens use it)
  'utils/combatOrder.js', // -> game chunk (only the combat picker screens use it)
  'engine/dpsCalculator.js', // -> game chunk (server-side helper today; never referenced at boot)
  'engine/gearOptimizer.js',
  'screens/HomeScreen.js',
  'screens/StatsScreen.js',
  'screens/InventoryScreen.js',
  'screens/BankScreen.js',
  'screens/WildernessEntryModal.js',
  'screens/CoopBossScreen.js',
  'components/HardMode.js',
  'components/CoopSessionBrowser.js',
  'components/CoopRaidPartyList.js',
  'components/CoopRaidLobby.js',
  'components/CoopLootShare.js',
  'components/CoopChatPanel.js',
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
  'screens/SummoningScreen.js',
  'screens/MagicScreen.js',
  'screens/WorldMapScreen.js',
  'screens/SlayerScreen.js',
  'screens/GatherScreen.js',
  'screens/TradingPostScreen.js',
  'screens/BankHubScreen.js',
  'screens/EquipmentScreen.js',
  'screens/ArmouryScreen.js',
  'screens/AdventuresScreen.js',
  'screens/KingdomScreen.js',
  'screens/QuestsScreen.js',
  'screens/CluesScreen.js',
  'screens/MinigamesScreen.js',
  'screens/CollectionLogScreen.js',
  'screens/LeaderboardScreen.js',
  'screens/HelpScreen.js',
  'screens/CharacterUnlockScreen.js',
  'screens/GrimReaperScreen.js',
  'screens/SlayerTaskBlockScreen.js',
  'screens/DemoLockedScreen.js',
]);

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
const bespokeIconsJSON = readSrc('data/bespokeIcons.json');
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
const dailyTasksJSON = readSrc('data/dailyTasks.json');
const summoningJSON = readSrc('data/summoning.json');
const worldJSON = readSrc('data/world.json');
const worldActivitiesJSON = readSrc('data/worldActivities.json');
const placeMapsJSON = readSrc('data/placeMaps.json');

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
  // Skip responsive variants (e.g. ss-bank-360.webp); only the full-size
  // originals are keyed. Variants are referenced via `srcset` built from the
  // original URL (see landingSrcSet in utils/helpers.js).
  if (/-\d+\.webp$/.test(file)) continue;
  const key = file.replace(/\.webp$/, '');
  landingImagesObj[key] = `/public/landing/${file}`;
}
const landingImagesJSON = JSON.stringify(landingImagesObj);

// ── Prerendered landing content (crawlability) ──
// The real interactive landing page only exists after cloudPhase resolves
// (App.jsx starts at cloudPhase='pending' and shows a bare "Loading…" div),
// so the raw HTML a non-JS crawler sees was always just the splash screen —
// invisible to Bing, DuckDuckGo and every LLM crawler, all of which mostly
// don't execute JS. This fragment is injected into <main id="app"> below,
// UNDER the opaque full-viewport #app-splash overlay (position:fixed,
// z-index:9999 — see index.css), so it is never visible to a real browser:
// the boot script below explicitly clears #app before Preact mounts (Preact's
// render() does NOT do this itself for pre-existing DOM it didn't create —
// see the comment at that call site). Deliberately NOT a render of the live
// LandingScreen component
// — that drags in GameIcon's icon-resolution pipeline and the WebGL hero,
// neither of which is safe or worthwhile to execute in Node at build time.
// Instead it's built straight from landingContent.js's own marketing data
// (already the single source of truth LandingScreen itself reads), kept to
// real semantic text a crawler can index.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const landingContentModule = { exports: {} };
new Function(
  'module', 'exports',
  esbuild.transformSync(readSrc('screens/landingContent.js'), { loader: 'js', format: 'cjs' }).code
)(landingContentModule, landingContentModule.exports);
const { LANDING_STATS, LANDING_PLACES, LANDING_CARDS } = landingContentModule.exports;
// Mirrors LP_SKILLS in LandingScreen.jsx — keep the two lists in sync.
const LANDING_PRERENDER_SKILLS = [
  'Attack', 'Strength', 'Defence', 'Hitpoints', 'Ranged', 'Magic', 'Prayer', 'Mining',
  'Woodcutting', 'Fishing', 'Farming', 'Smithing', 'Cooking', 'Crafting', 'Herblore', 'Runecrafting',
  'Firemaking', 'Agility', 'Thieving', 'Hunter', 'Slayer', 'Construction', 'Fletching', 'Dungeoneering',
  'Summoning',
];
const landingPrerenderHTML = `
<h1>PocketRPG — a browser idle RPG</h1>
<p>A tick-based idle fantasy RPG set in the world of Eldermoor. Train 25 skills, fight bosses, and complete quests — progress continues whether the app is open or not. Free to play, no download.</p>
<ul>${LANDING_STATS.map(([value, label]) => `<li><strong>${escapeHtml(value)}</strong> ${escapeHtml(label)}</li>`).join('')}</ul>
<h2>Features</h2>
${LANDING_CARDS.map((c) => `<h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.desc)}</p>`).join('\n')}
<h2>Explore the realm of Eldermoor</h2>
${LANDING_PLACES.map((p) => `<h3>${escapeHtml(p.name)} — ${escapeHtml(p.sub)}</h3><p>${escapeHtml(p.blurb)}</p>`).join('\n')}
<h2>Train 25 skills to 99</h2>
<ul>${LANDING_PRERENDER_SKILLS.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
`.trim();

// Optional Home Screen hero logo, served externally from /public. Falls back
// to null — and the crossed-swords crest — when the file is absent.
const logoPath = path.join(__dirname, 'public', 'pocketrpg-logo.png');
const homeLogoJSON = fs.existsSync(logoPath)
  ? JSON.stringify('/public/pocketrpg-logo.png')
  : 'null';

// Concatenate JS — core (inline) vs lazily-loaded game chunk
let coreJS = '';
let gameJS = '';
for (const f of sourceFiles) {
  try {
    const out = processFile(f);
    if (GAME_CHUNK_FILES.has(f)) gameJS += out;
    else coreJS += out;
  } catch(e) {
    console.error(`Error: ${f}: ${e.message}`);
    process.exit(1);
  }
}

// ── Guard: imports of unregistered modules ──
// processFile strips every `import` line and relies on the imported bindings
// existing as top-level declarations elsewhere in the concatenated bundle. If
// a module imports a src file that is NOT in sourceFiles, its bindings are
// simply undefined at runtime — and when the reference lives inside a
// function (a lazily-mounted component), check:single's eval smoke-run never
// executes it, so the break only surfaces in production (e.g. 3d/rigs.js
// missing → the combat arena silently fails over for procedural monsters).
// JSON imports are exempt: they resolve to data globals injected below, and
// a missing injection dies at eval time where check:single catches it.
{
  const stripExt = (p) => p.replace(/\.(jsx?|tsx?)$/, '');
  const registered = new Set(sourceFiles.map(stripExt));
  // deliberately unregistered: replaced by globals injected into the core
  // script below (landingImages/homeLogo), like the JSON data files
  registered.add('screens/landingImages');
  registered.add('utils/homeLogo');
  const offenders = [];
  for (const f of sourceFiles) {
    const src = readDist(f);
    const re = /^import\s+(?:[\w{},*\s]+?\s+from\s+)?['"]([^'"]+)['"]/gm;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (!spec.startsWith('.') || spec.endsWith('.json') || spec.endsWith('.css')) continue;
      const resolved = stripExt(path.posix.join(path.posix.dirname(f), spec));
      if (!registered.has(resolved)) offenders.push(`${f} imports ${spec} → '${resolved}.js' is not in sourceFiles`);
    }
  }
  if (offenders.length) {
    console.error(
      'build_single: module(s) imported but not registered in sourceFiles.\n' +
      'The single-file bundle strips imports and depends on concatenation, so these\n' +
      "bindings would be undefined at runtime (and check:single can't see references\n" +
      'made inside functions). Add the module to sourceFiles (and GAME_CHUNK_FILES if\n' +
      'only in-game code uses it):\n  ' +
      [...new Set(offenders)].join('\n  ')
    );
    process.exit(1);
  }
}

// ── Guard: duplicate top-level declarations across the flattened bundle ──
// The core inline script and the lazily-loaded game chunk are concatenated into
// one shared global lexical environment (minifyIdentifiers:false keeps source
// names), so two modules declaring the same top-level name collide. Duplicate
// `const`/`let`/`class` are SyntaxErrors that `check:single` (node --check)
// catches in the emitted output — but duplicate top-level `function`
// declarations are *legal* JS (last one wins) and esbuild's minifier silently
// drops the shadowed one, so they disappear before any post-build check can see
// them. We must detect them here, on the pre-minify module source, where both
// declarations still exist (e.g. a screen-local helper named `ItemSlot`
// clobbering the shared <ItemSlot> component).
function topLevelDeclCounts(source) {
  const counts = new Map();
  const re = /^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/;
  for (const line of source.split('\n')) {
    const m = re.exec(line);
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
}
{
  const coreDecls = topLevelDeclCounts(coreJS);
  const gameDecls = topLevelDeclCounts(gameJS);
  const offenders = [];
  for (const [name, n] of coreDecls) if (n > 1) offenders.push(`${name} — declared ${n}× in the core script`);
  for (const [name, n] of gameDecls) if (n > 1) offenders.push(`${name} — declared ${n}× in the game chunk`);
  for (const name of coreDecls.keys()) if (gameDecls.has(name)) offenders.push(`${name} — declared in BOTH the core script and the game chunk`);
  if (offenders.length) {
    console.error(
      'build_single: duplicate top-level declaration(s) in the flattened single-file bundle.\n' +
      'These share one global scope, so the later declaration silently clobbers the earlier one\n' +
      '(esbuild then drops the shadowed copy, hiding it from check:single). Rename the\n' +
      'screen/component-local binding so every top-level name is unique:\n  ' +
      offenders.join('\n  ')
    );
    process.exit(1);
  }
}

// ── Compile Tailwind CSS ──
fs.mkdirSync(path.join(__dirname, '.tmp'), { recursive: true });
// Run the CLI's entry script directly via `node` rather than spawning the
// node_modules/.bin shim: on Windows that's a .cmd/.ps1 file, not something
// spawnSync can exec without shell:true, so this stays cross-platform.
const twCliDir = path.dirname(require.resolve('@tailwindcss/cli/package.json'));
const twCliBin = require(path.join(twCliDir, 'package.json')).bin.tailwindcss;
const twResult = spawnSync(process.execPath, [
  path.join(twCliDir, twCliBin),
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
//
// `preload` lists the weights that paint above the fold (the splash brand +
// landing hero headings in Cinzel, body copy in Nunito). Without a hint these
// are only discovered after the inline CSS parses and those elements lay out,
// which puts them at the tail of the critical request chain (Lighthouse's
// "Network dependency tree" insight). Emitting `<link rel=preload as=font>`
// for just those weights lets the browser fetch them up front in parallel with
// the document, shortening the chain. Below-the-fold / in-app-only weights
// (Nunito 600/700, all JetBrains Mono) are intentionally NOT preloaded so they
// don't compete with the LCP image for early bandwidth.
// Forgemark (in-game only, loaded inside the lazy game chunk — never preloaded):
//   Grenze Gotisch    — display / headings
//   Spectral          — body serif (needs italic for the "ledger" emphasis voice)
//   IM Fell English   — lore/flavour italic (its only real use is italic)
//   Spline Sans Mono  — numerics
const FONT_FACES = [
  { pkg: '@fontsource/cinzel',           family: 'Cinzel',           weights: [400, 700, 900], preload: [400, 700, 900] },
  { pkg: '@fontsource/nunito',            family: 'Nunito',           weights: [400, 600, 700], preload: [400]           },
  { pkg: '@fontsource/jetbrains-mono',   family: 'JetBrains Mono',   weights: [400, 700],      preload: []              },
  { pkg: '@fontsource/grenze-gotisch',   family: 'Grenze Gotisch',   weights: [400, 700, 900], preload: []              },
  { pkg: '@fontsource/spectral',         family: 'Spectral',         weights: [400, 600, 700], italics: [400, 600],    preload: [] },
  { pkg: '@fontsource/im-fell-english',  family: 'IM Fell English',  weights: [400],           italics: [400],         preload: [] },
  { pkg: '@fontsource/spline-sans-mono', family: 'Spline Sans Mono', weights: [400, 500, 600, 700], preload: []        },
];
const fontsOutDir = path.join(__dirname, 'public', 'fonts');
fs.mkdirSync(fontsOutDir, { recursive: true });
let fontFaceCSS = '';
let fontPreloadTags = '';
for (const { pkg, family, weights, italics, preload } of FONT_FACES) {
  const fontName = pkg.split('/')[1];
  const styles = weights.map((weight) => [weight, 'normal']).concat((italics || []).map((weight) => [weight, 'italic']));
  for (const [weight, style] of styles) {
    const fname = `${fontName}-latin-${weight}-${style}.woff2`;
    const fpath = path.join(__dirname, 'node_modules', pkg, 'files', fname);
    if (!fs.existsSync(fpath)) {
      console.error(`Missing font: ${fpath}`);
      process.exit(1);
    }
    fs.copyFileSync(fpath, path.join(fontsOutDir, fname));
    fontFaceCSS +=
      `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};` +
      `font-display:swap;src:url('/public/fonts/${fname}') format('woff2')}\n`;
    // `crossorigin` is required even for same-origin fonts: woff2 is always
    // fetched in CORS-anonymous mode, so a preload without it would be a
    // separate, unused fetch (double download).
    if ((preload || []).includes(weight)) {
      fontPreloadTags +=
        `<link rel="preload" href="/public/fonts/${fname}" as="font" type="font/woff2" crossorigin>\n`;
    }
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

// CSS. Tailwind's CLI already minifies its output; the hand-written rules from
// index.css (the `:root` variables, app/landing styles) are not, so run them
// through esbuild's CSS minifier too — otherwise they ship as ~2 KiB of
// avoidable whitespace (Lighthouse "Minify CSS").
const rawCustomCSS = readSrc('index.css').replace('@import "tailwindcss";', '').trim();
const customCSS = esbuild.transformSync(rawCustomCSS, {
  loader: 'css',
  minify: true,
}).code.trim();
const css = fontFaceCSS + compiledTailwindCSS + '\n' + customCSS;

// ── Minify settings for the split bundles ──
// The core inline script and the lazily-loaded game chunk are emitted as two
// CLASSIC scripts that share the global lexical environment (see
// GAME_CHUNK_FILES). For App (core) to reference the game screens — and for the
// game chunk to reference core's bindings — top-level identifiers must keep
// their source names across both files, so identifier minification is disabled.
// Whitespace + syntax minification still apply, and the self-contained vendor
// IIFE is already fully minified. Re-running esbuild over already-minified code
// (vendor) is a no-op.
const SPLIT_MINIFY = {
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  target: 'es2020',
  legalComments: 'none',
};

// ── Game chunk (lazily loaded in-game screens) ──
// Built first so the core loader can embed its content-hashed URL. Classic
// script + "use strict" matches the module semantics the source was authored
// under (strict, top-level `this` === undefined).
//
// gameIconsData (the ~126 KiB game-icons.net SVG glyph map) lives in the chunk,
// not core: it is consumed only by icon code (GameIcon / itemIcons / skillArt),
// never on the mobile landing/login page, so it is pure dead weight there. The
// desktop landing — the one place an icon renders before the player is in-game —
// fetches the chunk on mount (see LandingScreen) and GameIcon falls back
// to an emoji until it arrives.
//
// worldActivitiesData (the ~150 KiB content→place mapping) also rides the chunk:
// only in-game code reads it (activity gating via requestActivityStart, and the
// World Map place hub — both unreachable before the chunk loads). Core keeps the
// small world.json geography for boot-time location/travel; worldContent.js
// guards every access with `typeof worldActivitiesData !== 'undefined'`, so a
// pre-chunk call degrades to "unmapped, never gate".
// The branch this build is for. Workers Builds injects WORKERS_CI_BRANCH;
// Pages injected CF_PAGES_BRANCH, still read so the Pages project keeps baking
// correctly for as long as it stays deployed as the migration's rollback.
// Every flag below derives from this ONE value: read the raw env var again and
// a Workers build silently loses whichever flag missed the change — which for
// the world origin below means production players handed to preview.
const deployBranch = process.env.WORKERS_CI_BRANCH || process.env.CF_PAGES_BRANCH || '';
const isProductionBranch = deployBranch === 'main';
const branchLog = `branch=${deployBranch || 'unset'}`;

// Open-world beta button flag, same build-time-bake pattern as the other
// deploy-branch-derived flags in this file (and for the same reason: this is
// a client-bundle toggle, and wrangler.toml [vars] never reach the client
// build — only functions/**).
// `EnableWorldBeta` ("true"/anything) is an explicit override when set;
// otherwise derive from CF_PAGES_BRANCH the same way: preview = enabled,
// production (main) = disabled. Fail-safe: no branch info disables.
const worldBetaEnabled = process.env.EnableWorldBeta != null
  ? process.env.EnableWorldBeta === 'true'
  : Boolean(deployBranch) && !isProductionBranch;
console.log(`World beta button: ${worldBetaEnabled ? 'ENABLED' : 'disabled'} (EnableWorldBeta=${process.env.EnableWorldBeta ?? 'unset'}, ${branchLog})`);
// Boss lairs are a SEPARATE flag from the world beta above, deliberately: a
// lair is one authored instanced room entered from the boss picker and left by
// closing the tab, so it ships to production while the beta button — which
// drops the player into the whole overworld — stays off. Default on; the
// `EnableWorldLairs` override exists so a bad night is one redeploy, not a
// code change. What may have a lair is still the allowlist in
// src/engine/worldLairs.js.
const worldLairsEnabled = process.env.EnableWorldLairs != null
  ? process.env.EnableWorldLairs === 'true'
  : true;
console.log(`World boss lairs: ${worldLairsEnabled ? 'ENABLED' : 'disabled'} (EnableWorldLairs=${process.env.EnableWorldLairs ?? 'unset'})`);
// Where the handoff opens the open-world client. The world ships from the same
// Worker as the game, staged under /world/ (scripts/stage-site.mjs), so every
// environment — production included — points at its OWN origin: a bare path,
// never a hostname. The dedicated world.pocketrpg.co.uk custom domain (which
// worker/worldHost.js could still map onto the same prefix, if reattached) was
// retired in favour of this — one fewer DNS record to keep pointed at the
// right Worker across a migration.
const worldOrigin = process.env.WorldOrigin || '/world';
console.log(`World origin: ${worldOrigin} (WorldOrigin=${process.env.WorldOrigin ?? 'unset'}, ${branchLog})`);
// Quest-requirement bypass (src/engine/questGates.js), same build-time-bake
// pattern as the two flags above — a preview-only testing aid, so main and
// branch-less local builds bake `false` and the production bundle cannot
// express the bypass at all. This one goes in the CORE preamble, not the game
// chunk: engine gates run before the chunk loads (boot-time idle catch-up), and
// a `typeof`-undefined read there would silently mean "enforced" mid-session.
// Unlike the two flags above, the `main` branch is an unconditional NO: the
// override can only turn this on somewhere that is already not production.
const questGatesDisabled = isProductionBranch
  ? false
  : process.env.DisableQuestRequirements != null
    ? process.env.DisableQuestRequirements === 'true'
    : Boolean(deployBranch);
console.log(`Quest requirements: ${questGatesDisabled ? 'BYPASSED (preview)' : 'enforced'} (DisableQuestRequirements=${process.env.DisableQuestRequirements ?? 'unset'}, ${branchLog})`);
const gameChunkSource = `const gameIconsData = ${gameIconsJSON};\nconst bespokeIconsData = ${bespokeIconsJSON};\nconst worldActivitiesData = ${worldActivitiesJSON};\nconst placeMapsData = ${placeMapsJSON};\nconst pocketAssetBase = '/public/';\nconst pocketWorldBetaEnabled = ${worldBetaEnabled};\nconst pocketWorldLairsEnabled = ${worldLairsEnabled};\nconst pocketWorldOrigin = ${JSON.stringify(worldOrigin)};\n${gameJS}`;
const gameChunkScript = esbuild.transformSync(gameChunkSource, SPLIT_MINIFY).code.trim();
const gameChunkBody = `"use strict";\n${gameChunkScript}\n`;
const gameChunkHash = require('crypto').createHash('sha256').update(gameChunkBody).digest('hex').slice(0, 12);
const gameChunkFile = `game-${gameChunkHash}.js`;
// Remove stale game-*.js chunks from previous builds so only the current one ships.
for (const f of fs.readdirSync(__dirname)) {
  if (/^game-[0-9a-f]+\.js$/.test(f) && f !== gameChunkFile) {
    try { fs.unlinkSync(path.join(__dirname, f)); } catch {}
  }
}
fs.writeFileSync(path.join(__dirname, gameChunkFile), gameChunkBody);

// Loader installed in the core script: injects the game chunk on first request
// and caches the promise. A failed load clears the cache so the next call (App
// retries on error) re-attempts. Served from the site root by Cloudflare Pages.
const gameChunkLoader = `globalThis.__loadGameChunk=(function(){var p=null;return function(){if(!p){p=new Promise(function(resolve,reject){var s=document.createElement('script');s.src='/${gameChunkFile}';s.onload=function(){resolve();};s.onerror=function(e){p=null;reject(e);};document.head.appendChild(s);});}return p;};})();`;

// ── Core inline script ──
// vendor (preact + idb) + injected JSON data globals + game-chunk loader +
// core app modules (engine, utils, components, state, db, App, landing/auth) +
// bootstrap. Concatenated raw and minified as one unit (sans identifier renaming).
const coreScript = `${vendorBundle}
${vendorDestructure}
${gameChunkLoader}

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
const dailyTasksData = ${dailyTasksJSON};
const summoningData = ${summoningJSON};
const worldData = ${worldJSON};
const pocketQuestGatesDisabled = ${questGatesDisabled};
const landingImages = ${landingImagesJSON};
const homeLogo = ${homeLogoJSON};

${coreJS}

// The prerendered crawlability fragment (see landingPrerenderHTML in
// build_single.cjs) sits inside #app for a non-JS request. Preact's render()
// does NOT clear pre-existing DOM it didn't create — passed a container with
// pre-existing children, it uses them only as a reuse pool for matching new
// nodes and leaves any it doesn't consume in place, so without this line the
// app mounts ALONGSIDE the static fragment instead of replacing it.
const pocketAppRoot = document.getElementById('app') || document.querySelector('main');
if (pocketAppRoot) pocketAppRoot.textContent = '';
render(h(App, null), pocketAppRoot);
document.getElementById('app-splash')?.remove();`;

const minified = esbuild.transformSync(coreScript, SPLIT_MINIFY);
const inlineScript = `"use strict";\n${minified.code.trim()}`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#e6d8b6">
<title>PocketRPG — Browser Idle RPG with 25 Skills, Bosses &amp; Raids</title>
<meta name="description" content="PocketRPG — a tick-based idle fantasy RPG set in the world of Eldermoor. Train 25 skills, fight bosses, and complete quests — progress continues whether the app is open or not. Free to play in your browser, no download.">
<link rel="canonical" href="https://pocketrpg.co.uk/">
<link rel="manifest" href="/manifest.json">
<!-- Open Graph + Twitter card. lp-map is the most legible single image for a
     share preview (readable at thumbnail size, shows the scale of the world)
     — none of the painted place scenes read as well cropped that small.
     1108x594 (1.865:1) is close enough to OG's 1.91:1 ideal that platforms
     don't visibly letterbox it; declared explicitly since it isn't the
     canonical 1200x630. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="PocketRPG">
<meta property="og:url" content="https://pocketrpg.co.uk/">
<meta property="og:title" content="PocketRPG — Browser Idle RPG with 25 Skills, Bosses &amp; Raids">
<meta property="og:description" content="A tick-based idle fantasy RPG set in the world of Eldermoor. Train 25 skills, fight bosses, complete quests and raid with a party — progress continues while you're away. Free to play, no download.">
<meta property="og:image" content="https://pocketrpg.co.uk/public/landing/lp-map.webp">
<meta property="og:image:type" content="image/webp">
<meta property="og:image:width" content="1108">
<meta property="og:image:height" content="594">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="PocketRPG — Browser Idle RPG with 25 Skills, Bosses &amp; Raids">
<meta name="twitter:description" content="A tick-based idle fantasy RPG set in the world of Eldermoor. Train 25 skills, fight bosses, complete quests and raid with a party — free to play, no download.">
<meta name="twitter:image" content="https://pocketrpg.co.uk/public/landing/lp-map.webp">
<!-- VideoGame + WebSite structured data. Kept to fields we can state as fact
     from src/data today (§8 non-negotiables apply to game content, not to
     this — but the same "don't claim what isn't true" discipline does).
     Revisit if pricing/monetization is ever added. -->
<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoGame","name":"PocketRPG","url":"https://pocketrpg.co.uk/","description":"A tick-based idle fantasy RPG set in the world of Eldermoor. Train 25 skills, fight bosses, complete quests and raid with a party — progress continues while you're away.","genre":["Idle","RPG","MMO"],"gamePlatform":["Web Browser"],"applicationCategory":"Game","operatingSystem":"Any","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"PocketRPG","url":"https://pocketrpg.co.uk/"}</script>
<!-- LCP image: the hero Warlord Grondar poster is rendered by JS, so preload
     it here to make the request discoverable from the initial document and
     fetch it at high priority. imagesrcset/imagesizes mirror the hero <img>
     so the preloaded variant is the one actually used (no double download).
     Kept first (fetchpriority high) so it stays ahead of the font preloads
     below in the queue. -->
<link rel="preload" as="image" href="/public/landing/lp-grondar.webp" imagesrcset="/public/landing/lp-grondar-360.webp 360w, /public/landing/lp-grondar.webp 720w" imagesizes="(min-width: 880px) 430px, 66vw" type="image/webp" fetchpriority="high">
<!-- Above-the-fold fonts: discover them from the initial document so they load
     in parallel instead of trailing the critical request chain. font-display:swap
     keeps text visible in a fallback meanwhile. See FONT_FACES.preload above. -->
${fontPreloadTags.trim()}
<style>
${css}
</style>
<!-- Theme stamp. Must run in <head>, before #app-splash paints — the scripts
     at the top of <body> are already too late and would flash the wrong
     material. Mirrors resolveTheme() in src/utils/theme.js; the default is
     'light' so existing players keep the parchment they installed. -->
<script>(function(){try{var p=localStorage.getItem('pocketrpg_theme');if(p!=='light'&&p!=='dark'&&p!=='system')p='light';var t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#14110d':'#e6d8b6')}catch(e){document.documentElement.setAttribute('data-theme','light')}})()</script>
</head>
<body>
<script>if(navigator.standalone){document.documentElement.classList.add('pwa-standalone');var s=document.createElement('style');s.textContent='.pwa-standalone .overflow-y-auto{padding-bottom:env(safe-area-inset-bottom)}';document.head.appendChild(s)}</script>
<script>['gesturestart','gesturechange','gestureend'].forEach(function(t){document.addEventListener(t,function(e){e.preventDefault()},{passive:false})});</script>
<div id="app-splash"><div class="app-splash__brand">PocketRPG</div><div class="app-splash__sub">Loading your adventure…</div></div>
<main id="app">${landingPrerenderHTML}</main>
<script>
${inlineScript}
<\/script>
</body>
</html>`;

// Always write to project root (the served/committed artifact)
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('✅ Built index.html (' + (html.length / 1024).toFixed(1) + ' KB)'
  + ' + ' + gameChunkFile + ' (' + (gameChunkBody.length / 1024).toFixed(1) + ' KB)');

