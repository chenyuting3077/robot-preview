import * as THREE from 'three';
import * as d3 from 'd3';
import { SceneManager } from './renderer/SceneManager.js';
import { UIController } from './ui/UIController.js';
import { FileHandler } from './controllers/FileHandler.js';
import { JointControlsUI } from './ui/JointControlsUI.js';
import { PanelManager } from './ui/PanelManager.js';
import { ModelGraphView } from './views/ModelGraphView.js';
import { MeasurementController } from './controllers/MeasurementController.js';
import { MujocoSimulationManager } from './renderer/MujocoSimulationManager.js';
import { i18n } from './utils/i18n.js';
import { PoseController } from './animation/runtime/PoseController.js';
import { ViewGizmo } from './ui/ViewGizmo.js';
import './ui/view-gizmo.css';

window.d3 = d3;
window.i18n = i18n;

const vscode = acquireVsCodeApi();

const SETTING_BUTTONS = [
    'show-visual', 'show-collision', 'show-inertia', 'show-com', 'toggle-axes-btn', 'toggle-joint-axes-btn',
    'toggle-shadow', 'toggle-lighting', 'toggle-grid', 'toggle-joints-panel', 'toggle-model-tree', 'ignore-limits'
];
const PANEL_BUTTONS = { 'toggle-joints-panel': 'floating-joints-panel', 'toggle-model-tree': 'floating-model-tree' };
const MODEL_FILE_RE = /\.(urdf|xacro|xml)$/i;

function syntaxErrorsOf(entries) {
    const result = {};
    for (const { path, data } of entries) {
        if (!MODEL_FILE_RE.test(path)) continue;
        const doc = new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml');
        const error = doc.querySelector('parsererror')?.textContent;
        if (!error) {
            result[path] = [];
            continue;
        }
        const match = error.match(/line (\d+) at column (\d+):\s*(.*?)(?:Below is a rendering|$)/s);
        result[path] = [{
            line: match ? Number(match[1]) - 1 : 0,
            column: match ? Number(match[2]) - 1 : 0,
            message: (match ? match[3] : error).trim()
        }];
    }
    return result;
}

class App {
    constructor() {
        this.sceneManager = null;
        this.uiController = null;
        this.fileHandler = null;
        this.jointControlsUI = null;
        this.panelManager = null;
        this.modelGraphView = null;
        this.measurementController = null;
        this.mujocoSimulationManager = null;
        this.poseController = null;
        this.currentModel = null;
        this.currentMJCFFile = null;
        this.currentMJCFModel = null;
        this.angleUnit = 'rad';
        this.lastLoadError = null;
        this.lastSettings = null;
        this.lastHighlight = null;
        this.pendingSyntax = {};
        this.pendingPrimary = null;
        this.pendingIsUpdate = null;
        this.isUpdate = false;
        this.loading = null;
    }

    async init() {
        try {
            i18n.init();

            const canvas = document.getElementById('canvas');
            this.sceneManager = new SceneManager(canvas);
            this.sceneManager.viewGizmo = new ViewGizmo(this.sceneManager, canvas.parentElement);

            this.poseController = new PoseController(this.sceneManager);
            this.sceneManager.setPoseController(this.poseController);

            this.fileHandler = new FileHandler();
            this.fileHandler.onModelLoaded = (model, file) => this.handleModelLoaded(model, file);
            this.fileHandler.onLoadError = error => {
                this.lastLoadError = error.message;
                this.showError(error.message);
            };

            this.jointControlsUI = new JointControlsUI(this.sceneManager);
            this.jointControlsUI.setPoseController(this.poseController);
            this.jointControlsUI.onLimitsEdited = (joint, limits) => vscode.postMessage({ type: 'editLimits', joint, limits });

            this.modelGraphView = new ModelGraphView(this.sceneManager);
            this.modelGraphView.onReveal = (kind, name) => vscode.postMessage({ type: 'reveal', kind, name });

            this.panelManager = new PanelManager();
            this.panelManager.initAllPanels();
            this.panelManager.setModelGraphView(this.modelGraphView);

            this.uiController = new UIController(this.sceneManager);
            this.uiController.setupAll({
                onAngleUnitChanged: (unit) => this.handleAngleUnitChanged(unit),
                onIgnoreLimitsChanged: (ignore) => this.handleIgnoreLimitsChanged(ignore),
                onResetJoints: () => this.handleResetJoints(),
                onMujocoReset: () => this.handleMujocoReset(),
                onMujocoToggleSimulate: () => this.handleMujocoToggleSimulate()
            });

            this.sceneManager.onMeasurementUpdate = () => this.measurementController?.updateMeasurement();
            this.setupCanvasClickHandler(canvas);

            this.measurementController = new MeasurementController(this.sceneManager);
            this.modelGraphView.setMeasurementController(this.measurementController);

            this.mujocoSimulationManager = new MujocoSimulationManager(this.sceneManager);

            this.setupModelTreePanel();
            this.setupTheme();
            this.setupSettingsSync();
            this.setupMessages();

            this.animate();
        } catch (error) {
            console.error('Initialization error:', error);
            vscode.postMessage({ type: 'error', message: error.stack || String(error) });
        }
    }

