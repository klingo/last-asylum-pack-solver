const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WEBAPP_DATA_DIR = path.join(__dirname, '..', 'webapp', 'public', 'data');

/**
 * Copies the raw pack_data.json into webapp/public/data, so the webapp can fetch() it at
 * runtime after being built/deployed. Everything the webapp shows (purchase-source
 * listings, purchase plans, and the value ranking) is computed live in the browser from
 * this raw data; no ranking/index files are pre-generated, since the effective cost of
 * anything depends on quantity and shared purchase-limit capacities, which can't be
 * flattened into a single static number ahead of time.
 *
 * Usage:
 *   node scripts/copy-pack-data.js
 */
function main() {
    fs.mkdirSync(WEBAPP_DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(DATA_DIR, 'pack_data.json'), path.join(WEBAPP_DATA_DIR, 'pack_data.json'));
    console.log(`Copied pack_data.json to ${WEBAPP_DATA_DIR}`);
}

main();
