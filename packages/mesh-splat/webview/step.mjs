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
