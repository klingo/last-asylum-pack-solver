const {
    loadData,
    buildItemCostResolver,
    collectPackageSources,
    collectExchangeSources,
    formatDays,
} = require('./lib/pricing');

/**
 * Analyzes every available purchase option (packages & exchange shop offers) that can
 * yield a given item, ranks them by effective Banknotes-per-unit price, and prints
 * a purchase plan for a target quantity if one is provided.
 *
 * Usage:
 *   node scripts/analyze-item-value.js <item_id> [target_quantity] [--ignore-limits[=level]]
 *   node scripts/analyze-item-value.js <item_id> [target_quantity] [ignore_limits_level]
 *
 * Limit Override Levels:
 *   0 / "false" / "none"    Respect all purchase limits (default).
 *   1 / "true" / "daily"    Exceed/ignore daily purchase limits only.
 *   2 / "weekly"            Exceed/ignore daily and weekly purchase limits.
 *   3 / "monthly"           Exceed/ignore daily, weekly, and monthly purchase limits.
 *   * Note: "exclusive" and "event" limits are NEVER exceeded under any level.
 *
 * Options:
 *   --ignore-limits (-i)        Exceed purchase limits up to the specified level (defaults to level 1 / daily).
 *                               Can also be passed as a plain (non-dashed) 3rd positional
 *                               argument, e.g. "true"/"daily"/"1", "weekly"/"2", or "monthly"/"3",
 *                               which is the recommended way when running via npm (see note below).
 *
 * Example:
 *   node scripts/analyze-item-value.js gear_blueprint_ur 50 --ignore-limits
 *   node scripts/analyze-item-value.js gear_blueprint_ur 50 --ignore-limits=weekly
 *
 * Note (npm): npm treats leading "--" flags (like --ignore-limits) as its own
 * options unless you add an extra "--" separator before the script arguments:
 *   npm run analyze-item-value -- gear_blueprint_ur 50 --ignore-limits
 *
 * To avoid needing "--" at all, pass the item_id and target_quantity as plain positional
 * arguments plus a plain 3rd positional argument (no leading dashes) for the limit override level;
 * npm forwards these the same way it forwards item_id and target_quantity:
 *   npm run analyze-item-value gear_blueprint_ur 50 true      # ignore daily limits
 *   npm run analyze-item-value gear_blueprint_ur 50 weekly    # ignore daily + weekly limits
 *   npm run analyze-item-value gear_blueprint_ur 50 monthly   # ignore daily + weekly + monthly limits
 *
 * Alternative: set the IGNORE_LIMITS environment variable instead:
 *   IGNORE_LIMITS=daily npm run analyze-item-value gear_blueprint_ur 50
 */

