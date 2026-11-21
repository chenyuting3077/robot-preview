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
import { createCloudColors, assignHues } from './cloud-colors.mjs';
import { UP, relativeUp } from './up.mjs';
import { turboGradient } from './color.mjs';
import { hasColor, MESH_GREY, POINT_GREY, surfaceMaterial } from './materials.mjs';
import { parsePointsText, parseOff } from './text-formats.mjs';
import { createCameraKeys } from '../../../src/utils/camera-keys.js';
import { pcdReader, dropNaNPoints } from './pcd.mjs';
import { binReader, binLayout } from './kitti.mjs';
import { createTransport } from './transport.mjs';
import { recentering } from './recenter.mjs';
import { legendLabels } from './legend-format.mjs';

const STRINGS = {
    en: { detailInView: 'Load detail in view', colorRgb: 'Original color', colorHeight: 'Height', colorIntensity: 'Intensity', pointsShown: '{0} shown of {1}', help: 'Controls', pointSmall: 'Small points', pointMedium: 'Medium points', pointLarge: 'Large points', helpKeyOrbit: 'Left drag', helpOrbit: 'Rotate', helpKeyPan: 'Right / middle drag', helpPan: 'Pan', helpKeyZoom: 'Wheel', helpZoom: 'Zoom toward the cursor', helpKeyPivot: 'Double-click', helpPivot: 'Set the rotation center', helpKeyFly: 'W A S D', helpFly: 'Move', helpKeyTurn: 'Q E', helpTurn: 'Turn', helpKeyFast: 'Shift', helpFast: 'Faster', helpKeyFrame: 'F', helpFrame: 'Frame the model', display: 'Display', stage: 'Stage', primName: 'Name', primType: 'Type', notLoaded: 'Not loaded', missingMaterials: 'Missing materials', notShown: 'Not shown', unit: 'Unit', info: 'Info', solid: 'Solid', wireframe: 'Wireframe', points: 'Points', loading: 'Loading', unsupportedFormat: 'Unsupported file format', file: 'File', format: 'Format', fileSize: 'File size', vertices: 'Vertices', faces: 'Faces', pointCount: 'Points', splats: 'Splats', size: 'Size', mesh: 'Mesh', pointCloud: 'Point cloud', gaussian: 'Gaussian splat', flat: '2DGS (flattened)', failed: 'Cannot open this file', flatUnsupported: '2DGS PLY must be binary little-endian with vertex as the first element', screenshot: 'Save screenshot', upAxis: 'Up axis', pickParts: 'Pick parts in the view', grid: 'Grid', axes: 'Axes', bounds: 'Bounds', layout: 'Layout', notAScan: 'the file is {0} bytes, not a multiple of the {1}-byte {2} point ({3}): it does not look like a {2} scan', occupancyMap: 'Occupancy grid map', greyImage: 'Greyscale image', cells: 'Cells', resolution: 'Resolution', perCell: 'm/cell', origin: 'Origin', mapMode: 'Mode', mapYaml: 'Map YAML', mapImage: 'Map image', noMapYaml: 'Not found, shown at 1 unit per pixel', notMapYaml: 'shown at 1 unit per pixel', mapImageMissing: 'Cannot read the map image', mapTooLarge: 'cells is more than this GPU can show as one texture', addFile: 'Add file…', offset: 'Offset taken out', detailFailed: 'Could not read', colorSolid: 'Solid color', remove: 'Remove from the view', notFound: 'File not found' },
    'zh-TW': { detailInView: '載入視野內細節', colorRgb: '原色', colorHeight: '高度', colorIntensity: '強度', pointsShown: '顯示 {0} / 共 {1}', help: '操作說明', pointSmall: '小點', pointMedium: '中點', pointLarge: '大點', helpKeyOrbit: '左鍵拖曳', helpOrbit: '旋轉', helpKeyPan: '右鍵／中鍵拖曳', helpPan: '平移', helpKeyZoom: '滾輪', helpZoom: '朝游標縮放', helpKeyPivot: '雙擊', helpPivot: '設定旋轉中心', helpKeyFly: 'W A S D', helpFly: '移動', helpKeyTurn: 'Q E', helpTurn: '轉向', helpKeyFast: 'Shift', helpFast: '加速', helpKeyFrame: 'F', helpFrame: '回到全貌', display: '顯示', stage: 'Stage', primName: '名稱', primType: '類型', notLoaded: '未載入', missingMaterials: '缺少的材質', notShown: '未顯示', unit: '單位', info: '資訊', solid: '實體', wireframe: '線框', points: '點', loading: '正在載入', unsupportedFormat: '不支援的檔案格式', file: '檔案', format: '格式', fileSize: '檔案大小', vertices: '頂點', faces: '面', pointCount: '點數', splats: 'Splat 數', size: '尺寸', mesh: '網格', pointCloud: '點雲', gaussian: '高斯潑濺', flat: '2DGS（已壓平）', failed: '無法開啟這個檔案', flatUnsupported: '2DGS PLY 必須是 binary little-endian，且 vertex 是第一個 element', screenshot: '儲存截圖', upAxis: '上方軸', pickParts: '在畫面上點選零件', grid: '格線', axes: '座標軸', bounds: '包圍盒', layout: '欄位配置', notAScan: '檔案大小 {0} bytes，不是 {2} 每點 {1} bytes（{3}）的倍數，看起來不是 {2} 掃描檔', occupancyMap: '佔據網格地圖', greyImage: '灰階影像', cells: '格數', resolution: '解析度', perCell: 'm/格', origin: '原點', mapMode: '模式', mapYaml: '地圖 YAML', mapImage: '地圖影像', noMapYaml: '找不到，以每像素 1 單位顯示', notMapYaml: '以每像素 1 單位顯示', mapImageMissing: '無法讀取地圖影像', mapTooLarge: '格超過這張顯示卡單張貼圖的上限', addFile: '加入檔案…', offset: '已扣除的偏移', detailFailed: '無法讀取', colorSolid: '單色', remove: '從檢視移除', notFound: '找不到檔案' },
    'zh-CN': { detailInView: '加载视野内细节', colorRgb: '原色', colorHeight: '高度', colorIntensity: '强度', pointsShown: '显示 {0} / 共 {1}', help: '操作说明', pointSmall: '小点', pointMedium: '中点', pointLarge: '大点', helpKeyOrbit: '左键拖曳', helpOrbit: '旋转', helpKeyPan: '右键／中键拖曳', helpPan: '平移', helpKeyZoom: '滚轮', helpZoom: '朝光标缩放', helpKeyPivot: '双击', helpPivot: '设置旋转中心', helpKeyFly: 'W A S D', helpFly: '移动', helpKeyTurn: 'Q E', helpTurn: '转向', helpKeyFast: 'Shift', helpFast: '加速', helpKeyFrame: 'F', helpFrame: '回到全貌', display: '显示', stage: 'Stage', primName: '名称', primType: '类型', notLoaded: '未加载', missingMaterials: '缺少的材质', notShown: '未显示', unit: '单位', info: '信息', solid: '实体', wireframe: '线框', points: '点', loading: '正在加载', unsupportedFormat: '不支持的文件格式', file: '文件', format: '格式', fileSize: '文件大小', vertices: '顶点', faces: '面', pointCount: '点数', splats: 'Splat 数', size: '尺寸', mesh: '网格', pointCloud: '点云', gaussian: '高斯泼溅', flat: '2DGS（已压平）', failed: '无法打开这个文件', flatUnsupported: '2DGS PLY 必须是 binary little-endian，且 vertex 是第一个 element', screenshot: '保存截图', upAxis: '上方轴', pickParts: '在画面上点选零件', grid: '网格线', axes: '坐标轴', bounds: '包围盒', layout: '字段布局', notAScan: '文件大小 {0} 字节，不是 {2} 每点 {1} 字节（{3}）的整数倍，看起来不是 {2} 扫描文件', occupancyMap: '占据栅格地图', greyImage: '灰度图像', cells: '栅格数', resolution: '分辨率', perCell: 'm/格', origin: '原点', mapMode: '模式', mapYaml: '地图 YAML', mapImage: '地图图像', noMapYaml: '未找到，以每像素 1 单位显示', notMapYaml: '以每像素 1 单位显示', mapImageMissing: '无法读取地图图像', mapTooLarge: '格超过这块显卡单张纹理的上限', addFile: '添加文件…', offset: '已扣除的偏移', detailFailed: '无法读取', colorSolid: '单色', remove: '从视图移除', notFound: '找不到文件' }
};
const lang = document.documentElement.lang.toLowerCase();
const strings = STRINGS[/^zh-(tw|hk|mo|hant)/.test(lang) ? 'zh-TW' : lang.startsWith('zh') ? 'zh-CN' : 'en'];
const t = key => strings[key] ?? STRINGS.en[key];
const $ = id => document.getElementById(id);

