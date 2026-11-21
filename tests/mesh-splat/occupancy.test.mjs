import test from 'node:test';
import assert from 'node:assert/strict';
import { readPgm, readMapYaml, companionMap, mapModeText, occupancyCells, rgbaImage, mapColors, greyColors, imageBeside } from '../../packages/mesh-splat/webview/occupancy.mjs';

const bytes = (header, body) => new Uint8Array([...Buffer.from(header, 'latin1'), ...body]);

test('readPgm reads a binary 8-bit P5 image', () => {
    const pgm = readPgm(bytes('P5\n3 2\n255\n', [0, 128, 255, 10, 20, 30]));
    assert.deepEqual({ ...pgm, pixels: Array.from(pgm.pixels) }, { width: 3, height: 2, maxval: 255, pixels: [0, 128, 255, 10, 20, 30] });
});

test('readPgm skips header comments', () => {
    const pgm = readPgm(bytes('P5\n# CREATOR: map_saver.cpp 0.050 m/pix\n2 1 # size\n255\n', [7, 9]));
    assert.deepEqual([pgm.width, pgm.height, Array.from(pgm.pixels)], [2, 1, [7, 9]]);
});

test('readPgm reads 16-bit P5 samples as big-endian', () => {
    const pgm = readPgm(bytes('P5 2 1 65535\n', [0x01, 0x02, 0xff, 0xfe]));
    assert.deepEqual([pgm.maxval, Array.from(pgm.pixels)], [65535, [0x0102, 0xfffe]]);
});

test('readPgm reads ASCII P2, 8- and 16-bit, with comments', () => {
    const small = readPgm(bytes('P2\n# hand-made\n3 1\n15\n0 7\n# end of row\n15\n', []));
    assert.deepEqual([small.width, small.height, small.maxval, Array.from(small.pixels)], [3, 1, 15, [0, 7, 15]]);
    assert.deepEqual(Array.from(readPgm(bytes('P2 2 1 1000 999 1000', [])).pixels), [999, 1000]);
});

test('readPgm rejects a truncated body and a file that is not a greyscale PGM', () => {
    assert.throws(() => readPgm(bytes('P5\n4 4\n255\n', [1, 2, 3])), /PGM.*16 pixels.*3/);
    assert.throws(() => readPgm(bytes('P5\n2 2\n65535\n', [0, 1, 0, 2, 0, 3])), /PGM.*4 pixels.*3/);
    assert.throws(() => readPgm(bytes('P2\n2 2\n255\n1 2 3', [])), /PGM.*4 pixels.*3/);
    assert.throws(() => readPgm(bytes('P6\n1 1\n255\n', [1, 2, 3])), /not a greyscale PGM/);
    assert.throws(() => readPgm(bytes('P5\n1\n', [])), /PGM header/);
});

test('readPgm names a 16-bit P2 sample past 65535 as written', () => {
    assert.throws(() => readPgm(bytes('P2\n1 1\n65535\n70000\n', [])), /PGM sample 70000.*maxval 65535/);
});

test('mapModeText names negate only where the mode reads it', () => {
    assert.equal(mapModeText({ mode: 'trinary', negate: true }), 'trinary, negate');
    assert.equal(mapModeText({ mode: 'scale', negate: false }), 'scale');
    assert.equal(mapModeText({ mode: 'raw', negate: true }), 'raw');
});

test('companionMap can match the image name without case, as macOS and Windows disks do', async () => {
    const map = 'image: Map.PGM\nresolution: 0.05\norigin: [0, 0, 0]\n';
    const lookup = async name => (name === 'map.yaml' ? map : null);
    assert.equal((await companionMap('map.pgm', lookup)).map, null);
    assert.equal((await companionMap('map.pgm', lookup, { ignoreCase: true })).map?.resolution, 0.05);
});

test('readPgm rejects a sample above maxval', () => {
    assert.throws(() => readPgm(bytes('P5\n2 1\n100\n', [50, 101])), /PGM sample 101.*maxval 100/);
    assert.throws(() => readPgm(bytes('P2\n2 1\n15\n3 16\n', [])), /PGM sample 16.*maxval 15/);
    assert.throws(() => readPgm(bytes('P5\n1 1\n1000\n', [0x03, 0xe9])), /PGM sample 1001.*maxval 1000/);
});

test('readMapYaml reads a map_saver YAML with a flow sequence origin', () => {
    const text = 'image: my_map.pgm\nmode: trinary\nresolution: 0.05\norigin: [-10.2, -7.5, 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.25\n';
    assert.deepEqual(readMapYaml(text), { image: 'my_map.pgm', resolution: 0.05, origin: [-10.2, -7.5, 0], negate: false, occupiedThresh: 0.65, freeThresh: 0.25, mode: 'trinary' });
});

