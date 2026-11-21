import { load } from 'js-yaml';

const MODES = ['trinary', 'scale', 'raw'];

// ROS 1 `map_saver -f /abs/name` writes the image's absolute path, and a map moved since has its image beside the
// YAML: the name to look for there, or null for an image named without a folder.
export function imageBeside(image) {
    const name = image.split(/[\\/]/).pop();
    return name && name !== image ? name : null;
}

// Nav2's map_server requires the thresholds and negate; a hand-written map often leaves them out. The defaults
// are what most maps carry (ROS 1 map_saver, TurtleBot3): with them map_saver's unknown grey 205 (occ 0.19608)
// stays unknown, where Nav2 map_saver's own default free_thresh 0.25 would read it as free.
export function readMapYaml(text) {
    let doc;
    try {
        doc = load(text);
    } catch (error) {
        throw new Error(`YAML: ${error.reason ?? error.message}`);
    }
    if (!doc || typeof doc !== 'object' || (!('image' in doc) && !('resolution' in doc))) throw new Error('not a map YAML: it has no image or resolution key');
    const { image, resolution, origin, negate = 0, occupied_thresh: occupiedThresh = 0.65, free_thresh: freeThresh = 0.196, mode = 'trinary' } = doc;
    if (typeof image !== 'string' || !image) throw new Error('map YAML needs an image file name');
    if (typeof resolution !== 'number' || !(resolution > 0)) throw new Error('map YAML needs a positive resolution (m/cell)');
    if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) throw new Error('map YAML needs an origin of three numbers [x, y, yaw]');
    if (!Number.isFinite(occupiedThresh) || !Number.isFinite(freeThresh)) throw new Error('map YAML occupied_thresh and free_thresh must be numbers');
    if (!MODES.includes(mode)) throw new Error(`map YAML mode must be ${MODES.join(', ')}, not ${mode}`);
    return { image, resolution, origin, negate: Boolean(negate), occupiedThresh, freeThresh, mode };
}

// raw takes the grey level as it is and ignores negate.
export const mapModeText = map => (map.negate && map.mode !== 'raw' ? `${map.mode}, negate` : map.mode);

// The map YAML beside the PGM `pgm`: `stem.yaml`, else `stem.yml`. One of that name that is not a map (a camera
// calibration) or that names another image is passed over and named in `rejected`, so the PGM still opens.
// `textOf(name)` is the file's text, or null when there is none.
export async function companionMap(pgm, textOf, { ignoreCase = false } = {}) {
    const same = (a, b) => (ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);
    const stem = pgm.replace(/\.[^.]*$/, '');
    const rejected = [];
    for (const name of [`${stem}.yaml`, `${stem}.yml`]) {
        const text = await textOf(name);
        if (text === null) continue;
        try {
            const map = readMapYaml(text);
            if (!same(map.image.split(/[\\/]/).pop(), pgm)) throw new Error(`its image is ${map.image}, not ${pgm}`);
            return { name, map, rejected };
        } catch (error) {
            rejected.push(`${name}: ${error.message}`);
        }
    }
    return { name: null, map: null, rejected };
}

// Nav2 (Jazzy on) classifies the 8-bit grey level in float32, thresholds included; doing the same keeps a grey
// that lands on a threshold in the class map_server puts it in. Humble and ROS 1 differ at the edges: strict
// comparisons, and in trinary mode alpha averaged into the grey instead of making the cell unknown.
function cellOfGrey(map) {
    const f = Math.fround;
    const occupied = f(map.occupiedThresh);
    const free = f(map.freeThresh);
    const span = f(map.occupiedThresh - map.freeThresh);
    const table = new Int8Array(256);
    for (let g = 0; g < 256; g++) {
        if (map.mode === 'raw') {
            table[g] = g <= 100 ? g : -1;
            continue;
        }
        const occ = map.negate ? f(g / 255) : f(1 - f(g / 255));
        let value = -1;
        // A grey past both thresholds (occupied_thresh below free_thresh) is occupied, as Nav2 checks it first.
        if (occ >= occupied) value = 100;
        else if (occ <= free) value = 0;
        else if (map.mode === 'scale') value = Math.round(f(f(f(occ - free) / span) * 100));
        table[g] = value;
    }
    return table;
}

// Cells as map_server publishes them: row 0 is the bottom image row, values 0-100 or -1 for unknown.
export function occupancyCells({ width, height, maxval = 255, pixels, alpha }, map) {
    const table = cellOfGrey(map);
    const cells = new Int8Array(width * height);
    const transparentUnknown = alpha && map.mode !== 'raw';
    for (let y = 0; y < height; y++) {
        const from = y * width;
        const to = (height - 1 - y) * width;
        for (let x = 0; x < width; x++) {
            const grey = maxval === 255 ? pixels[from + x] : Math.round(pixels[from + x] * 255 / maxval);
            cells[to + x] = transparentUnknown && alpha[from + x] < 255 ? -1 : table[grey];
        }
    }
    return cells;
}

