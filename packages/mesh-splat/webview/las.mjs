import { linearByteTable } from './color.mjs';
import { pointSampler } from './pcd.mjs';
import { FAR } from './recenter.mjs';

// Per point format: standard bytes, GPS time and RGB offsets (-1: none); the wave packets of 4, 5, 9 and 10 are skipped like extra bytes.
const FORMATS = [[20, -1, -1], [28, 20, -1], [26, -1, 20], [34, 20, 28], [57, 20, -1], [63, 20, 28], [30, 22, -1], [36, 22, 30], [38, 22, 30], [59, 22, -1], [67, 22, 30]]
    .map(([size, gps, rgb], format) => ({ size, gps, rgb, wide: format >= 6 }));
const FIELDS = ['intensity', 'classification', 'return_number', 'gps_time', 'point_source_id'];

const textOf = (bytes, at, length) => new TextDecoder('latin1').decode(bytes.subarray(at, at + length)).replace(/\0[\s\S]*$/, '');

// The VLRs between the header and the points, as { at, length } of their data by `user/id`.
function vlrsOf(bytes, from, to, count) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const records = {};
    for (let at = from, i = 0; i < count && at + 54 <= to; i++) {
        const length = view.getUint16(at + 20, true);
        records[`${textOf(bytes, at + 2, 16)}/${view.getUint16(at + 18, true)}`] = { at: at + 54, length: Math.min(length, to - at - 54) };
        at += 54 + length;
    }
    return records;
}

// The coordinate system's name from the WKT VLR, else the GeoTIFF citation and EPSG code; null without either.
function crsName(bytes, records) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (at, length) => textOf(bytes, at, length);
    const wkt = records['LASF_Projection/2112'];
    const name = wkt && /^\s*[A-Z_]+\[\s*"([^"]+)"/.exec(text(wkt.at, wkt.length))?.[1];
    if (name) return name;
    const keys = records['LASF_Projection/34735'];
    if (!keys || keys.length < 8) return null;
    const ascii = records['LASF_Projection/34737'];
    let code = 0, citation = '';
    // GeoKeys 3072 / 2048: projected / geographic EPSG code (32767 is user-defined); 3073 / 1026: citations.
    for (let k = 1; k <= view.getUint16(keys.at + 6, true) && 8 * k + 8 <= keys.length; k++) {
        const [id, location, length, value] = [0, 2, 4, 6].map(i => view.getUint16(keys.at + 8 * k + i, true));
        if ((id === 3072 || (id === 2048 && !code)) && location === 0 && value > 0 && value < 32767) code = value;
        if ([3073, 1026].includes(id) && location === 34737 && ascii && !citation) citation = text(ascii.at + value, Math.min(length, ascii.length - value)).split('|')[0];
    }
    if (!code) return citation || null;
    return citation ? `${citation} (EPSG:${code})` : `EPSG:${code}`;
}

// One suffix labels X, Y and Z, so mixed horizontal and vertical units, or degrees, give null.
const GEO_UNITS = { 9001: 1, 9002: 0.3048, 9003: 1200 / 3937 };
// UTM zones (WGS 84, NAD27, NAD83, ETRS89) are metres by definition; laspy writes only their EPSG code.
const UTM = [[32601, 32660], [32701, 32760], [26701, 26722], [26901, 26923], [25828, 25838]];
const ANGULAR = ['GEOGCS', 'GEOGCRS', 'BASEGEOGCRS'];
const oneOf = values => (values.size === 1 ? [...values][0] : null);
function lengthUnit(bytes, records) {
    const wkt = records['LASF_Projection/2112'];
    if (wkt) {
        const text = textOf(bytes, wkt.at, wkt.length);
        const units = new Set(), stack = [];
        const value = /\s*"[^"]*"\s*,\s*([-+\d.eE]+)/y;
        for (const token of text.matchAll(/([A-Z_]+)\s*\[|\]/g)) {
            if (!token[1]) {
                stack.pop();
                continue;
            }
            // A GEOGCS / GEOGCRS that is not a projection's base makes X and Y degrees.
            if (['GEOGCRS', 'GEOGCS'].includes(token[1]) && !['PROJCS', 'PROJCRS'].includes(stack.at(-1))) return null;
            if ((token[1] === 'UNIT' && !ANGULAR.includes(stack.at(-1))) || (token[1] === 'LENGTHUNIT' && stack.at(-1) !== 'ELLIPSOID')) {
                value.lastIndex = token.index + token[0].length;
                const factor = Number(value.exec(text)?.[1]);
                if (factor > 0) units.add(factor);
            }
            stack.push(token[1]);
        }
        return oneOf(units);
    }
    const keys = records['LASF_Projection/34735'];
    if (!keys || keys.length < 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const units = new Set();
    let projected = 0, model = 0, geographic = 0;
    for (let k = 1; k <= view.getUint16(keys.at + 6, true) && 8 * k + 8 <= keys.length; k++) {
        const [id, location, , value] = [0, 2, 4, 6].map(i => view.getUint16(keys.at + 8 * k + i, true));
        if (location !== 0) continue;
        if (id === 3076 || id === 4099) units.add(GEO_UNITS[value] ?? NaN);
        if (id === 3072) projected = value;
        if (id === 1024) model = value;
        if (id === 2048) geographic = value;
    }
    // GTModelType 2, or a geographic CRS that is not a projection's base, is in degrees.
    if (model === 2 || (geographic && !projected)) return null;
    if (!units.size && UTM.some(([from, to]) => projected >= from && projected <= to)) units.add(1);
    const unit = oneOf(units);
    return Number.isNaN(unit) ? null : unit;
}

