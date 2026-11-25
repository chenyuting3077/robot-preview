/** Where F puts the camera, shared by the robot and the Mesh & Splat views. Usage: fitDistance(camera, radius) */

// The camera looks from (1, FRAME_RISE, 1) off the center, in the y-up scene: front right, a little above.
export const FRAME_RISE = 0.7;

export function fitDistance(camera, radius) {
    const half = camera.fov * Math.PI / 360;
    // The narrower of the two fields of view, so a pane taller than wide still takes it all in.
    const halfFov = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
    // The bounding sphere fits from radius / sin, not / tan: the tangent left a 10 m room cut at a pane's edges.
    return radius / Math.sin(halfFov);
}
