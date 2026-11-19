import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { readPlyHeader, plyKind, addMissingScale, readPlyPoints, readPlyMesh } from './ply.mjs';
import { flatNormals, percentile, grown } from './geometry.mjs';
import { createCloudColors } from './cloud-colors.mjs';
import { hasColor, MESH_GREY, POINT_GREY, surfaceMaterial } from './materials.mjs';
import { parsePointsText, parseOff } from './text-formats.mjs';
import { createCameraKeys } from '../../../src/utils/camera-keys.js';
import { pcdReader, dropNaNPoints } from './pcd.mjs';
import { createTransport } from './transport.mjs';

const STRINGS = {
    en: { detailInView: 'Load detail in view', colorRgb: 'Original color', colorHeight: 'Height', colorIntensity: 'Intensity', pointsShown: '{0} shown of {1}', help: 'Controls', pointSmall: 'Small points', pointMedium: 'Medium points', pointLarge: 'Large points', helpKeyOrbit: 'Left drag', helpOrbit: 'Rotate', helpKeyPan: 'Right / middle drag', helpPan: 'Pan', helpKeyZoom: 'Wheel', helpZoom: 'Zoom toward the cursor', helpKeyPivot: 'Double-click', helpPivot: 'Set the rotation center', helpKeyFly: 'W A S D', helpFly: 'Move', helpKeyTurn: 'Q E', helpTurn: 'Turn', helpKeyFast: 'Shift', helpFast: 'Faster', helpKeyFrame: 'F', helpFrame: 'Frame the model', display: 'Display', stage: 'Stage', primName: 'Name', primType: 'Type', notLoaded: 'Not loaded', info: 'Info', solid: 'Solid', wireframe: 'Wireframe', points: 'Points', loading: 'Loading', unsupportedFormat: 'Unsupported file format', file: 'File', format: 'Format', fileSize: 'File size', vertices: 'Vertices', faces: 'Faces', pointCount: 'Points', splats: 'Splats', size: 'Size', mesh: 'Mesh', pointCloud: 'Point cloud', gaussian: 'Gaussian splat', flat: '2DGS (flattened)', failed: 'Cannot open this file', flatUnsupported: '2DGS PLY must be binary little-endian with vertex as the first element', screenshot: 'Save screenshot' },
    'zh-TW': { detailInView: '載入視野內細節', colorRgb: '原色', colorHeight: '高度', colorIntensity: '強度', pointsShown: '顯示 {0} / 共 {1}', help: '操作說明', pointSmall: '小點', pointMedium: '中點', pointLarge: '大點', helpKeyOrbit: '左鍵拖曳', helpOrbit: '旋轉', helpKeyPan: '右鍵／中鍵拖曳', helpPan: '平移', helpKeyZoom: '滾輪', helpZoom: '朝游標縮放', helpKeyPivot: '雙擊', helpPivot: '設定旋轉中心', helpKeyFly: 'W A S D', helpFly: '移動', helpKeyTurn: 'Q E', helpTurn: '轉向', helpKeyFast: 'Shift', helpFast: '加速', helpKeyFrame: 'F', helpFrame: '回到全貌', display: '顯示', stage: 'Stage', primName: '名稱', primType: '類型', notLoaded: '未載入', info: '資訊', solid: '實體', wireframe: '線框', points: '點', loading: '正在載入', unsupportedFormat: '不支援的檔案格式', file: '檔案', format: '格式', fileSize: '檔案大小', vertices: '頂點', faces: '面', pointCount: '點數', splats: 'Splat 數', size: '尺寸', mesh: '網格', pointCloud: '點雲', gaussian: '高斯潑濺', flat: '2DGS（已壓平）', failed: '無法開啟這個檔案', flatUnsupported: '2DGS PLY 必須是 binary little-endian，且 vertex 是第一個 element', screenshot: '儲存截圖' },
    'zh-CN': { detailInView: '加载视野内细节', colorRgb: '原色', colorHeight: '高度', colorIntensity: '强度', pointsShown: '显示 {0} / 共 {1}', help: '操作说明', pointSmall: '小点', pointMedium: '中点', pointLarge: '大点', helpKeyOrbit: '左键拖曳', helpOrbit: '旋转', helpKeyPan: '右键／中键拖曳', helpPan: '平移', helpKeyZoom: '滚轮', helpZoom: '朝光标缩放', helpKeyPivot: '双击', helpPivot: '设置旋转中心', helpKeyFly: 'W A S D', helpFly: '移动', helpKeyTurn: 'Q E', helpTurn: '转向', helpKeyFast: 'Shift', helpFast: '加速', helpKeyFrame: 'F', helpFrame: '回到全貌', display: '显示', stage: 'Stage', primName: '名称', primType: '类型', notLoaded: '未加载', info: '信息', solid: '实体', wireframe: '线框', points: '点', loading: '正在加载', unsupportedFormat: '不支持的文件格式', file: '文件', format: '格式', fileSize: '文件大小', vertices: '顶点', faces: '面', pointCount: '点数', splats: 'Splat 数', size: '尺寸', mesh: '网格', pointCloud: '点云', gaussian: '高斯泼溅', flat: '2DGS（已压平）', failed: '无法打开这个文件', flatUnsupported: '2DGS PLY 必须是 binary little-endian，且 vertex 是第一个 element', screenshot: '保存截图' }
};
const lang = document.documentElement.lang.toLowerCase();
const strings = STRINGS[/^zh-(tw|hk|mo|hant)/.test(lang) ? 'zh-TW' : lang.startsWith('zh') ? 'zh-CN' : 'en'];
const t = key => strings[key] ?? STRINGS.en[key];
const $ = id => document.getElementById(id);

