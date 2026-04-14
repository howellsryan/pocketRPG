#!/usr/bin/env node
/**
 * Fetch OSRS prices from the official wiki API and update items.json
 *
 * Fetches all OSRS item prices from the wiki API and updates shopValue
 * in items.json for any items that match (by name).
 *
 * Usage:
 *   node scripts/fetch-prices.cjs
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const OSRS_PRICES_API = 'https://prices.runescape.wiki/osrs/api/v2/latest';
const ITEMS_JSON_PATH = path.join(__dirname, '../src/data/items.json');

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function normalizeName(name) {
  // Convert names to lowercase for matching
  // "Bronze dagger" -> "bronze dagger"
  return name.toLowerCase().trim();
}

async function updatePrices() {
  console.log('📥 Fetching OSRS prices from wiki API...\n');

  try {
    const osrsData = await fetchJSON(OSRS_PRICES_API);
    const osrsItems = osrsData.data || {};

    // Build a name-to-price lookup map from OSRS data
    console.log(`📊 Building OSRS price lookup from ${Object.keys(osrsItems).length} items...\n`);

    const osrsPricesByName = {};
    Object.entries(osrsItems).forEach(([id, itemData]) => {
      const name = normalizeName(itemData.name || '');
      const price = itemData.price || 0;
      osrsPricesByName[name] = price;
    });

    // Load our items.json (source of truth)
    const itemsJSON = fs.readFileSync(ITEMS_JSON_PATH, 'utf-8');
    const itemsData = JSON.parse(itemsJSON);

    console.log(`✅ Loaded ${Object.keys(itemsData).length} items from items.json\n`);
    console.log('🔍 Matching items and updating prices...\n');

    let updated = 0;
    let notFound = [];
    const changes = [];

    // Loop through OUR items.json (single source of truth)
    // and try to find matches in OSRS prices
    Object.entries(itemsData).forEach(([itemId, item]) => {
      // Skip items that shouldn't have OSRS prices
      if (item.isUntradeable || item.type === 'currency') {
        return;
      }

      const normalized = normalizeName(item.name);
      const osrsPrice = osrsPricesByName[normalized];

      if (osrsPrice && osrsPrice > 0) {
        const oldPrice = item.shopValue || 0;
        const newPrice = Math.floor(osrsPrice);
        item.shopValue = newPrice;
        updated++;

        if (oldPrice !== newPrice) {
          changes.push({
            name: item.name,
            old: oldPrice,
            new: newPrice
          });
        }
      } else if (!item.isUntradeable && item.type !== 'currency') {
        notFound.push(item.name);
      }
    });

    // Print changes
    if (changes.length > 0) {
      console.log('💰 Price Updates:\n');
      changes.slice(0, 20).forEach(change => {
        const diff = change.new - change.old;
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        console.log(`  ${change.name}`);
        console.log(`    ${change.old} → ${change.new} (${diffStr})\n`);
      });
      if (changes.length > 20) {
        console.log(`  ... and ${changes.length - 20} more items\n`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  ✅ Updated: ${updated} items`);
    console.log(`  📝 Price changes: ${changes.length} items`);

    if (notFound.length > 0) {
      console.log(`  ⚠️  Not found in OSRS: ${notFound.length} items`);
      console.log(`\n    These items kept their current prices:`);
      notFound.slice(0, 10).forEach(name => console.log(`      - ${name}`));
      if (notFound.length > 10) {
        console.log(`      ... and ${notFound.length - 10} more`);
      }
    }

    // Write back to items.json
    fs.writeFileSync(ITEMS_JSON_PATH, JSON.stringify(itemsData, null, 2) + '\n');
    console.log(`\n✅ Updated ${path.relative(process.cwd(), ITEMS_JSON_PATH)}`);

  } catch (error) {
    console.error('❌ Error fetching prices:', error.message);
    process.exit(1);
  }
}

updatePrices();