const page = document.body.dataset;
const { cached } = page;
const vscodeApi = globalThis.acquireVsCodeApi?.();
// A page without a list is one rendered before views held several files.
const listed = page.files ? JSON.parse(page.files) : [{ id: page.file, src: page.src, name: page.name, bytes: page.bytes, mtime: page.mtime }];
const files = listed.map((file, index) => {
    const entry = {
        ...file,
        size: Number(file.bytes),
        index,
        hue: index,
        ext: file.name.split('.').pop().toLowerCase(),
        transport: createTransport(vscodeApi, page, file),
        group: new THREE.Group(),
        info: {},
        object: null,
        error: null
    };
    entry.bytes = async () => new Uint8Array(await (await fetch(file.src)).arrayBuffer());
    entry.text = async () => (await fetch(file.src)).text();
    entry.group.name = file.name;
    entry.group.userData.file = entry;
    return entry;
});
const opened = files[0];
const fileOf = object => (object ? object.userData.file ?? fileOf(object.parent) : null);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
document.body.prepend(renderer.domElement);
// Frames are drawn only while the view may change: input, camera motion and loads, each followed by a short
// settle in which Spark finishes sorting splats for the camera that stopped. A view left open draws nothing.
const SETTLE_MS = 1500;
let awakeUntil = 0;
const wake = () => { awakeUntil = performance.now() + SETTLE_MS; };
for (const type of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'click', 'dblclick', 'change', 'input']) {
    window.addEventListener(type, wake, { capture: true, passive: true });
}
// Textures (OBJ materials, glTF images) arrive after the model shows.
THREE.DefaultLoadingManager.onProgress = wake;
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
// In list order, so walking the scene meets the files in the order of their rows.
for (const file of files) root.add(file.group);
let localBox = null;
const fieldLabel = name => (name === 'intensity' ? t('colorIntensity') : name);
const cloudColors = createCloudColors({
    root,
    upAxis: () => $('up-select').value,
    label: fieldLabel,
    // By id, which a file keeps when one before it is removed, so its solid color stays.
    fileOf: cloud => fileOf(cloud).hue,
    onChange: (mode, range) => {
        showLegend(mode, range);
        syncColorRows();
    }
});

function syncTheme() {
    const theme = /\bvscode-(high-contrast-)?light\b/.test(document.body.className) ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    scene.background = new THREE.Color(theme === 'light' ? 0xffffff : 0x505050);
    wake();
}
syncTheme();
new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

new ResizeObserver(() => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    wake();
}).observe(document.body);
const raycaster = new THREE.Raycaster();
const visibleInScene = object => !object || (object.visible && visibleInScene(object.parent));
const pickAt = ndc => {
    raycaster.setFromCamera(ndc, camera);
    raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.01;
    return raycaster.intersectObject(root, true).find(({ object }) => visibleInScene(object));
};
const cameraKeys = createCameraKeys({
    camera,
    target: controls.target,
    element: renderer.domElement,
    pick: ndc => pickAt(ndc)?.point,
    frame: () => localBox && frame()
});

// A click (a press that did not drag the view) on a USD stage selects the prim under the cursor. The URDF view's
// hover raycast cost orbiting 10 fps on a 1.24M-triangle robot, so nothing here raycasts while dragging.
// The part under a moving pointer (never while dragging) is boxed faintly and named by the cursor, raycast at most
// every 40 ms: over 200 rays on G1 one takes 0.4 ms at the median, 9 ms at p99 and 33 ms at most, so a frame is
// rarely lost; waiting for the pointer to rest 100 ms instead felt slow. The name is the path's last three levels:
// Isaac calls every leaf "mesh", and the link it belongs to sits two levels up (left_hip_roll_link › visuals › mesh).
let usdStage = null;
let selected = null;
let selectionBox = null;
let hovered = null;
let hoverBox = null;
let hoverTimer = 0;
// A box, not a recoloured material: cheap on million-triangle robots and visible on any colour. It bounds only what
// is shown, so a link's hidden collision meshes do not widen it and hiding the part hides its box.
const fitBox = (helper, prim) => {
    if (!helper) return;
    const part = new THREE.Box3();
    root.updateMatrixWorld(true);
    if (visibleInScene(prim)) {
        prim.traverseVisible(object => {
            if (!(object.isMesh || object.isPoints) || !object.geometry) return;
            object.geometry.boundingBox ?? object.geometry.computeBoundingBox();
            part.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
        });
    }
    helper.box.copy(part);
    helper.visible = !part.isEmpty();
};
const primBox = (prim, color) => {
    const helper = Object.assign(new THREE.Box3Helper(new THREE.Box3(), color), { raycast: () => {} });
    fitBox(helper, prim);
    scene.add(helper);
    return helper;
};
function refitBoxes() {
    fitBox(selectionBox, selected);
    fitBox(hoverBox, hovered);
    wake();
}
const dropBox = box => {
    box?.removeFromParent();
    box?.dispose();
    return null;
};
// Only meshes, points and primitives are picked: a Gaussian field is one prim spanning the scene, so in a 3DGS stage
// every rest between drags boxed the whole scene, and its raycast runs over every splat.
// Picking can be turned off for orbiting a scene, where any rest between drags would box what lies under the
// pointer; the Stage panel still selects. The choice is kept like the Display helpers.
let picking = page.pick !== 'false';
function setPicking(on) {
    picking = on;
    $('pick-btn').classList.toggle('active', on);
    $('pick-btn').setAttribute('aria-pressed', String(on));
    if (!on) hoverPrim(null);
}
function primAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.01;
    // Hidden prims (Isaac's collision meshes) are left out of the raycast, not filtered after it.
    return raycaster.intersectObjects(usdStage.pickable.filter(visibleInScene), false)[0]?.object ?? null;
}
function hoverPrim(prim, event) {
    const label = $('hover-label');
    label.hidden = !prim;
    if (prim) {
        const path = [];
        for (let level = prim; level && level !== usdStage.group && path.length < 3; level = level.parent) path.unshift(level.name || level.type);
        label.textContent = path.join(' › ');
        Object.assign(label.style, { left: `${event.clientX + 14}px`, top: `${event.clientY + 14}px` });
    }
    if (prim === hovered) return;
    hovered = prim;
    hoverBox = dropBox(hoverBox);
    if (prim && prim !== selected) hoverBox = primBox(prim, 0x7fb5ff);
    wake();
}
function selectPrim(prim) {
    selected = prim;
    selectionBox = dropBox(selectionBox);
    if (prim) selectionBox = primBox(prim, 0x0a84ff);
    if (hovered === prim) hoverBox = dropBox(hoverBox);
    usdStage?.panel?.select(prim);
    wake();
}
let pressedAt = null;
renderer.domElement.addEventListener('pointerdown', event => { pressedAt = event.button === 0 ? [event.clientX, event.clientY] : null; });
renderer.domElement.addEventListener('pointerup', event => {
    if (!usdStage || !pressedAt || Math.hypot(event.clientX - pressedAt[0], event.clientY - pressedAt[1]) > 4) return;
    // With picking off a click picks nothing, but it still clears a selection made before or from the Stage panel.
    selectPrim(picking ? primAt(event) : null);
});
let lastMove = null;
renderer.domElement.addEventListener('pointermove', event => {
    if (!usdStage || !picking) return;
    if (event.buttons) {
        clearTimeout(hoverTimer);
        hoverTimer = 0;
        hoverPrim(null);
        return;
    }
    lastMove = event;
    if (!$('hover-label').hidden) Object.assign($('hover-label').style, { left: `${event.clientX + 14}px`, top: `${event.clientY + 14}px` });
    hoverTimer ||= setTimeout(() => {
        hoverTimer = 0;
        hoverPrim(primAt(lastMove), lastMove);
    }, 40);
});
renderer.domElement.addEventListener('pointerleave', () => {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    if (usdStage) hoverPrim(null);
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selected) selectPrim(null);
});
controls.addEventListener('change', wake);
renderer.setAnimationLoop(() => {
    if (cameraKeys()) wake();
    controls.update();
    if (performance.now() < awakeUntil) {
        renderer.render(scene, camera);
        if (localBox) saveSoon();
    }
});
// Saved once the view has been still for a moment: on every frame it was ~60 state messages a second while moving.
// An add or remove saves first, so the page it asks for takes the view as it is.
let saveTimer = 0;
let seenView = '';
const saveSoon = () => {
    const view = viewJson();
    if (!view || view === seenView) return;
    seenView = view;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveView, 300);
};

