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
    en: { display: 'Display', info: 'Info', solid: 'Solid', wireframe: 'Wireframe', points: 'Points', loading: 'Loading', unsupportedFormat: 'Unsupported file format', file: 'File', format: 'Format', fileSize: 'File size', vertices: 'Vertices', faces: 'Faces', pointCount: 'Points', splats: 'Splats', size: 'Size', mesh: 'Mesh', pointCloud: 'Point cloud', gaussian: 'Gaussian splat', flat: '2DGS (flattened)', failed: 'Cannot open this file', flatUnsupported: '2DGS PLY must be binary little-endian with vertex as the first element' },
    'zh-TW': { display: '顯示', info: '資訊', solid: '實體', wireframe: '線框', points: '點', loading: '正在載入', unsupportedFormat: '不支援的檔案格式', file: '檔案', format: '格式', fileSize: '檔案大小', vertices: '頂點', faces: '面', pointCount: '點數', splats: 'Splat 數', size: '尺寸', mesh: '網格', pointCloud: '點雲', gaussian: '高斯潑濺', flat: '2DGS（已壓平）', failed: '無法開啟這個檔案', flatUnsupported: '2DGS PLY 必須是 binary little-endian，且 vertex 是第一個 element' },
    'zh-CN': { display: '显示', info: '信息', solid: '实体', wireframe: '线框', points: '点', loading: '正在加载', unsupportedFormat: '不支持的文件格式', file: '文件', format: '格式', fileSize: '文件大小', vertices: '顶点', faces: '面', pointCount: '点数', splats: 'Splat 数', size: '尺寸', mesh: '网格', pointCloud: '点云', gaussian: '高斯泼溅', flat: '2DGS（已压平）', failed: '无法打开这个文件', flatUnsupported: '2DGS PLY 必须是 binary little-endian，且 vertex 是第一个 element' }
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
const cameraKeys = createCameraKeys({
    camera,
    target: controls.target,
    element: renderer.domElement,
    pick: ndc => {
        raycaster.setFromCamera(ndc, camera);
        raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.01;
        return raycaster.intersectObject(root, true).find(({ object }) => object.visible)?.point;
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

const pointsOf = geometry => new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 2, sizeAttenuation: false, color: hasColor(geometry) ? 0xffffff : 0x9aa7b8, vertexColors: hasColor(geometry)
}));

function geometryFrom({ positions, indices }) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
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

async function loadSplat(bytes, info) {
    root.add(new SparkRenderer({ renderer }));
    const splat = new SplatMesh({ fileBytes: bytes, fileName: name });
    await splat.initialized;
    info.format ??= t('gaussian');
    info.splats = splat.packedSplats?.numSplats ?? splat.numSplats;
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
const loadTextPoints = async () => pointsOf(geometryFrom({ positions: parsePointsText(await fetchText()) }));
const loadSplatFile = async info => loadSplat(await fetchBytes(), info);

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
    sog: loadSplatFile
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
        [t('size'), info.size]
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
    root.traverse(child => child.isMesh && meshes.push(child));
    for (const mesh of meshes) {
        [].concat(mesh.material).forEach(material => { material.wireframe = mode === 'wireframe'; });
        mesh.visible = mode !== 'points';
        if (mode === 'points' && !mesh.userData.points) {
            const points = pointsOf(mesh.geometry);
            points.matrixAutoUpdate = false;
            points.matrix = mesh.matrix;
            mesh.parent.add(points);
            mesh.userData.points = points;
        }
        if (mesh.userData.points) mesh.userData.points.visible = mode === 'points';
    }
}

function setupUi(hasMesh, up) {
    $('display-menu-btn').closest('.control-bar-section').hidden = !hasMesh;
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
    $('display-menu-btn').addEventListener('click', event => {
        event.stopPropagation();
        $('display-menu').classList.toggle('open');
        $('display-menu-btn').classList.toggle('active', $('display-menu').classList.contains('open'));
    });
    document.addEventListener('click', event => {
        if ($('display-menu').contains(event.target)) return;
        $('display-menu').classList.remove('open');
        $('display-menu-btn').classList.remove('active');
    });
    $('info-btn').addEventListener('click', () => {
        $('info-panel').hidden = !$('info-panel').hidden;
        $('info-btn').classList.toggle('active', !$('info-panel').hidden);
    });
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
        localBox = isSplat ? splatBox(object) : new THREE.Box3().setFromObject(object);
        info.size = localBox.getSize(new THREE.Vector3()).toArray().map(value => +value.toPrecision(3)).join(' × ');
        const up = isSplat ? '-Y' : '+Y';
        setupUi(counted.faces > 0, up);
        setUp(up);
        showInfo(info);
        $('info-panel').hidden = false;
    } catch (error) {
        $('load-error').textContent = `${t('failed')}: ${error?.message ?? error}`;
        $('load-error').hidden = false;
    }
    $('loading-indicator').hidden = true;
}

main();
