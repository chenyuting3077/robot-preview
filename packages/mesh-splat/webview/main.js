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
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { readPlyHeader, plyKind, addMissingScale } from './ply.mjs';
import { parsePointsText, parseOff } from './text-formats.mjs';
import { createCameraKeys } from '../../../src/utils/camera-keys.js';

const STRINGS = {
    en: { help: 'Controls', pointSmall: 'Small points', pointMedium: 'Medium points', pointLarge: 'Large points', helpKeyOrbit: 'Left drag', helpOrbit: 'Rotate', helpKeyPan: 'Right / middle drag', helpPan: 'Pan', helpKeyZoom: 'Wheel', helpZoom: 'Zoom toward the cursor', helpKeyPivot: 'Double-click', helpPivot: 'Set the rotation center', helpKeyFly: 'W A S D', helpFly: 'Move', helpKeyTurn: 'Q E', helpTurn: 'Turn', helpKeyFast: 'Shift', helpFast: 'Faster', helpKeyFrame: 'F', helpFrame: 'Frame the model', display: 'Display', stage: 'Stage', primName: 'Name', primType: 'Type', notLoaded: 'Not loaded', info: 'Info', solid: 'Solid', wireframe: 'Wireframe', points: 'Points', loading: 'Loading', unsupportedFormat: 'Unsupported file format', file: 'File', format: 'Format', fileSize: 'File size', vertices: 'Vertices', faces: 'Faces', pointCount: 'Points', splats: 'Splats', size: 'Size', mesh: 'Mesh', pointCloud: 'Point cloud', gaussian: 'Gaussian splat', flat: '2DGS (flattened)', failed: 'Cannot open this file', flatUnsupported: '2DGS PLY must be binary little-endian with vertex as the first element' },
    'zh-TW': { help: '操作說明', pointSmall: '小點', pointMedium: '中點', pointLarge: '大點', helpKeyOrbit: '左鍵拖曳', helpOrbit: '旋轉', helpKeyPan: '右鍵／中鍵拖曳', helpPan: '平移', helpKeyZoom: '滾輪', helpZoom: '朝游標縮放', helpKeyPivot: '雙擊', helpPivot: '設定旋轉中心', helpKeyFly: 'W A S D', helpFly: '移動', helpKeyTurn: 'Q E', helpTurn: '轉向', helpKeyFast: 'Shift', helpFast: '加速', helpKeyFrame: 'F', helpFrame: '回到全貌', display: '顯示', stage: 'Stage', primName: '名稱', primType: '類型', notLoaded: '未載入', info: '資訊', solid: '實體', wireframe: '線框', points: '點', loading: '正在載入', unsupportedFormat: '不支援的檔案格式', file: '檔案', format: '格式', fileSize: '檔案大小', vertices: '頂點', faces: '面', pointCount: '點數', splats: 'Splat 數', size: '尺寸', mesh: '網格', pointCloud: '點雲', gaussian: '高斯潑濺', flat: '2DGS（已壓平）', failed: '無法開啟這個檔案', flatUnsupported: '2DGS PLY 必須是 binary little-endian，且 vertex 是第一個 element' },
    'zh-CN': { help: '操作说明', pointSmall: '小点', pointMedium: '中点', pointLarge: '大点', helpKeyOrbit: '左键拖曳', helpOrbit: '旋转', helpKeyPan: '右键／中键拖曳', helpPan: '平移', helpKeyZoom: '滚轮', helpZoom: '朝光标缩放', helpKeyPivot: '双击', helpPivot: '设置旋转中心', helpKeyFly: 'W A S D', helpFly: '移动', helpKeyTurn: 'Q E', helpTurn: '转向', helpKeyFast: 'Shift', helpFast: '加速', helpKeyFrame: 'F', helpFrame: '回到全貌', display: '显示', stage: 'Stage', primName: '名称', primType: '类型', notLoaded: '未加载', info: '信息', solid: '实体', wireframe: '线框', points: '点', loading: '正在加载', unsupportedFormat: '不支持的文件格式', file: '文件', format: '格式', fileSize: '文件大小', vertices: '顶点', faces: '面', pointCount: '点数', splats: 'Splat 数', size: '尺寸', mesh: '网格', pointCloud: '点云', gaussian: '高斯泼溅', flat: '2DGS（已压平）', failed: '无法打开这个文件', flatUnsupported: '2DGS PLY 必须是 binary little-endian，且 vertex 是第一个 element' }
};
const lang = document.documentElement.lang.toLowerCase();
const strings = STRINGS[/^zh-(tw|hk|mo|hant)/.test(lang) ? 'zh-TW' : lang.startsWith('zh') ? 'zh-CN' : 'en'];
const t = key => strings[key] ?? STRINGS.en[key];
const $ = id => document.getElementById(id);