// A re-render for an added or removed file would reset the view; webview state outlives it.
const savedView = (page.keep && vscodeApi?.getState?.()) || null;
// A page for a changed file starts afresh; a file added before it is up must not bring back the page before it.
if (!page.keep) vscodeApi?.setState?.(null);
let lastView = '';
// A view where nothing loaded has no camera of its own to hand on to the next page.
const viewJson = () => files.some(file => file.object) && JSON.stringify({
    camera: [...camera.position.toArray(), ...controls.target.toArray(), camera.near, camera.far],
    hidden: files.filter(file => !file.group.visible).map(file => file.id),
    helpers: Object.keys(HELPERS).filter(kind => helpers[kind] || (kind === 'axes' && axesHeldBack)),
    mode: displayMode,
    hues: Object.fromEntries(files.map(file => [file.id, file.hue])),
    colors: Object.fromEntries(files.filter(file => file.clouds?.length).map(file => [file.id, cloudColors.modeOf(file.clouds[0])]))
});
// Saved only once the view is set up: a half-made one (default camera, no helpers) would be taken back by the
// page an early Add file… brings.
let viewReady = false;
function saveView() {
    if (!viewReady) return;
    const view = viewJson();
    if (!view || view === lastView) return;
    lastView = view;
    vscodeApi?.setState?.(JSON.parse(view));
}

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

// A far cloud's points are stored relative to the offset its reader took out (recenter.mjs), and the cloud is put
// back there, so the file's origin, the grid's lines and other files stay at real coordinates. three.js composes
// each object's model-view matrix in float64, so the GPU gets only the small step from the camera to the cloud.
function placed(cloud, offset, info) {
    if (!offset) return cloud;
    cloud.position.fromArray(offset);
    cloud.userData.offset = offset;
    info.offset = offset;
    return cloud;
}
// PLYLoader and PCDLoader already stored float32: the offset cannot bring back what that rounded off, but the
// cloud is placed like the others. Their bounding sphere, at the file's coordinates, would cull it.
function placedLoaded(cloud, info) {
    const { geometry } = cloud;
    if (!geometry.attributes.position) return cloud;
    const positions = geometry.attributes.position.array;
    const placing = recentering();
    for (let i = 0; i < positions.length / 3; i++) placing.write(positions, i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const offset = placing.finish(positions);
    if (offset) {
        geometry.attributes.position.needsUpdate = true;
        geometry.boundingSphere = geometry.boundingBox = null;
    }
    return placed(cloud, offset, info);
}

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

async function loadObj(info, file) {
    const text = await file.text();
    const loader = new OBJLoader();
    const mtl = text.match(/^mtllib\s+(.+)$/m)?.[1].trim();
    if (mtl) {
        const materials = await new MTLLoader().loadAsync(new URL(mtl, new URL(file.src, location.href)).href).catch(() => null);
        if (materials) loader.setMaterials((materials.preload(), materials));
    }
    return loader.parse(text);
}

// Spark is 2.4 MB of inlined WASM, loaded only when a splat opens; splats are marked so code that only
// needs to recognise them never imports it.
let sparkRenderer = null;
async function loadSplat(bytes, info, fileName) {
    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    if (!sparkRenderer) root.add(sparkRenderer = new SparkRenderer({ renderer }));
    const splat = new SplatMesh({ fileBytes: bytes, fileName });
    splat.userData.splat = true;
    await splat.initialized;
    info.format ??= t('gaussian');
    info.splats = (info.splats ?? 0) + (splat.packedSplats?.numSplats ?? splat.numSplats);
    return splat;
}

async function loadPly(info, file) {
    const bytes = await file.bytes();
    const header = readPlyHeader(bytes);
    const kind = header && plyKind(header);
    if (kind === 'splat') {
        const patched = addMissingScale(bytes, header);
        if (!patched) throw new Error(t('flatUnsupported'));
        if (patched !== bytes) info.format = t('flat');
        return loadSplat(patched, info, file.name);
    }
    const points = kind === 'points' ? readPlyPoints(bytes, header, { scalars: true, recenter: true }) : kind === 'mesh' && readPlyMesh(bytes, header);
    if (points?.indices) return meshOf(geometryFrom(points));
    if (points) {
        const geometry = geometryFrom(points);
        geometry.userData.scalars = points.scalars;
        return placed(pointsOf(geometry), points.offset, info);
    }
    const geometry = new PLYLoader().parse(bytes.buffer);
    return kind === 'mesh' ? meshOf(geometry) : placedLoaded(pointsOf(geometry), info);
}

// The up menu shows the file's own up axis. Files that do not declare one start +Z (ROS REP 103), splats
// included: robot-side splats (Isaac Sim, nerfstudio) are Z-up, raw COLMAP / 3DGS output needs -Y by hand.
function withUp(object, up) {
    object.userData.up = up;
    return object;
}
// The Draco and meshopt decoders load only when a glTF opens, and Draco's workers start only for a file
// that uses KHR_draco_mesh_compression.
async function loadGltf(info, file) {
    const [{ DRACOLoader, DRACO_GLTF_CONFIG }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/DRACOLoader.js'),
        import('meshoptimizer/decoder')
    ]);
    const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
    try {
        const gltf = await new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).loadAsync(file.src);
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
    geometry.userData.scalars = points.scalars ?? (points.intensity && { intensity: points.intensity });
    return pointsOf(geometry);
};
// Clouds shown as a sample, with their file's point count and `readerOf(limit, region)` (a pcdReader or
// binReader); Load detail in view reads each of them again.
const sampled = [];
function streamedCloud(points, info, readerOf, file) {
    info.pointsTotal = points.total;
    const cloud = placed(cloudOf(points), points.offset, info);
    if (points.total > cloud.geometry.attributes.position.count) sampled.push({ cloud, total: points.total, file, readerOf });
    return cloud;
}
async function loadPcd(info, file) {
    const reader = pcdReader(POINT_LIMIT);
    for await (const chunk of file.transport.fileChunks()) if (!reader.push(chunk)) break;
    const points = reader.finish();
    // Only a header the reader does not know (no numeric x y z) reaches PCDLoader, whole.
    if (!points) {
        const geometry = new PCDLoader().parse((await file.bytes()).buffer).geometry;
        const kept = dropNaNPoints(geometry.attributes);
        if (kept) for (const [name, array] of Object.entries(kept)) {
            const { itemSize, normalized } = geometry.attributes[name];
            geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
        }
        const intensity = geometry.attributes.intensity?.array;
        geometry.userData.scalars = intensity && { intensity };
        return placedLoaded(pointsOf(geometry), info);
    }
    return streamedCloud(points, info, pcdReader, file);
}

