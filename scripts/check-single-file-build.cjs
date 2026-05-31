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
  const match = html.match(/<script\s+type=["']module["']>([\s\S]*?)<\/script>/i);
  if (!match) {
    console.error('No <script type="module"> block found in index.html');
    process.exit(1);
  }

  fs.writeFileSync(tmpPath, match[1], 'utf8');
  const result = spawnSync(process.execPath, ['--check', tmpPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
} finally {
  cleanup();
}
