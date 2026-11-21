import { linearByteTable } from './color.mjs';
import { TYPES } from './ply.mjs';
import { recentering } from './recenter.mjs';

// PCDLoader pushes every field of every point into plain arrays and needs the whole file, which runs the
// webview out of memory on a 1.2 GB, 38.9M-point cloud.

// A row with a NaN coordinate is no return of an organized cloud, not a point; one NaN point also makes
// the bounding box, and with it the framing, NaN.
const isPoint = (x, y, z) => Number.isFinite(x + y + z);

// PCDLoader's attributes ({ name: { array, itemSize } }) without the rows that are not points, or null when
// every row is one.
export function dropNaNPoints(attributes) {
    const positions = attributes.position.array;
    const keep = [];
    for (let i = 0; i < positions.length / 3; i++) if (isPoint(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])) keep.push(i);
    if (keep.length * 3 === positions.length) return null;
    return Object.fromEntries(Object.entries(attributes).map(([name, { array, itemSize }]) => {
        const out = new array.constructor(keep.length * itemSize);
        keep.forEach((i, k) => out.set(array.subarray(i * itemSize, (i + 1) * itemSize), k * itemSize));
        return [name, out];
    }));
}

// Which of `count` points in file order to keep: `take(x, y, z)` for each in turn gives the slot of a kept
// point, or -1. Keeps `keep` of them, evenly spaced (Bresenham). A NaN row (no return in an organized cloud)
// is skipped and its slot goes to the next finite row, so the sample stays near `keep`; `missing` counts
// NaN rows for the total. With `inside(x, y, z)`, only the points it accepts count, and `expected` of them
// are assumed when spacing the sample; once `limit` are kept, the rest are dropped, so `expected` should
// not fall short. `inside` sees points less `offset`, as the cloud stores them (recenter.mjs).
export function pointSampler(count, limit = Infinity, { inside, expected, offset = [0, 0, 0] } = {}) {
    const keep = Math.min(inside ? Math.ceil(expected) : count, limit);
    const population = inside ? Math.max(keep, Math.ceil(expected)) : count;
    const sampled = i => (i * keep) % population < keep;
    let row = 0, hits = 0, owed = 0;
    const sampler = {
        keep, kept: 0, missing: 0,
        take(x, y, z) {
            const r = row++;
            if (!isPoint(x, y, z)) {
                sampler.missing++;
                if (!inside && sampled(r)) owed++;
                return -1;
            }
            if (inside && !inside(x - offset[0], y - offset[1], z - offset[2])) return -1;
            if (!sampled(inside ? hits++ : r)) {
                if (!owed) return -1;
                owed--;
            }
            return sampler.kept < keep ? sampler.kept++ : -1;
        }
    };
    return sampler;
}

