// One-off asset tool: generate smaller responsive webp variants of the landing
// screenshots so the page can ship `srcset` candidates sized for mobile.
//
// The landing screenshots are authored at 560px wide but render at 144–328 CSS
// px on mobile, so the full-size file is far larger than needed (Lighthouse
// "Improve image delivery"). This emits down-scaled variants next to each
// original (e.g. ss-bank-360.webp) which are committed as static assets and
// referenced from a `srcset`. The widths below cover the mobile/desktop
// displayed sizes at common device pixel ratios; 560 stays as the suffix-less
// original (the largest `srcset` candidate).
//
// `sharp` is an optional one-off devtool, intentionally NOT a project/build
// dependency — the variants it produces are committed, so the deploy build does
// not need it. Run manually after changing a source screenshot:
//   npm i --no-save sharp && node scripts/gen-landing-variants.cjs
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WIDTHS = [240, 360, 480];
const landingDir = path.join(__dirname, '..', 'public', 'landing');

async function main() {
  const originals = fs
    .readdirSync(landingDir)
    .filter(f => f.endsWith('.webp') && !/-\d+\.webp$/.test(f));

  for (const file of originals) {
    const key = file.replace(/\.webp$/, '');
    const input = path.join(landingDir, file);
    const meta = await sharp(input).metadata();
    for (const w of WIDTHS) {
      if (w >= meta.width) continue; // never upscale past the source
      const out = path.join(landingDir, `${key}-${w}.webp`);
      await sharp(input)
        .resize({ width: w })
        .webp({ quality: 80, effort: 6 })
        .toFile(out);
      const kib = (fs.statSync(out).size / 1024).toFixed(1);
      console.log(`  ${key}-${w}.webp  ${kib} KiB`);
    }
  }
  console.log('Done.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