async function loadBin(info, file) {
    const layout = binLayout(file.name);
    const readerOf = (limit, region) => binReader(file.size, layout, limit, region);
    let reader;
    try {
        reader = readerOf(POINT_LIMIT);
    } catch (error) {
        if (error.name !== 'NotAScan') throw error;
        throw new Error(t('notAScan').replace('{0}', error.bytes).replace('{1}', error.stride).replaceAll('{2}', error.format).replace('{3}', error.record));
    }
    for await (const chunk of file.transport.fileChunks()) reader.push(chunk);
    info.layout = layout.name;
    return streamedCloud(reader.finish(), info, readerOf, file);
}

// The extension re-renders the page after a save, and the new one loads the file, so that is no error.
function showError(error) {
    if (error?.name === 'FileChanged') return false;
    $('load-error').textContent = `${t('failed')}: ${error?.message ?? error}`;
    $('load-error').hidden = false;
    return true;
}

// Every sampled cloud shown and in view gets its detail, one cloud at a time: each read takes the whole file.
async function loadDetailInView() {
    $('detail-btn').disabled = true;
    $('loading-indicator').hidden = false;
    for (const file of files) delete file.info.detailError;
    try {
        const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        for (const { cloud, total, file, readerOf } of sampled) {
            if (!visibleInScene(cloud)) continue;
            cloud.geometry.computeBoundingBox();
            cloud.updateMatrixWorld(true);
            if (!view.intersectsBox(cloud.geometry.boundingBox.clone().applyMatrix4(cloud.matrixWorld))) continue;
            // One file's failed read (changed on disk, or gone) leaves the others' detail coming, and says so in its
            // own Info; a view of one file shows it as before.
            try {
                await loadDetail(cloud, total, file, view, readerOf);
            } catch (error) {
                if (files.length < 2) showError(error);
                else if (error?.name !== 'FileChanged') file.info.detailError = error?.message ?? String(error);
            }
        }
        showInfo();
    } finally {
        $('detail-btn').disabled = false;
        $('loading-indicator').hidden = true;
        wake();
    }
}

async function loadDetail(base, total, file, view, readerOf) {
    const toBase = base.matrixWorld.clone().invert();
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
    // The detail is stored less the sample's offset, since it is drawn as the sample's child.
    const reader = readerOf(POINT_LIMIT, { inside, expected: 1.25 * total * seen / (sample.length / 3) + 1000, offset: base.userData.offset ?? [0, 0, 0] });
    for await (const chunk of file.transport.fileChunks()) reader.push(chunk);
    const points = reader.finish();
    const old = base.userData.detailCloud;
    if (old) {
        cloudColors.remove(old);
        old.removeFromParent();
        old.geometry.dispose();
    }
    const detail = base.userData.detailCloud = cloudOf(points);
    base.add(detail);
    cloudColors.add(detail);
}
const loadTextPoints = async (info, file) => {
    const points = parsePointsText(await file.text());
    return placed(pointsOf(geometryFrom(points)), points.offset, info);
};
const loadSplatFile = async (info, file) => loadSplat(await file.bytes(), info, file.name);

async function loadUsd(info, file) {
    const { composeUsd } = await import('./usd.mjs');
    const read = async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.statusText);
        return new Uint8Array(await response.arrayBuffer());
    };
    const { group, gaussians, missing, missingMaterials, notShown, upAxis, metersPerUnit } = await composeUsd(await file.bytes(), new URL('.', new URL(file.src, location.href)).href, read);
    info.format = 'USD';
    info.notLoaded = missing.join(', ');
    info.missingMaterials = missingMaterials.join(', ');
    info.notShown = notShown.map(([type, count]) => `${type} ×${count}`).join(', ');
    info.unit = metersPerUnit && ({ 1: 'm', 0.01: 'cm', 0.001: 'mm' }[metersPerUnit] ?? `${metersPerUnit} m`);
    for (const { object, ply } of gaussians) object.add(await loadSplat(ply, info, 'gaussians.ply'));
    // Its prims are rows of the Stage panel, which setupStage builds once every file has loaded.
    group.userData.stage = true;
    const pickable = [];
    group.traverse(object => {
        let splat = false;
        for (let level = object; level && level !== group; level = level.parent) splat ||= Boolean(level.userData.splat);
        if ((object.isMesh || object.isPoints) && !splat) pickable.push(object);
    });
    usdStage = { group, pickable, panel: null };
    $('pick-section').hidden = false;
    setPicking(picking);
    $('pick-btn').addEventListener('click', () => {
        setPicking(!picking);
        vscodeApi?.postMessage({ type: 'pick', on: picking });
    });
    return withUp(group, upAxis === 'Y' ? '+Y' : '+Z');
}

// A ROS map_server map is a plane in the map frame, one texel per cell: its lower-left corner at origin (x, y),
// turned by yaw about that corner. Drawn unlit so the cells keep RViz's colors exactly.
function mapPlane(colors, width, height, resolution = 1, [x, y, yaw] = [0, 0, 0]) {
    const limit = renderer.capabilities.maxTextureSize;
    if (width > limit || height > limit) throw new Error(`${width} × ${height} ${t('mapTooLarge')} (${limit})`);
    const texture = new THREE.DataTexture(colors, width, height, THREE.RGBAFormat);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(width * resolution, height * resolution).translate(width * resolution / 2, height * resolution / 2, 0);
    // Pushed back in depth: the axes (and the grid, if turned on) lie in the map's plane and would flicker with it.
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(x, y, 0);
    plane.rotation.z = yaw;
    plane.userData.map = true;
    return plane;
}

