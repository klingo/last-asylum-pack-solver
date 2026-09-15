/**
 * Browser-safe port of the pure pricing/yield resolution helpers from scripts/lib/pricing.js.
 * Kept free of any Node.js dependency (no "fs"/"path") so it can run in the webapp.
 * If the logic in scripts/lib/pricing.js changes, mirror the change here too.
 */

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

const DEFAULT_MAX_PURCHASE_ITERATIONS = 5000;
const MAX_MARKET_RECURSION_DEPTH = 64;

/**
 * Creates a "market" that tracks, for a single what-if calculation, how much purchase
 * capacity (daily/weekly/monthly/etc. limits) remains for every package and every exchange
 * offer. This is essential because currency needed for exchange offers (e.g. "Strange
 * Coins") is itself often limited: once its cheapest source is exhausted, buying more of it
 * has to fall back to pricier packages/offers, which in turn changes the effective price of
 * anything bought with that currency. A market instance is meant to be used for a single
 * purchase-plan calculation; capacity consumed via `purchase()` is shared across every
 * nested currency purchase, so the whole calculation stays internally consistent.
 *
 * `peekUnitCost(itemId)` returns the cheapest price for the *next* unit of `itemId` given
 * the market's current (possibly already partially consumed) capacities, without spending
 * anything. `purchase(itemId, quantity)` actually spends capacity/Banknotes to acquire up to
 * `quantity` units, recursively buying whatever currency is required along the way, and
 * returns the resulting cost/steps.
 */