const page = document.body.dataset;
const { src, name, bytes: fileSize, cached } = page;
const vscodeApi = globalThis.acquireVsCodeApi?.();
const transport = createTransport(vscodeApi, page);
const ext = name.split('.').pop().toLowerCase();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.zoomToCursor = true;
controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.5), camera);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(1, 2, 3);
camera.add(sun);
const root = new THREE.Group();
scene.add(root);
const UP = { '+Y': [0, 0, 0], '-Y': [Math.PI, 0, 0], '+Z': [-Math.PI / 2, 0, 0], '-Z': [Math.PI / 2, 0, 0], '+X': [0, 0, Math.PI / 2], '-X': [0, 0, -Math.PI / 2] };
let localBox = null;
const cloudColors = createCloudColors({ root, upAxis: () => $('up-select').value });

function syncTheme() {
    const theme = /\bvscode-(high-contrast-)?light\b/.test(document.body.className) ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    scene.background = new THREE.Color(theme === 'light' ? 0xffffff : 0x505050);
}
syncTheme();
new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

new ResizeObserver(() => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}).observe(document.body);
const raycaster = new THREE.Raycaster();
const visibleInScene = object => !object || (object.visible && visibleInScene(object.parent));
const cameraKeys = createCameraKeys({
    camera,
    target: controls.target,
    element: renderer.domElement,
    pick: ndc => {
        raycaster.setFromCamera(ndc, camera);
        raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.01;
        return raycaster.intersectObject(root, true).find(({ object }) => visibleInScene(object))?.point;
    },
    frame: () => localBox && frame()
});
renderer.setAnimationLoop(() => {
    cameraKeys();
    controls.update();
    renderer.render(scene, camera);
});

const fetchBytes = async () => new Uint8Array(await (await fetch(src)).arrayBuffer());
const fetchText = async () => (await fetch(src)).text();

// PLY doubles arrive as Float64Array, which WebGL cannot take: the first draw throws and nothing renders.
function float32Attributes(geometry) {
    for (const [key, attribute] of Object.entries(geometry.attributes)) {
        if (attribute.array instanceof Float64Array) geometry.setAttribute(key, new THREE.BufferAttribute(new Float32Array(attribute.array), attribute.itemSize));
    }
    return geometry;
}

function meshOf(geometry) {
    float32Attributes(geometry);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, surfaceMaterial(hasColor(geometry) ? [1, 1, 1] : MESH_GREY, { vertexColors: hasColor(geometry) }));
}

