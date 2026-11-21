// Three significant digits read elevations of 1234.5-1236.0 m as 1,230 and 1,240, so both ends take as many
// decimals as their difference needs, whole numbers kept. Values arrive as float32, whose step 2^-k has k
// decimals: more would print digits it does not hold.
const MAX_DECIMALS = 7;

export function legendLabels(low, high, locale) {
    const format = (value, options) => value.toLocaleString(locale, { signDisplay: 'negative', ...options });
    if (!Number.isFinite(low) || !Number.isFinite(high)) return [low, high].map(value => (+value.toPrecision(3)).toLocaleString(locale));
    const magnitude = Math.max(Math.abs(low), Math.abs(high));
    const span = high - low;
    if (!(span > 0)) {
        const whole = magnitude >= 1 ? Math.floor(Math.log10(magnitude)) + 1 : 0;
        return [low, high].map(value => format(value, { maximumSignificantDigits: Math.min(7, Math.max(3, whole + 1)) }));
    }
    if (magnitude < 1e-3) {
        const significant = Math.min(Math.max(Math.ceil(Math.log10(magnitude / span)) + 2, 1), MAX_DECIMALS);
        return [low, high].map(value => (value === 0 ? '0' : format(value, { notation: 'scientific', maximumSignificantDigits: significant })));
    }
    const held = Math.min(Math.max(23 - Math.floor(Math.log2(magnitude)), 0), MAX_DECIMALS);
    const digits = Math.min(Math.max(Math.ceil(-Math.log10(span)) + 1, 0), held);
    return [low, high].map(value => format(value, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
}
