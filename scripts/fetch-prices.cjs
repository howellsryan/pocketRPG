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

// OSRS Wiki Prices API endpoints
// Docs: https://prices.runescape.wiki/api/v1/osrs/mapping
const OSRS_MAPPING_API = 'https://prices.runescape.wiki/api/v1/osrs/mapping';
const OSRS_PRICES_API = 'https://prices.runescape.wiki/api/v1/osrs/latest';
const ITEMS_JSON_PATH = path.join(__dirname, '../src/data/items.json');

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'PocketRPG (https://github.com/howellsryan/pocketRPG)'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 100)}`));
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON Parse Error: ${e.message}. Response: ${data.substring(0, 100)}`));
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
  console.log('📥 Fetching OSRS prices and mapping from wiki API...\n');

  try {
    // Fetch both mapping (array of { id, name, ... }) and prices ({ data: { id: { high, low, ... } } })
    console.log('   Fetching item mapping and prices...');
    const mappingData = await fetchJSON(OSRS_MAPPING_API);
    const pricesData = await fetchJSON(OSRS_PRICES_API);

    // The /mapping endpoint returns a plain JSON array of item objects, NOT an object
    // wrapped with `data`. Build an ID → name lookup from the array.
    const mappingArray = Array.isArray(mappingData) ? mappingData : (mappingData.data || []);
    const osrsNameById = {};
    for (const entry of mappingArray) {
      if (entry && entry.id != null && entry.name) {
        osrsNameById[String(entry.id)] = entry.name;
      }
    }

    // The /latest endpoint returns { data: { "<id>": { high, low, highTime, lowTime } } }
    const osrsPrices = pricesData.data || {};

    console.log(`   Mapping has ${mappingArray.length} items (${Object.keys(osrsNameById).length} with names)`);
    console.log(`   Prices has ${Object.keys(osrsPrices).length} items`);

    // Build a name-to-price lookup map by joining prices against mapping by ID.
    const osrsPricesByName = {};
    let pricesWithoutMapping = 0;
    let pricesWithoutValue = 0;

    Object.entries(osrsPrices).forEach(([id, priceData]) => {
      const itemName = osrsNameById[id];
      if (!itemName) {
        pricesWithoutMapping++;
        return;
      }

      // The GE API gives us `high` (latest buy) and `low` (latest sell) offers.
      // Use the midpoint when both are present, otherwise fall back to whichever
      // side we have. Items with no recent trades are skipped.
      const high = typeof priceData.high === 'number' ? priceData.high : null;
      const low = typeof priceData.low === 'number' ? priceData.low : null;
      let price = 0;
      if (high != null && low != null) {
        price = Math.floor((high + low) / 2);
      } else if (high != null) {
        price = high;
      } else if (low != null) {
        price = low;
      }

      if (price <= 0) {
        pricesWithoutValue++;
        return;
      }

      osrsPricesByName[normalizeName(itemName)] = price;
    });

    console.log(`   Price entries with no mapping match: ${pricesWithoutMapping}`);
    console.log(`   Price entries with no high/low value: ${pricesWithoutValue}`);

    // Load our items.json (source of truth)
    const itemsJSON = fs.readFileSync(ITEMS_JSON_PATH, 'utf-8');
    const itemsData = JSON.parse(itemsJSON);

    console.log(`✅ Loaded ${Object.keys(itemsData).length} items from items.json\n`);

    let updated = 0;
    let changed = 0;
    const notFound = [];

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
          changed++;
        }
      } else {
        notFound.push(item.name);
      }
    });

    console.log(`\n📊 Summary:`);
    console.log(`  ✅ Updated: ${updated} items`);
    console.log(`  📝 Price changes: ${changed} items`);

    if (notFound.length > 0) {
      console.log(`  ⚠️  Not found in OSRS: ${notFound.length} items`);
      console.log(`\n    These items kept their current prices:`);
      notFound.sort((a, b) => a.localeCompare(b));
      notFound.forEach(name => console.log(`      - ${name}`));
    }

    // Write back to items.json
    fs.writeFileSync(ITEMS_JSON_PATH, JSON.stringify(itemsData, null, 2) + '\n');
    console.log(`\n✅ Updated ${path.relative(process.cwd(), ITEMS_JSON_PATH)}`);

  } catch (error) {
    console.warn('⚠️  Could not fetch OSRS prices:', error.message);
    console.warn('    Using cached items.json prices instead.\n');
    // Don't exit with error — allow build to continue with cached prices
  }
}

updatePrices();
