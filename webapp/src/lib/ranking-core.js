/**
 * Browser-safe port of scripts/build-item-value-index.js + scripts/rank-packages.js,
 * computed live from the raw pack data (no pre-generated output/*.json files involved).
 * Ranks every package AND every exchange shop offer (including bonus tiers) by how much
 * value they provide relative to their price, using each item's cheapest known Banknotes
 * cost (see lib/pricing-core.js `createMarket`).
 *
 * "Value" of a purchase option is the sum of (quantity * item.unit_cost) for every item it
 * contains. For "choice" blocks (pick N of several options), the best N choices are assumed,
 * matching the optimistic approach the item-analysis page already uses for yield
 * calculations. "value_ratio" (value / price) is the ranking metric: options that return
 * more value per Banknote spent rank higher, i.e. they are the best deals to prioritize
 * buying. Purchase limits are intentionally ignored for this "unit cost" (a fresh market is
 * peeked, never purchased from), since it represents the theoretical cheapest market price
 * of an item, independent of how many can actually be bought; if the item has no known
 * purchasable source, "unit_cost" stays null and the ranking entry is marked incomplete.
 */

import { createMarket } from './pricing-core';

function getUnitCost(market, itemId) {
    const cost = market.peekUnitCost(itemId);
    return Number.isFinite(cost) ? cost : null;
}

function valueOfContains(containsObj, market, items) {
    let total = 0;
    let complete = true;
    const breakdown = [];

    for (const [itemId, qty] of Object.entries(containsObj || {})) {
        const unitCost = getUnitCost(market, itemId);
        if (unitCost === null) {
            complete = false;
        }
        const value = qty * (unitCost ?? 0);
        total += value;
        breakdown.push({
            item_id: itemId,
            name: items[itemId]?.name || itemId,
            quantity: qty,
            unit_cost: unitCost,
            value: unitCost !== null ? Number(value.toFixed(6)) : 0,
        });
    }

    return { total, complete, breakdown };
}

function valueOfChoice(choiceObj, market, items) {
    if (!choiceObj || !Array.isArray(choiceObj.choices) || choiceObj.choices.length === 0) {
        return { total: 0, complete: true, breakdown: [] };
    }

    const selectCount = choiceObj.select_count || 1;
    const evaluatedChoices = choiceObj.choices.map((choiceEntry) => valueOfContains(choiceEntry, market, items));

    const bestChoices = [...evaluatedChoices].sort((a, b) => b.total - a.total).slice(0, selectCount);

    let total = 0;
    let complete = true;
    const breakdown = [];
    for (const choice of bestChoices) {
        total += choice.total;
        if (!choice.complete) {
            complete = false;
        }
        breakdown.push(...choice.breakdown);
    }

    return { total, complete, breakdown };
}

function valueOfPackage(pkg, market, items) {
    const containsResult = valueOfContains(pkg.contains, market, items);
    const choiceResult = valueOfChoice(pkg.choice, market, items);

    return {
        total: containsResult.total + choiceResult.total,
        complete: containsResult.complete && choiceResult.complete,
        breakdown: [...containsResult.breakdown, ...choiceResult.breakdown],
    };
}

function rankPackages(packages, market, items) {
    const rankings = [];

    for (const [pkgId, pkg] of Object.entries(packages)) {
        const { total, complete, breakdown } = valueOfPackage(pkg, market, items);
        const price = pkg.price;
        if (!Number.isFinite(price) || price <= 0) {
            continue;
        }

        rankings.push({
            type: 'package',
            id: pkgId,
            name: pkg.name,
            category: pkg.category || '-',
            price,
            price_display: `${price} Banknotes`,
            total_value: Number(total.toFixed(2)),
            value_ratio: Number((total / price).toFixed(4)),
            purchase_limit: pkg.purchase_limit,
            limit_type: pkg.limit_type,
            available_days: pkg.available_days || null,
            requires: pkg.requires || null,
            value_complete: complete,
            contains_breakdown: breakdown,
        });
    }

    return rankings;
}

