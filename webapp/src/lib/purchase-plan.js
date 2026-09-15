/**
 * Browser-safe port of the purchase-plan calculation from scripts/analyze-item-value.js,
 * returning structured data instead of printing a console.table so it can be rendered in the UI.
 */

/**
 * Builds an optimal (cheapest Banknotes/unit first) purchase plan for a target quantity,
 * given the list of purchase sources produced by collectPackageSources/collectExchangeSources.
 */
function buildPurchasePlan(sources, targetQuantity) {
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
            source,
            purchases: purchasesNeeded,
            unitsGained: Number(actualUnits.toFixed(2)),
            cost: Number(cost.toFixed(2)),
        });

        totalCost += cost;
        remaining -= actualUnits;
    }

    return {
        plan,
        totalCost: Number(totalCost.toFixed(2)),
        remaining: Number(Math.max(remaining, 0).toFixed(2)),
        fullyReachable: remaining <= 0,
    };
}

export { buildPurchasePlan };
