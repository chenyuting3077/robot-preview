// A workspace referencing one mesh per path form, shared by the extension
// matrix and the webview end-to-end check. Generated per run because absolute
// and file:// references need the real temp path. Meshes are valid so the
// webview can parse them, not just receive them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STL = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 0.01 0 0\nvertex 0 0.01 0\nendloop\nendfacet\nendsolid x\n';
const OBJ = 'mtllib g.mtl\nv 0 0 0\nv 0.01 0 0\nv 0 0.01 0\nusemtl m\nf 1 2 3\n';
const MTL = 'newmtl m\nKd 1 0 0\nmap_Kd tex.png\n';
const DAE = `<?xml version="1.0"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_images><image id="img"><init_from>k_tex.jpg</init_from></image></library_images>
  <library_geometries><geometry id="g"><mesh>
    <source id="p"><float_array id="pa" count="9">0 0 0 0.01 0 0 0 0.01 0</float_array><technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="v"><input semantic="POSITION" source="#p"/></vertices>
    <triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="s"><node id="n"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

export function write(file, data = STL) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
}

// A one-package workspace with a single model file, for tests that need nothing else.
export function robotWorkspace(urdf, name = 'robot.urdf') {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-ws-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    const primary = path.join(ws, 'src/pkg/urdf', name);
    write(primary, urdf);
    return { ws, primary };
}

export function createPathMatrix() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-paths-')));
    const ws = path.join(root, 'ws');
    const outside = path.join(root, 'outside');
    const models = path.join(root, 'models');
    const extPkg = path.join(root, 'ext_pkg');

    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/pkg/meshes/a.stl'));
    write(path.join(ws, 'src/pkg/meshes/Case.stl'));
    write(path.join(ws, 'src/other/meshes/c.stl'));
    write(path.join(outside, 'd.stl'));
    write(path.join(outside, 'd2.stl'));
    write(path.join(outside, 'my part.stl'));
    write(path.join(outside, 'g.obj'), OBJ);
    write(path.join(outside, 'g.mtl'), MTL);
    write(path.join(outside, 'tex.png'), PNG);
    write(path.join(outside, 'unrelated.stl'));
    write(path.join(outside, 'stray.png'), PNG);
    write(path.join(outside, 'k.dae'), DAE);
    write(path.join(outside, 'k_tex.jpg'), 'jpg');
    write(path.join(outside, 'recording.bag'), 'bag');
    write(path.join(outside, 'env/h.stl'));
    write(path.join(models, 'model_x/meshes/e.stl'));
    write(path.join(extPkg, 'meshes/f.stl'));

    const references = [
        'package://pkg/meshes/a.stl',
        '../../other/meshes/c.stl',
        path.join(outside, 'd.stl'),
        'file://' + path.join(outside, 'd2.stl'),
        path.join(outside, 'my%20part.stl'),
        path.join(outside, 'g.obj'),
        'model://model_x/meshes/e.stl',
        'package://ext_pkg/meshes/f.stl',
        '$(env PATH_MATRIX_DIR)/h.stl',
        'package://pkg/meshes/case.STL'
    ];
    // xacro, because only xacro expands $(env); a plain URDF passes it through.
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    const links = references.map((filename, i) => `  <link name="l${i}"><visual><geometry><mesh filename="${filename}"/></geometry></visual></link>`);
    const joints = references.slice(1).map((_, i) => `  <joint name="j${i + 1}" type="fixed"><parent link="l0"/><child link="l${i + 1}"/></joint>`);
    // Not meshes: a plugin pointing at a recording and a mesh pointing at a
    // directory must neither be sent nor break the listing.
    const extras = `  <gazebo><plugin name="replay" filename="${path.join(outside, 'recording.bag')}"/></gazebo>\n  <link name="dir"><visual><geometry><mesh filename="${path.join(outside, 'env')}"/></geometry></visual></link>\n  <link name="dae"><visual><geometry><mesh filename="${path.join(outside, 'k.dae')}"/></geometry></visual></link>`;
    write(primary, `<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">\n${links.join('\n')}\n${joints.join('\n')}\n${extras}\n</robot>\n`);

    return {
        root,
        // The mesh pointing at a directory is the one reference meant to stay missing.
        expectedMissing: [path.join(outside, 'env')],
        ws,
        primary,
        env: { GZ_SIM_RESOURCE_PATH: models, PATH_MATRIX_DIR: path.join(outside, 'env') },
        config: { packages: { ext_pkg: extPkg } }
    };
}
