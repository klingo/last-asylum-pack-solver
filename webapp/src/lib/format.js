/**
 * The number of decimal places a per-unit Banknotes value needs, starting from `minDecimals`
 * and growing (up to `maxDecimals`) until at least one non-zero digit is visible. Some very
 * cheap-per-unit resources (e.g. Herbs, obtained in the tens of millions per purchase) round
 * away to "0.00" at a fixed low precision, which reads as free/unknown rather than merely
 * tiny.
 */
function unitPriceDecimals(value, { minDecimals = 2, maxDecimals = 10 } = {}) {
    let decimals = minDecimals;
    while (decimals < maxDecimals && value !== 0 && Number(value.toFixed(decimals)) === 0) {
        decimals++;
    }
    return decimals;
}

/**
 * Formats a single per-unit Banknotes price at its own precision (see `unitPriceDecimals`).
 * Returns a string, not a number, so trailing zeros required by `minDecimals` are preserved
 * (e.g. "1.00" rather than "1", which `Number(...)` would silently collapse back down to).
 */
function formatUnitPrice(value, options = {}) {
    if (!Number.isFinite(value)) {
        return null;
    }
    return value.toFixed(unitPriceDecimals(value, options));
}

/**
 * Formats a whole column of per-unit Banknotes prices at one shared precision: whatever the
 * smallest (hardest to show) value in the column needs (see `unitPriceDecimals`). Every value
 * is padded to that same precision, so e.g. "1.00" lines up under "0.07" instead of each row
 * picking its own, inconsistent number of decimal places. Returns strings in the same order
 * as `values`, with `null` for non-finite entries.
 */
function formatUnitPriceColumn(values, options = {}) {
    const decimals = values.reduce(
        (max, value) => (Number.isFinite(value) ? Math.max(max, unitPriceDecimals(value, options)) : max),
        options.minDecimals ?? 2,
    );
    return values.map((value) => (Number.isFinite(value) ? value.toFixed(decimals) : null));
}

export { formatUnitPrice, formatUnitPriceColumn };
