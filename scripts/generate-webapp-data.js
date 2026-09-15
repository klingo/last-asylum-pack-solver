const fs = require('fs');
const path = require('path');

// Requiring rank-packages.js runs its main(): it (re)builds output/item_value_index.json
// (if missing) and always regenerates output/value_ranking.json from data/pack_data.json.
require('./rank-packages');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const WEBAPP_DATA_DIR = path.join(__dirname, '..', 'webapp', 'public', 'data');

/**
 * Copies the raw pack data plus the two generated JSON files (item value index & value
 * ranking) into webapp/public/data, so the webapp can fetch() them at runtime after being
 * built/deployed. This is meant to run before every webapp build (locally and in CI), so the
 * rankings shown by the webapp are always freshly regenerated from the current pack data.
 *
 * Usage:
 *   node scripts/generate-webapp-data.js
 */
function copyInto(fileName, fromDir) {
    fs.copyFileSync(path.join(fromDir, fileName), path.join(WEBAPP_DATA_DIR, fileName));
}

function main() {
    fs.mkdirSync(WEBAPP_DATA_DIR, { recursive: true });

    copyInto('pack_data.json', DATA_DIR);
    copyInto('item_value_index.json', OUTPUT_DIR);
    copyInto('value_ranking.json', OUTPUT_DIR);

    console.log(`Copied pack_data.json, item_value_index.json and value_ranking.json to ${WEBAPP_DATA_DIR}`);
}

main();