let pointSize = 2;
const pointsOf = geometry => new THREE.Points(float32Attributes(geometry), new THREE.PointsMaterial({
    size: pointSize, sizeAttenuation: false, color: hasColor(geometry) ? 0xffffff : POINT_GREY, vertexColors: hasColor(geometry)
}));

// Typed arrays are used as they are; Uint8 colors are read as 0-255.
function geometryFrom({ positions, normals, uvs, colors, indices }) {
    const geometry = new THREE.BufferGeometry();
    const attribute = (array, size) => new THREE.BufferAttribute(ArrayBuffer.isView(array) ? array : new Float32Array(array), size, array instanceof Uint8Array);
    geometry.setAttribute('position', attribute(positions, 3));
    if (normals) geometry.setAttribute('normal', attribute(normals, 3));
    if (uvs) geometry.setAttribute('uv', attribute(uvs, 2));
    if (colors) geometry.setAttribute('color', attribute(colors, 3));
    if (indices) geometry.setIndex(ArrayBuffer.isView(indices) ? new THREE.BufferAttribute(indices, 1) : indices);
    return geometry;
}

async function loadObj() {
    const text = await fetchText();
    const loader = new OBJLoader();
    const mtl = text.match(/^mtllib\s+(.+)$/m)?.[1].trim();
    if (mtl) {
        const materials = await new MTLLoader().loadAsync(new URL(mtl, new URL(src, location.href)).href).catch(() => null);
        if (materials) loader.setMaterials((materials.preload(), materials));
    }
    return loader.parse(text);
}

// Spark is 2.4 MB of inlined WASM, loaded only when a splat opens; splats are marked so code that only
// needs to recognise them never imports it.
let sparkRenderer = null;
async function loadSplat(bytes, info, fileName = name) {
    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    if (!sparkRenderer) root.add(sparkRenderer = new SparkRenderer({ renderer }));
    const splat = new SplatMesh({ fileBytes: bytes, fileName });
    splat.userData.splat = true;
    await splat.initialized;
    info.format ??= t('gaussian');
    info.splats = (info.splats ?? 0) + (splat.packedSplats?.numSplats ?? splat.numSplats);
    return splat;
}

async function loadPly(info) {
    const bytes = await fetchBytes();
    const header = readPlyHeader(bytes);
    const kind = header && plyKind(header);
    if (kind === 'splat') {
        const patched = addMissingScale(bytes, header);
        if (!patched) throw new Error(t('flatUnsupported'));
        if (patched !== bytes) info.format = t('flat');
        return loadSplat(patched, info);
    }
    const points = kind === 'points' ? readPlyPoints(bytes, header) : kind === 'mesh' && readPlyMesh(bytes, header);
    if (points) return (points.indices ? meshOf : pointsOf)(geometryFrom(points));
    const geometry = new PLYLoader().parse(bytes.buffer);
    return kind === 'mesh' ? meshOf(geometry) : pointsOf(geometry);
}

// The up menu shows the file's own up axis. Files that do not declare one start +Z (ROS REP 103), splats
// included: robot-side splats (Isaac Sim, nerfstudio) are Z-up, raw COLMAP / 3DGS output needs -Y by hand.
function withUp(object, up) {
    object.userData.up = up;
    return object;
}
// The Draco and meshopt decoders load only when a glTF opens, and Draco's workers start only for a file
// that uses KHR_draco_mesh_compression.
async function loadGltf() {
    const [{ DRACOLoader, DRACO_GLTF_CONFIG }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/DRACOLoader.js'),
        import('meshoptimizer/decoder')
    ]);
    const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
    try {
        const gltf = await new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).loadAsync(src);
        return withUp(gltf.scene, '+Y');
    } finally {
        draco.dispose();
    }
}
// ponytail: past the limit an even sample shows, and the detail in view is read for the view at the click,
// one at a time, with a full re-read of the file (docs/mesh-splat.md).
const POINT_LIMIT = 10_000_000;
const cloudOf = points => {
    const geometry = geometryFrom(points);
    geometry.userData.intensity = points.intensity;
    return pointsOf(geometry);
};
async function loadPcd(info) {
    const reader = pcdReader(POINT_LIMIT);
    for await (const chunk of transport.fileChunks()) if (!reader.push(chunk)) break;
    const points = reader.finish();
    // Only a header the reader does not know (no numeric x y z) reaches PCDLoader, whole.
    if (!points) {
        const geometry = new PCDLoader().parse((await fetchBytes()).buffer).geometry;
        const kept = dropNaNPoints(geometry.attributes);
        if (kept) for (const [name, array] of Object.entries(kept)) {
            const { itemSize, normalized } = geometry.attributes[name];
            geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
        }
        geometry.userData.intensity = geometry.attributes.intensity?.array;
        return pointsOf(geometry);
    }
    info.pointsTotal = points.total;
    const cloud = cloudOf(points);
    if (points.total > cloud.geometry.attributes.position.count) {
        $('detail-btn').hidden = false;
        $('detail-btn').addEventListener('click', () => loadDetail(cloud, points.total));
    }
    return cloud;
}

