// Measured points back in their files' own frames, and their readout. Usage: measurement({ view, turn }, { view, turn })

const UNIT_NAMES = { 1: 'm', 0.01: 'cm', 0.001: 'mm' };

// `turn` is the file's rotation in the view, [x, y, z, w]; a far cloud's offset is already in the view point, where the cloud is placed.
export function filePoint([x, y, z], [qx, qy, qz, qw]) {
    const [ix, iy, iz] = [-qx, -qy, -qz];
    const tx = 2 * (iy * z - iz * y), ty = 2 * (iz * x - ix * z), tz = 2 * (ix * y - iy * x);
    return [x + qw * tx + iy * tz - iz * ty, y + qw * ty + iz * tx - ix * tz, z + qw * tz + ix * ty - iy * tx];
}

// `scale` is the view's size of one file unit (a USD stage is drawn in meters); deltas are in the first point's file.
export function measurement(a, b) {
    const step = [0, 1, 2].map(axis => b.view[axis] - a.view[axis]);
    const inFile = ({ scale = 1 }, point) => point.map(value => value / scale);
    return {
        a: inFile(a, filePoint(a.view, a.turn)),
        b: inFile(b, filePoint(b.view, b.turn)),
        distance: Math.hypot(...step) / (a.scale ?? 1),
        delta: inFile(a, filePoint(step, a.turn))
    };
}

// A millimetre in a view a metre or more across, a thousandth of a smaller one.
export const decimalsFor = size => (size > 0 ? Math.min(7, Math.max(3, 3 - Math.floor(Math.log10(size)))) : 3);

const fixed = (value, decimals) => {
    const text = value.toFixed(decimals);
    return Number(text) === 0 ? text.replace('-', '') : text;
};
export const unitName = metersPerUnit => UNIT_NAMES[metersPerUnit] ?? `× ${metersPerUnit} m`;
const unitSuffix = metersPerUnit => (metersPerUnit ? ` ${unitName(metersPerUnit)}` : '');
// Said once below the rows when the points share it (null: the file states none); per row only when they differ.
export const readoutUnit = units => (new Set(units.map(unit => unit || null)).size > 1 ? { perRow: true } : { shared: units[0] ? unitName(units[0]) : null });

export const formatLength = (value, decimals, metersPerUnit) => `${fixed(value, decimals)}${unitSuffix(metersPerUnit)}`;
export const formatPoint = (point, decimals, metersPerUnit) => `${point.map(value => fixed(value, decimals)).join(', ')}${unitSuffix(metersPerUnit)}`;