const relativeUrl = (path, file) => new URL(path.split('/').map(encodeURIComponent).join('/'), new URL(file.src, location.href));

async function occupancyMap(image, map, info) {
    const { occupancyCells, mapColors, mapModeText } = await import('./occupancy.mjs');
    const round = value => +value.toPrecision(6);
    const [x, y, yaw] = map.origin;
    info.format = t('occupancyMap');
    info.cells = `${image.width} × ${image.height}`;
    info.mapSize = `${round(image.width * map.resolution)} × ${round(image.height * map.resolution)} m`;
    info.resolution = `${map.resolution} ${t('perCell')}`;
    info.origin = `${round(x)}, ${round(y)}, ${round(THREE.MathUtils.radToDeg(yaw))}°`;
    info.mapMode = mapModeText(map);
    return mapPlane(mapColors(occupancyCells(image, map)), image.width, image.height, map.resolution, map.origin);
}

// PNG and other browser formats are decoded by the browser; only PGM needs our own reader.
async function mapImage(bytes, label) {
    const { readPgm, rgbaImage } = await import('./occupancy.mjs');
    try {
        if (bytes[0] === 0x50 && (bytes[1] === 0x32 || bytes[1] === 0x35)) return readPgm(bytes);
        const bitmap = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return rgbaImage(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
    } catch (error) {
        throw new Error(`${t('mapImageMissing')}: ${label}: ${error.message}`);
    }
}

// An absolute image path (Nav2's map_saver can write one), or a relative one that leaves the webview's roots,
// cannot be fetched: in VS Code the extension reads it.
let imageReads = 0;
const imageOfExtension = (path, file) => new Promise((resolve, reject) => {
    const id = ++imageReads;
    const listen = ({ data }) => {
        if (data?.type !== 'imageReply' || data.id !== id || String(data.render) !== String(page.render)) return;
        window.removeEventListener('message', listen);
        if (data.error) return reject(new Error(data.error));
        const { bytes } = data;
        resolve(new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength));
    };
    window.addEventListener('message', listen);
    vscodeApi.postMessage({ type: 'readImage', id, file: file.id, path, render: page.render });
});

async function mapImageNamed(image, file) {
    const missing = reason => new Error(`${t('mapImageMissing')}: ${image} (${reason})`);
    const viaExtension = () => imageOfExtension(image, file).catch(error => { throw missing(error.message); });
    if (vscodeApi && /^([a-z]:)?[\\/]/i.test(image)) return viaExtension();
    const response = await fetch(relativeUrl(image, file)).catch(error => ({ ok: false, statusText: error.message }));
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (vscodeApi) return viaExtension();
    throw missing(response.status || response.statusText);
}

async function mapImageBytes(image, file) {
    try {
        return await mapImageNamed(image, file);
    } catch (error) {
        const { imageBeside } = await import('./occupancy.mjs');
        const beside = imageBeside(image);
        const response = beside && await fetch(relativeUrl(beside, file)).catch(() => null);
        if (response?.ok) return new Uint8Array(await response.arrayBuffer());
        throw error;
    }
}

async function loadMapYaml(info, file) {
    const { readMapYaml } = await import('./occupancy.mjs');
    const map = readMapYaml(await file.text());
    const image = await mapImage(await mapImageBytes(map.image, file), map.image);
    info.mapImage = map.image;
    return occupancyMap(image, map, info);
}

// A PGM is a map when a YAML of the same name sits beside it; otherwise it shows as a picture, one unit per
// pixel, so nothing reads as meters.
async function loadPgm(info, file) {
    const { readPgm, companionMap, greyColors } = await import('./occupancy.mjs');
    const image = readPgm(await file.bytes());
    const { name, map, rejected } = await companionMap(file.name, async yaml => {
        const response = await fetch(relativeUrl(yaml, file)).catch(() => null);
        return response?.ok ? response.text() : null;
    // macOS and Windows disks ignore case, as the extension does when it compares paths.
    }, { ignoreCase: /^(Mac|Win)/i.test(navigator.platform) });
    if (map) {
        info.mapYaml = name;
        return occupancyMap(image, map, info);
    }
    info.format = t('greyImage');
    info.cells = `${image.width} × ${image.height}`;
    info.mapYaml = rejected.length ? `${rejected.join('; ')}; ${t('notMapYaml')}` : t('noMapYaml');
    return mapPlane(greyColors(image), image.width, image.height);
}

// IGES declares no up axis either and starts +Y like STEP.
const cadLoader = format => async (info, file) => {
    info.format = format;
    return withUp(await (await import('./step-load.mjs')).stepModel(cached, file.transport, format), '+Y');
};
const loadStep = cadLoader('STEP');
const loadIges = cadLoader('IGES');

const LOADERS = {
    stl: async (info, file) => {
        const geometry = new STLLoader().parse((await file.bytes()).buffer);
        geometry.setAttribute('normal', new THREE.BufferAttribute(flatNormals(geometry.attributes.position.array), 3));
        return meshOf(geometry);
    },
    ply: loadPly,
    obj: loadObj,
    off: async (info, file) => meshOf(geometryFrom(parseOff(await file.text()))),
    dae: async (info, file) => {
        // ColladaLoader rotates Z_UP files to Y-up and reads a missing <up_axis> as Y_UP; both are undone here.
        const text = await file.text();
        const { scene } = new ColladaLoader().parse(text, new URL('.', new URL(file.src, location.href)).href);
        scene.rotation.set(0, 0, 0);
        return withUp(scene, `+${text.match(/<up_axis>\s*([XYZ])_UP/)?.[1] ?? 'Z'}`);
    },
    gltf: loadGltf,
    glb: loadGltf,
    '3mf': (info, file) => new ThreeMFLoader().loadAsync(file.src),
    wrl: async (info, file) => withUp(await new VRMLLoader().loadAsync(file.src), '+Y'),
    '3ds': (info, file) => new TDSLoader().loadAsync(file.src),
    pcd: loadPcd,
    bin: loadBin,
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
    iges: loadIges,
    pgm: loadPgm,
    yaml: loadMapYaml,
    yml: loadMapYaml
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
    const box = viewBox();
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.near = distance / 1000;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    if (isMap) {
        // A map is seen from above as a floor plan, its +Y (the scene's -Z under +Z up) up the screen; the small
        // offset keeps the orbit off its pole, where the view's roll is undefined.
        camera.position.copy(center).add(new THREE.Vector3(0, 1, 1e-3).normalize().multiplyScalar(distance));
    } else {
        // Over a cloud below its plane at 0, the camera rises until it sees the plane above the center at the default
        // slope: from the default direction a 0.1 x 0.1 x 1 m pole at z = -1..0 put the camera at y = -0.02, the grid
        // edge-on and off screen.
        const slope = 0.7 / Math.SQRT2;
        const below = cloudGround === 0 ? Math.min(center.y, 0) : 0;
        const run = (slope * below + Math.sqrt(Math.max(0, (1 + slope ** 2) * distance ** 2 - below ** 2))) / (1 + slope ** 2);
        camera.position.copy(center).add(new THREE.Vector3(run / Math.SQRT2, slope * run - below, run / Math.SQRT2));
    }
    controls.target.copy(center);
    controls.update();
}