test('readMapYaml takes a block sequence origin, comments and a boolean negate', () => {
    const text = '# hand-written\nimage: "maps/floor 2.png"  # beside\nresolution: 0.1\norigin:\n  - 1\n  - 2\n  - 1.5708\nnegate: true\nmode: scale\n';
    const map = readMapYaml(text);
    assert.deepEqual([map.image, map.origin, map.negate, map.mode], ['maps/floor 2.png', [1, 2, 1.5708], true, 'scale']);
});

test('readMapYaml gives map_server defaults for missing optional keys', () => {
    assert.deepEqual(readMapYaml('image: a.pgm\nresolution: 1\norigin: [0, 0, 0]\n'), {
        image: 'a.pgm', resolution: 1, origin: [0, 0, 0], negate: false, occupiedThresh: 0.65, freeThresh: 0.196, mode: 'trinary'
    });
});

test('readMapYaml rejects missing or malformed required keys', () => {
    assert.throws(() => readMapYaml('resolution: 0.05\norigin: [0, 0, 0]\n'), /image/);
    assert.throws(() => readMapYaml('image: a.pgm\norigin: [0, 0, 0]\n'), /resolution/);
    assert.throws(() => readMapYaml('image: a.pgm\nresolution: 0.05\n'), /origin/);
    assert.throws(() => readMapYaml('image: a.pgm\nresolution: fine\norigin: [0, 0, 0]\n'), /resolution/);
    assert.throws(() => readMapYaml('image: a.pgm\nresolution: 0.05\norigin: [0, 0]\n'), /origin/);
    assert.throws(() => readMapYaml('image: a.pgm\nresolution: 0.05\norigin: [0, 0, 0]\nmode: costmap\n'), /mode/);
    assert.throws(() => readMapYaml('plugins: [a, b]\n'), /not a map/);
    assert.throws(() => readMapYaml('image: [a\n'), /YAML/);
});

// Expected cells follow Nav2 (Jazzy) map_io.cpp loadMapFromFile: occ = g / 255, or 1 - g / 255 without negate;
// occ >= occupied_thresh is 100, occ <= free_thresh is 0 (free wins), trinary leaves the rest -1 and scale gives
// round((occ - free) / (occupied - free) * 100); raw takes g itself when 0-100, else -1, ignoring negate; any alpha
// below 255 is -1 in trinary and scale. Thresholds here: occupied 0.65, free 0.196.
const settings = (mode, negate = false) => ({ mode, negate, occupiedThresh: 0.65, freeThresh: 0.196 });
const row = (pixels, extra = {}) => ({ width: pixels.length, height: 1, maxval: 255, pixels: Uint8Array.from(pixels), ...extra });
const cells = (image, map) => Array.from(occupancyCells(image, map));

test('companionMap passes over a same-named YAML whose image is another file', async () => {
    const other = 'image: maps/other.pgm\nresolution: 0.05\norigin: [0, 0, 0]\n';
    const own = 'image: ./sub/../room.pgm\nresolution: 0.1\norigin: [0, 0, 0]\n';
    const lookup = disk => async name => disk[name] ?? null;
    const passed = await companionMap('room.pgm', lookup({ 'room.yaml': other, 'room.yml': own }));
    assert.deepEqual([passed.name, passed.map?.resolution], ['room.yml', 0.1]);
    assert.match(passed.rejected[0], /^room\.yaml: .*maps\/other\.pgm/);
    assert.equal((await companionMap('room.pgm', lookup({ 'room.yaml': other }))).map, null);
});

test('companionMap takes the same-named .yaml, else the .yml, and passes over a YAML that is not a map', async () => {
    const map = 'image: room.pgm\nresolution: 0.05\norigin: [0, 0, 0]\n';
    const calibration = 'image_width: 640\nimage_height: 480\ncamera_name: front\n';
    const lookup = disk => async name => disk[name] ?? null;
    const both = await companionMap('room.pgm', lookup({ 'room.yaml': map, 'room.yml': calibration }));
    assert.deepEqual([both.name, both.map?.resolution, both.rejected], ['room.yaml', 0.05, []]);
    const yml = await companionMap('room.pgm', lookup({ 'room.yaml': calibration, 'room.yml': map }));
    assert.equal(yml.name, 'room.yml');
    assert.equal(yml.rejected.length, 1);
    assert.match(yml.rejected[0], /^room\.yaml: not a map YAML/);
    const none = await companionMap('room.pgm', lookup({ 'room.yaml': calibration }));
    assert.equal(none.map, null);
    assert.match(none.rejected.join(), /^room\.yaml: not a map YAML/);
    assert.deepEqual(await companionMap('room.pgm', lookup({})), { name: null, map: null, rejected: [] });
});

