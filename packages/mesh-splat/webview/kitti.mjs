import { pointSampler } from './pcd.mjs';
import { recentering } from './recenter.mjs';

// Headerless LiDAR scans: little-endian float32 x y z and then each field, per point.
function recordLayout(format, fields) {
    const record = `x y z ${fields.join(' ')}`;
    return { format, fields, record, name: `${format} ${record}` };
}
const KITTI = recordLayout('KITTI', ['intensity']);
const NUSCENES = recordLayout('nuScenes', ['intensity', 'ring']);

// Nothing in the bytes tells the layouts apart; nuScenes names its scans *.pcd.bin.
export const binLayout = fileName => (/\.pcd\.bin$/i.test(fileName) ? NUSCENES : KITTI);

// `limit`, `inside`, `expected` and `offset` choose the points as in pointSampler, and the points are stored less
// the offset (given, or taken from the scan as for PCD: a scan georeferenced to UTM). The count comes from the file's
// size `bytes`, so the even sample needs no first pass. The size is also the only guard against another
// kind of .bin opened with this editor, so one that is not whole points is refused (NotAScan) up front.
export function binReader(bytes, layout, limit = Infinity, { inside, expected, offset: given } = {}) {
    const stride = 4 * (3 + layout.fields.length);
    const { format, record } = layout;
    if (bytes % stride) {
        const message = `the file is ${bytes} bytes, not a multiple of the ${stride}-byte ${format} point (${record}): it does not look like a ${format} scan`;
        throw Object.assign(new Error(message), { name: 'NotAScan', bytes, stride, format, record });
    }
    const count = bytes / stride;
    const shift = given ?? (inside ? [0, 0, 0] : undefined);
    const placing = recentering({ offset: shift });
    const sampler = pointSampler(count, limit, { inside, expected, offset: shift });
    const positions = new Float32Array(sampler.keep * 3);
    const scalars = Object.fromEntries(layout.fields.map(field => [field, new Float32Array(sampler.keep)]));
    // A record cut by the end of a chunk waits here for the rest.
    const partial = new Uint8Array(stride);
    let row = 0, filled = 0;

    function emit(view, at) {
        row++;
        const x = view.getFloat32(at, true), y = view.getFloat32(at + 4, true), z = view.getFloat32(at + 8, true);
        const kept = sampler.take(x, y, z);
        if (kept < 0) return;
        placing.write(positions, kept, x, y, z);
        layout.fields.forEach((field, f) => { scalars[field][kept] = view.getFloat32(at + 12 + f * 4, true); });
    }

    return {
        push(chunk) {
            let at = 0;
            if (filled) {
                at = Math.min(stride - filled, chunk.length);
                partial.set(chunk.subarray(0, at), filled);
                filled += at;
                if (filled < stride) return true;
                if (row < count) emit(new DataView(partial.buffer), 0);
                filled = 0;
            }
            const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            for (; at + stride <= chunk.length && row < count; at += stride) emit(view, at);
            if (row < count && at < chunk.length) {
                partial.set(chunk.subarray(at));
                filled = chunk.length - at;
            }
            return true;
        },
        finish() {
            const { kept } = sampler;
            const offset = placing.finish(positions);
            return {
                offset,
                total: count - sampler.missing,
                positions: positions.subarray(0, kept * 3),
                colors: null,
                scalars: Object.fromEntries(Object.entries(scalars).map(([field, values]) => [field, values.subarray(0, kept)]))
            };
        }
    };
}
