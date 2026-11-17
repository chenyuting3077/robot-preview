import * as THREE from 'three';

export const hasColor = geometry => Boolean(geometry.attributes.color);
// sRGB 0-1, for surfaces without colors of their own.
export const MESH_GREY = [176 / 255, 176 / 255, 176 / 255];
// For points without colors of their own.
export const POINT_GREY = 0x9aa7b8;

// Meshes from any format: scans and CAD parts are often open or single-sided, so both sides draw.
export const surfaceMaterial = (srgb, params = {}) => new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(...srgb, THREE.SRGBColorSpace), roughness: 0.8, side: THREE.DoubleSide, ...params
});