// Streams binary, ASCII and binary_compressed bodies alike; any other header (push returns false, finish
// returns null) goes to PCDLoader. binary_compressed is LZF over columns, so its body is inflated as it
// arrives into one buffer the size of the uncompressed data, and read once complete.
// `limit`, `inside` and `expected` choose the points as in pointSampler; `inside` sees points with `offset`
// taken out (none when it is not given).
export function pcdReader(limit = Infinity, { inside, expected, offset: given } = {}) {
    let head = new Uint8Array(0), layout = null, failed = false, row = 0, sampler, result;
    let partial, filled = 0, text = '', carry = new Uint8Array(0), inflated = null, written = 0;
    const shift = given ?? (inside ? [0, 0, 0] : undefined);
    const placing = recentering({ offset: shift });
    const table = linearByteTable();
    const floatBits = new Float32Array(1), uintBits = new Uint32Array(floatBits.buffer);

    function setup(header, data) {
        const mode = data[2].toLowerCase();
        if (!['binary', 'ascii', 'binary_compressed'].includes(mode)) return false;
        const field = key => new RegExp(`^${key}[ \\t]+(.*)$`, 'im').exec(header.slice(0, data.index).replace(/^#.*/gm, ''))?.[1].trim().split(/\s+/) ?? [];
        const fields = field('FIELDS'), sizes = field('SIZE').map(Number), types = field('TYPE');
        const counts = fields.map((_, i) => Number(field('COUNT')[i] ?? 1));
        const count = parseInt(field('POINTS')[0]);
        if (!(count >= 0) || sizes.length !== fields.length || types.length !== fields.length) return false;
        const [x, y, z, intensity, rgb] = ['x', 'y', 'z', 'intensity', 'rgb'].map(name => fields.indexOf(name));
        // Any numeric type, as DataView getter names.
        const getterOf = i => i >= 0 && TYPES[`${{ F: 'float', U: 'uint', I: 'int' }[types[i]]}${sizes[i] * 8}`]?.getter;
        const read = [x, y, z].map(getterOf);
        if (!read.every(Boolean)) return false;
        // Byte offset of each field in a row, its token in an ASCII line, and its column in compressed data.
        const offsets = [], tokens = [], columns = [];
        let stride = 0, token = 0, column = 0;
        fields.forEach((_, i) => {
            offsets.push(stride);
            tokens.push(token);
            columns.push(column);
            stride += sizes[i] * counts[i];
            token += counts[i];
            column += sizes[i] * counts[i] * count;
        });
        const hasRgb = rgb >= 0 && sizes[rgb] === 4;
        const readIntensity = getterOf(intensity);
        sampler = pointSampler(count, limit, { inside, expected, offset: shift });
        const { keep } = sampler;
        const widths = fields.map((_, i) => sizes[i] * counts[i]);
        layout = { mode, count, stride, offsets, tokens, columns, widths, read, xyz: [x, y, z], rgb: hasRgb ? rgb : -1,
            rgbFloat: types[rgb] === 'F', intensity: readIntensity ? intensity : -1, readIntensity };
        partial = new Uint8Array(stride);
        result = { total: count, positions: new Float32Array(keep * 3),
            colors: hasRgb ? new Uint8Array(keep * 3) : null,
            intensity: readIntensity ? new Float32Array(keep) : null };
        return stride > 0;
    }

    // `rgb` is 0xRRGGBB.
    function emit(x, y, z, rgb, value) {
        row++;
        const kept = sampler.take(x, y, z);
        if (kept < 0) return;
        const { colors, intensity } = result;
        placing.write(result.positions, kept, x, y, z);
        if (colors) {
            colors[kept * 3] = table[(rgb >> 16) & 255];
            colors[kept * 3 + 1] = table[(rgb >> 8) & 255];
            colors[kept * 3 + 2] = table[rgb & 255];
        }
        if (intensity) intensity[kept] = value;
    }

    // Binary rows: `at` is the row's first byte. Compressed columns: `at` is the row's index.
    function emitBinary(view, at, columns) {
        const { offsets, read, xyz, rgb, intensity, readIntensity } = layout;
        const where = i => (columns ? layout.columns[i] + at * layout.widths[i] : at + offsets[i]);
        const [x, y, z] = xyz.map((f, k) => view[read[k]](where(f), true));
        emit(x, y, z, rgb >= 0 ? view.getUint32(where(rgb), true) : 0, intensity >= 0 ? view[readIntensity](where(intensity), true) : 0);
    }

    function emitLine(line) {
        const t = line.trim().split(/\s+/);
        if (t.length < 3 || t[0] === '') return;
        const { tokens, xyz, rgb, rgbFloat, intensity } = layout;
        let color = 0;
        if (rgb >= 0) {
            floatBits[0] = parseFloat(t[tokens[rgb]]);
            color = rgbFloat ? uintBits[0] : parseInt(t[tokens[rgb]]);
        }
        emit(...xyz.map(f => parseFloat(t[tokens[f]])), color, intensity >= 0 ? parseFloat(t[tokens[intensity]]) : 0);
    }

    function pushBinary(chunk) {
        const { count, stride } = layout;
        let at = 0;
        if (filled) {
            at = Math.min(stride - filled, chunk.length);
            partial.set(chunk.subarray(0, at), filled);
            filled += at;
            if (filled < stride) return;
            if (row < count) emitBinary(new DataView(partial.buffer), 0);
            filled = 0;
        }
        const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        for (; at + stride <= chunk.length && row < count; at += stride) emitBinary(view, at);
        if (row < count && at < chunk.length) {
            partial.set(chunk.subarray(at));
            filled = chunk.length - at;
        }
    }

    function pushAscii(chunk) {
        const lines = (text + new TextDecoder('latin1').decode(chunk)).split('\n');
        text = lines.pop();
        for (const line of lines) if (row < layout.count) emitLine(line);
    }

    // LZF: a control byte below 32 starts that many + 1 literal bytes, any other a back-reference. A token
    // cut by the end of a chunk waits in `carry` for the next one.
    function pushCompressed(chunk) {
        let src = chunk;
        if (carry.length) {
            src = new Uint8Array(carry.length + chunk.length);
            src.set(carry);
            src.set(chunk, carry.length);
        }
        let i = 0;
        if (!inflated) {
            if (src.length < 8) return void (carry = src.slice());
            const sizes = new DataView(src.buffer, src.byteOffset, 8);
            if (sizes.getUint32(4, true) !== layout.stride * layout.count) throw new Error('the PCD\'s compressed size does not match its POINTS');
            inflated = new Uint8Array(layout.stride * layout.count);
            i = 8;
        }
        while (i < src.length && written < inflated.length) {
            const ctrl = src[i];
            if (ctrl < 32) {
                const n = ctrl + 1;
                if (i + 1 + n > src.length) break;
                inflated.set(src.subarray(i + 1, i + 1 + n), written);
                written += n;
                i += 1 + n;
                continue;
            }
            let n = ctrl >> 5, j = i + 1;
            if (n === 7) {
                if (j >= src.length) break;
                n += src[j++];
            }
            if (j >= src.length) break;
            const from = written - ((ctrl & 31) << 8) - src[j++] - 1;
            n += 2;
            if (from < 0 || written + n > inflated.length) throw new Error('the PCD\'s compressed data is corrupt');
            for (let k = 0; k < n; k++) inflated[written++] = inflated[from + k];
            i = j;
        }
        carry = src.slice(i);
        if (written === inflated.length && row === 0) {
            const view = new DataView(inflated.buffer);
            for (let r = 0; r < layout.count; r++) emitBinary(view, r, true);
            inflated = new Uint8Array(0);
            written = 0;
        }
    }

    return {
        push(chunk) {
            if (failed) return false;
            if (!layout) {
                const joined = new Uint8Array(head.length + chunk.length);
                joined.set(head);
                joined.set(chunk, head.length);
                const header = new TextDecoder('latin1').decode(joined.subarray(0, 65536));
                const data = /(^|[\r\n])DATA[ \t]+(\S+)[ \t]*\r?\n/i.exec(header);
                if (!data) {
                    head = joined;
                    return !(failed = joined.length > 65536);
                }
                if (!setup(header, data)) return !(failed = true);
                chunk = joined.subarray(data.index + data[0].length);
                head = null;
            }
            ({ binary: pushBinary, ascii: pushAscii, binary_compressed: pushCompressed })[layout.mode](chunk);
            return true;
        },
        // null when the header is one this reader leaves to PCDLoader. A body shorter than POINTS says is an
        // error rather than a PCDLoader retry, which would hold the whole file at once.
        finish() {
            if (failed || !layout) return null;
            if (layout.mode === 'ascii' && text && row < layout.count) emitLine(text);
            if (row !== layout.count) throw new Error(`the PCD ends after ${row} of its ${layout.count} points`);
            const offset = placing.finish(result.positions);
            const { positions, colors, intensity } = result, { kept } = sampler;
            return { total: layout.count - sampler.missing, positions: positions.subarray(0, kept * 3), colors: colors?.subarray(0, kept * 3) ?? null, intensity: intensity?.subarray(0, kept) ?? null,
                offset };
        }
    };
}
