import { grown } from './geometry.mjs';

const numbers = line => line.trim().split(/[\s,;]+/).map(Number);

const isByte = value => Number.isInteger(value) && value >= 0 && value <= 255;

// Same values as numbers(line) for every line, without a string array per line:
// that took most of a 1M-point load (599 ms for 1M lines; Node 22, Apple M2,
// median of 9).
// A plain decimal of at most 15 digits is an exact integer divided by an exact
// power of ten, which IEEE division rounds exactly as Number() does; anything
// else (exponents, more digits, words, non-ASCII spaces) goes through Number()
// or the original per-line path, so results are identical, not approximate.
// ASCII only: a non-ASCII character sends the line to numbers().
const TOKEN = 0;
const SPACE = 1;
const SEPARATOR = 2;
const KIND = new Uint8Array(128);
for (const code of [9, 10, 11, 12, 13, 32]) KIND[code] = SPACE;
KIND[44] = KIND[59] = SEPARATOR;
const POWERS = Array.from({ length: 16 }, (_, k) => 10 ** k);

function numberAt(text, start, end) {
    let i = start;
    let sign = 1;
    let code = text.charCodeAt(i);
    if (code === 45 || code === 43) {
        if (code === 45) sign = -1;
        code = text.charCodeAt(++i);
    }
    let value = 0;
    let digits = 0;
    let decimals = 0;
    while (i < end && code >= 48 && code <= 57) { value = value * 10 + code - 48; digits++; code = text.charCodeAt(++i); }
    if (i < end && code === 46) {
        code = text.charCodeAt(++i);
        while (i < end && code >= 48 && code <= 57) { value = value * 10 + code - 48; digits++; decimals++; code = text.charCodeAt(++i); }
    }
    if (i !== end || digits === 0 || digits > 15) return Number(text.slice(start, end));
    return sign * (decimals ? value / POWERS[decimals] : value);
}

// Splits like line.trim().split(/[\s,;]+/): a leading or trailing , or ; yields
// an empty token, i.e. a 0. Returns the token count; fills at most
// values.length values.
// Returns -1 when the line has a non-ASCII character.
function scanLine(text, start, end, values) {
    let code;
    while (start < end && (code = text.charCodeAt(start)) < 128 && KIND[code] === SPACE) start++;
    while (end > start && (code = text.charCodeAt(end - 1)) < 128 && KIND[code] === SPACE) end--;
    let count = 0;
    for (let at = start; ;) {
        const tokenStart = at;
        while (at < end && ((code = text.charCodeAt(at)) >= 128 || KIND[code] === TOKEN)) {
            if (code >= 128) return -1;
            at++;
        }
        if (count < values.length) values[count] = at > tokenStart ? numberAt(text, tokenStart, at) : 0;
        count++;
        if (at >= end) return count;
        while (at < end && (code = text.charCodeAt(at)) < 128 && KIND[code] !== TOKEN) at++;
        if (at >= end) {
            if (count < values.length) values[count] = 0;
            return count + 1;
        }
    }
}

export function parsePointsText(text) {
    let positions = new Float32Array(3 * 4096);
    let colors = new Float32Array(3 * 4096);
    let count = 0;
    let colored = true;
    const values = new Array(7);
    for (let start = 0; start <= text.length;) {
        let end = text.indexOf('\n', start);
        if (end < 0) end = text.length;
        let tokens = scanLine(text, start, end, values);
        if (tokens < 0) {
            const all = numbers(text.slice(start, end));
            tokens = all.length;
            for (let k = 0; k < values.length; k++) values[k] = all[k];
        }
        start = end + 1;
        if (tokens < 3 || !Number.isFinite(values[0]) || !Number.isFinite(values[1]) || !Number.isFinite(values[2])) continue;
        if (count * 3 + 3 > positions.length) {
            positions = grown(positions);
            colors = grown(colors);
        }
        positions[count * 3] = values[0];
        positions[count * 3 + 1] = values[1];
        positions[count * 3 + 2] = values[2];
        const rgbAt = tokens >= 7 ? 4 : 3;
        if (colored && tokens >= rgbAt + 3 && isByte(values[rgbAt]) && isByte(values[rgbAt + 1]) && isByte(values[rgbAt + 2])) {
            colors[count * 3] = values[rgbAt] / 255;
            colors[count * 3 + 1] = values[rgbAt + 1] / 255;
            colors[count * 3 + 2] = values[rgbAt + 2] / 255;
        } else {
            colored = false;
        }
        count++;
    }
    return { positions: positions.subarray(0, count * 3), colors: colored && count ? colors.subarray(0, count * 3) : null };
}

export function parseOff(text) {
    const lines = text.split('\n').map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
    const first = lines.shift().replace(/^[A-Z]*OFF/, '').trim();
    const [vertexCount, faceCount] = numbers(first || lines.shift());
    const positions = lines.slice(0, vertexCount).flatMap(line => numbers(line).slice(0, 3));
    const indices = [];
    for (const line of lines.slice(vertexCount, vertexCount + faceCount)) {
        const [n, ...rest] = numbers(line);
        for (let k = 1; k < n - 1; k++) indices.push(rest[0], rest[k], rest[k + 1]);
    }
    return { positions, indices };
}