// A point cloud is a scan or map whose frame puts the ground at up = 0 (z = 0 for Z-up); stray points below the
// ground would drag a grid on the lowest point down. Its origin is the sensor's or the map's, worth showing even a
// few metres off the cloud (a wall scanned from 10 m); only past camera.far (UTM coordinates) can the axes not be
// drawn, so only then they start hidden. Bounds would only repeat the size in Info and what the grid shows.
// Near the plane the view takes it in with the grid hidden too, so F returns to the view the cloud opened with;
// farther (altitude or UTM heights) the plane would shrink the cloud to a speck.
const helpers = {};
let isCloud = false;
// A map is a 2D layer at z = 0: the grid would lie in its plane and fight it, so it starts hidden.
let isMap = false;
// Point clouds, maps and other models each open with the helpers last left on for their kind, or these the first time.
const DEFAULT_HELPERS = { cloud: ['grid', 'axes'], map: ['axes'], model: ['grid'] };
const helperKind = () => (isMap ? 'map' : isCloud ? 'cloud' : 'model');
// Point size and Original / Height colouring as last left anywhere, and this file's up axis as last chosen for it.
const savedSettings = (() => {
    try {
        return JSON.parse(page.settings || '{}');
    } catch {
        return {};
    }
})();
const saveSettings = settings => vscodeApi?.postMessage({ type: 'settings', ...settings });
const savedHelpers = (() => {
    try {
        return JSON.parse(page.helpers || '{}');
    } catch {
        return {};
    }
})();
let cloudGround = null;
// Axes left off only because this cloud's origin is far stay in the saved helpers, so the next cloud still gets them.
let axesHeldBack = false;
const axesLength = () => localBox.getSize(new THREE.Vector3()).length() * 0.25 || 1;
function modelBox() {
    root.updateMatrixWorld(true);
    return localBox.clone().applyMatrix4(root.matrixWorld);
}

function viewBox() {
    const box = modelBox();
    // root only rotates about the origin, so the file's up = 0 is the scene's y = 0.
    if (cloudGround === 0) box.expandByPoint(box.getCenter(new THREE.Vector3()).setY(0));
    return box;
}

// The ground grid reaches the horizon like Isaac Sim's: a plane under the camera whose shader draws minor and
// major (10x) lines in powers of ten picked by the camera's distance to its target, minor lines fading out as the
// view zooms out until the major ones take their place, and everything fading with distance. A GridHelper sized to
// the model left a patch floating in the void when zoomed out, and its 10-100 cells jumped with the model's size.
// Coordinates stay small on the GPU: the plane's own xz plus an offset reduced in JS doubles. World xz in float32
// is 0.25 m coarse at UTM northings (4e6), which drew the lines as speckled noise.
const GRID_VERTEX = `
uniform float size;
varying vec2 vLocal;
void main() {
    vLocal = position.xz * size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const GRID_FRAGMENT = `