// The extension re-renders the page after a save, and the new one loads the file, so that is no error.
function showError(error) {
    if (error?.name === 'FileChanged') return false;
    $('load-error').textContent = `${t('failed')}: ${error?.message ?? error}`;
    $('load-error').hidden = false;
    return true;
}

let detail = null;
async function loadDetail(base, total) {
    $('detail-btn').disabled = true;
    $('loading-indicator').hidden = false;
    try {
        base.updateMatrixWorld(true);
        const toBase = base.matrixWorld.clone().invert();
        const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const p = view.planes.flatMap(plane => {
            const { normal, constant } = plane.clone().applyMatrix4(toBase);
            return [normal.x, normal.y, normal.z, constant];
        });
        const inside = (x, y, z) => {
            for (let i = 0; i < 24; i += 4) if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < 0) return false;
            return true;
        };
        // The shown sample is even over the file, so its share in the view estimates the file's; the margin
        // keeps a view a little denser than estimated from losing the end of the file.
        const sample = base.geometry.attributes.position.array;
        let seen = 0;
        for (let i = 0; i < sample.length; i += 3) if (inside(sample[i], sample[i + 1], sample[i + 2])) seen++;
        const reader = pcdReader(POINT_LIMIT, { inside, expected: 1.25 * total * seen / (sample.length / 3) + 1000 });
        for await (const chunk of transport.fileChunks()) reader.push(chunk);
        const points = reader.finish();
        if (detail) {
            cloudColors.remove(detail);
            detail.removeFromParent();
            detail.geometry.dispose();
        }
        detail = cloudOf(points);
        base.add(detail);
        cloudColors.add(detail);
    } catch (error) {
        showError(error);
    } finally {
        $('detail-btn').disabled = false;
        $('loading-indicator').hidden = true;
    }
}
const loadTextPoints = async () => pointsOf(geometryFrom(parsePointsText(await fetchText())));
const loadSplatFile = async info => loadSplat(await fetchBytes(), info);

async function loadUsd(info) {
    const [{ composeUsd }, { buildStage }] = await Promise.all([import('./usd.mjs'), import('./stage.mjs')]);
    const read = async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.statusText);
        return new Uint8Array(await response.arrayBuffer());
    };
    const { group, gaussians, missing, upAxis } = await composeUsd(await fetchBytes(), new URL('.', new URL(src, location.href)).href, read);
    info.format = 'USD';
    info.notLoaded = missing.join(', ');
    for (const { object, ply } of gaussians) object.add(await loadSplat(ply, info, 'gaussians.ply'));
    buildStage(group);
    return withUp(group, upAxis === 'Y' ? '+Y' : '+Z');
}

// IGES declares no up axis either and starts +Y like STEP.
const cadLoader = format => async info => {
    info.format = format;
    return withUp(await (await import('./step-load.mjs')).stepModel(cached, transport, format), '+Y');
};
const loadStep = cadLoader('STEP');
const loadIges = cadLoader('IGES');

