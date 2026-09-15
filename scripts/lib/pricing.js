const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'pack_data.json');

/**
 * Shared pricing/yield resolution helpers used by the value-analysis scripts
 * (analyze-item-value.js, build-item-value-index.js, rank-packages.js).
 *
 * These functions resolve how many units of a target item can be obtained from
 * a package/item/exchange offer, recursively unwrapping "contains", "choice",
 * "substitutes_for" (wildcard) and "drop_table" (random) structures, and can
 * find the cheapest Banknotes cost to obtain a single unit of any item.
 */

function loadData(dataPath = DATA_PATH) {
    if (!fs.existsSync(dataPath)) {
        console.error(`Data file not found at ${dataPath}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
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

function resolveYieldFromSubstitutes(substitutesFor, targetId, visited, items) {
    if (!substitutesFor) {
        return 0;
    }
    let best = 0;
    if (Array.isArray(substitutesFor)) {
        for (const subId of substitutesFor) {
            const y = rawYield(subId, targetId, visited, items);
            if (y > best) {
                best = y;
            }
        }
    } else if (typeof substitutesFor === 'object') {
        for (const [subId, qty] of Object.entries(substitutesFor)) {
            const y = Number(qty) * rawYield(subId, targetId, visited, items);
            if (y > best) {
                best = y;
            }
        }
    }
    return best;
}

/**
 * Returns how many units of `targetId` are obtained from a single unit of `itemId`,
 * recursively resolving nested "contains", "choice", "substitutes_for" (wildcard) and
 * "drop_table" (random) structures.
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
    if (item.substitutes_for) {
        total += resolveYieldFromSubstitutes(item.substitutes_for, targetId, visited, items);
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

/**
 * Cheapest Banknotes cost to obtain a single unit of `itemId`, considering direct
 * packages and (recursively) exchange shop offers paid for with other items.
 * Purchase limits are intentionally ignored here: this resolves the theoretical
 * cheapest per-unit market price of an item, independent of how many can actually
 * be bought.
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
            for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
                const offerItemId = offer.item_id || offerKey;
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

/**
 * Determines whether a purchase limit of the given type should be ignored based on the override level:
 * - Level 0: None (respect all limits)
 * - Level 1: Exceed daily limits only
 * - Level 2: Exceed daily + weekly limits
 * - Level 3: Exceed daily + weekly + monthly limits
 * "exclusive" and "event" limits are NEVER exceeded under any level.
 */
function shouldIgnoreLimit(limitType, ignoreLevel) {
    if (limitType === 'exclusive' || limitType === 'event') {
        return false;
    }
    if (ignoreLevel >= 1 && limitType === 'daily') {
        return true;
    }
    if (ignoreLevel >= 2 && limitType === 'weekly') {
        return true;
    }
    if (ignoreLevel >= 3 && limitType === 'monthly') {
        return true;
    }
    return false;
}

function collectPackageSources(targetId, packages, items, ignoreLevel = 0) {
    const sources = [];
    for (const [pkgId, pkg] of Object.entries(packages)) {
        const y = packageYield(pkg, targetId, items);
        if (y <= 0) {
            continue;
        }
        const limitIgnored = shouldIgnoreLimit(pkg.limit_type, ignoreLevel);
        sources.push({
            type: 'package',
            id: pkgId,
            name: pkg.name,
            category: pkg.category || '-',
            price: pkg.price,
            yieldPerPurchase: y,
            pricePerUnit: pkg.price / y,
            purchaseLimit: pkg.purchase_limit,
            limitType: pkg.limit_type,
            availableDays: pkg.available_days || null,
            requires: pkg.requires || null,
            limitIgnored,
            purchaseCapacity: limitIgnored || pkg.purchase_limit == null ? Infinity : pkg.purchase_limit,
        });
    }
    return sources;
}

function collectExchangeSources(targetId, exchangeShops, items, getItemCost, ignoreLevel = 0) {
    const sources = [];
    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            const y = offer.quantity * rawYield(offerItemId, targetId, new Set(), items);
            if (y <= 0) {
                continue;
            }
            const currencyUnitCost = getItemCost(shop.currency_item_id);
            const totalPrice = offer.currency_cost * currencyUnitCost;
            const limitIgnored = shouldIgnoreLimit(offer.limit_type, ignoreLevel);
            sources.push({
                type: 'exchange',
                id: `${shopId}:${offerKey}`,
                name: `${shop.name} - ${items[offerItemId]?.name || offerItemId}`,
                category: shop.category || (shop.event_id ? 'Event Exchange' : 'Exchange'),
                price: totalPrice,
                priceDisplay: `${offer.currency_cost} ${items[shop.currency_item_id]?.name || shop.currency_item_id} (~${totalPrice.toFixed(2)} Banknotes)`,
                yieldPerPurchase: y,
                pricePerUnit: Number.isFinite(totalPrice) ? totalPrice / y : Infinity,
                purchaseLimit: offer.purchase_limit,
                limitType: offer.limit_type,
                availableDays: null,
                requires: null,
                limitIgnored,
                purchaseCapacity: limitIgnored || offer.purchase_limit == null ? Infinity : offer.purchase_limit,
            });
        }
    }
    return sources;
}

function formatDays(availableDays) {
    return availableDays ? availableDays.join(', ') : 'any day';
}

module.exports = {
    DATA_PATH,
    loadData,
    resolveYieldFromContains,
    resolveYieldFromChoice,
    resolveYieldFromSubstitutes,
    rawYield,
    packageYield,
    buildItemCostResolver,
    shouldIgnoreLimit,
    collectPackageSources,
    collectExchangeSources,
    formatDays,
};
