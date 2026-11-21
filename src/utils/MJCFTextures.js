// MJCF 2D textures, matched to MuJoCo's classic renderer (render_gl3.c
// settexture, render_context.c makePlane, user_objects.cc Builtin2D) rather
// than to three.js conventions:
// - Textures keep MuJoCo's row order (row 0 at v = 0), so file textures load
//   with flipY off and the builtin ones are uploaded as generated.
// - Each geom gets its own uv transform, because texrepeat and texuniform
//   depend on the geom's size. Clones share the image and the GPU upload.
// - Colors are tagged sRGB: MuJoCo writes texture bytes to the screen as is.
// Cube and skybox textures are not drawn: the viewer has its own background,
// and a cube texture on a box is rare in robot models.
import * as THREE from 'three';
import { textureManager } from './MeshLoader.js';

const MAX_BUILTIN_PIXELS = 4096 * 4096;

const numbers = (text, fallback) => {
    if (text == null) return fallback;
    const values = text.trim().split(/\s+/).map(Number);
    return values.every(Number.isFinite) && values.length >= fallback.length ? values : fallback;
};

/** `<texture>` elements by name; `type` defaults to cube, as in MuJoCo. */
export function parseTextures(doc, resolvePath) {
    const textures = new Map();
    for (const element of doc.querySelectorAll('asset > texture')) {
        const file = element.getAttribute('file');
        const name = element.getAttribute('name')
            || (file ? file.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]*$/, '') : null);
        if (!name) continue;
        textures.set(name, {
            name,
            type: element.getAttribute('type') || 'cube',
            builtin: element.getAttribute('builtin') || 'none',
            file: file ? resolvePath(file) : null,
            width: parseInt(element.getAttribute('width') || '0', 10),
            height: parseInt(element.getAttribute('height') || '0', 10),
            rgb1: numbers(element.getAttribute('rgb1'), [0.8, 0.8, 0.8]),
            rgb2: numbers(element.getAttribute('rgb2'), [0.5, 0.5, 0.5]),
            markrgb: numbers(element.getAttribute('markrgb'), [0, 0, 0]),
            mark: element.getAttribute('mark') || 'none',
            random: parseFloat(element.getAttribute('random') ?? '0.01'),
            hflip: element.getAttribute('hflip') === 'true',
            vflip: element.getAttribute('vflip') === 'true'
        });
    }
    return textures;
}

/** The texture part of a `<material>`: `texture`, or an rgb `<layer>` (MuJoCo 3.2+). */
export function parseMaterialTexture(element) {
    const layer = Array.from(element.children).find(child =>
        child.tagName === 'layer' && (child.getAttribute('role') || 'rgb') === 'rgb');
    return {
        texture: element.getAttribute('texture') || layer?.getAttribute('texture') || null,
        texrepeat: numbers(element.getAttribute('texrepeat'), [1, 1]),
        texuniform: element.getAttribute('texuniform') === 'true'
    };
}

// MuJoCo seeds a mt19937_64 with 42 for random marks. The exact dots are not
// reproduced, only their density.
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** RGBA pixels of a builtin 2D texture, row 0 first; null when MuJoCo would reject it. */
export function builtinTexturePixels(spec) {
    const { width, height, builtin, mark } = spec;
    if (!(width >= 1 && height >= 1) || width * height > MAX_BUILTIN_PIXELS) return null;
    const byte = color => color.map(c => Math.trunc(255 * c));
    const rgb1 = byte(spec.rgb1), rgb2 = byte(spec.rgb2), markrgb = byte(spec.markrgb);
    const data = new Uint8Array(width * height * 4);
    const put = (r, c, rgb) => {
        const i = 4 * (r * width + c);
        data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    };

    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (builtin === 'gradient') {
                const x = 2 * c / (width - 1) - 1;
                const y = 1 - 2 * r / (height - 1);
                const pos = 2 * Math.sqrt(x * x + y * y) - 1;
                const alpha = Math.min(1, Math.max(0, 0.5 * (1 + pos / Math.sqrt(1 + pos * pos) * Math.SQRT2)));
                put(r, c, [0, 1, 2].map(j => Math.trunc(255 * (alpha * spec.rgb2[j] + (1 - alpha) * spec.rgb1[j]))));
            } else if (builtin === 'checker') {
                put(r, c, (r < Math.trunc(height / 2)) === (c < Math.trunc(width / 2)) ? rgb1 : rgb2);
            } else {
                put(r, c, rgb1);
            }
        }
    }

    if (mark === 'edge') {
        for (let r = 0; r < height; r++) { put(r, 0, markrgb); put(r, width - 1, markrgb); }
        for (let c = 0; c < width; c++) { put(0, c, markrgb); put(height - 1, c, markrgb); }
    } else if (mark === 'cross') {
        for (let r = 0; r < height; r++) put(r, Math.trunc(width / 2), markrgb);
        for (let c = 0; c < width; c++) put(Math.trunc(height / 2), c, markrgb);
    } else if (mark === 'random' && spec.random > 0) {
        const random = seededRandom(42);
        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) if (random() < spec.random) put(r, c, markrgb);
        }
    }
    return data;
}

