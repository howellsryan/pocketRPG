#!/usr/bin/env node
/**
 * Fetch OSRS prices from the official wiki API and update items.json
 * Usage:
 *   node scripts/fetch-osrs-prices.cjs              (fetch from live API)
 *   node scripts/fetch-osrs-prices.cjs --test       (test with sample data)
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

const OSRS_PRICES_API = 'https://prices.runescape.wiki/osrs/api/v2/latest';
const ITEMS_JSON_PATH = path.join(__dirname, '../src/data/items.json');
const TEST_MODE = process.argv.includes('--test');

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
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

// Sample OSRS prices for testing (taken from actual OSRS wiki data)
function getTestOSRSData() {
  return {
    data: {
      '2': { name: 'Bones', price: 5 },
      '314': { name: 'Feathers', price: 8 },
      '1741': { name: 'Cowhide', price: 111 },
      '1205': { name: 'Bronze dagger', price: 18 },
      '1207': { name: 'Bronze scimitar', price: 31 },
      '1171': { name: 'Iron dagger', price: 24 },
      '1209': { name: 'Iron scimitar', price: 80 },
      '1231': { name: 'Steel dagger', price: 41 },
      '1233': { name: 'Steel scimitar', price: 190 },
      '3101': { name: 'Mithril dagger', price: 128 },
      '3103': { name: 'Mithril scimitar', price: 626 },
      '1305': { name: 'Adamant dagger', price: 356 },
      '1307': { name: 'Adamant scimitar', price: 2069 },
      '11694': { name: 'Rune dagger', price: 2286 },
      '11696': { name: 'Rune scimitar', price: 16502 },
      '1079': { name: 'Wooden shield', price: 48 },
      '1540': { name: 'Bronze sq shield', price: 140 },
      '1542': { name: 'Iron sq shield', price: 160 },
      '1544': { name: 'Steel sq shield', price: 380 },
      '1548': { name: 'Mithril sq shield', price: 1274 },
      '1550': { name: 'Adamant sq shield', price: 3521 },
      '1552': { name: 'Rune sq shield', price: 32002 },
      '1025': { name: 'Iron full helm', price: 76 },
      '1053': { name: 'Steel full helm', price: 316 },
      '1081': { name: 'Mithril full helm', price: 982 },
      '1109': { name: 'Adamant full helm', price: 2715 },
      '1137': { name: 'Rune full helm', price: 19765 },
      '558': { name: 'Air rune', price: 7 },
      '559': { name: 'Water rune', price: 6 },
      '560': { name: 'Fire rune', price: 7 },
      '561': { name: 'Earth rune', price: 8 },
      '562': { name: 'Mind rune', price: 11 },
      '563': { name: 'Body rune', price: 12 },
      '565': { name: 'Cosmic rune', price: 201 },
      '566': { name: 'Chaos rune', price: 163 },
      '564': { name: 'Soul rune', price: 264 }
    }
  };
}

async function updatePrices() {
  const mode = TEST_MODE ? '(TEST MODE)' : '';
  console.log(`📥 Fetching OSRS prices from wiki API... ${mode}\n`);

  try {
    let osrsData;
    if (TEST_MODE) {
      console.log('   Using sample test data...\n');
      osrsData = getTestOSRSData();
    } else {
      osrsData = await fetchJSON(OSRS_PRICES_API);
    }
    const osrsItems = osrsData.data || {};

    // Build a name-to-price lookup map from OSRS data
    const osrsPricesByName = {};
    Object.entries(osrsItems).forEach(([id, itemData]) => {
      const name = normalizeName(itemData.name || '');
      // Use the 'price' field (mid-market price)
      const price = itemData.price || 0;
      osrsPricesByName[name] = price;
    });

    console.log(`✅ Loaded ${Object.keys(osrsPricesByName).length} OSRS items from wiki\n`);

    // Load our items.json
    const itemsJSON = fs.readFileSync(ITEMS_JSON_PATH, 'utf-8');
    const itemsData = JSON.parse(itemsJSON);

    let updated = 0;
    let notFound = [];
    const changes = [];

    // Try to match and update
    Object.entries(itemsData).forEach(([itemId, item]) => {
      // Skip special items
      if (item.isUntradeable || item.type === 'currency') {
        return;
      }

      const normalized = normalizeName(item.name);
      const osrsPrice = osrsPricesByName[normalized];

      if (osrsPrice) {
        const oldPrice = item.shopValue;
        item.shopValue = Math.floor(osrsPrice);
        updated++;

        if (oldPrice !== Math.floor(osrsPrice)) {
          changes.push({
            name: item.name,
            old: oldPrice,
            new: Math.floor(osrsPrice)
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
