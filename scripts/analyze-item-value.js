const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'pack_data.json');

const DAYS_IN_WEEK = 7;

/**
 * Analyzes every available purchase option (packages & exchange shop offers) that can
 * yield a given item, ranks them by effective Banknotes-per-unit price, and prints
 * a purchase plan for a target quantity if one is provided.
 *
 * Usage:
 *   node scripts/analyze-item-value.js <item_id> [target_quantity] [--ignore-event-limits]
 *   node scripts/analyze-item-value.js <item_id> [target_quantity] [ignore_event_limits]
 *
 * Options:
 *   --ignore-event-limits (-e)  Treat the purchase_limit of packages that yield event
 *                               currencies (category "Event" / event_id set) as unlimited,
 *                               since such events typically run across multiple days/weeks
 *                               and can effectively be re-bought. Can also be passed as a
 *                               plain (non-dashed) 3rd positional argument, e.g. "true"/"1"/
 *                               "yes", which is the recommended way when running via npm
 *                               (see note below).
 *
 * Example:
 *   node scripts/analyze-item-value.js gear_blueprint_ur 50 --ignore-event-limits
 *
 * Note (npm): npm treats leading "--" flags (like --ignore-event-limits) as its own
 * options unless you add an extra "--" separator before the script arguments:
 *   npm run analyze-item-value -- gear_blueprint_ur 50 --ignore-event-limits
 *
 * To avoid needing "--" at all, pass the item_id and target_quantity as plain positional
 * arguments (exactly like today) plus a plain 3rd positional argument (no leading dashes)
 * to enable the event-limit override; npm forwards these the same way it forwards item_id
 * and target_quantity:
 *   npm run analyze-item-value gear_blueprint_ur 50 true
 *
 * Alternative: set the IGNORE_EVENT_LIMITS environment variable instead, since environment
 * variables are always forwarded by npm regardless of the "--" separator:
 *   IGNORE_EVENT_LIMITS=true npm run analyze-item-value gear_blueprint_ur 50
 */

