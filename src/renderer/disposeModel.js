const texturesOf = object => {
    const textures = new Set();
    object?.traverse(child => {
        for (const material of [].concat(child.material || [])) {
            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
    });
    return textures;
};

// Without this every reload kept the old model on the GPU: +8.4 MB and +31
// geometries per UR5e reload (headless Chrome 157, Apple M2, 10 reloads).
// Geometries and materials are the model's own copies of the mesh cache.
// Textures are shared through the cache, so only those the next model does not
// use go; a disposed texture that comes back from the cache is uploaded again.
export function disposeModel(object, next = null) {
    const kept = texturesOf(next);
    for (const texture of texturesOf(object)) if (!kept.has(texture)) texture.dispose();
    object?.traverse(child => {
        child.geometry?.dispose();
        for (const material of [].concat(child.material || [])) material.dispose();
    });
}