    setupTheme() {
        const sync = () => {
            const theme = /\bvscode-(high-contrast-)?light\b/.test(document.body.className) ? 'light' : 'dark';
            if (document.documentElement.getAttribute('data-theme') === theme) return;
            document.documentElement.setAttribute('data-theme', theme);
            this.sceneManager.updateBackgroundColor();
            if (this.currentModel) this.modelGraphView.drawModelGraph(this.currentModel);
        };
        document.documentElement.removeAttribute('data-theme');
        sync();
        new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    collectSettings() {
        const settings = {};
        for (const id of SETTING_BUTTONS) {
            const button = document.getElementById(id);
            if (button) settings[id] = button.classList.contains('active');
        }
        settings.up = document.getElementById('up-select')?.value;
        settings.unit = this.angleUnit;
        return settings;
    }

    applyPanelSettings(settings) {
        for (const [buttonId, panelId] of Object.entries(PANEL_BUTTONS)) {
            if (!(buttonId in settings)) continue;
            document.getElementById(panelId).style.display = settings[buttonId] ? 'flex' : 'none';
            document.getElementById(buttonId).classList.toggle('active', settings[buttonId]);
        }
    }

    applySettings(settings) {
        for (const id of SETTING_BUTTONS) {
            const button = document.getElementById(id);
            if (id in PANEL_BUTTONS || !button || !(id in settings)) continue;
            if (button.classList.contains('active') !== settings[id]) button.click();
        }
        const upSelect = document.getElementById('up-select');
        if (upSelect && settings.up && upSelect.value !== settings.up) {
            upSelect.value = settings.up;
            upSelect.dispatchEvent(new Event('change'));
        }
        if (settings.unit && settings.unit !== this.angleUnit) document.getElementById(`unit-${settings.unit}`)?.click();
        this.lastSettings = JSON.stringify(this.collectSettings());
    }

    setupSettingsSync() {
        const save = () => {
            if (this.lastSettings === null) return;
            const settings = this.collectSettings();
            const key = JSON.stringify(settings);
            if (key === this.lastSettings) return;
            this.lastSettings = key;
            vscode.postMessage({ type: 'settings', settings });
        };
        document.addEventListener('click', event => {
            if (event.target.closest('#top-control-bar, .floating-panel-header')) setTimeout(save, 300);
        });
        document.getElementById('up-select')?.addEventListener('change', () => setTimeout(save, 0));
    }

    showError(message) {
        let box = document.getElementById('load-error');
        if (!box) {
            box = document.createElement('div');
            box.id = 'load-error';
            document.body.appendChild(box);
        }
        box.textContent = message;
        box.style.display = message ? 'block' : 'none';
    }

    loadFiles({ files, removed = [], primary }, reset) {
        this.fileHandler.setFiles(files, removed, reset);
        Object.assign(this.pendingSyntax, syntaxErrorsOf(files));
        this.pendingPrimary = primary;
        this.pendingIsUpdate = !reset && (this.pendingIsUpdate ?? true);
        this.loading ??= this.runLoads().finally(() => { this.loading = null; });
        return this.loading;
    }

    async runLoads() {
        while (this.pendingPrimary) {
            const primary = this.pendingPrimary;
            const syntax = this.pendingSyntax;
            this.isUpdate = this.pendingIsUpdate && this.currentModel !== null;
            Object.assign(this, { pendingPrimary: null, pendingSyntax: {}, pendingIsUpdate: null, lastLoadError: null });

            const pose = this.isUpdate ? this.poseController.getPose() : null;
            const previousModel = this.currentModel;
            await this.fileHandler.loadPrimary(primary);
            if (!this.lastLoadError) this.showError('');
            if (pose && this.currentModel !== previousModel) this.poseController.applyPose(pose, { source: 'user' });
            if (this.lastHighlight) this.highlightByPattern(this.lastHighlight.kind, this.lastHighlight.pattern);

            vscode.postMessage({ type: 'diagnostics', syntax, loadError: this.lastLoadError });
        }
    }

    setupMessages() {
        const handlers = {
            load: async (message) => {
                vscode.setState({ sourcePath: message.sourcePath });
                if (this.lastSettings === null) this.applyPanelSettings(message.settings || {});
                await this.loadFiles(message, true);
                if (this.lastSettings === null) this.applySettings(message.settings || {});
            },
            update: (message) => this.loadFiles(message, false),
            highlight: async ({ kind, pattern }) => {
                this.lastHighlight = pattern ? { kind, pattern } : null;
                this.highlightByPattern(kind, pattern);
            }
        };

        window.addEventListener('message', ({ data }) => {
            handlers[data?.type]?.(data).catch(error => {
                vscode.postMessage({ type: 'error', message: error.stack || String(error) });
            });
        });
        vscode.postMessage({ type: 'ready' });
    }

    highlightByPattern(kind, pattern) {
        const highlightManager = this.sceneManager.highlightManager;
        highlightManager.clearHighlight();
        const model = this.currentModel;
        if (!pattern || !model?.links) return;

        const regex = new RegExp(`^(?:${pattern})$`);
        const linkName = kind === 'joint'
            ? Array.from(model.joints.values()).find(joint => regex.test(joint.name))?.child
            : Array.from(model.links.keys()).find(name => regex.test(name));
        const link = linkName && model.links.get(linkName);
        if (link) highlightManager.highlightLink(link, model);
    }

    handleModelLoaded(model, file) {
        const isMJCF = file.name.toLowerCase().endsWith('.xml') && model?.userData?.type === 'mjcf';

        if (this.mujocoSimulationManager?.hasScene()) {
            this.mujocoSimulationManager.clearScene();
        }

        const simulationBar = document.getElementById('mujoco-simulation-bar');
        if (isMJCF && model.joints?.size > 0) {
            this.currentMJCFFile = file;
            this.currentMJCFModel = model;
            simulationBar.style.display = 'flex';

            const resetBtn = document.getElementById('mujoco-reset-btn-bar');
            resetBtn.disabled = false;
            resetBtn.querySelector('span').textContent = i18n.t('mujocoReset');

            const simulateBtn = document.getElementById('mujoco-simulate-btn-bar');
            simulateBtn.disabled = false;
            simulateBtn.classList.remove('active');
            simulateBtn.querySelector('span').textContent = i18n.t('mujocoSimulate');
        } else {
            simulationBar.style.display = 'none';
            this.currentMJCFFile = null;
            this.currentMJCFModel = null;
        }

        if (this.currentModel) {
            this.sceneManager.removeModel(this.currentModel);
        }
        this.currentModel = model;
        this.poseController.setModel(model);

        if (this.isUpdate) {
            const jointList = document.getElementById('joint-controls');
            const scrollTop = jointList?.scrollTop ?? 0;
            this.sceneManager.addModel(model, { fitCamera: false });
            this.sceneManager.setGroundVisible(true);
            this.jointControlsUI.setupJointControls(model);
            if (jointList) jointList.scrollTop = scrollTop;
            this.modelGraphView.drawModelGraph(model, { keepView: true });
            this.sceneManager.redraw();
            return;
        }

        this.sceneManager.redraw();
        this.sceneManager.render();

        const canvas = document.getElementById('canvas');
        let snapshot = null;
        try {
            snapshot = document.createElement('div');
            snapshot.id = 'canvas-snapshot';
            snapshot.style.cssText = `
                position: absolute; inset: 0; z-index: 2; pointer-events: none;
                background: var(--bg-primary) url(${canvas.toDataURL('image/png')}) center / cover no-repeat;
            `;
            document.getElementById('canvas-container').appendChild(snapshot);
        } catch (error) {
            console.error('Failed to create snapshot:', error);
        }

        const removeSnapshot = () => {
            clearTimeout(timeoutId);
            this.sceneManager.off('modelReady', removeSnapshot);
            if (!snapshot?.parentNode) return;
            snapshot.style.transition = 'opacity 0.3s ease';
            snapshot.style.opacity = '0';
            setTimeout(() => snapshot.remove(), 300);
        };
        const timeoutId = setTimeout(removeSnapshot, 5000);
        this.sceneManager.on('modelReady', removeSnapshot);

        this.sceneManager.addModel(model);
        this.sceneManager.setGroundVisible(true);
        this.jointControlsUI.setupJointControls(model);
        this.modelGraphView.drawModelGraph(model);
    }

    setupCanvasClickHandler(canvas) {
        let mouseDownPos = null;
        let mouseDownTime = 0;

        canvas.addEventListener('mousedown', (event) => {
            if (event.button === 0) {
                mouseDownPos = { x: event.clientX, y: event.clientY };
                mouseDownTime = Date.now();
            }
        }, true);

        canvas.addEventListener('mouseup', (event) => {
            if (event.button !== 0 || !mouseDownPos) return;

            const distance = Math.hypot(event.clientX - mouseDownPos.x, event.clientY - mouseDownPos.y);
            const duration = Date.now() - mouseDownTime;
            mouseDownPos = null;
            if (distance >= 5 || duration >= 300) return;

            const rect = canvas.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1
            );
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.sceneManager.camera);

            const hit = raycaster.intersectObjects(this.sceneManager.scene.children, true).find(({ object }) => {
                for (let current = object; current; current = current.parent) {
                    const name = current.name || '';
                    if (name.includes('jointAxis') || name.includes('helper') ||
                        name.includes('grid') || name.includes('Ground') || name === 'groundPlane') {
                        return false;
                    }
                }
                return object.isMesh && object.visible;
            });

            if (!hit) {
                this.sceneManager.highlightManager.clearHighlight();
                this.modelGraphView.clearAllSelections(d3.select('#model-graph-svg'));
                this.measurementController.clearMeasurement();
                return;
            }

            const links = Array.from(this.currentModel?.links?.values() || []);
            for (let obj = hit.object; obj; obj = obj.parent) {
                const link = links.find(candidate => candidate.threeObject === obj);
                if (link) {
                    vscode.postMessage({ type: 'reveal', kind: 'link', name: link.name });
                    break;
                }
            }
        }, true);
    }

    setupModelTreePanel() {
        const floatingPanel = document.getElementById('floating-model-tree');

        floatingPanel.addEventListener('click', (event) => {
            const target = event.target;
            if (target === floatingPanel ||
                target.classList?.contains('graph-controls-hint') ||
                target.classList?.contains('empty-state')) {
                this.modelGraphView.clearAllSelections(d3.select('#model-graph-svg'));
                this.measurementController.clearMeasurement();
                this.sceneManager.highlightManager.clearHighlight();
            }
        });
    }

    handleAngleUnitChanged(unit) {
        this.angleUnit = unit;
        this.jointControlsUI.setAngleUnit(unit);
    }

    handleResetJoints() {
        if (this.currentModel) this.jointControlsUI.resetAllJoints(this.currentModel);
    }

    handleIgnoreLimitsChanged(ignore) {
        if (this.currentModel) this.jointControlsUI.updateAllSliderLimits(this.currentModel, ignore);
    }

    handleMujocoReset() {
        this.mujocoSimulationManager.reset();
    }

    async handleMujocoToggleSimulate() {
        if (!this.mujocoSimulationManager.hasScene() && this.currentMJCFFile && this.currentMJCFModel) {
            try {
                const xmlContent = await this.currentMJCFFile.text();
                await this.mujocoSimulationManager.loadScene(
                    xmlContent,
                    this.currentMJCFFile.name,
                    this.fileHandler.fileMap,
                    this.currentMJCFModel
                );
                if (this.currentModel?.threeObject) this.currentModel.threeObject.visible = false;
                this.mujocoSimulationManager.startSimulation();
                return true;
            } catch (error) {
                console.error('MuJoCo scene loading failed:', error);
                return false;
            }
        }

        const isSimulating = this.mujocoSimulationManager.toggleSimulation();
        if (this.currentModel?.threeObject) this.currentModel.threeObject.visible = !isSimulating;
        return isSimulating;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.sceneManager) {
            this.sceneManager.update();

            // A running simulation changes scene transforms every frame. A
            // paused or absent simulation leaves the scene clean, allowing the
            // renderer (and discrete GPU) to remain idle.
            const simulationRunning =
                this.mujocoSimulationManager?.isSimulationRunning() === true;
            if (simulationRunning) {
                this.mujocoSimulationManager.update(performance.now());
                this.sceneManager.redraw();
            }

            this.sceneManager.renderIfNeeded();
        }
    }
}

const app = new App();
app.init();
window.app = app;
