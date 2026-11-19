import { Color, SRGBColorSpace } from 'three';
import { percentile } from './geometry.mjs';

// 8-bit sRGB to the linear bytes three.js keeps for vertex colors.
let srgbToLinearByte = null;
const color = new Color();
export const linearByte = value => Math.round(color.setRGB(value * (1 / 255), 0, 0, SRGBColorSpace).r * 255);

export function linearByteTable() {
    srgbToLinearByte ??= Uint8Array.from({ length: 256 }, (_, i) => linearByte(i));
    return srgbToLinearByte;
}

// Turbo (Google's polynomial fit): t in 0..1 to 8-bit sRGB.
const TURBO = [
    [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943],
    [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604],
    [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973]
];
const turboSrgb = t => TURBO.map(c => Math.round(Math.min(1, Math.max(0, c.reduceRight((sum, k) => sum * t + k, 0))) * 255));

// The same colors as a CSS gradient, for the legend.
export const turboGradient = (stops = 16) => `linear-gradient(to right, ${Array.from({ length: stops + 1 }, (_, i) => `rgb(${turboSrgb(i / stops).join(' ')})`).join(', ')})`;

// Turbo as linear bytes for a normalized color attribute.
let turboTable;
function turbo() {
    if (turboTable) return turboTable;
    const srgb = linearByteTable();
    turboTable = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) turboSrgb(i / 255).forEach((value, j) => { turboTable[i * 3 + j] = srgb[value]; });
    return turboTable;
}

// The 2nd-98th percentile of the finite values of all `lists`, so a few outliers don't squash the rest into
// one color, and clouds shown together share one scale.
export function colorRange(lists) {
    const finite = new Float32Array(lists.reduce((n, values) => n + values.length, 0));
    let n = 0;
    for (const values of lists) for (const value of values) if (Number.isFinite(value)) finite[n++] = value;
    const sorted = finite.subarray(0, n);
    return [percentile(sorted, 0.02), percentile(sorted, 0.98)];
}

// Per-point turbo colors over `range`; non-finite values get the lowest color.
export function colorize(values, colors = new Uint8Array(values.length * 3), [low, high] = colorRange([values])) {
    const scale = 255 / (high - low || 1);
    const table = turbo();
    for (let i = 0; i < values.length; i++) {
        const k = Math.min(255, Math.max(0, Math.round((values[i] - low) * scale))) * 3 || 0;
        colors[i * 3] = table[k];
        colors[i * 3 + 1] = table[k + 1];
        colors[i * 3 + 2] = table[k + 2];
    }
    return colors;
}
