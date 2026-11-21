import { grown, percentile } from './geometry.mjs';

// float32 positions snap to 0.25 m at a UTM northing (4e6) and 3 cm at an easting (5e5), so each axis that far out
// has its offset taken out in float64 first. Below 10 km float32 steps are at most 1 mm (2^-10 m from 8192 m), so
// nearer axes, elevations among them, keep their coordinates. The offset is a whole kilometre, which reads plainly
// in Info.
const FAR = 10_000;
const STEP = 1000;
// Points are stored before the whole cloud is seen (PCD streams, and a second float64 copy of a large text cloud
// doubled its peak memory), so the offset comes from the first DECIDE_ROWS real points, which wait in float64.
// Rows at exactly 0 0 0 are left out with the non-finite ones: organized and sensor-ordered clouds fill no-return
// slots with them, often for whole leading scan lines, so up to MAX_WAITING rows are held to find real ones. The
// median, not the bounds: one stray point 10 km out must not shift an indoor scan. An axis is shifted only when
// its median lies farther out than the sample's 2nd-98th percentiles span, so a local corridor 22 km long keeps
// its origin end exact, and a stray point does not cancel a UTM tile's offset.
// The rest lie at most the cloud's extent from the offset, and float32 keeps 1 mm up to 16 km, so only a cloud
// wider than ~15 km loses detail; a prefix cannot tell what lies beyond it.
export const DECIDE_ROWS = 65536;
const MAX_WAITING = 8 * DECIDE_ROWS;

// `write` must be called with indices 0, 1, 2, ... in order.
export function recentering({ offset: given } = {}) {
    let offset = given ?? null;
    let pending = given ? null : new Float64Array(DECIDE_ROWS * 3);
    let waiting = 0, real = 0;
    const isReal = (x, y, z) => Number.isFinite(x + y + z) && (x !== 0 || y !== 0 || z !== 0);

    function decide(target) {
        const rows = [];
        for (let i = 0; i < waiting; i++) if (isReal(pending[i * 3], pending[i * 3 + 1], pending[i * 3 + 2])) rows.push(i);
        offset = [0, 1, 2].map(axis => {
            if (!rows.length) return 0;
            const values = rows.map(i => pending[i * 3 + axis]);
            const median = percentile(values, 0.5);
            const extent = percentile(values, 0.98) - percentile(values, 0.02);
            return Math.abs(median) >= FAR && Math.abs(median) > extent ? Math.round(median / STEP) * STEP : 0;
        });
        for (let i = 0; i < waiting * 3; i++) target[i] = pending[i] - offset[i % 3];
        pending = null;
    }

    return {
        write(target, i, x, y, z) {
            if (pending) {
                if (i * 3 >= pending.length) pending = grown(pending);
                pending[i * 3] = x;
                pending[i * 3 + 1] = y;
                pending[i * 3 + 2] = z;
                waiting++;
                if (isReal(x, y, z)) real++;
                if (real === DECIDE_ROWS || waiting === MAX_WAITING) decide(target);
                return;
            }
            target[i * 3] = x - offset[0];
            target[i * 3 + 1] = y - offset[1];
            target[i * 3 + 2] = z - offset[2];
        },
        // Points still waiting go into `target`.
        finish(target) {
            if (pending) decide(target);
            return offset.some(Boolean) ? offset : null;
        },
        get deciding() {
            return pending !== null;
        }
    };
}
