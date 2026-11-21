// SDF converts to a URDF that puts every link, visual and joint axis where
// Gazebo would. Expected values are worked out by hand from the SDF poses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import * as THREE from 'three';
import { SDFAdapter } from '../../src/adapters/SDFAdapter.js';

globalThis.DOMParser = DOMParser;

const files = entries => new Map(Object.entries(entries).map(([key, value]) => [key, new File([value], key.split('/').pop())]));

function origin(element) {
    const xyz = (element?.getAttribute('xyz') || '0 0 0').split(/\s+/).map(Number);
    const rpy = (element?.getAttribute('rpy') || '0 0 0').split(/\s+/).map(Number);
    return new THREE.Matrix4().compose(new THREE.Vector3(...xyz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX')), new THREE.Vector3(1, 1, 1));
}

/** World frames of the URDF's links, and its parsed document. */
async function convert(sdf, fileName = '/pkg/model.sdf', fileMap = new Map()) {
    const { urdf, files: generated } = await SDFAdapter.toURDF(sdf, fileName, fileMap);
    const doc = new DOMParser().parseFromString(urdf, 'text/xml');
    const joints = Array.from(doc.querySelectorAll('joint'));
    const frames = new Map();
    const frameOf = name => {
        if (frames.has(name)) return frames.get(name);
        const joint = joints.find(j => j.querySelector('child').getAttribute('link') === name);
        const frame = joint
            ? frameOf(joint.querySelector('parent').getAttribute('link')).clone().multiply(origin(joint.querySelector('origin')))
            : new THREE.Matrix4();
        frames.set(name, frame);
        return frame;
    };
    const link = name => doc.querySelector(`link[name="${name}"]`);
    const visualAt = (name, index = 0) => {
        const visual = link(name).querySelectorAll('visual')[index];
        return new THREE.Vector3().setFromMatrixPosition(frameOf(name).clone().multiply(origin(visual.querySelector('origin'))));
    };
    const joint = name => joints.find(j => j.getAttribute('name') === name);
    const axisInWorld = name => {
        const j = joint(name);
        const axis = new THREE.Vector3(...j.querySelector('axis').getAttribute('xyz').split(/\s+/).map(Number));
        return axis.applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(frameOf(j.querySelector('child').getAttribute('link'))));
    };
    return { urdf, doc, generated, frameOf, visualAt, joint, axisInWorld, link };
}

const close = (actual, expected, message) => {
    const values = actual.toArray ? actual.toArray() : actual;
    values.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6, `${message}: ${values} vs ${expected}`));
};

test('link, joint and visual poses compose as SDF 1.7 says', async () => {
    const { visualAt, frameOf, joint, axisInWorld } = await convert(`<sdf version="1.7"><model name="m">
        <pose>0 0 1 0 0 0</pose>
        <link name="base"><visual name="v"><geometry><box><size>1 1 1</size></box></geometry></visual></link>
        <link name="arm"><pose>1 0 0 0 0 1.5707963267948966</pose>
          <visual name="v"><pose>0.2 0 0 0 0 0</pose><geometry><sphere><radius>0.1</radius></sphere></geometry></visual></link>
        <joint name="j" type="revolute"><parent>base</parent><child>arm</child><pose>0 0.5 0 0 0 0</pose>
          <axis><xyz>1 0 0</xyz><limit><lower>-1</lower><upper>1</upper></limit></axis></joint>
      </model></sdf>`);
    close(visualAt('base'), [0, 0, 1], 'base visual');
    close(visualAt('arm'), [1, 0.2, 1], 'arm visual');
    // The joint pose is relative to its child link, rotated 90° about z.
    close(new THREE.Vector3().setFromMatrixPosition(frameOf('arm')), [0.5, 0, 1], 'joint frame');
    close(axisInWorld('j'), [0, 1, 0], 'axis in the joint frame');
    assert.equal(joint('j').getAttribute('type'), 'revolute');
    assert.equal(joint('j').querySelector('limit').getAttribute('upper'), '1');
});

test('relative_to frames, expressed_in axes and degrees', async () => {
    const { visualAt, axisInWorld, joint } = await convert(`<sdf version="1.9"><model name="m">
        <link name="base"/>
        <frame name="mount" attached_to="base"><pose>0 0 2 0 0 0</pose></frame>
        <link name="tool"><pose relative_to="mount" degrees="true">1 0 0 0 0 90</pose>
          <visual name="v"><geometry><box><size>1 1 1</size></box></geometry></visual></link>
        <joint name="j" type="revolute"><parent>base</parent><child>tool</child>
          <axis><xyz expressed_in="__model__">1 0 0</xyz></axis></joint>
      </model></sdf>`);
    close(visualAt('tool'), [1, 0, 2], 'tool visual');
    close(axisInWorld('j'), [1, 0, 0], 'axis stays in the model frame');
    assert.equal(joint('j').getAttribute('type'), 'continuous', 'no limits');
});

test('axes before 1.7: model frame in 1.4, and in 1.6 with use_parent_model_frame', async () => {
    const model = (version, extra) => `<sdf version="${version}"><model name="m">
        <link name="a"/><link name="b"><pose>0 0 0 0 0 1.5707963267948966</pose></link>
        <joint name="j" type="revolute"><parent>a</parent><child>b</child>
          <axis><xyz>1 0 0</xyz>${extra}<limit><lower>0</lower><upper>1</upper></limit></axis></joint>
      </model></sdf>`;
    close((await convert(model('1.4', ''))).axisInWorld('j'), [1, 0, 0], '1.4');
    close((await convert(model('1.6', '<use_parent_model_frame>true</use_parent_model_frame>'))).axisInWorld('j'), [1, 0, 0], '1.6 parent frame');
    close((await convert(model('1.6', ''))).axisInWorld('j'), [0, 1, 0], '1.6 joint frame');
});