uniform float cell;
uniform float blend;
uniform float fade;
uniform vec3 minorColor;
uniform vec3 majorColor;
uniform vec2 offset;
uniform float height;
varying vec2 vLocal;
float lines(vec2 p, float size, float width) {
    vec2 coord = p / size;
    vec2 d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    return 1.0 - min(min(d.x, d.y) / width, 1.0);
}
void main() {
    vec2 p = vLocal + offset;
    float minor = lines(p, cell, 1.0) * (1.0 - blend);
    float major = lines(p, cell * 10.0, 1.4);
    float alpha = max(minor * 0.55, major * 0.9) * (1.0 - smoothstep(fade * 0.25, fade, length(vec3(vLocal, height))));
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(minorColor, majorColor, step(minor * 0.55, major * 0.9)), alpha);
    // The colour uniforms arrive in linear space; without this the greys drew near the background's (86 on 80).
    #include <colorspace_fragment>
}`;
function gridHelper() {
    const box = viewBox();
    const material = new THREE.ShaderMaterial({
        vertexShader: GRID_VERTEX,
        fragmentShader: GRID_FRAGMENT,
        // Mid greys stand out against both the light (white) and the dark (#505050) background.
        uniforms: { cell: { value: 1 }, blend: { value: 0 }, fade: { value: 1 }, size: { value: 1 }, offset: { value: new THREE.Vector2() }, height: { value: 0 }, minorColor: { value: new THREE.Color(0x8c8c8c) }, majorColor: { value: new THREE.Color(0xa0a0a0) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        extensions: { derivatives: true }
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    grid.position.y = cloudGround ?? (box.isEmpty() ? 0 : box.min.y);
    grid.frustumCulled = false;
    grid.onBeforeRender = (renderer, scene, viewer) => {
        // Minor cells of about a tenth of the viewing distance: G1 framed whole gets 10 cm cells and 1 m major lines.
        const level = Math.log10(Math.max(viewer.position.distanceTo(controls.target), 1e-6) / 10);
        material.uniforms.cell.value = 10 ** Math.floor(level);
        material.uniforms.blend.value = level - Math.floor(level);
        // Gone by 15 viewing distances: fading out by half the far plane left the horizon a moiré of crowded lines.
        material.uniforms.fade.value = viewer.position.distanceTo(controls.target) * 15;
        grid.position.x = viewer.position.x;
        grid.position.z = viewer.position.z;
        grid.scale.setScalar(viewer.far * 2);
        grid.updateMatrixWorld();
        const period = material.uniforms.cell.value * 10;
        const wrap = value => ((value % period) + period) % period;
        material.uniforms.offset.value.set(wrap(grid.position.x), wrap(grid.position.z));
        material.uniforms.size.value = viewer.far * 2;
        material.uniforms.height.value = viewer.position.y - grid.position.y;
    };
    grid.dispose = () => {
        grid.geometry.dispose();
        material.dispose();
    };
    return grid;
}
// The grid lives in the scene, already in the view's frame; the axes and bounds turn with the up axis.
const HELPERS = {
    grid: () => [scene, gridHelper()],
    axes: () => [root, new THREE.AxesHelper(axesLength())],
    bounds: () => [root, new THREE.Box3Helper(localBox, 0xffa500)]
};
function setHelper(kind, on) {
    helpers[kind]?.removeFromParent();
    helpers[kind]?.dispose();
    helpers[kind] = null;
    if (on) {
        const [parent, helper] = HELPERS[kind]();
        helper.raycast = () => {};
        parent.add(helpers[kind] = helper);
    }
    document.querySelector(`[data-helper="${kind}"]`).classList.toggle('active', on);
}

function nearZeroPlane() {
    const box = modelBox();
    const size = box.getSize(new THREE.Vector3());
    return Math.max(box.min.y, -box.max.y, 0) <= 2 * Math.max(size.x, size.y, size.z);
}

function setUp(up) {
    root.rotation.set(...UP[up]);
    cloudGround = isCloud && nearZeroPlane() ? 0 : null;
    frame();
    fitBox(selectionBox, selected);
    if (usdStage) hoverPrim(null);
    if (helpers.grid) setHelper('grid', true);
}

// The colormap's range for every mode but Original; values past the 2nd-98th percentile take the end colors.
function showLegend(mode, range) {
    $('color-legend').hidden = !range;
    if (!range) return;
    $('legend-bar').style.background ||= turboGradient();
    $('legend-name').textContent = mode === 'height' ? t('colorHeight') : fieldLabel(mode.slice('field:'.length));
    [$('legend-low').textContent, $('legend-high').textContent] = legendLabels(range[0], range[1]);
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

// One section per file; a view of one file shows it as before.
function showInfo() {
    const format = number => number.toLocaleString();
    const sizeOf = bytes => (bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
    const sections = files.map(({ name, size, info, error }) => [
        [t('file'), name],
        [t('format'), info.format],
        [t('fileSize'), sizeOf(size)],
        [t('vertices'), info.vertices && format(info.vertices)],
        [t('faces'), info.faces && format(info.faces)],
        [t('pointCount'), info.points && (info.pointsTotal > info.points ? t('pointsShown').replace('{0}', format(info.points)).replace('{1}', format(info.pointsTotal)) : format(info.points))],
        [t('splats'), info.splats && format(info.splats)],
        [t('layout'), info.layout],
        [t('cells'), info.cells],
        [t('size'), info.mapSize ?? info.size],
        [t('offset'), info.offset?.map((value, axis) => value && `${'XYZ'[axis]} ${format(value)}`).filter(Boolean).join('  ')],
        [t('resolution'), info.resolution],
        [t('origin'), info.origin],
        [t('mapMode'), info.mapMode],
        [t('mapYaml'), info.mapYaml],
        [t('mapImage'), info.mapImage],
        [t('unit'), info.unit],
        [t('notLoaded'), info.notLoaded],
        [t('missingMaterials'), info.missingMaterials],
        [t('notShown'), info.notShown],
        [t('failed'), files.length > 1 && error],
        [t('detailInView'), info.detailError && `${t('detailFailed')}: ${info.detailError}`]
    ].filter(([, value]) => value));
    $('info-table').replaceChildren(...sections.flatMap((rows, s) => [
        ...(s ? [Object.assign(document.createElement('tr'), { className: 'info-gap' })] : []),
        ...rows.map(([label, value], r) => {
            const row = document.createElement('tr');
            if (files.length > 1 && !r) row.className = 'info-file';
            row.append(...[label, value].map(text => Object.assign(document.createElement('td'), { textContent: text })));
            return row;
        })
    ]));
}

let displayMode = 'solid';
function setMode(mode) {
    displayMode = mode;
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    const meshes = [];
    // A map in the view keeps its cells: the modes are for the meshes.
    root.traverse(child => child.isMesh && child !== sparkRenderer && !child.userData.map && meshes.push(child));
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

// Dropped files arrive as URIs, VS Code's own list first. A File dropped from the OS carries no path in a
// webview (Electron removed File.path), so it cannot be added.
function droppedUris(transfer) {
    const list = transfer.getData('application/vnd.code.uri-list') || transfer.getData('text/uri-list');
    return list.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

function setupAdding() {
    const adds = Boolean(vscodeApi && page.adds);
    $('add-btn').hidden = !adds;
    if (!adds) return;
    $('add-btn').title = $('add-btn').ariaLabel = t('addFile');
    $('add-btn').addEventListener('click', () => {
        saveView();
        vscodeApi.postMessage({ type: 'addFiles' });
    });
    document.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', event => {
        event.preventDefault();
        const uris = droppedUris(event.dataTransfer);
        if (!uris.length) return;
        saveView();
        vscodeApi.postMessage({ type: 'addPaths', uris });
    });
}

function setupUi(hasMesh, hasPoints, up) {
    // Splats have no display modes or point sizes; the grid, axes and bounds apply to everything.
    document.querySelectorAll('[data-mode], #size-separator').forEach(element => { element.hidden = !hasMesh; });
    document.querySelectorAll('#size-row, #helper-separator').forEach(element => { element.hidden = !hasMesh && !hasPoints; });
    document.querySelector('[data-helper="bounds"]').hidden = isCloud;
    document.querySelectorAll('[data-helper]').forEach(button => button.addEventListener('click', () => {
        setHelper(button.dataset.helper, !helpers[button.dataset.helper]);
        if (button.dataset.helper === 'axes') axesHeldBack = false;
        const shown = Object.keys(HELPERS).filter(kind => helpers[kind] || (kind === 'axes' && axesHeldBack));
        vscodeApi?.postMessage({ type: 'helpers', helpers: { [helperKind()]: shown } });
    }));
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
    document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => {
        setPointSize(Number(button.dataset.size));
        saveSettings({ pointSize: pointSize });
    }));
    for (const [button, panel] of [[$('display-menu-btn'), $('display-menu')], [$('up-menu-btn'), $('up-menu')], [$('info-btn'), $('info-panel')], [$('help-btn'), $('help-panel')]]) {
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
    const showUp = axis => {
        $('up-label').textContent = axis;
        document.querySelectorAll('[data-up]').forEach(button => button.classList.toggle('active', button.dataset.up === axis));
    };
    $('up-select').value = up;
    showUp(up);
    document.querySelectorAll('[data-up]').forEach(button => button.addEventListener('click', () => {
        $('up-menu').classList.remove('open');
        $('up-menu-btn').classList.remove('active');
        if ($('up-select').value === button.dataset.up) return;
        $('up-select').value = button.dataset.up;
        $('up-select').dispatchEvent(new Event('change'));
    }));
    $('up-select').addEventListener('change', () => {
        showUp($('up-select').value);
        setUp($('up-select').value);
        saveSettings({ up: $('up-select').value });
        cloudColors.refresh();
    });
    $('detail-btn').hidden = !sampled.length;
    $('detail-btn').addEventListener('click', loadDetailInView);
    cloudColors.setup();
    document.querySelectorAll('[data-color="rgb"], [data-color="height"]').forEach(button => button.addEventListener('click', () => saveSettings({ colorMode: button.dataset.color })));
    // One color per file is for telling files apart.
    $('color-solid').hidden ||= files.length < 2;
}

// Hiding every file keeps the last box for the grid and F.
function updateBox() {
    const box = new THREE.Box3();
    for (const file of files) if (file.box && file.group.visible) box.union(file.box);
    // A file with no points or faces still frames, around the origin.
    if (!box.isEmpty() || !localBox) localBox = box;
}

// Hiding or showing a file refits the grid, axes and bounds to what is shown; the camera stays.
function refit() {
    updateBox();
    cloudGround = isCloud && nearZeroPlane() ? 0 : null;
    for (const kind of Object.keys(helpers)) if (helpers[kind]) setHelper(kind, true);
    wake();
}

// A file's color menu is made once and updated in place: rebuilding it on every recolor (Load detail finishing)
// closed it under the pointer.
function colorMenu(file) {
    const { clouds } = file;
    if (file.colorMenu) return file.colorMenu;
    const fields = [...new Set(clouds.flatMap(cloud => Object.keys(cloud.geometry.userData.scalars ?? {})))];
    const menu = file.colorMenu = Object.assign(document.createElement('select'), { className: 'prim-color' });
    menu.append(...[['rgb', t('colorRgb')], ['height', t('colorHeight')], ...fields.map(name => [`field:${name}`, fieldLabel(name)]), ['solid', t('colorSolid')]]
        .map(([value, text]) => Object.assign(document.createElement('option'), { value, textContent: text })));
    menu.addEventListener('change', () => {
        cloudColors.setMode(menu.value, clouds);
        wake();
    });
    syncColorRows();
    return menu;
}
function syncColorRows() {
    for (const { colorMenu: menu, clouds } of files) {
        if (!menu) continue;
        menu.value = cloudColors.modeOf(clouds[0]);
        menu.style.borderLeftColor = `#${cloudColors.solidOf(clouds[0]).getHexString()}`;
    }
}

