const SI_PREFIX = { '': 1, KILO: 1e3, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };
const CONVERTED = { INCH: 0.0254, FOOT: 0.3048 };

function lengthUnit(entity) {
    const si = entity.match(/SI_UNIT\s*\(\s*(?:\$|\.(\w+)\.)\s*,\s*\.METRE\.\s*\)/);
    const converted = entity.match(/CONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/);
    return converted ? CONVERTED[converted[1].toUpperCase()] : si ? SI_PREFIX[si[1] ?? ''] : undefined;
}

// Meters per length unit of a STEP file, or null when it declares none, one the table does not know,
// or several different ones. foxtrot keeps file units, so a null sends the file to OpenCascade,
// which converts on its own. Only units a GLOBAL_UNIT_ASSIGNED_CONTEXT names count: exporters also
// declare unused ones (SolidWorks adds a metre next to the millimetre the model uses).
export function stepLengthUnit(text) {
    const assigned = new Set([...text.matchAll(/GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)/g)]
        .flatMap(([, list]) => list.match(/\d+/g) ?? []));
    const units = new Set();
    for (const [entity, id] of text.matchAll(/#(\d+)\s*=\s*\([^;]*LENGTH_UNIT[^;]*;/g)) {
        if (assigned.size && !assigned.has(id)) continue;
        const unit = lengthUnit(entity);
        if (unit === undefined) return null;
        units.add(unit);
    }
    return units.size === 1 ? [...units][0] : null;
}

// Sorts triangles into one run per color so a mesh draws once per color, not once per face.
// `keyOf(t)` is triangle t's 8-bit sRGB color as 0xRRGGBB.
export function groupTriangles(indices, keyOf) {
    const triangles = indices.length / 3;
    const keys = new Uint32Array(triangles);
    const counts = new Map();
    for (let t = 0; t < triangles; t++) {
        const key = keyOf(t);
        keys[t] = key;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const groups = [];
    const offsets = new Map();
    let start = 0;
    for (const [key, count] of counts) {
        groups.push({ color: [key >> 16, (key >> 8) & 255, key & 255].map(c => c / 255), start: start * 3, count: count * 3 });
        offsets.set(key, start);
        start += count;
    }
    if (groups.length < 2) return { indices, groups };
    const sorted = new Uint32Array(indices.length);
    for (let t = 0; t < triangles; t++) {
        const at = offsets.get(keys[t]);
        offsets.set(keys[t], at + 1);
        sorted.set(indices.subarray(t * 3, t * 3 + 3), at * 3);
    }
    return { indices: sorted, groups };
}

const rgbKey = (r, g, b) => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);

// foxtrot colors every vertex of a face alike, so a triangle takes its first vertex's color.
export function groupByColor(colors, indices) {
    return groupTriangles(indices, t => {
        const v = indices[t * 3] * 3;
        return rgbKey(colors[v], colors[v + 1], colors[v + 2]);
    });
}

// OpenCascade gives each face as a run of triangles [first, last] that may carry its own color over the
// part's `base`; triangles in no face keep `base`.
export function groupByFace(indices, faces, base) {
    const keys = new Uint32Array(indices.length / 3).fill(rgbKey(...base));
    for (const { first, last, color } of faces ?? []) if (color) keys.fill(rgbKey(...color), first, last + 1);
    return groupTriangles(indices, t => keys[t]);
}