function prepare(texture) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    // A floor repeats its texture hundreds of times; without mipmaps and
    // anisotropy the far tiles shimmer.
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
}

/** A three.js texture for a 2D MJCF texture, or null (cube, missing file, invalid builtin). */
export async function loadTexture(spec, fileMap) {
    if (spec.type !== '2d') return null;
    if (spec.builtin !== 'none') {
        const data = builtinTexturePixels(spec);
        if (!data) {
            console.warn(`MJCF texture "${spec.name}": builtin textures need width and height`);
            return null;
        }
        return prepare(new THREE.DataTexture(data, spec.width, spec.height, THREE.RGBAFormat));
    }
    if (!spec.file || !fileMap) return null;
    try {
        const texture = await new THREE.TextureLoader(textureManager(fileMap)).loadAsync(spec.file);
        texture.flipY = false;
        return prepare(texture);
    } catch {
        console.warn(`MJCF texture "${spec.name}": cannot load ${spec.file}`);
        return null;
    }
}

/**
 * The uv transform that makes three.js geometry sample a texture where
 * MuJoCo would. `geometry` is the parsed MJCF GeometryType.
 */
export function textureMatrix(geometry, { texrepeat, texuniform }, spec = {}) {
    const type = geometry.type;
    const infinitePlane = type === 'plane' && geometry.infinite;
    const size = geometry.size || {};
    // MuJoCo's geom size: half extents for plane and box, radius and half height otherwise.
    const halfSize = type === 'plane' ? [infinitePlane ? 0 : size.width / 2, infinitePlane ? 0 : size.height / 2]
        : type === 'box' ? [size.x / 2, size.y / 2]
        : type === 'sphere' ? [size.radius, 0]
        : type === 'cylinder' || type === 'capsule' ? [size.radius, size.height / 2]
        : [0, 0];

    const scale = texrepeat.map(r => (r > 0 ? r : 1));
    if (texuniform && type !== 'mesh') {
        for (const k of [0, 1]) if (halfSize[k] > 0) scale[k] *= halfSize[k];
    }

    // three.js uv -> MuJoCo texcoord. MuJoCo flips v of OBJ texcoords and of
    // its own primitives; an infinite plane is textured in metres.
    let [au, bu, av, bv] = infinitePlane
        ? [0.5 * size.width, -0.25 * size.width, -0.5 * size.height, 0.25 * size.height]
        : [1, 0, -1, 1];
    const shift = infinitePlane ? -0.5 : 0;
    [au, bu, av, bv] = [scale[0] * au, scale[0] * bu + shift, scale[1] * av, scale[1] * bv + shift];
    if (spec.hflip) [au, bu] = [-au, 1 - bu];
    if (spec.vflip) [av, bv] = [-av, 1 - bv];
    return new THREE.Matrix3().set(au, 0, bu, 0, av, bv, 0, 0, 1);
}

/** Put `texture` on every mesh of `object` that has texture coordinates. */
export function applyTexture(object, texture, matrix) {
    const textured = texture.clone();
    textured.matrixAutoUpdate = false;
    textured.matrix.copy(matrix);
    object.traverse(child => {
        if (!child.isMesh || !child.geometry?.attributes?.uv) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (!material) continue;
            material.map = textured;
            material.needsUpdate = true;
        }
    });
}
