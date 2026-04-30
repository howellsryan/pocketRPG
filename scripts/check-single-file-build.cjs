const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const tmpPath = path.join(root, 'tmp_module_check.mjs');

function cleanup() {
  try { fs.unlinkSync(tmpPath); } catch {}
}

try {
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
