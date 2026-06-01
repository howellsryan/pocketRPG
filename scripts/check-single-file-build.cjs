const fs = require('fs');
const path = require('path');
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

try {
  checkJsonImportNames();

  const html = fs.readFileSync(indexPath, 'utf8');
  // The build emits the core app as a classic inline <script> (so it shares the
  // global lexical environment with the lazily-loaded game chunk). Match an
  // inline <script> that has no attributes.
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  if (!match) {
    console.error('No inline <script> block found in index.html');
    process.exit(1);
  }

  // Syntax-check every concatenated artifact: the inline core script plus the
  // content-hashed game-*.js chunk (build_single.cjs code-splits the in-game
  // screens out of the inline payload).
  const scripts = [{ name: 'index.html inline core', code: match[1] }];
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
} finally {
  cleanup();
}
