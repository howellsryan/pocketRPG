const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const tmpPath = path.join(root, 'tmp_module_check.mjs');

function cleanup() {
  try { fs.unlinkSync(tmpPath); } catch {}
}

// The single-file build (build_single.cjs) strips ALL import statements and
// injects each src/data/*.json file as a fixed global named `<base>Data`
// (e.g. collectionLog.json → collectionLogData). A source file that imports
// the JSON under any other local name compiles fine for Vite but references an
// undefined global in the bundled app, crashing at runtime. Enforce the
// canonical local name so that whole class of bug can't ship again.
function checkJsonImportNames() {
  const srcDir = path.join(root, 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      const code = fs.readFileSync(full, 'utf8');
      const re = /import\s+(\w+)\s+from\s+['"][^'"]*\/data\/([\w-]+)\.json['"]/g;
      let m;
      while ((m = re.exec(code))) {
        const [, localName, base] = m;
        const expected = base.replace(/-/g, '_') + 'Data';
        if (localName !== expected) {
          offenders.push(`${path.relative(root, full)}: imports ${base}.json as "${localName}" — must be "${expected}" to match the single-file build global`);
        }
      }
    }
  };
  walk(srcDir);
  if (offenders.length) {
    console.error('Single-file build JSON import-name check failed:\n  ' + offenders.join('\n  '));
    process.exit(1);
  }
}

// Engine modules are concatenated into the single-file build via an EXPLICIT
// `sourceFiles`/`GAME_CHUNK_FILES` list in build_single.cjs (src/engine is never
// globbed). A new engine module that isn't registered there compiles & tests
// fine under Vite/Vitest but is simply ABSENT from the bundle — every reference
// to its exports becomes an undefined global and throws at runtime (and because
// onTick swallows listener errors, that surfaces as "combat silently frozen").
// Enforce that every engine module is registered so that can't ship again.
function checkEngineModulesRegistered() {
  const srcDir = path.join(root, 'src');
  const engineDir = path.join(srcDir, 'engine');
  if (!fs.existsSync(engineDir)) return;
  const buildSrc = fs.readFileSync(path.join(root, 'build_single.cjs'), 'utf8');

  // Collect every engine module that some client (src/**) file imports. Engine
  // modules imported only by functions/** (the Cloudflare server) are exempt —
  // they're not part of the browser bundle.
  const needed = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      const code = fs.readFileSync(full, 'utf8');
      const re = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
      let m;
      while ((m = re.exec(code))) {
        const base = path.resolve(path.dirname(full), m[1]).replace(/\.(jsx?|tsx?)$/, '');
        for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
          const candidate = base + ext;
          if (candidate.startsWith(engineDir + path.sep) && fs.existsSync(candidate)) {
            needed.add(path.relative(srcDir, candidate).replace(/\\/g, '/').replace(/\.tsx?$/, '.js'));
            break;
          }
        }
      }
    }
  };
  walk(srcDir);

  const offenders = [];
  for (const rel of needed) {
    if (!buildSrc.includes(`'${rel}'`) && !buildSrc.includes(`"${rel}"`)) {
      offenders.push(`${rel} is imported by client source but not registered in build_single.cjs (sourceFiles or GAME_CHUNK_FILES) — it would be missing from the single-file build`);
    }
  }
  if (offenders.length) {
    console.error('Single-file build engine-module registration check failed:\n  ' + offenders.join('\n  '));
    process.exit(1);
  }
}