function createMarket(packages, exchangeShops, items, ignoreLevel = 0, options = {}) {
    const maxIterations = options.maxIterations || DEFAULT_MAX_PURCHASE_ITERATIONS;
    const ledger = new Map();

    function packageLedgerKey(pkgId) {
        return `package:${pkgId}`;
    }

    function offerLedgerKey(shopId, offerKey) {
        return `exchange:${shopId}:${offerKey}`;
    }

    function packageCapacity(pkgId, pkg) {
        const key = packageLedgerKey(pkgId);
        if (!ledger.has(key)) {
            const limitIgnored = shouldIgnoreLimit(pkg.limit_type, ignoreLevel);
            ledger.set(key, limitIgnored || pkg.purchase_limit == null ? Infinity : pkg.purchase_limit);
        }
        return ledger.get(key);
    }

    function offerCapacity(shopId, offerKey, offer) {
        const key = offerLedgerKey(shopId, offerKey);
        if (!ledger.has(key)) {
            const limitIgnored = shouldIgnoreLimit(offer.limit_type, ignoreLevel);
            ledger.set(key, limitIgnored || offer.purchase_limit == null ? Infinity : offer.purchase_limit);
        }
        return ledger.get(key);
    }

    // Cheapest price for the *next* unit of `itemId`, given currently remaining capacities.
    // Never mutates the ledger, so it's safe to call at any time to inspect the current state.
    function peekUnitCost(itemId, visiting) {
        if (visiting.has(itemId)) {
            return Infinity; // cycle guard
        }
        visiting.add(itemId);
        let best = Infinity;

        for (const [pkgId, pkg] of Object.entries(packages)) {
            if (packageCapacity(pkgId, pkg) <= 0) {
                continue;
            }
            const y = packageYield(pkg, itemId, items);
            if (y > 0) {
                best = Math.min(best, pkg.price / y);
            }
        }

        for (const [shopId, shop] of Object.entries(exchangeShops)) {
            for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
                if (offerCapacity(shopId, offerKey, offer) <= 0) {
                    continue;
                }
                const offerItemId = offer.item_id || offerKey;
                const y = offer.quantity * rawYield(offerItemId, itemId, new Set(), items);
                if (y <= 0) {
                    continue;
                }
                const currencyCost = peekUnitCost(shop.currency_item_id, visiting);
                if (Number.isFinite(currencyCost)) {
                    best = Math.min(best, (offer.currency_cost * currencyCost) / y);
                }
            }
        }

        visiting.delete(itemId);
        return best;
    }

    // Finds the single cheapest still-available source (package or exchange offer) for the
    // next unit of `itemId`, based on the current ledger state. `shopFilter` (a Set of shop
    // ids, or null/undefined for "any shop") restricts which exchange shops may directly
    // sell `itemId`; it is only meant to be applied at the outermost call of a purchase (see
    // `purchase()`), never to the recursive currency lookups, so an "active shop" filter on
    // the target item never restricts which shops its currency can come from.
    function findCheapestSource(itemId, shopFilter) {
        let best = null;

        for (const [pkgId, pkg] of Object.entries(packages)) {
            const capacity = packageCapacity(pkgId, pkg);
            if (capacity <= 0) {
                continue;
            }
            const y = packageYield(pkg, itemId, items);
            if (y <= 0) {
                continue;
            }
            const pricePerUnit = pkg.price / y;
            if (!best || pricePerUnit < best.pricePerUnit) {
                best = { kind: 'package', pkgId, pkg, yieldPerPurchase: y, pricePerUnit, capacity };
            }
        }

        for (const [shopId, shop] of Object.entries(exchangeShops)) {
            if (shopFilter && !shopFilter.has(shopId)) {
                continue;
            }
            for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
                const capacity = offerCapacity(shopId, offerKey, offer);
                if (capacity <= 0) {
                    continue;
                }
                const offerItemId = offer.item_id || offerKey;
                const y = offer.quantity * rawYield(offerItemId, itemId, new Set(), items);
                if (y <= 0) {
                    continue;
                }
                const currencyUnitCost = peekUnitCost(shop.currency_item_id, new Set());
                if (!Number.isFinite(currencyUnitCost)) {
                    continue;
                }
                const pricePerUnit = (offer.currency_cost * currencyUnitCost) / y;
                if (!best || pricePerUnit < best.pricePerUnit) {
                    best = {
                        kind: 'exchange',
                        shopId,
                        shop,
                        offerKey,
                        offer,
                        offerItemId,
                        yieldPerPurchase: y,
                        pricePerUnit,
                        capacity,
                        currencyItemId: shop.currency_item_id,
                        currencyCostPerPurchase: offer.currency_cost,
                    };
                }
            }
        }

        return best;
    }

    function describeSource(best) {
        if (best.kind === 'package') {
            return {
                type: 'package',
                id: best.pkgId,
                name: best.pkg.name,
                category: best.pkg.category || '-',
                availableDays: best.pkg.available_days || null,
                requires: best.pkg.requires || null,
            };
        }
        return {
            type: 'exchange',
            id: `${best.shopId}:${best.offerKey}`,
            name: `${best.shop.name} - ${items[best.offerItemId]?.name || best.offerItemId}`,
            category: best.shop.category || (best.shop.event_id ? 'Event Exchange' : 'Exchange'),
            availableDays: null,
            requires: null,
        };
    }

    // Actually spends capacity/Banknotes to acquire up to `quantity` units of `itemId`,
    // always picking the currently cheapest available source, and recursively buying
    // whatever currency an exchange offer needs (sharing the same ledger, so limited
    // currency sources really do run out and force pricier fallbacks). `shopFilter` (only
    // meaningful at the outermost call, i.e. `depth === 0`) restricts which exchange shops
    // may directly sell `itemId`; nested currency purchases are never restricted by it.
    function purchase(itemId, quantity, depth, shopFilter) {
        let remaining = quantity;
        let totalCost = 0;
        const steps = [];
        let iterations = 0;

        if (depth > MAX_MARKET_RECURSION_DEPTH) {
            return { totalCost: 0, obtained: 0, remaining: quantity, steps, incomplete: true };
        }

        while (remaining > 1e-9 && iterations < maxIterations) {
            iterations++;
            const best = findCheapestSource(itemId, depth === 0 ? shopFilter : null);
            if (!best) {
                break;
            }

            if (best.kind === 'package') {
                const maxUnits = best.capacity * best.yieldPerPurchase;
                const unitsToBuy = Math.min(remaining, maxUnits);
                const purchases = Math.ceil(unitsToBuy / best.yieldPerPurchase - 1e-9);
                const actualUnits = purchases * best.yieldPerPurchase;
                const cost = purchases * best.pkg.price;

                const key = packageLedgerKey(best.pkgId);
                ledger.set(key, ledger.get(key) - purchases);
                steps.push({
                    source: describeSource(best),
                    purchases,
                    unitsGained: actualUnits,
                    cost,
                    pricePerUnit: best.pricePerUnit,
                });
                totalCost += cost;
                remaining -= actualUnits;
                continue;
            }

            // Exchange offer: buy exactly one purchase at a time, verifying the currency is
            // actually affordable at the current shared ledger state before committing (it
            // may itself require drawing down other limited packages/offers).
            const ledgerSnapshot = new Map(ledger);
            const currencyResult = purchase(best.currencyItemId, best.currencyCostPerPurchase, depth + 1, null);

            if (currencyResult.remaining > 1e-9) {
                // Not fully affordable: roll back any partial currency spend and mark this
                // offer as exhausted so it isn't retried forever.
                ledger.clear();
                for (const [key, value] of ledgerSnapshot) {
                    ledger.set(key, value);
                }
                ledger.set(offerLedgerKey(best.shopId, best.offerKey), 0);
                continue;
            }

            const offerKeyName = offerLedgerKey(best.shopId, best.offerKey);
            ledger.set(offerKeyName, ledger.get(offerKeyName) - 1);
            const unitsGained = best.yieldPerPurchase;
            steps.push({
                source: describeSource(best),
                purchases: 1,
                unitsGained,
                cost: currencyResult.totalCost,
                pricePerUnit: currencyResult.totalCost / unitsGained,
            });
            totalCost += currencyResult.totalCost;
            remaining -= unitsGained;
        }

        return {
            totalCost,
            obtained: quantity - Math.max(remaining, 0),
            remaining: Math.max(remaining, 0),
            steps,
            incomplete: remaining > 1e-9,
        };
    }

    return {
        peekUnitCost: (itemId) => peekUnitCost(itemId, new Set()),
        purchase: (itemId, quantity, shopFilter = null) => purchase(itemId, quantity, 0, shopFilter),
    };
}

/**
 * Cheapest Banknotes cost to obtain a single unit of `itemId`, considering direct
 * packages and (recursively) exchange shop offers paid for with other items, on a fresh
 * (nothing-yet-purchased) market. This mirrors the "theoretical cheapest first unit price"
 * that used to be computed by a dedicated resolver; kept as a thin convenience wrapper
 * around `createMarket()` for callers that only need a one-off snapshot cost (e.g. ranking).
 */
function buildItemCostResolver(packages, exchangeShops, items) {
    const market = createMarket(packages, exchangeShops, items, 0);
    return (itemId) => market.peekUnitCost(itemId);
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
                itemId: offerItemId,
            });
        }
    }
    return sources;
}

function formatDays(availableDays) {
    return availableDays ? availableDays.join(', ') : 'any day';
}

export {
    resolveYieldFromContains,
    resolveYieldFromChoice,
    resolveYieldFromSubstitutes,
    rawYield,
    packageYield,
    createMarket,
    buildItemCostResolver,
    shouldIgnoreLimit,
    collectPackageSources,
    collectExchangeSources,
    formatDays,
};
