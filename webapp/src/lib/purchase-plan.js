/**
 * Browser-safe purchase-plan builder, mirroring scripts/analyze-item-value.js.
 *
 * Unlike a flat per-unit-price sort, this simulates the purchase against a `market`
 * (see lib/pricing-core.js `createMarket`) so that limited currency sources (e.g. a
 * "100 Strange Coins for 499 Banknotes" offer capped at once per day) correctly run out
 * mid-plan and fall back to pricier sources for the remainder, instead of assuming the
 * cheapest price applies to an unlimited amount.
 */

/**
 * Builds a purchase plan for `targetQuantity` units of `targetItemId` using `market`
 * (a fresh `createMarket()` instance, already configured with the desired purchase-limit
 * override level). `shopFilter` (a Set of shop ids, or null for "any shop") restricts which
 * exchange shops may directly sell the target item; nested currency purchases are never
 * restricted by it. Returns structured data instead of printing a console.table so it can
 * be rendered in the UI.
 */
function buildPurchasePlan(market, targetItemId, targetQuantity, shopFilter = null) {
    const result = market.purchase(targetItemId, targetQuantity, shopFilter);

    // Multiple purchase "steps" can reference the same underlying source (each exchange
    // offer purchase is simulated one at a time), so merge them back into a single row per
    // source for a readable plan, in the order each source was first used.
    const order = [];
    const bySourceId = new Map();

    for (const step of result.steps) {
        const id = step.source.id;
        if (!bySourceId.has(id)) {
            bySourceId.set(id, {
                source: step.source,
                purchases: 0,
                unitsGained: 0,
                cost: 0,
            });
            order.push(id);
        }
        const entry = bySourceId.get(id);
        entry.purchases += step.purchases;
        entry.unitsGained += step.unitsGained;
        entry.cost += step.cost;
    }

    const plan = order.map((id) => {
        const entry = bySourceId.get(id);
        return {
            source: { ...entry.source, pricePerUnit: entry.cost / entry.unitsGained },
            purchases: entry.purchases,
            unitsGained: Number(entry.unitsGained.toFixed(2)),
            cost: Number(entry.cost.toFixed(2)),
        };
    });

    return {
        plan,
        totalCost: Number(result.totalCost.toFixed(2)),
        remaining: Number(result.remaining.toFixed(2)),
        fullyReachable: result.remaining <= 1e-9,
    };
}

export { buildPurchasePlan };