// The core script and game chunk are CLASSIC scripts sharing one lexical scope,
// executed top-to-bottom at page load. A top-level statement that reads another
// module's `const`/`let` before its declaration is concatenated (e.g. a util
// module ordered ahead of the engine module it imports) throws a "Cannot access
// X before initialization" temporal-dead-zone ReferenceError — which aborts the
// WHOLE inline script and leaves a blank white screen in production. `node
// --check` only parses, so it can't see this; execute the script far enough to
// surface any eval-time TDZ. Browser globals are stubbed by a permissive Proxy
// so real DOM/network access doesn't throw; we fail ONLY on the TDZ signature.
function checkNoEvalTimeTDZ(scripts) {
  // A permissive stub for browser globals: callable, constructable, iterable
  // (empty), number-coercible, and every property access returns itself — so DOM
  // and network access flows without throwing, letting execution reach later
  // top-level statements. Real JS built-ins (Object, Array, JSON, …) are left
  // untouched, so only genuinely-missing browser globals resolve to the stub.
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.iterator ? function* () {} : k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : stub),
    apply: () => stub, construct: () => stub, has: () => true, set: () => true,
  });
  for (const { name, code } of scripts) {
    const sandbox = {};
    let tdz = null;
    // Run, and each time a browser global is missing, define it as the stub and
    // retry — separating "undefined global" (benign here) from the TDZ signature
    // ("Cannot access X before initialization"), which is the real outage class.
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        vm.runInNewContext(code, sandbox, { timeout: 8000 });
        break; // ran to completion — no eval-time TDZ
      } catch (err) {
        // Errors thrown inside the vm belong to the sandbox realm, so
        // `instanceof` fails across the boundary — match on the message instead.
        const msg = (err && err.message) || '';
        if (/before initialization/.test(msg)) { tdz = err; break; } // the outage signature
        const missing = /(\w+) is not defined/.exec(msg);
        if (missing) { sandbox[missing[1]] = stub; continue; } // stub a missing global and retry
        break; // an unrelated runtime throw under the stubs — inconclusive, stop
      }
    }
    if (tdz) {
      console.error(`Eval-time temporal-dead-zone error in ${name}: ${tdz.message}\n` +
        `A top-level statement reads a binding declared later in the concatenated bundle. ` +
        `Defer the access into a function (lazy init) so it runs after every module is defined.`);
      process.exit(1);
    }
  }
}

try {
  checkJsonImportNames();
  checkEngineModulesRegistered();

  const html = fs.readFileSync(indexPath, 'utf8');
  // The build emits the core app as a classic inline <script> (so it shares the
  // global lexical environment with the lazily-loaded game chunk). It also emits
  // OTHER small attribute-less inline scripts (e.g. a PWA-standalone bootstrap
  // placed *before* the core). Matching only the first block would check the
  // wrong script and silently skip the real core↔chunk redeclaration guard
  // below, so collect EVERY attribute-less inline <script>.
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  if (!inlineScripts.length) {
    console.error('No inline <script> block found in index.html');
    process.exit(1);
  }

  // Syntax-check every concatenated artifact: each inline script plus the
  // content-hashed game-*.js chunk (build_single.cjs code-splits the in-game
  // screens out of the inline payload).
  const scripts = inlineScripts.map((m, i) => ({
    name: `index.html inline script #${i + 1}`,
    code: m[1],
  }));
  for (const f of fs.readdirSync(root)) {
    if (/^game-[0-9a-f]+\.js$/.test(f)) {
      scripts.push({ name: f, code: fs.readFileSync(path.join(root, f), 'utf8') });
    }
  }

  for (const { name, code } of scripts) {
    fs.writeFileSync(tmpPath, code, 'utf8');
    const result = spawnSync(process.execPath, ['--check', tmpPath], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(`Syntax check failed for ${name}`);
      process.exit(result.status || 1);
    }
  }

  // The core script and the game chunk are CLASSIC scripts that share one global
  // lexical environment at runtime, so a top-level identifier declared in BOTH
  // would throw "Identifier already declared" in the browser — something the
  // per-file syntax checks above can't catch. Concatenate and --check the lot to
  // surface any cross-script redeclaration (a single combined script makes
  // duplicate top-level const/let/class a SyntaxError).
  if (scripts.length > 1) {
    fs.writeFileSync(tmpPath, scripts.map(s => s.code).join('\n;\n'), 'utf8');
    const combined = spawnSync(process.execPath, ['--check', tmpPath], { stdio: 'inherit' });
    if (combined.status !== 0) {
      console.error('Combined core+chunk syntax check failed — likely a top-level identifier declared in both the core script and the game chunk.');
      process.exit(combined.status || 1);
    }
  }

  // Execute each script (and, for the core, itself alone as it loads before the
  // chunk) to catch eval-time temporal-dead-zone errors the syntax check misses.
  checkNoEvalTimeTDZ(scripts);
} finally {
  cleanup();
}