test('occupancyCells in trinary mode classifies by the thresholds', () => {
    // 205 is map_saver's unknown grey: occ 0.19608 > 0.196. 89: occ 0.651 >= 0.65. 100: occ 0.608, between.
    assert.deepEqual(cells(row([0, 254, 255, 205, 89, 100]), settings('trinary')), [100, 0, 0, -1, 100, -1]);
    // Negated, 50 gives occ 0.19608: unknown; 205 gives 0.804: occupied.
    assert.deepEqual(cells(row([0, 255, 205, 50]), settings('trinary', true)), [0, 100, 100, -1]);
});

test('occupancyCells calls a grey that meets both thresholds occupied, as Nav2 does', () => {
    // occupied_thresh 0.4 below free_thresh 0.6: grey 128 (occ 0.498) is past both.
    const crossed = mode => ({ mode, negate: false, occupiedThresh: 0.4, freeThresh: 0.6 });
    assert.deepEqual(cells(row([128]), crossed('trinary')), [100]);
    assert.deepEqual(cells(row([128]), crossed('scale')), [100]);
});

test('occupancyCells in scale mode keeps the shades between the thresholds', () => {
    // 128: occ 0.49804 -> 66.5 -> 67. 180: occ 0.29412 -> 21.6 -> 22. 205: occ 0.19608 -> 0.02 -> 0. 64: occ 0.749.
    assert.deepEqual(cells(row([0, 255, 128, 180, 205, 64, 100]), settings('scale')), [100, 0, 67, 22, 0, 100, 91]);
    // Negated, 100: occ 0.39216 -> 43.2 -> 43.
    assert.deepEqual(cells(row([0, 255, 100]), settings('scale', true)), [0, 100, 43]);
});

test('occupancyCells in raw mode takes the grey level as the cell value and ignores negate', () => {
    const expected = [0, 50, 100, -1, -1];
    assert.deepEqual(cells(row([0, 50, 100, 101, 255]), settings('raw')), expected);
    assert.deepEqual(cells(row([0, 50, 100, 101, 255]), settings('raw', true)), expected);
});

test('occupancyCells reads any alpha below 255 as unknown in trinary and scale, not in raw', () => {
    const image = row([0, 0, 255, 50], { alpha: Uint8Array.from([255, 254, 0, 0]) });
    assert.deepEqual(cells(image, settings('trinary')), [100, -1, -1, -1]);
    assert.deepEqual(cells(image, settings('scale')), [100, -1, -1, -1]);
    assert.deepEqual(cells(image, settings('raw')), [0, 0, -1, 50]);
});

test('occupancyCells scales 16-bit samples to 8 bits first', () => {
    const image = { width: 3, height: 1, maxval: 65535, pixels: Uint16Array.from([0, 65535, 205 * 257]) };
    assert.deepEqual(cells(image, settings('trinary')), [100, 0, -1]);
});

test('occupancyCells puts the bottom image row in cell row 0', () => {
    // Image rows top to bottom: [black, white], [white, white]; only the top-left cell is occupied.
    const image = { width: 2, height: 2, maxval: 255, pixels: Uint8Array.from([0, 255, 255, 255]) };
    assert.deepEqual(cells(image, settings('trinary')), [0, 0, 100, 0]);
});

test('rgbaImage takes Rec. 601 luma as the grey level and keeps alpha', () => {
    // Pure red: 0.299 * 255 = 76.2 -> 76, occ 0.702: occupied. White half-transparent: unknown.
    const image = rgbaImage(Uint8ClampedArray.from([255, 0, 0, 255, 255, 255, 255, 128]), 2, 1);
    assert.deepEqual([image.width, image.height, image.maxval, Array.from(image.pixels), Array.from(image.alpha)], [2, 1, 255, [76, 255], [255, 128]]);
    assert.deepEqual(cells(image, settings('trinary')), [100, -1]);
});

test('mapColors colors cells as RViz Map display\'s map scheme does', () => {
    // rviz_default_plugins palette_builder.cpp makeMapPalette: 0-100 grey 255 - (255 * v) / 100 (integer
    // division), -1 is 0x708986, other negatives red to yellow, 101-127 green.
    const rgba = Array.from(mapColors(Int8Array.from([0, 100, 50, -1, 101, -128])));
    assert.deepEqual(rgba, [255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 0x70, 0x89, 0x86, 255, 0, 255, 0, 255, 255, 0, 0, 255]);
});

test('greyColors shows a PGM without a map YAML as its grey levels, bottom row first', () => {
    const image = { width: 2, height: 2, maxval: 65535, pixels: Uint16Array.from([0, 65535, 257 * 100, 257 * 200]) };
    assert.deepEqual(Array.from(greyColors(image)), [100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
});

test('an image named with a folder is also looked for by its name beside the YAML', () => {
    assert.equal(imageBeside('/data/maps/floor.pgm'), 'floor.pgm');
    assert.equal(imageBeside('C:\\maps\\floor.pgm'), 'floor.pgm');
    assert.equal(imageBeside('sub/floor.pgm'), 'floor.pgm');
    assert.equal(imageBeside('floor.pgm'), null);
});