const LOADERS = {
    stl: async () => {
        const geometry = new STLLoader().parse((await fetchBytes()).buffer);
        geometry.setAttribute('normal', new THREE.BufferAttribute(flatNormals(geometry.attributes.position.array), 3));
        return meshOf(geometry);
    },
    ply: loadPly,
    obj: loadObj,
    off: async () => meshOf(geometryFrom(parseOff(await fetchText()))),
    dae: async () => {
        // ColladaLoader rotates Z_UP files to Y-up and reads a missing <up_axis> as Y_UP; both are undone here.
        const text = await fetchText();
        const { scene } = new ColladaLoader().parse(text, new URL('.', new URL(src, location.href)).href);
        scene.rotation.set(0, 0, 0);
        return withUp(scene, `+${text.match(/<up_axis>\s*([XYZ])_UP/)?.[1] ?? 'Z'}`);
    },
    gltf: loadGltf,
    glb: loadGltf,
    '3mf': () => new ThreeMFLoader().loadAsync(src),
    wrl: async () => withUp(await new VRMLLoader().loadAsync(src), '+Y'),
    '3ds': () => new TDSLoader().loadAsync(src),
    pcd: loadPcd,
    xyz: loadTextPoints,
    pts: loadTextPoints,
    asc: loadTextPoints,
    splat: loadSplatFile,
    ksplat: loadSplatFile,
    spz: loadSplatFile,
    sog: loadSplatFile,
    usd: loadUsd,
    usda: loadUsd,
    usdc: loadUsd,
    usdz: loadUsd,
    stp: loadStep,
    step: loadStep,
    igs: loadIges,
    iges: loadIges
};

function splatBox(splat) {
    let axes = [0, 1, 2].map(() => new Float32Array(splat.packedSplats?.numSplats || splat.numSplats || 1024));
    let count = 0;
    splat.forEachSplat((index, center) => {
        if (index >= axes[0].length) axes = axes.map(values => grown(values, index + 1));
        axes[0][index] = center.x;
        axes[1][index] = center.y;
        axes[2][index] = center.z;
        count = Math.max(count, index + 1);
    });
    const box = new THREE.Box3(
        new THREE.Vector3(...axes.map(values => percentile(values.subarray(0, count), 0.02))),
        new THREE.Vector3(...axes.map(values => percentile(values.subarray(0, count), 0.98)))
    );
    splat.updateWorldMatrix(true, false);
    return box.applyMatrix4(splat.matrixWorld);
}

function boxOf(object) {
    const box = new THREE.Box3();
    object.updateWorldMatrix(true, true);
    object.traverseVisible(child => {
        if (child.userData.splat) box.union(splatBox(child));
        else if (child.isMesh || child.isPoints) box.expandByObject(child);
    });
    return box;
}

function frame() {
    root.updateMatrixWorld(true);
    const box = localBox.clone().applyMatrix4(root.matrixWorld);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.near = distance / 1000;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
    controls.target.copy(center);
    controls.update();
}

function setUp(up) {
    root.rotation.set(...UP[up]);
    frame();
}

function stats(object) {
    const result = { vertices: 0, faces: 0, points: 0 };
    const counted = new Set();
    object.traverse(child => {
        const position = child.geometry?.attributes.position;
        const count = position?.count ?? 0;
        if (child.isMesh) {
            // glTF primitives of one mesh share a vertex buffer.
            if (!counted.has(position)) result.vertices += count;
            counted.add(position);
            result.faces += (child.geometry.index?.count ?? count) / 3;
        }
        if (child.isPoints) result.points += count;
    });
    return result;
}

function showInfo(info) {
    const format = number => number.toLocaleString();
    const rows = [
        [t('file'), name],
        [t('format'), info.format],
        [t('fileSize'), fileSize < 1048576 ? `${(fileSize / 1024).toFixed(1)} KB` : `${(fileSize / 1048576).toFixed(1)} MB`],
        [t('vertices'), info.vertices && format(info.vertices)],
        [t('faces'), info.faces && format(info.faces)],
        [t('pointCount'), info.points && (info.pointsTotal > info.points ? t('pointsShown').replace('{0}', format(info.points)).replace('{1}', format(info.pointsTotal)) : format(info.points))],
        [t('splats'), info.splats && format(info.splats)],
        [t('size'), info.size],
        [t('notLoaded'), info.notLoaded]
    ].filter(([, value]) => value);
    $('info-table').replaceChildren(...rows.map(([label, value]) => {
        const row = document.createElement('tr');
        row.append(...[label, value].map(text => Object.assign(document.createElement('td'), { textContent: text })));
        return row;
    }));
}