const { src, name, bytes: fileSize } = document.body.dataset;
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
const shown = object => !object || (object.visible && shown(object.parent));
const cameraKeys = createCameraKeys({
    camera,
    target: controls.target,
    element: renderer.domElement,
    pick: ndc => {
        raycaster.setFromCamera(ndc, camera);
        raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.01;
        return raycaster.intersectObject(root, true).find(({ object }) => shown(object))?.point;
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
const hasColor = geometry => Boolean(geometry.attributes.color);

function meshOf(geometry) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: hasColor(geometry) ? 0xffffff : 0xb0b0b0, vertexColors: hasColor(geometry), roughness: 0.8, side: THREE.DoubleSide
    }));
}

let pointSize = 2;
const pointsOf = geometry => new THREE.Points(geometry, new THREE.PointsMaterial({
    size: pointSize, sizeAttenuation: false, color: hasColor(geometry) ? 0xffffff : 0x9aa7b8, vertexColors: hasColor(geometry)
}));

function geometryFrom({ positions, indices, colors }) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (indices) geometry.setIndex(indices);
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

let sparkRenderer = null;
async function loadSplat(bytes, info, fileName = name) {
    if (!sparkRenderer) root.add(sparkRenderer = new SparkRenderer({ renderer }));
    const splat = new SplatMesh({ fileBytes: bytes, fileName });
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
    const geometry = new PLYLoader().parse(bytes.buffer);
    return kind === 'mesh' ? meshOf(geometry) : pointsOf(geometry);
}

const loadGltf = async () => (await new GLTFLoader().loadAsync(src)).scene;
const loadTextPoints = async () => pointsOf(geometryFrom(parsePointsText(await fetchText())));
const loadSplatFile = async info => loadSplat(await fetchBytes(), info);

async function loadUsd(info) {
    const { composeUsd } = await import('./usd.mjs');
    const read = async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.statusText);
        return new Uint8Array(await response.arrayBuffer());
    };
    const { group, gaussians, missing } = await composeUsd(await fetchBytes(), new URL('.', new URL(src, location.href)).href, read);
    info.format = 'USD';
    info.notLoaded = missing.join(', ');
    for (const { object, ply } of gaussians) object.add(await loadSplat(ply, info, 'gaussians.ply'));
    buildStage(group);
    return group;
}

const LOADERS = {
    stl: async () => {
        const geometry = new STLLoader().parse((await fetchBytes()).buffer);
        geometry.deleteAttribute('normal');
        return meshOf(geometry);
    },
    ply: loadPly,
    obj: loadObj,
    off: async () => meshOf(geometryFrom(parseOff(await fetchText()))),
    dae: async () => (await new ColladaLoader().loadAsync(src)).scene,
    gltf: loadGltf,
    glb: loadGltf,
    '3mf': () => new ThreeMFLoader().loadAsync(src),
    wrl: () => new VRMLLoader().loadAsync(src),
    '3ds': () => new TDSLoader().loadAsync(src),
    pcd: async () => pointsOf((await new PCDLoader().loadAsync(src)).geometry),
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
    usdz: loadUsd
};

