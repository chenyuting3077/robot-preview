const KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const SPEED = 0.8;
const TURN_SPEED = Math.PI / 2;
const FAST = 4;

export function flyStep(camera, target, held, dt) {
    const axis = (plus, minus) => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
    const offset = target.clone().sub(camera.position);
    const forward = offset.clone().projectOnPlane(camera.up).normalize();
    const right = forward.clone().cross(camera.up).normalize();
    const step = offset.length() * SPEED * dt;
    const move = forward.multiplyScalar(step * axis('w', 's')).add(right.multiplyScalar(step * axis('d', 'a')));
    camera.position.add(move);
    target.add(move);
    const turn = axis('q', 'e') * TURN_SPEED * dt;
    if (turn) target.sub(camera.position).applyAxisAngle(camera.up, turn).add(camera.position);
}

export function createFlyKeys(camera, target) {
    const held = new Set();
    let fast = false;
    let last = performance.now();
    const typing = event => event.target.closest?.('input, select, textarea, [contenteditable]');
    document.addEventListener('keydown', event => {
        fast = event.shiftKey;
        const key = event.key.toLowerCase();
        if (!KEYS.has(key) || event.ctrlKey || event.metaKey || event.altKey || typing(event)) return;
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
        if (!held.size) return false;
        flyStep(camera, target, held, dt * (fast ? FAST : 1));
        return true;
    };
}