function setMode(mode) {
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    const meshes = [];
    root.traverse(child => child.isMesh && child !== sparkRenderer && meshes.push(child));
    for (const mesh of meshes) {
        [].concat(mesh.material).forEach(material => {
            material.wireframe = mode === 'wireframe';
            material.visible = mode !== 'points';
        });
        if (mode === 'points' && !mesh.userData.points) {
            mesh.userData.points = pointsOf(mesh.geometry);
            mesh.add(mesh.userData.points);
        }
        if (mesh.userData.points) mesh.userData.points.visible = mode === 'points';
    }
}

function setPointSize(size) {
    pointSize = size;
    document.querySelectorAll('[data-size]').forEach(button => button.classList.toggle('active', Number(button.dataset.size) === size));
    root.traverse(child => {
        if (child.isPoints) child.material.size = size;
    });
}

// Rendered at twice the CSS size, as in the URDF preview, so the picture does not depend on the screen it
// was taken on. The extension asks where to save it.
function captureScreenshot() {
    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(2);
    renderer.setSize(size.x, size.y, false);
    renderer.render(scene, camera);
    const data = renderer.domElement.toDataURL('image/png').split(',')[1];
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(size.x, size.y, false);
    vscodeApi.postMessage({ type: 'screenshot', data });
}

function setupUi(hasMesh, hasPoints, up) {
    $('display-menu-btn').closest('.control-bar-section').hidden = !hasMesh && !hasPoints;
    document.querySelectorAll('[data-mode], #size-separator').forEach(element => { element.hidden = !hasMesh; });
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
    document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => setPointSize(Number(button.dataset.size))));
    for (const [button, panel] of [[$('display-menu-btn'), $('display-menu')], [$('info-btn'), $('info-panel')], [$('help-btn'), $('help-panel')]]) {
        button.addEventListener('click', () => {
            panel.classList.toggle('open');
            button.classList.toggle('active', panel.classList.contains('open'));
        });
        document.addEventListener('click', event => {
            if (panel.contains(event.target) || button.contains(event.target)) return;
            panel.classList.remove('open');
            button.classList.remove('active');
        });
    }
    $('help-btn').title = $('help-btn').ariaLabel = t('help');
    $('info-btn').title = $('info-btn').ariaLabel = t('info');
    $('screenshot-btn').title = $('screenshot-btn').ariaLabel = t('screenshot');
    $('screenshot-btn').hidden = !vscodeApi;
    $('screenshot-btn').addEventListener('click', captureScreenshot);
    $('up-select').value = up;
    $('up-select').addEventListener('change', () => {
        setUp($('up-select').value);
        if ($('color-height').classList.contains('active')) cloudColors.setMode('height');
    });
    cloudColors.setup();
}


function show(object, info) {
    root.add(object);
    const counted = stats(object);
    Object.assign(info, counted);
    info.format ??= counted.faces ? t('mesh') : t('pointCloud');
    localBox = boxOf(object);
    info.size = localBox.getSize(new THREE.Vector3()).toArray().map(value => +value.toPrecision(3)).join(' × ');
    showInfo(info);
    return counted;
}

async function main() {
    document.querySelectorAll('[data-t]').forEach(element => {
        (element.querySelector('span') ?? element).textContent = t(element.dataset.t);
    });
    const info = {};
    try {
        const load = LOADERS[ext];
        if (!load) throw new Error(`${t('unsupportedFormat')}: ${name}`);
        const object = await load(info);
        const counted = show(object, info);
        const up = object.userData.up ?? '+Z';
        setupUi(counted.faces > 0, counted.points > 0, up);
        setUp(up);
    } catch (error) {
        // A page whose file changed keeps showing that it loads.
        if (!showError(error)) return;
    }
    $('loading-indicator').hidden = true;
}

main();
