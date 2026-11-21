// three.js raycasting ignores `visible`, `material.visible` and (with a fresh Raycaster) the camera's layers, so a
// hidden part still answered hover, click and drag. Picking walks only what the renderer draws.

function shownAncestry(object) {
    for (let current = object; current; current = current.parent) {
        if (!current.visible) return false;
    }
    return true;
}

function materialShown(object, hit) {
    const material = Array.isArray(object.material) ? object.material[hit.face?.materialIndex ?? 0] : object.material;
    return material?.visible !== false;
}

/**
 * Intersections of the ray with what is on screen under `roots`, nearest first. An object counts when it and all its
 * ancestors are visible, the hit face's material is visible and, given a camera, it is on one of the camera's layers.
 */
export function intersectDisplayed(raycaster, roots, camera = null) {
    const hits = [];
    const visit = object => {
        if (!object.visible) return;
        if (!camera || object.layers.test(camera.layers)) {
            const found = [];
            object.raycast(raycaster, found);
            for (const hit of found) if (materialShown(object, hit)) hits.push(hit);
        }
        for (const child of object.children) visit(child);
    };
    for (const root of roots) if (shownAncestry(root)) visit(root);
    return hits.sort((a, b) => a.distance - b.distance);
}