function parseIgnoreLevel(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const str = String(value).trim().toLowerCase();
    if (str === '0' || str === 'false' || str === 'none' || str === 'off' || str === 'no') {
        return 0;
    }
    if (str === '1' || str === 'true' || str === 'daily' || str === 'yes' || str === 'on') {
        return 1;
    }
    if (str === '2' || str === 'weekly') {
        return 2;
    }
    if (str === '3' || str === 'monthly' || str === 'month' || str === 'all') {
        return 3;
    }
    const num = Number(str);
    if (!Number.isNaN(num) && num >= 0) {
        return Math.min(Math.floor(num), 3);
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

function printPurchasePlan(sources, targetQuantity) {
    console.log(`\nOptimal purchase plan for ${targetQuantity} unit(s) (cheapest cost/unit first):`);

    // Ensure the plan is strictly ordered by effective Banknotes/unit, cheapest first,
    // so it's clear at a glance where it stops making sense to keep buying.
    const orderedSources = [...sources].sort((a, b) => a.pricePerUnit - b.pricePerUnit);

    let remaining = targetQuantity;
    let totalCost = 0;
    const plan = [];

    for (const source of orderedSources) {
        if (remaining <= 0) {
            break;
        }
        const availableUnits = Number.isFinite(source.purchaseCapacity)
            ? source.purchaseCapacity * source.yieldPerPurchase
            : Infinity;
        if (availableUnits <= 0) {
            continue;
        }
        const unitsFromSource = Math.min(remaining, availableUnits);
        const purchasesNeeded = Math.ceil(unitsFromSource / source.yieldPerPurchase);
        const actualUnits = purchasesNeeded * source.yieldPerPurchase;
        const cost = purchasesNeeded * source.price;

        plan.push({
            Source: source.name,
            Category: source.category || '-',
            Days: formatDays(source.availableDays),
            Purchases: purchasesNeeded,
            'Units Gained': Number(actualUnits.toFixed(2)),
            'Cost (Banknotes)': Number(cost.toFixed(2)),
            'Banknotes/Unit': Number.isFinite(source.pricePerUnit) ? Number(source.pricePerUnit.toFixed(2)) : 'N/A',
        });

        totalCost += cost;
        remaining -= actualUnits;
    }

    console.table(plan);

    if (remaining > 0) {
        console.log(
            `\nWarning: target quantity not fully reachable using known sources within purchase limits. Missing ~${remaining.toFixed(2)} unit(s).`,
        );
    }
    console.log(`Total estimated cost: ${totalCost.toFixed(2)} Banknotes\n`);
}

function main() {
    const rawArgs = process.argv.slice(2);
    const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('-'));
    const [targetItemId, quantityArg, ignoreLimitsArg] = positionalArgs;

    let flagLevel = null;
    for (const arg of rawArgs) {
        if (/^--ignore-daily-limits$/i.test(arg)) {
            flagLevel = Math.max(flagLevel ?? 0, 1);
        } else if (/^--ignore-weekly-limits$/i.test(arg)) {
            flagLevel = Math.max(flagLevel ?? 0, 2);
        } else if (/^--ignore-monthly-limits$/i.test(arg)) {
            flagLevel = Math.max(flagLevel ?? 0, 3);
        } else if (/^(?:--ignore-limits?|--ignore-purchase-limits?|-i)(?:=(.+))?$/i.test(arg)) {
            const match = arg.match(/^(?:--ignore-limits?|--ignore-purchase-limits?|-i)(?:=(.+))?$/i);
            const val = match && match[1] ? parseIgnoreLevel(match[1]) : 1;
            if (val !== null) {
                flagLevel = Math.max(flagLevel ?? 0, val);
            }
        }
    }

    const envLevel = parseIgnoreLevel(
        process.env.IGNORE_LIMITS || process.env.IGNORE_LIMITS_LEVEL || process.env.IGNORE_EVENT_LIMITS,
    );
    const positionalLevel = parseIgnoreLevel(ignoreLimitsArg);

    const ignoreLevel = positionalLevel ?? flagLevel ?? envLevel ?? 0;

    if (!targetItemId) {
        console.error(
            'Usage: node scripts/analyze-item-value.js <item_id> [target_quantity] [ignore_limits_level|--ignore-limits[=level]]',
        );
        console.error(
            'Note: when running via "npm run analyze-item-value", plain (non-dashed) positional arguments ' +
                'are always forwarded, so you can pass "true"/"daily", "weekly", or "monthly" as the 3rd argument, e.g.:',
        );
        console.error(
            '  npm run analyze-item-value <item_id> [target_quantity] true      # level 1: ignore daily limits',
        );
        console.error(
            '  npm run analyze-item-value <item_id> [target_quantity] weekly    # level 2: ignore daily + weekly limits',
        );
        console.error(
            '  npm run analyze-item-value <item_id> [target_quantity] monthly   # level 3: ignore daily + weekly + monthly limits',
        );
        console.error(
            'If you prefer the --ignore-limits flag via npm, add "--" before the arguments, e.g.:\n' +
                '  npm run analyze-item-value -- <item_id> [target_quantity] --ignore-limits=weekly',
        );
        console.error(
            'Alternative: set the IGNORE_LIMITS environment variable instead, e.g.:\n' +
                '  IGNORE_LIMITS=daily npm run analyze-item-value <item_id> [target_quantity]',
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

    console.log(`ignoreLevel=${ignoreLevel}`);

    const getItemCost = buildItemCostResolver(packages, exchangeShops, items);

    const packageSources = collectPackageSources(targetItemId, packages, items, ignoreLevel);
    const exchangeSources = collectExchangeSources(targetItemId, exchangeShops, items, getItemCost, ignoreLevel);

    const allSources = [...packageSources, ...exchangeSources]
        .filter((s) => Number.isFinite(s.pricePerUnit))
        .sort((a, b) => a.pricePerUnit - b.pricePerUnit);

    console.log(`\nPurchase options for "${items[targetItemId].name}" (${targetItemId}):\n`);

    if (allSources.length === 0) {
        console.log('No purchasable sources found for this item.');
        return;
    }

    printSourceTable(allSources);

    console.log(
        '\nNote: exchange shop prices are converted to Banknotes using the cheapest known source for their currency item.',
    );
    if (ignoreLevel === 1) {
        console.log(
            'Purchase limit override active (level 1 / daily): daily limits are treated as unlimited (weekly, monthly, exclusive, and event limits are respected).',
        );
    } else if (ignoreLevel === 2) {
        console.log(
            'Purchase limit override active (level 2 / weekly): daily and weekly limits are treated as unlimited (monthly, exclusive, and event limits are respected).',
        );
    } else if (ignoreLevel >= 3) {
        console.log(
            'Purchase limit override active (level 3 / monthly): daily, weekly, and monthly limits are treated as unlimited (exclusive and event limits are never exceeded).',
        );
    }

    const targetQuantity = quantityArg ? Number(quantityArg) : null;
    if (targetQuantity && targetQuantity > 0) {
        printPurchasePlan(allSources, targetQuantity);
    } else {
        console.log('\nTip: pass a target quantity as a second argument to get a suggested purchase plan, e.g.:');
        console.log(`  node scripts/analyze-item-value.js ${targetItemId} 50`);
        console.log(
            '     Add limit override level (1/daily, 2/weekly, 3/monthly) to treat limits as unlimited up to that level.',
        );
        console.log(
            '     Via npm, the easiest way is a plain 3rd argument (no "--" needed), e.g.:\n' +
                `       npm run analyze-item-value ${targetItemId} 50 true      # daily\n` +
                `       npm run analyze-item-value ${targetItemId} 50 weekly    # daily + weekly\n` +
                `       npm run analyze-item-value ${targetItemId} 50 monthly   # daily + weekly + monthly`,
        );
        console.log(
            '     If you prefer the --ignore-limits flag via npm, add "--" before the arguments, e.g.:\n' +
                `       npm run analyze-item-value -- ${targetItemId} 50 --ignore-limits=weekly`,
        );
        console.log(
            '     Alternative for npm without "--": set the IGNORE_LIMITS environment variable, e.g.:\n' +
                `       IGNORE_LIMITS=weekly npm run analyze-item-value ${targetItemId} 50`,
        );
    }
}

main();
