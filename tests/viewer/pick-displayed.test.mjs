import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JointDragControls } from '../../src/utils/JointDragControls.js';
import { DragStateManager } from '../../src/utils/DragStateManager.js';
import { HighlightManager } from '../../src/renderer/HighlightManager.js';
import { intersectDisplayed } from '../../src/utils/picking.js';

// base --(revolute j about Z)--> arm; arm has a visual box and a collision box at x = 1.
function robot() {
    const root = new THREE.Group();
    const base = Object.assign(new THREE.Object3D(), { name: 'base', isURDFLink: true });
    const joint = Object.assign(new THREE.Object3D(), { name: 'j', isURDFJoint: true, jointType: 'revolute', axis: new THREE.Vector3(0, 0, 1), angle: 0 });
    const arm = Object.assign(new THREE.Object3D(), { name: 'arm', isURDFLink: true });
    const visual = Object.assign(new THREE.Group(), { isURDFVisual: true });
    const collider = Object.assign(new THREE.Group(), { isURDFCollider: true });
    const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshPhongMaterial());
    const collisionMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshPhongMaterial());
    visual.position.x = collider.position.x = 1;
    root.add(base);
    base.add(joint);
    joint.add(arm);
    arm.add(visual, collider);
    visual.add(visualMesh);
    collider.add(collisionMesh);
    root.updateMatrixWorld(true);
    const jointData = { name: 'j', type: 'revolute', threeObject: joint, limits: { lower: -3, upper: 3 } };
    const model = {
        threeObject: root,
        links: new Map([['base', { name: 'base' }], ['arm', { name: 'arm' }]]),
        joints: new Map([['j', jointData]])
    };
    return { root, arm, visual, collider, visualMesh, collisionMesh, model, jointData };
}

const rayAt = (x, y) => new THREE.Ray(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));

function hoverAt(r, x = 1, y = 0) {
    const controls = new JointDragControls(null, new THREE.PerspectiveCamera(), null, r.model);
    controls.moveRay(rayAt(x, y));
    return controls;
}

test('a shown visual is hovered as its link', () => {
    const r = robot();
    r.collider.visible = false;
    assert.equal(hoverAt(r).hovered?.name, 'arm');
});

test('a hidden visual is not hovered', () => {
    const r = robot();
    r.visualMesh.visible = false;
    r.collider.visible = false;
    assert.equal(hoverAt(r).hovered, null);
});

test('a visual under a hidden ancestor is not hovered', () => {
    const r = robot();
    r.collider.visible = false;
    r.visual.visible = false;
    assert.equal(hoverAt(r).hovered, null);
    r.visual.visible = true;
    r.root.visible = false;
    assert.equal(hoverAt(r).hovered, null);
});

test('a visual whose material is hidden is not hovered', () => {
    const r = robot();
    r.collider.visible = false;
    r.visualMesh.material.visible = false;
    assert.equal(hoverAt(r).hovered, null);
});

test('a visual outside the camera layers is not hovered', () => {
    const r = robot();
    r.collider.visible = false;
    r.visualMesh.layers.set(2);
    assert.equal(hoverAt(r).hovered, null);
});

test('with only collision shown, the collision mesh is hovered as its link and drags its joint', () => {
    const r = robot();
    r.visualMesh.visible = false;
    // y = 0.22 is on the 0.5 collision box but off the 0.4 visual box
    const controls = hoverAt(r, 1, 0.22);
    assert.equal(controls.hovered?.name, 'arm');
    const moved = [];
    controls.onUpdateJoint = (joint, angle) => moved.push([joint.name, angle]);
    controls.setGrabbed(true);
    controls.moveRay(rayAt(1, 0.5));
    assert.equal(moved.length, 1);
    assert.equal(moved[0][0], 'j');
    assert.ok(moved[0][1] > 0.1, `angle ${moved[0][1]}`);
});

test('with visual and collision hidden, nothing is hovered or grabbed', () => {
    const r = robot();
    r.visualMesh.visible = false;
    r.collider.visible = false;
    const controls = hoverAt(r);
    assert.equal(controls.hovered, null);
    const moved = [];
    controls.onUpdateJoint = (joint, angle) => moved.push(angle);
    controls.setGrabbed(true);
    controls.moveRay(rayAt(1, 0.3));
    assert.deepEqual(moved, []);
});

function physicsScene() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld(true);
    const body = new THREE.Group();
    const geom = Object.assign(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial()), { bodyID: 1 });
    body.add(geom);
    scene.add(body);
    scene.updateMatrixWorld(true);
    const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } };
    const drag = new DragStateManager(scene, renderer, camera, null, { enabled: true });
    return { body, geom, drag };
}

