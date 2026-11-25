/** Ground grid that reaches the horizon, shared by the robot and the Mesh & Splat views. Usage: scene.add(createHorizonGrid(THREE, () => controls.target)) */

// Why a shader plane with a JS-reduced offset, not a GridHelper: docs/mesh-splat.md, Ground grid.
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

// THREE comes from the caller (#23).
export function createHorizonGrid(THREE, target) {
    const material = new THREE.ShaderMaterial({
        vertexShader: GRID_VERTEX,
        fragmentShader: GRID_FRAGMENT,
        // Mid greys stand out against both the light (white) and the dark (#505050) background.
        uniforms: { cell: { value: 1 }, blend: { value: 0 }, fade: { value: 1 }, size: { value: 1 }, offset: { value: new THREE.Vector2() }, height: { value: 0 }, minorColor: { value: new THREE.Color(0x8c8c8c) }, majorColor: { value: new THREE.Color(0xa0a0a0) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    grid.frustumCulled = false;
    grid.onBeforeRender = (renderer, scene, viewer) => {
        const distance = Math.max(viewer.position.distanceTo(target()), 1e-6);
        // Minor cells of about a tenth of the viewing distance: G1 framed whole gets 10 cm cells and 1 m major lines.
        const level = Math.log10(distance / 10);
        material.uniforms.cell.value = 10 ** Math.floor(level);
        material.uniforms.blend.value = level - Math.floor(level);
        // Gone by 15 viewing distances: fading out by half the far plane left the horizon a moiré of crowded lines.
        material.uniforms.fade.value = distance * 15;
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
    grid.raycast = () => {};
    grid.dispose = () => {
        grid.geometry.dispose();
        material.dispose();
    };
    return grid;
}
