// docs/vscode-extension.md, "Model checks": why these rules, their severity
// and thresholds.

export const RULES = {
    'unknown-link': 'error',
    'multiple-parents': 'error',
    'kinematic-loop': 'error',
    'duplicate-name': 'error',
    'multiple-roots': 'error',
    'missing-limit': 'error',
    'missing-mass': 'error',
    'missing-inertial': 'warning',
    'nonpositive-mass': 'warning',
    'invalid-inertia': 'warning',
    'zero-axis': 'warning',
    'inverted-limit': 'warning',
    'zero-effort-velocity': 'warning',
    'continuous-with-limits': 'warning',
    'collision-scale-mismatch': 'warning'
};

const SCALE_MISMATCH = 100;
const MOVING = new Set(['revolute', 'continuous', 'prismatic', 'planar']);

const childOf = (element, tag) => Array.from(element.children).find(child => child.tagName === tag);
const linkOf = (joint, tag) => childOf(joint, tag)?.getAttribute('link');
const number = (element, name) => Number(element?.getAttribute(name) || 0);

function principalMoments(xx, yy, zz, xy, xz, yz) {
    const p1 = xy * xy + xz * xz + yz * yz;
    if (p1 === 0) return [xx, yy, zz];
    const q = (xx + yy + zz) / 3;
    const p = Math.sqrt(((xx - q) ** 2 + (yy - q) ** 2 + (zz - q) ** 2 + 2 * p1) / 6);
    const [a, b, c, d, e, f] = [(xx - q) / p, (yy - q) / p, (zz - q) / p, xy / p, xz / p, yz / p];
    const r = Math.min(1, Math.max(-1, (a * (b * c - f * f) - d * (d * c - f * e) + e * (d * f - b * e)) / 2));
    const phi = Math.acos(r) / 3;
    const largest = q + 2 * p * Math.cos(phi);
    const smallest = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
    return [largest, 3 * q - largest - smallest, smallest];
}

function isValidInertia(inertia) {
    const [xx, yy, zz, xy, xz, yz] = ['ixx', 'iyy', 'izz', 'ixy', 'ixz', 'iyz'].map(name => number(inertia, name));
    const scale = Math.max(Math.abs(xx), Math.abs(yy), Math.abs(zz));
    const epsilon = 1e-9;
    const minor2 = xx * yy - xy * xy;
    const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
    if (!(xx > epsilon * scale && minor2 > epsilon * scale ** 2 && det > epsilon * scale ** 3)) return false;
    const [a, b, c] = principalMoments(xx, yy, zz, xy, xz, yz);
    const tolerance = epsilon * (a + b + c);
    return a + b >= c - tolerance && a + c >= b - tolerance && b + c >= a - tolerance;
}

function loopJoints(joints, linkNames) {
    const edges = new Map();
    for (const joint of joints) {
        const parent = linkOf(joint, 'parent');
        if (!linkNames.has(parent) || !linkNames.has(linkOf(joint, 'child'))) continue;
        edges.set(parent, [...(edges.get(parent) || []), joint]);
    }
    const state = new Map();
    const found = [];
    const visit = link => {
        state.set(link, 'open');
        for (const joint of edges.get(link) || []) {
            const child = linkOf(joint, 'child');
            if (state.get(child) === 'open') found.push(joint);
            else if (!state.has(child)) visit(child);
        }
        state.set(link, 'done');
    };
    for (const link of linkNames) if (!state.has(link)) visit(link);
    return joints.filter(joint => found.includes(joint));
}