test('physics drag grabs a shown body and ignores a hidden one', () => {
    const shown = physicsScene();
    shown.drag.start(50, 50);
    assert.equal(shown.drag.physicsObject, shown.geom);

    for (const hide of [s => { s.geom.visible = false; }, s => { s.body.visible = false; }, s => { s.geom.material.visible = false; }]) {
        const s = physicsScene();
        hide(s);
        s.drag.start(50, 50);
        assert.equal(s.drag.physicsObject, null);
    }
});

test('physics drag ignores a wireframe geom, which is drawn only along its edges', () => {
    const s = physicsScene();
    s.geom.material.wireframe = true;
    s.drag.start(50, 50);
    assert.equal(s.drag.physicsObject, null);
});

test('a visual seen through another link\'s collision shell is the one hovered', () => {
    const r = robot();
    // base's oversized collision shell sits between the camera and arm's visual
    const shell = Object.assign(new THREE.Group(), { isURDFCollider: true });
    shell.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.1), new THREE.MeshPhongMaterial()));
    shell.position.z = 2;
    r.model.threeObject.children[0].add(shell);
    r.root.updateMatrixWorld(true);
    const controls = hoverAt(r);
    assert.equal(controls.hovered?.name, 'arm');
    // off arm's visual, the shell is what is on screen
    assert.equal(hoverAt(r, -1, 0).hovered?.name, 'base');
});

test('a hovered collision mesh keeps its see-through look, a little more opaque', () => {
    const r = robot();
    const original = r.collisionMesh.material;
    Object.assign(original, { transparent: true, opacity: 0.35 });
    const highlight = new HighlightManager({ redraw() {} });
    highlight.highlightLink({ name: 'arm', threeObject: r.arm }, r.model, { showInfo: false });
    assert.equal(r.visualMesh.material, highlight.highlightMaterial);
    assert.notEqual(r.collisionMesh.material, highlight.highlightMaterial);
    assert.ok(r.collisionMesh.material.transparent && Math.abs(r.collisionMesh.material.opacity - 0.5) < 1e-9, `opacity ${r.collisionMesh.material.opacity}`);
    // unhighlighting also hides the hover tooltip
    globalThis.document = { getElementById: () => null };
    try {
        highlight.unhighlightLink({ name: 'arm', threeObject: r.arm }, r.model);
    } finally {
        delete globalThis.document;
    }
    assert.equal(r.collisionMesh.material, original);
});

test('a hovered floor keeps its colour and texture with a faint glow, not the white highlight', () => {
    const r = robot();
    const map = new THREE.Texture();
    const original = new THREE.MeshPhongMaterial({ color: 0x336699, map });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), original);
    floor.userData.isGroundPlane = true;
    r.arm.add(floor);
    const highlight = new HighlightManager({ redraw() {} });
    highlight.highlightLink({ name: 'arm', threeObject: r.arm }, r.model, { showInfo: false });
    assert.equal(r.visualMesh.material, highlight.highlightMaterial, 'other visuals still turn white');
    const lit = floor.material;
    assert.ok(lit !== highlight.highlightMaterial && lit !== original);
    assert.equal(lit.map, map);
    assert.equal(lit.color.getHex(), 0x336699);
    assert.ok(lit.emissiveIntensity > 0 && lit.emissiveIntensity < highlight.highlightMaterial.emissiveIntensity);
    globalThis.document = { getElementById: () => null };
    try {
        highlight.unhighlightLink({ name: 'arm', threeObject: r.arm }, r.model);
    } finally {
        delete globalThis.document;
    }
    assert.equal(floor.material, original);
});

test('picking skips a face with no material, and objects off the raycaster layers', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    const unmaterialed = new THREE.Mesh(geometry, []);
    unmaterialed.updateMatrixWorld(true);
    assert.deepEqual(intersectDisplayed(ray, [unmaterialed]), []);
    const layered = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial());
    layered.layers.set(3);
    layered.updateMatrixWorld(true);
    assert.deepEqual(intersectDisplayed(ray, [layered]), []);
});

test('a floor is not hovered, and still hides what is behind it', () => {
    const r = robot();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshPhongMaterial({ side: THREE.DoubleSide }));
    floor.userData.isGroundPlane = true;
    floor.position.z = -1;
    const visual = Object.assign(new THREE.Group(), { isURDFVisual: true });
    visual.add(floor);
    r.model.threeObject.children[0].add(visual);
    r.root.updateMatrixWorld(true);
    assert.equal(hoverAt(r).hovered?.name, 'arm', 'the arm in front of the floor');
    assert.equal(hoverAt(r, -1, 0).hovered, null, 'only the floor under the pointer');
    floor.position.z = 2;
    r.root.updateMatrixWorld(true);
    assert.equal(hoverAt(r).hovered, null, 'the floor between the camera and the arm');
});