function splatBox(splat) {
    const axes = [[], [], []];
    splat.forEachSplat((index, center) => {
        axes[0].push(center.x);
        axes[1].push(center.y);
        axes[2].push(center.z);
    });
    const at = (values, q) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
    const box = new THREE.Box3(
        new THREE.Vector3(...axes.map(values => at(values, 0.02))),
        new THREE.Vector3(...axes.map(values => at(values, 0.98)))
    );
    splat.updateWorldMatrix(true, false);
    return box.applyMatrix4(splat.matrixWorld);
}

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function buildStage(group) {
    const prims = object => object.children.filter(child => !(child instanceof SplatMesh));
    const expanded = new Set();
    const render = () => {
        const rows = [];
        const walk = (object, depth, inheritedOff) => prims(object).forEach(child => {
            const children = prims(child);
            const row = document.createElement('div');
            row.className = `prim-row${child.visible ? '' : ' off'}${inheritedOff ? ' inherited' : ''}`;
            const name = document.createElement('div');
            name.className = 'prim-name';
            name.style.paddingLeft = `${depth * 14}px`;
            const toggle = Object.assign(document.createElement('button'), { className: 'prim-toggle', textContent: children.length ? (expanded.has(child) ? '▾' : '▸') : '' });
            if (children.length) {
                name.style.cursor = 'pointer';
                name.addEventListener('click', () => {
                    if (!expanded.delete(child)) expanded.add(child);
                    render();
                });
            }
            name.append(toggle, Object.assign(document.createElement('span'), { textContent: child.name || child.type, title: child.name }));
            const eye = Object.assign(document.createElement('button'), { className: 'prim-eye', innerHTML: child.visible && !inheritedOff ? EYE : EYE_OFF });
            eye.setAttribute('aria-pressed', String(child.visible));
            eye.addEventListener('click', () => {
                child.visible = !child.visible;
                render();
            });
            row.append(name, Object.assign(document.createElement('div'), { className: 'prim-type', textContent: child.userData.usdType ?? '', title: child.userData.usdType ?? '' }), eye);
            rows.push(row);
            if (expanded.has(child)) walk(child, depth + 1, inheritedOff || !child.visible);
        });
        walk(group, 0, false);
        $('stage-rows').replaceChildren(...rows);
    };
    const expand = (object, depth) => prims(object).forEach(child => {
        if (depth < 2 && prims(child).length) expanded.add(child);
        if (depth < 1) expand(child, depth + 1);
    });
    expand(group, 0);
    render();
    if (!prims(group).length) return;
    $('stage-bar').hidden = false;
    const show = open => {
        $('stage-panel').hidden = !open;
        $('stage-btn').classList.toggle('active', open);
    };
    $('stage-btn').addEventListener('click', () => show($('stage-panel').hidden));
    show(true);
}

function boxOf(object) {
    const box = new THREE.Box3();
    object.updateWorldMatrix(true, true);
    object.traverseVisible(child => {
        if (child instanceof SplatMesh) box.union(splatBox(child));
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
    object.traverse(child => {
        const count = child.geometry?.attributes.position?.count ?? 0;
        if (child.isMesh) {
            result.vertices += count;
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
        [t('pointCount'), info.points && format(info.points)],
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
    $('up-select').value = up;
    $('up-select').addEventListener('change', () => setUp($('up-select').value));
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
        root.add(object);
        const counted = stats(object);
        Object.assign(info, counted);
        info.format ??= counted.faces ? t('mesh') : t('pointCloud');
        const isSplat = object instanceof SplatMesh;
        localBox = boxOf(object);
        info.size = localBox.getSize(new THREE.Vector3()).toArray().map(value => +value.toPrecision(3)).join(' × ');
        const up = isSplat ? '-Y' : '+Y';
        setupUi(counted.faces > 0, counted.points > 0, up);
        setUp(up);
        showInfo(info);
    } catch (error) {
        $('load-error').textContent = `${t('failed')}: ${error?.message ?? error}`;
        $('load-error').hidden = false;
    }
    $('loading-indicator').hidden = true;
}

main();