function loadData() {
    if (!fs.existsSync(DATA_PATH)) {
        console.error(`Data file not found at ${DATA_PATH}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function resolveYieldFromContains(containsObj, targetId, visited, items) {
    let total = 0;
    for (const [subId, qty] of Object.entries(containsObj)) {
        total += qty * rawYield(subId, targetId, visited, items);
    }
    return total;
}

function resolveYieldFromChoice(choiceObj, targetId, visited, items) {
    if (!choiceObj || !Array.isArray(choiceObj.choices) || choiceObj.choices.length === 0) {
        return 0;
    }
    // We only ever need to occupy a single selection slot to obtain the target item,
    // so the best case is the highest-yielding choice that contains it.
    let best = 0;
    for (const choiceEntry of choiceObj.choices) {
        for (const [subId, qty] of Object.entries(choiceEntry)) {
            const y = qty * rawYield(subId, targetId, visited, items);
            if (y > best) {
                best = y;
            }
        }
    }
    return best;
}

/**
 * Returns how many units of `targetId` are obtained from a single unit of `itemId`,
 * recursively resolving nested "contains", "choice" and "drop_table" (random) structures.
 */
function rawYield(itemId, targetId, visited, items) {
    if (itemId === targetId) {
        return 1;
    }
    if (visited.has(itemId)) {
        return 0; // cycle guard
    }
    const item = items[itemId];
    if (!item) {
        return 0;
    }

    visited.add(itemId);
    let total = 0;

    if (item.contains) {
        total += resolveYieldFromContains(item.contains, targetId, visited, items);
    }
    if (item.choice) {
        total += resolveYieldFromChoice(item.choice, targetId, visited, items);
    }
    if (item.type === 'random' && Array.isArray(item.drop_table)) {
        for (const entry of item.drop_table) {
            if (entry.contains) {
                total +=
                    entry.probability * resolveYieldFromContains(entry.contains, targetId, new Set(visited), items);
            }
        }
    }

    visited.delete(itemId);
    return total;
}

/** Whether a package yields an event-bound currency (Event category or explicit event_id). */
function isEventPackage(pkg) {
    return Boolean(pkg.event_id) || pkg.category === 'Event';
}

function packageYield(pkg, targetId, items) {
    let y = 0;
    if (pkg.contains) {
        y += resolveYieldFromContains(pkg.contains, targetId, new Set(), items);
    }
    if (pkg.choice) {
        y += resolveYieldFromChoice(pkg.choice, targetId, new Set(), items);
    }
    return y;
}

/** Number of times per week a package/offer with the given limits can be bought. */
function weeklyCapacity(purchaseLimit, limitType, availableDays, ignoreLimit = false) {
    if (ignoreLimit || purchaseLimit == null) {
        return Infinity;
    }
    if (limitType === 'daily') {
        const days = Array.isArray(availableDays) && availableDays.length > 0 ? availableDays.length : DAYS_IN_WEEK;
        return purchaseLimit * days;
    }
    // weekly / monthly / exclusive are all treated as "available once in the target week"
    // in the best case scenario.
    return purchaseLimit;
}

/**
 * Cheapest Banknotes cost to obtain a single unit of `itemId`, considering direct
 * packages and (recursively) exchange shop offers paid for with other items.
 */
function buildItemCostResolver(packages, exchangeShops, items) {
    const cache = new Map();

    function itemCost(itemId, visiting) {
        if (cache.has(itemId)) {
            return cache.get(itemId);
        }
        if (visiting.has(itemId)) {
            return Infinity; // cycle guard
        }
        visiting.add(itemId);

        let best = Infinity;

        for (const pkg of Object.values(packages)) {
            const y = packageYield(pkg, itemId, items);
            if (y > 0) {
                best = Math.min(best, pkg.price / y);
            }
        }

        for (const shop of Object.values(exchangeShops)) {
            for (const [offerItemId, offer] of Object.entries(shop.offers || {})) {
                const y = offer.quantity * rawYield(offerItemId, itemId, new Set(), items);
                if (y <= 0) {
                    continue;
                }
                const currencyCost = itemCost(shop.currency_item_id, visiting);
                if (Number.isFinite(currencyCost)) {
                    best = Math.min(best, (offer.currency_cost * currencyCost) / y);
                }
            }
        }

        visiting.delete(itemId);
        cache.set(itemId, best);
        return best;
    }

    return (itemId) => itemCost(itemId, new Set());
}

function collectPackageSources(targetId, packages, items, ignoreEventLimits) {
    const sources = [];
    for (const [pkgId, pkg] of Object.entries(packages)) {
        const y = packageYield(pkg, targetId, items);
        if (y <= 0) {
            continue;
        }
        const limitIgnored = ignoreEventLimits && isEventPackage(pkg);
        sources.push({
            type: 'package',
            id: pkgId,
            name: pkg.name,
            price: pkg.price,
            yieldPerPurchase: y,
            pricePerUnit: pkg.price / y,
            purchaseLimit: pkg.purchase_limit,
            limitType: pkg.limit_type,
            availableDays: pkg.available_days || null,
            requires: pkg.requires || null,
            limitIgnored,
            weeklyCapacity: weeklyCapacity(pkg.purchase_limit, pkg.limit_type, pkg.available_days, limitIgnored),
        });
    }
    return sources;
}

function collectExchangeSources(targetId, exchangeShops, items, getItemCost) {
    const sources = [];
    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        for (const [offerItemId, offer] of Object.entries(shop.offers || {})) {
            const y = offer.quantity * rawYield(offerItemId, targetId, new Set(), items);
            if (y <= 0) {
                continue;
            }
            const currencyUnitCost = getItemCost(shop.currency_item_id);
            const totalPrice = offer.currency_cost * currencyUnitCost;
            sources.push({
                type: 'exchange',
                id: `${shopId}:${offerItemId}`,
                name: `${shop.name} - ${items[offerItemId]?.name || offerItemId}`,
                price: totalPrice,
                priceDisplay: `${offer.currency_cost} ${items[shop.currency_item_id]?.name || shop.currency_item_id} (~${totalPrice.toFixed(2)} Banknotes)`,
                yieldPerPurchase: y,
                pricePerUnit: Number.isFinite(totalPrice) ? totalPrice / y : Infinity,
                purchaseLimit: offer.purchase_limit,
                limitType: offer.limit_type,
                availableDays: null,
                requires: null,
                weeklyCapacity: weeklyCapacity(offer.purchase_limit, offer.limit_type, null),
            });
        }
    }
    return sources;
}

function formatDays(availableDays) {
    return availableDays ? availableDays.join(', ') : 'any day';
}

function printSourceTable(sources) {
    const rows = sources.map((s, index) => ({
        Rank: index + 1,
        Source: s.name,
        Type: s.type,
        'Price/Purchase': s.type === 'exchange' ? s.priceDisplay : s.price,
        'Yield/Purchase': Number(s.yieldPerPurchase.toFixed(4)),
        'Banknotes/Unit': Number.isFinite(s.pricePerUnit) ? Number(s.pricePerUnit.toFixed(2)) : 'N/A',
        'Weekly Cap (units)': Number.isFinite(s.weeklyCapacity)
            ? Number((s.weeklyCapacity * s.yieldPerPurchase).toFixed(2))
            : s.limitIgnored
              ? 'Unlimited (event)'
              : 'Unlimited',
        Days: formatDays(s.availableDays),
        Requires: s.requires || '-',
    }));
    console.table(rows);
}

function printPurchasePlan(sources, targetQuantity) {
    console.log(`\nOptimal purchase plan for ${targetQuantity} unit(s) (cheapest cost/unit first, 1-week horizon):`);

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
        const availableUnits = Number.isFinite(source.weeklyCapacity)
            ? source.weeklyCapacity * source.yieldPerPurchase
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
            `\nWarning: target quantity not fully reachable within a single week using known sources. Missing ~${remaining.toFixed(2)} unit(s).`,
        );
    }
    console.log(`Total estimated cost: ${totalCost.toFixed(2)} Banknotes\n`);
}

function main() {
    const rawArgs = process.argv.slice(2);
    const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('-'));
    const [targetItemId, quantityArg, ignoreEventLimitsArg] = positionalArgs;

    const envIgnoreEventLimits = /^(1|true|yes)$/i.test(process.env.IGNORE_EVENT_LIMITS || '');
    const positionalIgnoreEventLimits = /^(1|true|yes)$/i.test(ignoreEventLimitsArg || '');
    const ignoreEventLimits =
        envIgnoreEventLimits ||
        positionalIgnoreEventLimits ||
        rawArgs.some((arg) => arg === '--ignore-event-limits' || arg === '-e');

    if (!targetItemId) {
        console.error(
            'Usage: node scripts/analyze-item-value.js <item_id> [target_quantity] [ignore_event_limits|--ignore-event-limits]',
        );
        console.error(
            'Note: when running via "npm run analyze-item-value", plain (non-dashed) positional arguments ' +
                'are always forwarded, so you can pass "true" as the 3rd argument instead of the ' +
                '--ignore-event-limits flag, e.g.:',
        );
        console.error('  npm run analyze-item-value <item_id> [target_quantity] true');
        console.error(
            'If you prefer the --ignore-event-limits flag via npm, add "--" before the arguments, e.g.:\n' +
                '  npm run analyze-item-value -- <item_id> [target_quantity] --ignore-event-limits',
        );
        console.error(
            'Alternative: set the IGNORE_EVENT_LIMITS environment variable instead, e.g.:\n' +
                '  IGNORE_EVENT_LIMITS=true npm run analyze-item-value <item_id> [target_quantity]',
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

    console.log(`ignoreEventLimits=${ignoreEventLimits}`);

    const getItemCost = buildItemCostResolver(packages, exchangeShops, items);

    const packageSources = collectPackageSources(targetItemId, packages, items, ignoreEventLimits);
    const exchangeSources = collectExchangeSources(targetItemId, exchangeShops, items, getItemCost);

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
        '\nNote: exchange shop prices are converted to Banknotes using the cheapest known source for their currency item. ' +
            'Weekly caps assume a full week is available and ignore possible currency production caps.',
    );
    if (ignoreEventLimits) {
        console.log(
            'Event limit override active: purchase_limit is ignored for packages that yield event currencies ' +
                '(category "Event" or with an event_id), since such events typically run across multiple days/weeks.',
        );
    }

    const targetQuantity = quantityArg ? Number(quantityArg) : null;
    if (targetQuantity && targetQuantity > 0) {
        printPurchasePlan(allSources, targetQuantity);
    } else {
        console.log('\nTip: pass a target quantity as a second argument to get a suggested purchase plan, e.g.:');
        console.log(`  node scripts/analyze-item-value.js ${targetItemId} 50`);
        console.log('     Add --ignore-event-limits to treat event-currency package purchase limits as unlimited.');
        console.log(
            '     Via npm, the easiest way is a plain 3rd argument (no "--" needed), e.g.:\n' +
                `       npm run analyze-item-value ${targetItemId} 50 true`,
        );
        console.log(
            '     If you prefer the --ignore-event-limits flag via npm, add "--" before the arguments, e.g.:\n' +
                `       npm run analyze-item-value -- ${targetItemId} 50 --ignore-event-limits`,
        );
        console.log(
            '     Alternative for npm without "--": set the IGNORE_EVENT_LIMITS environment variable, e.g.:\n' +
                `       IGNORE_EVENT_LIMITS=true npm run analyze-item-value ${targetItemId} 50`,
        );
    }
}

main();
