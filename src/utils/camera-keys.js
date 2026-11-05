const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const SPEED = 0.8;
const TURN_SPEED = Math.PI / 2;
const FAST = 4;

const isTyping = event => event.target.closest?.('input, select, textarea, [contenteditable]');

export function pointerNdc(element, event) {
    const rect = element.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1
    };
}

export function flyStep(camera, target, held, dt) {
    const axis = (plus, minus) => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
    const offset = target.clone().sub(camera.position);
    const forward = offset.clone().normalize();
    let right = forward.clone().cross(camera.up);
    if (right.lengthSq() < 1e-12) right = camera.position.clone().set(1, 0, 0).applyQuaternion(camera.quaternion);
    right.normalize();
    const step = offset.length() * SPEED * dt;
    const move = forward.clone().multiplyScalar(step * axis('w', 's')).add(right.clone().multiplyScalar(step * axis('d', 'a')));
    camera.position.add(move);
    target.add(move);
    const turn = axis('q', 'e') * TURN_SPEED * dt;
    if (turn) target.sub(camera.position).applyAxisAngle(right.clone().cross(forward).normalize(), turn).add(camera.position);
}

export function createCameraKeys({ camera, target, element, pick, frame }) {
    const held = new Set();
    let fast = false;
    let changed = false;
    let last = performance.now();
    element.addEventListener('dblclick', event => {
        const point = pick(pointerNdc(element, event));
        if (!point) return;
        target.copy(point);
        changed = true;
    });
    document.addEventListener('keydown', event => {
        fast = event.shiftKey;
        const key = event.key.toLowerCase();
        if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) return;
        if (key === 'f') frame();
        if (!FLY_KEYS.has(key)) return;
        held.add(key);
        event.preventDefault();
    });
    document.addEventListener('keyup', event => {
        fast = event.shiftKey;
        held.delete(event.key.toLowerCase());
    });
    window.addEventListener('blur', () => held.clear());
    return () => {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        if (held.size) flyStep(camera, target, held, dt * (fast ? FAST : 1));
        const moved = changed || held.size > 0;
        changed = false;
        return moved;
    };
}
