import { TYPES, linearByteTable } from './geometry.mjs';

// PCDLoader pushes every field of every point into plain arrays; a 1.2 GB
// binary cloud (38.9M points, x y z intensity normal curvature) runs the
// webview out of memory. This reads binary x y z (+ rgb, + float intensity)
// into typed arrays as the file streams in, so the file itself is never held
// whole, and drops normals, which PointsMaterial never uses. Past `limit`
// points it keeps an evenly spaced `limit` of them. Anything else (push
// returns false, or finish returns null) goes to PCDLoader.
export function pcdReader(limit = Infinity) {
    let head = new Uint8Array(0), layout = null, failed = false, partial, filled = 0, row = 0, kept = 0, owed = 0, missing = 0, result;
    function setup(text, data) {
        if (data[2] !== 'binary') return false;
        const field = key => new RegExp(`^${key}[ \\t]+(.*)$`, 'im').exec(text.slice(0, data.index).replace(/^#.*/gm, ''))?.[1].trim().split(/\s+/) ?? [];
        const fields = field('FIELDS'), sizes = field('SIZE').map(Number), types = field('TYPE');
        const counts = field('COUNT').map(Number);
        const count = parseInt(field('POINTS')[0]);
        if (!(count >= 0) || sizes.length !== fields.length || types.length !== fields.length) return false;
        const offsets = [];
        let stride = 0;
        fields.forEach((_, i) => { offsets.push(stride); stride += sizes[i] * (counts[i] ?? 1); });
        const [x, y, z, intensity] = ['x', 'y', 'z', 'intensity'].map(name => fields.indexOf(name));
        if ([x, y, z].some(i => i < 0 || types[i] !== 'F' || sizes[i] !== 4) || !stride) return false;
        const rgb = fields.indexOf('rgb');
        const keep = Math.min(count, limit);
        const readIntensity = intensity >= 0 && TYPES[`${{ F: 'float', U: 'uint', I: 'int' }[types[intensity]]}${sizes[intensity] * 8}`]?.getter;
        layout = { count, keep, stride, x: offsets[x], y: offsets[y], z: offsets[z],
            rgb: rgb >= 0 && sizes[rgb] === 4 ? offsets[rgb] : -1,
            intensity: readIntensity ? offsets[intensity] : -1, readIntensity };
        partial = new Uint8Array(stride);
        result = { total: count, positions: new Float32Array(keep * 3),
            colors: layout.rgb >= 0 ? new Uint8Array(keep * 3) : null,
            intensity: layout.intensity >= 0 ? new Float32Array(keep) : null };
        return true;
    }
    const table = linearByteTable();
    function readRow(view, at) {
        const { count, keep } = layout;
        // Takes `keep` of `count` rows, evenly spaced (Bresenham). A NaN row (no return in an organized
        // cloud) is skipped and its slot goes to the next finite row, so the sample stays near `keep`;
        // `missing` counts NaN rows for the total.
        const sampled = (row++ * keep) % count < keep;
        const x = view.getFloat32(at + layout.x, true), y = view.getFloat32(at + layout.y, true), z = view.getFloat32(at + layout.z, true);
        if (!Number.isFinite(x + y + z)) {
            missing++;
            if (sampled) owed++;
            return;
        }
        if (!sampled) {
            if (!owed) return;
            owed--;
        }
        if (kept >= keep) return;
        const { positions, colors, intensity } = result;
        positions[kept * 3] = x;
        positions[kept * 3 + 1] = y;
        positions[kept * 3 + 2] = z;
        if (colors) {
            colors[kept * 3] = table[view.getUint8(at + layout.rgb + 2)];
            colors[kept * 3 + 1] = table[view.getUint8(at + layout.rgb + 1)];
            colors[kept * 3 + 2] = table[view.getUint8(at + layout.rgb)];
        }
        if (intensity) intensity[kept] = view[layout.readIntensity](at + layout.intensity, true);
        kept++;
    }
    return {
        push(chunk) {
            if (failed) return false;
            if (!layout) {
                const joined = new Uint8Array(head.length + chunk.length);
                joined.set(head);
                joined.set(chunk, head.length);
                const text = new TextDecoder('latin1').decode(joined.subarray(0, 65536));
                const data = /(^|[\r\n])DATA[ \t]+(\S+)[ \t]*\r?\n/i.exec(text);
                if (!data) {
                    head = joined;
                    return !(failed = joined.length > 65536);
                }
                if (!setup(text, data)) return !(failed = true);
                chunk = joined.subarray(data.index + data[0].length);
                head = null;
            }
            const { count, stride } = layout;
            let at = 0;
            if (filled) {
                at = Math.min(stride - filled, chunk.length);
                partial.set(chunk.subarray(0, at), filled);
                filled += at;
                if (filled < stride) return true;
                if (row < count) readRow(new DataView(partial.buffer), 0);
                filled = 0;
            }
            const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            for (; at + stride <= chunk.length && row < count; at += stride) readRow(view, at);
            if (row < count && at < chunk.length) {
                partial.set(chunk.subarray(at));
                filled = chunk.length - at;
            }
            return true;
        },
        // A short body means POINTS is wrong; PCDLoader decides what to show.
        // A short body means POINTS is wrong; PCDLoader decides what to show.
        finish() {
            if (failed || !layout || row !== layout.count) return null;
            const { positions, colors, intensity } = result;
            return { total: layout.count - missing, positions: positions.subarray(0, kept * 3), colors: colors?.subarray(0, kept * 3) ?? null, intensity: intensity?.subarray(0, kept) ?? null };
        }
    };
}

export function readPcdPoints(bytes, limit) {
    const reader = pcdReader(limit);
    return reader.push(bytes) ? reader.finish() : null;
}