// The public header and the coordinate system its VLRs name, from the bytes up to the point data.
function lasHeader(bytes) {
    headerNeeds(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const major = bytes[24], minor = bytes[25], headerSize = view.getUint16(94, true), pointOffset = view.getUint32(96, true);
    const formatByte = bytes[104], format = formatByte & 0x3f, recordLength = view.getUint16(105, true);
    if (major !== 1 || headerSize < 227 || pointOffset < headerSize) throw new Error(`the LAS header is broken (version ${major}.${minor}, header ${headerSize} bytes, points at byte ${pointOffset})`);
    if (!FORMATS[format]) throw new Error(`LAS point format ${format} is not one of 0-10`);
    if (recordLength < FORMATS[format].size) throw new Error(`the LAS point records are ${recordLength} bytes, shorter than point format ${format}'s ${FORMATS[format].size}`);
    const f64 = at => view.getFloat64(at, true);
    const wide = minor >= 4 && headerSize >= 375 ? view.getUint32(247, true) + view.getUint32(251, true) * 2 ** 32 : 0;
    const records = vlrsOf(bytes, headerSize, pointOffset, view.getUint32(100, true));
    const laszip = records['laszip encoded/22204'];
    return {
        version: `${major}.${minor}`, format, recordLength, pointOffset,
        // Bit 7 marks LAZ; bit 6 was used by early LAZ writers.
        compressed: (formatByte & 0xc0) !== 0,
        count: wide || view.getUint32(107, true),
        scale: [f64(131), f64(139), f64(147)],
        offset: [f64(155), f64(163), f64(171)],
        min: [f64(187), f64(203), f64(219)],
        max: [f64(179), f64(195), f64(211)],
        crs: crsName(bytes, records),
        metersPerUnit: lengthUnit(bytes, records),
        // 0 none, 1 pointwise, 2 pointwise chunked, 3 layered chunked (LAS 1.4 formats 6-10).
        compressor: laszip?.length >= 2 ? view.getUint16(laszip.at, true) : null
    };
}

// As for other clouds (recenter.mjs), an axis within 10 km keeps its coordinates.
const farOnly = ([x, y]) => [x, y].map(value => (Math.abs(value) >= FAR ? value : 0)).concat(0);

// Bytes needed before lasHeader can read `bytes`, or 0 once there are enough.
function headerNeeds(bytes) {
    if (bytes.length >= 4 && new TextDecoder('latin1').decode(bytes.subarray(0, 4)) !== 'LASF') throw new Error('not a LAS file: it does not start with LASF');
    if (bytes.length < 227) return 227;
    const pointOffset = new DataView(bytes.buffer, bytes.byteOffset, 227).getUint32(96, true);
    return bytes.length < Math.max(pointOffset, 227) ? Math.max(pointOffset, 227) : 0;
}

// Streams LAS points with the PCD reader's contract (pcdReader); `decompressed` takes the records a LAZ decoder hands on.
export function lasReader(limit = Infinity, { inside, expected, offset: given, decompressed = false } = {}) {
    let head = new Uint8Array(0), header = null, layout, sampler, center, positions, colors16, scalars, partial;
    let row = 0, filled = 0, rgbMax = 0, gpsFirst = NaN, gpsMin = Infinity;

    function setup(bytes) {
        header = lasHeader(bytes);
        if (header.compressed && !decompressed) throw new Error('the LAS point records are LAZ-compressed: open it as a .laz file');
        const { format, recordLength, scale, offset, min, max, count } = header;
        layout = FORMATS[format];
        // float32 snaps a UTM northing to 0.25 m, so far X / Y lose the bounds' middle in float64 first; Z keeps sub-mm in float32 up to a few km.
        const bounded = [0, 1].every(axis => min[axis] <= max[axis]) && !min.concat(max).every(value => value === 0);
        center = given ?? (bounded ? farOnly([0, 1].map(axis => offset[axis] + Math.round(((min[axis] + max[axis]) / 2 - offset[axis]) / scale[axis]) * scale[axis])) : null);
        sampler = pointSampler(count, limit, { inside, expected, offset: given });
        const { keep } = sampler;
        positions = new Float32Array(keep * 3);
        colors16 = layout.rgb >= 0 ? new Uint16Array(keep * 3) : null;
        scalars = Object.fromEntries(FIELDS.filter(name => name !== 'gps_time' || layout.gps >= 0).map(name => [name, new Float32Array(keep)]));
        partial = new Uint8Array(recordLength);
    }

    function emit(view, at) {
        row++;
        const { scale: s, offset: o } = header;
        const x = view.getInt32(at, true) * s[0] + o[0], y = view.getInt32(at + 4, true) * s[1] + o[1], z = view.getInt32(at + 8, true) * s[2] + o[2];
        // A header without bounds.
        center ??= farOnly([x, y]);
        // Over every record, not only those kept, so a detail read scales its colours and times as the sample did.
        let time = 0;
        if (layout.gps >= 0) {
            time = view.getFloat64(at + layout.gps, true);
            if (Number.isNaN(gpsFirst)) gpsFirst = time;
            gpsMin = Math.min(gpsMin, time);
        }
        let r = 0, g = 0, b = 0;
        if (colors16) {
            r = view.getUint16(at + layout.rgb, true), g = view.getUint16(at + layout.rgb + 2, true), b = view.getUint16(at + layout.rgb + 4, true);
            rgbMax = Math.max(rgbMax, r, g, b);
        }
        const kept = sampler.take(x, y, z);
        if (kept < 0) return;
        positions[kept * 3] = x - center[0];
        positions[kept * 3 + 1] = y - center[1];
        positions[kept * 3 + 2] = z;
        if (colors16) {
            colors16[kept * 3] = r;
            colors16[kept * 3 + 1] = g;
            colors16[kept * 3 + 2] = b;
        }
        const returns = view.getUint8(at + 14), wide = layout.wide;
        scalars.intensity[kept] = view.getUint16(at + 12, true);
        scalars.classification[kept] = wide ? view.getUint8(at + 16) : view.getUint8(at + 15) & 31;
        scalars.return_number[kept] = wide ? returns & 15 : returns & 7;
        scalars.point_source_id[kept] = view.getUint16(at + (wide ? 20 : 18), true);
        // Relative to the first record: absolute GPS seconds (1e9) lose whole seconds in float32.
        if (scalars.gps_time) scalars.gps_time[kept] = time - gpsFirst;
    }

    function pushRecords(chunk) {
        const { count, recordLength: stride } = header;
        let at = 0;
        if (filled) {
            at = Math.min(stride - filled, chunk.length);
            partial.set(chunk.subarray(0, at), filled);
            filled += at;
            if (filled < stride) return;
            if (row < count) emit(new DataView(partial.buffer), 0);
            filled = 0;
        }
        const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        for (; at + stride <= chunk.length && row < count; at += stride) emit(view, at);
        if (row < count && at < chunk.length) {
            partial.set(chunk.subarray(at));
            filled = chunk.length - at;
        }
    }

    return {
        push(chunk) {
            if (!header) {
                const joined = new Uint8Array(head.length + chunk.length);
                joined.set(head);
                joined.set(chunk, head.length);
                if (headerNeeds(joined)) {
                    head = joined;
                    return true;
                }
                setup(joined);
                chunk = joined.subarray(header.pointOffset);
                head = null;
            }
            pushRecords(chunk);
            return true;
        },
        finish() {
            if (!header) throw new Error(head.length < 227 ? `the LAS header is cut short at ${head.length} bytes` : `the LAS ends at byte ${head.length}, before its points at byte ${headerNeeds(head)}`);
            if (row < header.count) throw new Error(`the LAS ends after ${row} of its ${header.count.toLocaleString('en-US')} points`);
            const { kept } = sampler;
            const table = linearByteTable();
            let colors = null;
            if (colors16) {
                // Some writers put 8-bit values in the 16-bit channels.
                const shift = rgbMax > 255 ? 8 : 0;
                colors = new Uint8Array(kept * 3);
                for (let i = 0; i < kept * 3; i++) colors[i] = table[colors16[i] >> shift];
            }
            const fields = {};
            for (const [name, values] of Object.entries(scalars)) {
                const shown = values.subarray(0, kept);
                if (name === 'gps_time') for (let i = 0; i < kept; i++) shown[i] -= gpsMin - gpsFirst;
                if (shown.some(value => value !== shown[0])) fields[name] = shown;
            }
            const { version, format, crs, metersPerUnit } = header;
            return {
                total: header.count - sampler.missing,
                positions: positions.subarray(0, kept * 3),
                colors,
                scalars: fields,
                offset: center && (center[0] || center[1]) ? center : null,
                las: { version, format, crs, metersPerUnit }
            };
        }
    };
}

const WAVEFORM = [4, 5, 9, 10];
const COMPRESSORS = ['none', 'pointwise', 'pointwise chunked', 'layered chunked'];
const BATCH = 65536;

// A LAZ file of `size` bytes, held whole in a fresh laz-perf instance from `createModule` (chunked LAZ keeps its chunk table at the end); its points go through lasReader.
export async function lazReader(size, createModule, limit, region = {}) {
    const module = await createModule();
    const file = module._malloc(size);
    if (!file) throw new Error(`the LAZ file (${size} bytes) does not fit in the LAZ decoder's memory`);
    let at = 0;
    return {
        push(chunk) {
            if (at + chunk.length > size) throw Object.assign(new Error('the file changed while it was read'), { name: 'FileChanged' });
            module.HEAPU8.set(chunk, file + at);
            at += chunk.length;
            return true;
        },
        async finish() {
            const bytes = () => module.HEAPU8.subarray(file, file + at);
            const las = lasReader(limit, { ...region, decompressed: true });
            const header = at >= 227 && lasHeader(bytes());
            if (!header?.compressed) {
                las.push(bytes());
                return las.finish();
            }
            if (WAVEFORM.includes(header.format)) throw new Error(`LAZ point format ${header.format} carries waveforms, which the LAZ decoder cannot read`);
            las.push(bytes().slice(0, header.pointOffset));
            const zip = new module.LASZip();
            const stride = header.recordLength;
            const batch = module._malloc(BATCH * stride);
            let row = 0, opened = false;
            try {
                zip.open(file, at);
                opened = true;
                if (zip.getPointLength() !== stride) throw new Error(`its records are ${zip.getPointLength()} bytes, the header says ${stride}`);
                const count = Math.min(header.count, zip.getCount());
                while (row < count) {
                    const n = Math.min(BATCH, count - row);
                    for (let i = 0; i < n; i++, row++) zip.getPoint(batch + i * stride);
                    las.push(module.HEAPU8.subarray(batch, batch + n * stride));
                    // Decoding runs on the page's thread, so the spinner turns only between batches.
                    await new Promise(resolve => setTimeout(resolve));
                }
            } catch (error) {
                // laz-perf is built without exception catching, so its own message is lost.
                if (!opened) throw new Error(`the LAZ decoder cannot open this file: it is cut short, or its compressor (${COMPRESSORS[header.compressor] ?? 'none named'}) is not one laz-perf reads`);
                throw new Error(`the LAZ data is corrupt after ${row} of its ${header.count.toLocaleString('en-US')} points: ${error?.message ?? error}`);
            } finally {
                zip.delete();
                module._free(batch);
                module._free(file);
            }
            return las.finish();
        }
    };
}