test('nested and included models: scoped names, newest SDF in model.config, relative mesh URIs', async () => {
    const fileMap = files({
        '/wheel/model.config': `<model><sdf version="1.5">old.sdf</sdf><sdf version="1.10">model.sdf</sdf></model>`,
        '/wheel/old.sdf': `<sdf version="1.5"><model name="old"><link name="wrong"/></model></sdf>`,
        '/wheel/model.sdf': `<sdf version="1.10"><model name="wheel"><link name="rim">
            <visual name="v"><geometry><mesh><uri>meshes/rim.dae</uri><scale>2 2 2</scale></mesh></geometry></visual></link></model></sdf>`
    });
    const { visualAt, link, doc } = await convert(`<sdf version="1.8"><model name="car">
        <link name="chassis"/>
        <model name="arm"><pose>0 1 0 0 0 0</pose>
          <link name="link1"><visual name="v"><geometry><box><size>1 1 1</size></box></geometry></visual></link></model>
        <include><uri>model://wheel</uri><name>front</name><pose>2 0 0 0 0 0</pose></include>
        <joint name="to_arm" type="fixed"><parent>chassis</parent><child>arm::link1</child></joint>
        <joint name="to_wheel" type="continuous"><parent>chassis</parent><child>front::rim</child></joint>
      </model></sdf>`, '/pkg/car.sdf', fileMap);
    close(visualAt('arm::link1'), [0, 1, 0], 'nested link');
    close(visualAt('front::rim'), [2, 0, 0], 'included link');
    const mesh = link('front::rim').querySelector('mesh');
    assert.equal(mesh.getAttribute('filename'), 'wheel/meshes/rim.dae', 'relative to the included file');
    assert.equal(mesh.getAttribute('scale'), '2 2 2');
    assert.equal(doc.querySelector('link[name="world"]'), null, 'one root: no world link');
});

test('a world scopes each model and roots them at world', async () => {
    const { visualAt, doc } = await convert(`<sdf version="1.6"><world name="w">
        <model name="a"><pose>1 0 0 0 0 0</pose><link name="l"><visual name="v"><geometry><box><size>1 1 1</size></box></geometry></visual></link></model>
        <model name="b"><pose>0 2 0 0 0 0</pose><link name="l"><visual name="v"><geometry><box><size>1 1 1</size></box></geometry></visual></link></model>
      </world></sdf>`, '/pkg/w.world');
    close(visualAt('a::l'), [1, 0, 0], 'model a');
    close(visualAt('b::l'), [0, 2, 0], 'model b');
    assert.ok(doc.querySelector('link[name="world"]'));
});

test('capsules become generated meshes; a loop-closing joint is dropped', async () => {
    const { generated, joint, link } = await convert(`<sdf version="1.9"><model name="m">
        <link name="a"/><link name="b"/><link name="c">
          <visual name="v"><geometry><capsule><radius>0.1</radius><length>0.5</length></capsule></geometry>
            <material><diffuse>1 0 0 1</diffuse></material></visual></link>
        <joint name="ab" type="fixed"><parent>a</parent><child>b</child></joint>
        <joint name="bc" type="fixed"><parent>b</parent><child>c</child></joint>
        <joint name="ac" type="fixed"><parent>a</parent><child>c</child></joint>
      </model></sdf>`);
    const filename = link('c').querySelector('mesh').getAttribute('filename');
    assert.ok(generated.has(filename), filename);
    assert.match(await generated.get(filename).text(), /^v /m);
    assert.equal(link('c').querySelector('color').getAttribute('rgba'), '1 0 0 1');
    assert.equal(joint('ac'), undefined);
});

test('a missing or Fuel include is skipped and listed, the rest still converts', async () => {
    const { urdf, missingIncludes } = await SDFAdapter.toURDF(`<sdf version="1.9"><world name="w">
        <include><uri>model://ground_plane</uri></include>
        <include><uri>https://fuel.gazebosim.org/1.0/OpenRobotics/models/Table</uri></include>
        <include><uri>../missing_dir</uri></include>
        <model name="m"><link name="l"/></model>
      </world></sdf>`, '/pkg/w.sdf', new Map());
    assert.deepEqual(missingIncludes, ['model://ground_plane', 'https://fuel.gazebosim.org/1.0/OpenRobotics/models/Table', '../missing_dir']);
    assert.match(urdf, /<link name="m::l">/);
});

test('a mesh visual carries its transparency for after loading; a primitive folds it into its color', async () => {
    const { link } = await convert(`<sdf version="1.9"><model name="m"><link name="l">
        <visual name="mesh"><transparency>0.25</transparency><geometry><mesh><uri>a.dae</uri></mesh></geometry>
          <material><diffuse>1 0 0 1</diffuse></material></visual>
        <visual name="box"><transparency>0.25</transparency><geometry><box><size>1 1 1</size></box></geometry>
          <material><diffuse>1 0 0 1</diffuse></material></visual>
      </link></model></sdf>`);
    const [mesh, box] = link('l').querySelectorAll('visual');
    assert.equal(mesh.getAttribute('sdf_transparency'), '0.25');
    assert.equal(mesh.querySelector('color').getAttribute('rgba'), '1 0 0 1');
    assert.equal(box.getAttribute('sdf_transparency'), null);
    assert.equal(box.querySelector('color').getAttribute('rgba'), '1 0 0 0.75');
});