export function checkModel(urdfText, { sizes = {} } = {}) {
    const robot = new DOMParser().parseFromString(urdfText, 'text/xml').documentElement;
    const issues = [];
    const add = (rule, kind, name, message) => issues.push({ rule, severity: RULES[rule], kind, name, message });
    const links = Array.from(robot.children).filter(element => element.tagName === 'link');
    const joints = Array.from(robot.children).filter(element => element.tagName === 'joint');

    for (const [kind, elements] of [['link', links], ['joint', joints]]) {
        const seen = new Set();
        for (const element of elements) {
            const name = element.getAttribute('name');
            if (seen.has(name)) add('duplicate-name', kind, name, `${kind} name "${name}" is used more than once`);
            seen.add(name);
        }
    }

    const linkNames = new Set(links.map(element => element.getAttribute('name')));
    const hasParent = new Set();
    for (const joint of joints) {
        const name = joint.getAttribute('name');
        const parent = linkOf(joint, 'parent');
        const child = linkOf(joint, 'child');
        const unknown = [parent, child].find(link => !linkNames.has(link));
        if (unknown !== undefined) {
            add('unknown-link', 'joint', name, `joint "${name}" refers to link "${unknown}", which does not exist`);
        } else if (hasParent.has(child)) {
            add('multiple-parents', 'link', child, `link "${child}" is the child of more than one joint`);
        }
        if (linkNames.has(child)) hasParent.add(child);

        const type = joint.getAttribute('type');
        const limit = childOf(joint, 'limit');
        if ((type === 'revolute' || type === 'prismatic') && !limit) {
            add('missing-limit', 'joint', name, `${type} joint "${name}" has no <limit>, which ROS requires`);
        } else if (limit && (!limit.hasAttribute('effort') || !limit.hasAttribute('velocity'))) {
            add('missing-limit', 'joint', name, `the <limit> of joint "${name}" lacks effort or velocity, which ROS requires`);
        }
        if (!MOVING.has(type)) continue;
        const axis = (childOf(joint, 'axis')?.getAttribute('xyz') ?? '1 0 0').trim().split(/\s+/).map(Number);
        if (axis.every(value => value === 0)) add('zero-axis', 'joint', name, `joint "${name}" has a zero axis, so it has no direction to move in`);
        if (!limit) continue;
        if (type === 'continuous' && (limit.hasAttribute('lower') || limit.hasAttribute('upper'))) {
            add('continuous-with-limits', 'joint', name, `continuous joint "${name}" ignores lower/upper; use revolute to limit it`);
        } else if (number(limit, 'lower') > number(limit, 'upper')) {
            add('inverted-limit', 'joint', name, `joint "${name}" has lower > upper, so it cannot move`);
        }
        if ((limit.hasAttribute('effort') && number(limit, 'effort') === 0) || (limit.hasAttribute('velocity') && number(limit, 'velocity') === 0)) {
            add('zero-effort-velocity', 'joint', name, `joint "${name}" has zero effort or velocity; planners such as MoveIt cannot move it`);
        }
    }

    const roots = [...linkNames].filter(name => !hasParent.has(name));
    for (const name of roots.slice(1)) add('multiple-roots', 'link', name, `link "${name}" has no parent; a URDF must have exactly one root link`);
    for (const joint of loopJoints(joints, linkNames)) {
        const name = joint.getAttribute('name');
        add('kinematic-loop', 'joint', name, `joint "${name}" closes a loop; URDF links must form a tree`);
    }

    for (const element of links) {
        const name = element.getAttribute('name');
        const inertial = childOf(element, 'inertial');
        const mass = inertial && childOf(inertial, 'mass');
        const inertia = inertial && childOf(inertial, 'inertia');
        if (!inertial) {
            if ((childOf(element, 'visual') || childOf(element, 'collision')) && name !== roots[0]) {
                add('missing-inertial', 'link', name, `link "${name}" has geometry but no <inertial>; Gazebo drops or merges it`);
            }
        } else if (!mass) {
            add('missing-mass', 'link', name, `the <inertial> of link "${name}" has no <mass>, which ROS requires`);
        } else if (!(number(mass, 'value') > 0)) {
            add('nonpositive-mass', 'link', name, `link "${name}" has a mass of zero or less`);
        } else if (inertia && !isValidInertia(inertia)) {
            add('invalid-inertia', 'link', name, `link "${name}" has an inertia no rigid body can have (not positive definite or breaking the triangle inequality)`);
        }
        const { visual, collision } = sizes[name] || {};
        const ratio = visual > 0 && collision > 0 ? Math.max(visual, collision) / Math.min(visual, collision) : 0;
        if (ratio >= SCALE_MISMATCH) {
            add('collision-scale-mismatch', 'link', name, `link "${name}": visual and collision differ in size ${Math.round(ratio)}x, likely a mm/m scale mistake`);
        }
    }
    return issues;
}

// Hidden colliders count: their mistakes are the ones nobody sees.
export function linkGeometrySizes(model, Box3) {
    const sizes = {};
    for (const [name, link] of model.links || []) {
        const object = link.threeObject;
        if (!object) continue;
        object.updateMatrixWorld(true);
        const extent = test => {
            const box = new Box3();
            for (const child of object.children) if (test(child)) box.expandByObject(child);
            if (box.isEmpty()) return undefined;
            const size = box.max.clone().sub(box.min);
            return Math.max(size.x, size.y, size.z);
        };
        sizes[name] = { visual: extent(child => child.isURDFVisual), collision: extent(child => child.isURDFCollider) };
    }
    return sizes;
}
