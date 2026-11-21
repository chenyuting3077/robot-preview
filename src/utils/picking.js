// three.js raycasting ignores `visible`, `material.visible` and the camera's layers, so a hidden part still answered
// hover, click and drag. Picking walks only what the renderer draws.

const isCollision = object => object.isURDFCollider || object.userData?.isCollisionGeom;

function materialShown(object, hit) {
    const material = Array.isArray(object.material) ? object.material[hit.face?.materialIndex ?? 0] : object.material;
    // A wireframe (MuJoCo collision geoms) is drawn along its edges only; a hit inside a face is empty screen.
    return Boolean(material) && material.visible !== false && !material.wireframe;
}

// part: 'all', 'visual' (collision subtrees skipped) or 'collision' (only collision subtrees)
export function intersectDisplayed(raycaster, roots, camera = null, part = 'all') {
    const hits = [];
    const visit = (object, inCollision) => {
        if (!object.visible) return;
        inCollision ||= isCollision(object);
        if (part === 'visual' && inCollision) return;
        if ((part !== 'collision' || inCollision) && object.layers.test(raycaster.layers) && (!camera || object.layers.test(camera.layers))) {
            const found = [];
            object.raycast(raycaster, found);
            for (const hit of found) if (materialShown(object, hit)) hits.push(hit);
        }
        for (const child of object.children) visit(child, inCollision);
    };
    for (const root of roots) {
        let shown = true, inCollision = false;
        for (let parent = root.parent; parent; parent = parent.parent) {
            shown &&= parent.visible;
            inCollision ||= isCollision(parent);
        }
        if (shown) visit(root, inCollision);
    }
    return hits.sort((a, b) => a.distance - b.distance);
}

// Collision shells are drawn see-through over the visuals, so a visual seen through one wins; collision is raycast
// only when no visual is hit. URDF collision often reuses the visual meshes: with one 1.2M-triangle mesh as both
// (Node, Apple M2), a hover on it costs 74-77 ms this way against 149-156 ms raycasting both. A pointer inside the
// mesh bounds but off its triangles still raycasts both (149-159 ms); three.js raycasting has no BVH.
export function pickDisplayed(raycaster, roots, camera, accept = () => true) {
    return intersectDisplayed(raycaster, roots, camera, 'visual').find(accept)
        ?? intersectDisplayed(raycaster, roots, camera, 'collision').find(accept)
        ?? null;
}
