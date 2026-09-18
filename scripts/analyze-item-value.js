const { loadData, createMarket, collectPackageSources, collectExchangeSources, formatDays } = require('./lib/pricing');

/**
 * Analyzes every available purchase option (packages & exchange shop offers) that can
 * yield a given item, ranks them by effective Banknotes-per-unit price, and prints
 * a purchase plan for a target quantity if one is provided.
 *
 * Usage:
 *   node scripts/analyze-item-value.js <item_id> [target_quantity] [options]
 *
 * Options:
 *   --days=N (default 1)           How many days you're planning to buy over. Daily limits
 *                                  scale linearly with N (buy up to N times); weekly limits
 *                                  only start allowing multiple purchases once N reaches 8+
 *                                  (ceil(N / 7) purchases). For anything tied to a specific
 *                                  event/shop (e.g. the Strange Bazaar), N is capped at 7
 *                                  since the event/shop won't still be around after that.
 *
 * Example:
 *   node scripts/analyze-item-value.js gear_blueprint_ur 50 --days=3
 *
 * Note (npm): npm treats leading "--" flags as its own options unless you add an extra "--"
 * separator before the script arguments:
 *   npm run analyze-item-value -- gear_blueprint_ur 50 --days=3
 *
 * Alternative: set the DAYS environment variable instead (useful with npm without the "--"
 * separator):
 *   DAYS=3 npm run analyze-item-value gear_blueprint_ur 50
 */

function parseDays(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const num = Number(value);
    if (!Number.isNaN(num) && num >= 1) {
        return Math.floor(num);
    }
    return null;
}

function printSourceTable(sources) {
    const rows = sources.map((s, index) => ({
        Rank: index + 1,
        Source: s.name,
        Category: s.category || '-',
        Type: s.type,
        'Price/Purchase': s.type === 'exchange' ? s.priceDisplay : s.price,
        'Yield/Purchase': Number(s.yieldPerPurchase.toFixed(4)),
        'Banknotes/Unit': Number.isFinite(s.pricePerUnit) ? Number(s.pricePerUnit.toFixed(2)) : 'N/A',
        'Limit (units)': Number.isFinite(s.purchaseCapacity)
            ? Number((s.purchaseCapacity * s.yieldPerPurchase).toFixed(2))
            : 'Unlimited',
        Days: formatDays(s.availableDays),
        Requires: s.requires || '-',
    }));
    console.table(rows);
}

function printPurchasePlan(market, targetItemId, targetQuantity) {
    console.log(`\nOptimal purchase plan for ${targetQuantity} unit(s) (cheapest cost/unit first):`);

    // Simulate the actual purchase against the market: this correctly accounts for limited
    // currency sources (e.g. a "100 Strange Coins for 499 Banknotes" offer capped at once
    // per day) running out mid-plan and falling back to pricier sources for the remainder,
    // instead of assuming the cheapest price applies to an unlimited amount.
    const result = market.purchase(targetItemId, targetQuantity);

    // Multiple purchase steps can reference the same underlying source (each exchange offer
    // purchase is simulated one at a time), so merge them back into a single row per source.
    const order = [];
    const bySourceId = new Map();
    for (const step of result.steps) {
        const id = step.source.id;
        if (!bySourceId.has(id)) {
            bySourceId.set(id, { source: step.source, purchases: 0, unitsGained: 0, cost: 0 });
            order.push(id);
        }
        const entry = bySourceId.get(id);
        entry.purchases += step.purchases;
        entry.unitsGained += step.unitsGained;
        entry.cost += step.cost;
    }

    const plan = order.map((id) => {
        const { source, purchases, unitsGained, cost } = bySourceId.get(id);
        return {
            Source: source.name,
            Category: source.category || '-',
            Days: formatDays(source.availableDays),
            Purchases: purchases,
            'Units Gained': Number(unitsGained.toFixed(2)),
            'Cost (Banknotes)': Number(cost.toFixed(2)),
            'Banknotes/Unit': Number((cost / unitsGained).toFixed(2)),
        };
    });

    console.table(plan);

    if (result.remaining > 0) {
        console.log(
            `\nWarning: target quantity not fully reachable using known sources within purchase limits. Missing ~${result.remaining.toFixed(2)} unit(s).`,
        );
    }
    console.log(`Total estimated cost: ${result.totalCost.toFixed(2)} Banknotes\n`);
}

function main() {
    const rawArgs = process.argv.slice(2);
    const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('-'));
    const [targetItemId, quantityArg] = positionalArgs;

    let days = null;
    for (const arg of rawArgs) {
        const daysMatch = arg.match(/^--days(?:=(.+))?$/i);
        if (daysMatch) {
            const parsed = parseDays(daysMatch[1]);
            if (parsed !== null) {
                days = parsed;
            }
        }
    }

    days = days ?? parseDays(process.env.DAYS) ?? 1;

    if (!targetItemId) {
        console.error('Usage: node scripts/analyze-item-value.js <item_id> [target_quantity] [options]');
        console.error(
            '  --days=N (default 1)   How many days you plan to buy over; scales daily/weekly limits accordingly.',
        );
        console.error(
            'Note: when running via "npm run analyze-item-value", add "--" before dashed flags, e.g.:\n' +
                '  npm run analyze-item-value -- <item_id> [target_quantity] --days=3',
        );
        console.error(
            'Alternative: set the DAYS environment variable instead, e.g.:\n' +
                '  DAYS=3 npm run analyze-item-value <item_id> [target_quantity]',
        );
        process.exit(1);
    }

    const data = loadData();
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = data.exchange_shops || {};

    if (!items[targetItemId]) {
        console.error(`Unknown item id "${targetItemId}". Check data/pack_data.json for valid item ids.`);
        process.exit(1);
    }

    const limitOptions = { days };
    console.log(`Limit options: days=${days}`);

    const market = createMarket(packages, exchangeShops, items, limitOptions);

    const packageSources = collectPackageSources(targetItemId, packages, items, limitOptions);
    const exchangeSources = collectExchangeSources(
        targetItemId,
        exchangeShops,
        items,
        market.peekUnitCost,
        limitOptions,
    );

    const allSources = [...packageSources, ...exchangeSources]
        .filter((s) => Number.isFinite(s.pricePerUnit))
        .sort((a, b) => a.pricePerUnit - b.pricePerUnit);

    console.log(`\nPurchase options for "${items[targetItemId].name.en}" (${targetItemId}):\n`);

    if (allSources.length === 0) {
        console.log('No purchasable sources found for this item.');
        return;
    }

    printSourceTable(allSources);

    console.log(
        '\nNote: exchange shop prices are converted to Banknotes using the cheapest known source for their currency item.',
    );
    if (days > 1) {
        console.log(`Purchase limit override active: days=${days} (exclusive and event limits are never exceeded).`);
    }

    const targetQuantity = quantityArg ? Number(quantityArg) : null;
    if (targetQuantity && targetQuantity > 0) {
        printPurchasePlan(market, targetItemId, targetQuantity);
    } else {
        console.log('\nTip: pass a target quantity as a second argument to get a suggested purchase plan, e.g.:');
        console.log(`  node scripts/analyze-item-value.js ${targetItemId} 50`);
        console.log('     Add --days=N to change purchase limit assumptions.');
        console.log(
            '     Via npm, add "--" before dashed flags, e.g.:\n' +
                `       npm run analyze-item-value -- ${targetItemId} 50 --days=3`,
        );
        console.log(
            '     Alternative for npm without "--": set the DAYS environment variable, e.g.:\n' +
                `       DAYS=3 npm run analyze-item-value ${targetItemId} 50`,
        );
    }
}

main();