function rankExchangeOffers(exchangeShops, market, items) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(market, shop.currency_item_id);

        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            const unitCost = getUnitCost(market, offerItemId);

            const totalValue = offer.quantity * (unitCost ?? 0);
            const price = offer.currency_cost * (currencyUnitCost ?? NaN);
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            rankings.push({
                type: 'exchange_offer',
                id: `${shopId}:${offerKey}`,
                name: `${shop.name} - ${items[offerItemId]?.name || offerItemId}`,
                category: shop.category || (shop.event_id ? 'Event Exchange' : 'Exchange'),
                price: Number(price.toFixed(6)),
                price_display: `${offer.currency_cost} ${items[shop.currency_item_id]?.name || shop.currency_item_id} (~${price.toFixed(2)} Banknotes)`,
                total_value: Number(totalValue.toFixed(2)),
                value_ratio: Number((totalValue / price).toFixed(4)),
                purchase_limit: offer.purchase_limit,
                limit_type: offer.limit_type,
                available_days: null,
                requires: null,
                value_complete: unitCost !== null && currencyUnitCost !== null,
                contains_breakdown: [
                    {
                        item_id: offerItemId,
                        name: items[offerItemId]?.name || offerItemId,
                        quantity: offer.quantity,
                        unit_cost: unitCost,
                        value: unitCost !== null ? Number(totalValue.toFixed(6)) : 0,
                    },
                ],
            });
        }
    }

    return rankings;
}

function rankBonusTiers(exchangeShops, market, items) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(market, shop.currency_item_id);

        for (const [thresholdStr, contains] of Object.entries(shop.bonus_tiers || {})) {
            const threshold = Number(thresholdStr);
            if (!Number.isFinite(threshold) || threshold <= 0) {
                continue;
            }

            const { total, complete, breakdown } = valueOfContains(contains, market, items);
            const price = threshold * (currencyUnitCost ?? NaN);
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            rankings.push({
                type: 'bonus_tier',
                id: `${shopId}:bonus_tier_${thresholdStr}`,
                name: `${shop.name} - Bonus Tier (${thresholdStr} ${items[shop.currency_item_id]?.name || shop.currency_item_id})`,
                category: shop.category || (shop.event_id ? 'Event Exchange' : 'Exchange'),
                price: Number(price.toFixed(6)),
                price_display: `${thresholdStr} ${items[shop.currency_item_id]?.name || shop.currency_item_id} spent (~${price.toFixed(2)} Banknotes)`,
                total_value: Number(total.toFixed(2)),
                value_ratio: Number((total / price).toFixed(4)),
                purchase_limit: 1,
                limit_type: 'cumulative_spend',
                available_days: null,
                requires: null,
                value_complete: complete && currencyUnitCost !== null,
                contains_breakdown: breakdown,
            });
        }
    }

    return rankings;
}

/**
 * Builds the full live ranking of packages/exchange offers/bonus tiers from raw pack data.
 * Mirrors the shape of the (now retired) output/value_ranking.json for a drop-in swap.
 */
function buildRanking(data) {
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = data.exchange_shops || {};
    const market = createMarket(packages, exchangeShops, items, 0);

    const rankings = [
        ...rankPackages(packages, market, items),
        ...rankExchangeOffers(exchangeShops, market, items),
        ...rankBonusTiers(exchangeShops, market, items),
    ]
        .filter((entry) => Number.isFinite(entry.value_ratio))
        .sort((a, b) => b.value_ratio - a.value_ratio)
        .map((entry, index) => ({ rank: index + 1, ...entry }));

    return {
        metadata: {
            generated_at: new Date().toISOString(),
            source_last_updated: data.metadata?.last_updated || null,
            currency: data.metadata?.currency || 'Banknotes',
            entry_count: rankings.length,
            note: 'value_ratio = total_value / price. Higher value_ratio means more relative value for the Banknotes spent; entries with value_complete=false contain at least one item with no known purchasable source, so total_value is a lower-bound estimate. Computed live in your browser from the current pack data.',
        },
        rankings,
    };
}

export { buildRanking };