function fileRow(file, primRows) {
    const type = file.clouds.length && !file.error ? colorMenu(file) : file.info.format ?? '';
    return {
        object: file.group,
        name: file.name,
        type,
        error: file.error,
        remove: file.index && vscodeApi ? () => {
            saveView();
            vscodeApi.postMessage({ type: 'removeFile', file: file.id });
        } : null,
        children: () => (file.object?.userData.stage ? primRows(file.object) : [])
    };
}

// The Stage panel holds a row per file once the view has more than one, and a USD file's prims as before.
async function setupStage() {
    const usd = opened.object?.userData.stage;
    if (files.length < 2 && !usd) return;
    const { buildStage, primRows } = await import('./stage.mjs');
    // A file's eye refits the grid, axes and framing to what is shown; a prim's, as before files, only its box.
    const onToggle = object => {
        if (object.userData.file) refit();
        refitBoxes();
    };
    const stage = files.length < 2
        ? buildStage(() => primRows(opened.object), { onToggle, onSelect: selectPrim })
        : buildStage(() => files.map(file => fileRow(file, primRows)), { files: true, removeLabel: t('remove'), onToggle, onSelect: selectPrim });
    if (usdStage) usdStage.panel = stage;
}

async function loadFile(file) {
    try {
        if (file.missing) throw new Error(t('notFound'));
        const load = LOADERS[file.ext];
        if (!load) throw new Error(`${t('unsupportedFormat')}: ${file.name}`);
        const object = await load(file.info, file);
        file.group.add(object);
        file.object = object;
        // Once, in the file's own frame: a splat's box takes a pass over every splat, and every refit would repeat it.
        root.updateMatrixWorld(true);
        file.ownBox = boxOf(file.group).applyMatrix4(root.matrixWorld.clone().invert());
        // A map's plane is two triangles; its Info rows are its cells and meters.
        if (object.userData.map) return;
        Object.assign(file.info, stats(object));
        file.info.format ??= file.info.faces ? t('mesh') : t('pointCloud');
        file.info.size = file.ownBox.getSize(new THREE.Vector3()).toArray().map(value => +value.toPrecision(3)).join(' × ');
    } catch (error) {
        file.error = error?.message ?? String(error);
        file.failure = error;
    }
}

async function main() {
    document.querySelectorAll('[data-t]').forEach(element => {
        (element.querySelector('span') ?? element).textContent = t(element.dataset.t);
    });
    document.querySelectorAll('[data-title]').forEach(element => { element.title = element.ariaLabel = t(element.dataset.title); });
    setupAdding();
    // Each file loads on its own: one that fails shows its error on its row and the others stay.
    await Promise.all(files.map(loadFile));
    // A page whose file changed keeps showing that it loads: the extension renders the next one.
    if (files.some(file => file.failure?.name === 'FileChanged')) return;
    showInfo();
    const shown = files.filter(file => file.object);
    // A view of several files lists them all, failed ones too, so an added one can be removed.
    if (!shown.length && files.length < 2) {
        showError(opened.failure);
        $('loading-indicator').hidden = true;
        return;
    }
    // A throw while setting the view up would otherwise leave the spinner turning with no word.
    try {
        await setupView(shown);
        viewReady = true;
    } catch (error) {
        showError(error);
    }
    $('loading-indicator').hidden = true;
    wake();
}

async function setupView(shown) {
    const counted = shown.map(file => file.info);
    for (const file of files) {
        file.clouds = [];
        file.group.traverse(child => child.isPoints && !child.userData.detail && !child.parent?.isMesh && file.clouds.push(child));
    }
    const kept = savedView?.camera ? savedView : null;
    // A file keeps its solid color while it stays in the view; one added takes the lowest color no other file has.
    const hues = assignHues(files.map(file => file.id), kept?.hues);
    for (const file of files) file.hue = hues[file.id];
    for (const file of files) file.group.visible = !kept?.hidden?.includes(file.id);
    // A kept state that hides every loaded file (the shown ones were removed) would leave nothing to frame.
    if (!shown.some(file => file.group.visible)) for (const file of files) file.group.visible = true;
    // A failed opened file leaves the view's defaults to the first file that loaded.
    const lead = opened.object ? opened : shown[0];
    // Point size and the up axis live in the settings the extension keeps (sent on every change), so a page
    // rendered for an added or removed file takes them from there like any other.
    const up = savedSettings.up ?? lead?.object.userData.up ?? '+Z';
    // Files share the opened file's frame: each is turned from the up its format declares into that frame.
    const frameUp = lead?.object.userData.up ?? '+Z';
    for (const file of shown) {
        file.group.quaternion.copy(relativeUp(frameUp, file.object.userData.up ?? '+Z'));
        file.box = file.ownBox.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(file.group.quaternion));
    }
    // Point-cloud and map defaults follow the opened file; a map's plane takes no display mode (its info has no faces).
    isMap = Boolean(lead?.object.userData.map);
    isCloud = lead?.info.points > 0 && !lead.info.faces;
    setupUi(counted.some(info => info.faces > 0), counted.some(info => info.points > 0), up);
    updateBox();
    setUp(up);
    if (kept?.camera) {
        const [x, y, z, tx, ty, tz, near, far] = kept.camera;
        camera.position.set(x, y, z);
        // The kept planes were set for the files before: a 200 m map added to a 10 cm part lay past a far of 15 m.
        // Near follows at frame()'s 1:1e5, the depth range frame() gives any file: wider, a map's faces z-fight.
        const box = viewBox();
        const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
        const farthest = box.isEmpty() ? 0 : Math.max(...corners.map(corner => corner.distanceTo(camera.position)));
        const wide = Math.max(far, farthest * 1.1);
        Object.assign(camera, { near: Math.max(near, wide / 1e5), far: wide });
        camera.updateProjectionMatrix();
        controls.target.set(tx, ty, tz);
        controls.update();
    }
    // The view kept over an added or removed file wins over the helpers last left for this kind of model.
    // A cloud's axes are held back (still kept as on) while its origin is past camera.far.
    const originNear = camera.position.length() <= camera.far;
    for (const helper of kept?.helpers ?? savedHelpers[helperKind()] ?? DEFAULT_HELPERS[helperKind()]) {
        if (isCloud && helper === 'bounds') continue;
        if (isCloud && helper === 'axes' && !originNear) axesHeldBack = true;
        else setHelper(helper, true);
    }
    if ([1, 2, 4].includes(savedSettings.pointSize)) setPointSize(savedSettings.pointSize);
    if (kept?.mode && counted.some(info => info.faces > 0)) setMode(kept.mode);
    // Solid is offered only while the view holds several files: kept for one, it could not be turned off.
    // A file without a kept mode (the one just added, or every file on a fresh page) takes the colouring last left;
    // Original is already the choice for a cloud that has colours, Height applies to any cloud.
    const keptColor = file => (kept?.colors?.[file.id] === 'solid' && files.length < 2 ? null : kept?.colors?.[file.id]);
    const colorOf = file => keptColor(file) ?? (savedSettings.colorMode === 'height' ? 'height' : null);
    const colors = files.filter(file => colorOf(file) && file.clouds.length).map(file => [colorOf(file), file.clouds]);
    if (colors.length) cloudColors.setModes(colors);
    await setupStage();
}

main();