// RViz's Map display, `map` color scheme (rviz_default_plugins palette_builder.cpp), indexed by the cell's byte.
const MAP_PALETTE = new Uint8Array(256 * 4);
for (let i = 0; i < 256; i++) {
    const v = 255 - Math.floor((255 * i) / 100);
    const rgb = i <= 100 ? [v, v, v] : i <= 127 ? [0, 255, 0] : i <= 254 ? [255, Math.floor((255 * (i - 128)) / 126), 0] : [0x70, 0x89, 0x86];
    MAP_PALETTE.set([...rgb, 255], 4 * i);
}

export function mapColors(cells) {
    const rgba = new Uint8Array(cells.length * 4);
    const bytes = new Uint8Array(cells.buffer, cells.byteOffset, cells.length);
    // One 32-bit copy per cell; both views share the platform's byte order, so RGBA stays RGBA.
    const palette = new Uint32Array(MAP_PALETTE.buffer);
    const out = new Uint32Array(rgba.buffer);
    for (let i = 0; i < bytes.length; i++) out[i] = palette[bytes[i]];
    return rgba;
}

export function greyColors({ width, height, maxval, pixels }) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const grey = Math.round(pixels[y * width + x] * 255 / maxval);
            const at = 4 * ((height - 1 - y) * width + x);
            rgba[at] = rgba[at + 1] = rgba[at + 2] = grey;
            rgba[at + 3] = 255;
        }
    }
    return rgba;
}

// Nav2 reads images through GraphicsMagick's greyscale conversion, Rec. 601 luma for colour pixels.
export function rgbaImage(data, width, height) {
    const pixels = new Uint8Array(width * height);
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = Math.round(0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2]);
        alpha[i] = data[4 * i + 3];
    }
    return { width, height, maxval: 255, pixels, alpha };
}

const isSpace = byte =>byte === 32 || (byte >= 9 && byte <= 13);

// Decimal numbers of a PGM header or P2 body, skipping whitespace and '#' comments; `at` is past the last one.
function numberReader(bytes, at) {
    return {
        get at() { return at; },
        next() {
            for (;;) {
                while (at < bytes.length && isSpace(bytes[at])) at++;
                if (bytes[at] !== 35) break;
                while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at++;
            }
            let value = 0;
            const start = at;
            while (at < bytes.length && bytes[at] >= 48 && bytes[at] <= 57) value = value * 10 + bytes[at++] - 48;
            return at > start ? value : NaN;
        }
    };
}

export function readPgm(bytes) {
    const magic = String.fromCharCode(bytes[0], bytes[1]);
    if (magic !== 'P2' && magic !== 'P5') throw new Error('not a greyscale PGM (P2 or P5)');
    const numbers = numberReader(bytes, 2);
    const [width, height, maxval] = [numbers.next(), numbers.next(), numbers.next()];
    if (!(width > 0 && height > 0 && maxval > 0 && maxval <= 65535)) throw new Error('PGM header needs a width, a height and a maxval of 1-65535');
    const count = width * height;
    const pixels = maxval > 255 ? new Uint16Array(count) : new Uint8Array(count);
    const truncated = read => new Error(`PGM body ends early: ${count} pixels declared, ${read} present`);
    // A sample past maxval would scale past white and wrap.
    const tooHigh = (i, value = pixels[i]) => new Error(`PGM sample ${value} at pixel ${i} is above maxval ${maxval}`);
    if (magic === 'P2') {
        for (let i = 0; i < count; i++) {
            const value = numbers.next();
            if (Number.isNaN(value)) throw truncated(i);
            if (value > maxval) throw tooHigh(i, value);
            pixels[i] = value;
        }
    } else {
        // One whitespace byte separates maxval from the binary body.
        const body = numbers.at + 1;
        const size = maxval > 255 ? 2 : 1;
        if (bytes.length - body < count * size) throw truncated(Math.max(0, Math.floor((bytes.length - body) / size)));
        if (size === 2) for (let i = 0; i < count; i++) pixels[i] = (bytes[body + 2 * i] << 8) | bytes[body + 2 * i + 1];
        else pixels.set(bytes.subarray(body, body + count));
        if (maxval !== 255 && maxval !== 65535) for (let i = 0; i < count; i++) if (pixels[i] > maxval) throw tooHigh(i);
    }
    return { width, height, maxval, pixels };
}
