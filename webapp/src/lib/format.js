/**
 * Formats a per-unit Banknotes price with at least `minDecimals` decimal places, extending
 * precision (up to `maxDecimals`) until at least one non-zero digit is visible. Some very
 * cheap-per-unit resources (e.g. Herbs, obtained in the tens of millions per purchase) round
 * away to "0.00" at a fixed low precision, which reads as free/unknown rather than merely
 * tiny.
 */
function formatUnitPrice(value, { minDecimals = 2, maxDecimals = 10 } = {}) {
    if (!Number.isFinite(value)) {
        return null;
    }
    let decimals = minDecimals;
    while (decimals < maxDecimals && value !== 0 && Number(value.toFixed(decimals)) === 0) {
        decimals++;
    }
    return Number(value.toFixed(decimals));
}

export { formatUnitPrice };
