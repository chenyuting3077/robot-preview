// URDF as urdfdom reads it (urdf_parser/src, 2026-07). docs/vscode-extension.md,
// "Structure checks": why a tag scanner rather than an XSD, and how xacro is handled.

const VECTOR3 = { type: 'vector', size: 3 };
const VECTOR4 = { type: 'vector', size: 4 };
const NUMBER = { type: 'number' };

const JOINT_TYPES = {
    revolute: 'Rotates about the axis between lower and upper.',
    continuous: 'Rotates about the axis without limits.',
    prismatic: 'Slides along the axis between lower and upper.',
    fixed: 'Does not move.',
    floating: 'Moves freely in all six degrees of freedom.',
    planar: 'Moves in the plane perpendicular to the axis.'
};

const POSE = {
    xyz: { ...VECTOR3, doc: 'Translation in metres.', default: '0 0 0' },
    rpy: { ...VECTOR3, doc: 'Roll, pitch, yaw in radians, about the fixed X, Y and Z axes in that order.', default: '0 0 0' },
    quat_xyzw: { ...VECTOR4, since: [1, 1], doc: 'Rotation as a quaternion x y z w, instead of `rpy`.' }
};

const inertiaTerm = { ...NUMBER, required: true, doc: 'Inertia tensor term in kg·m², about the centre of mass, in the frame of the inertial `<origin>`.' };

// children: elements urdfdom reads inside this one, only the first of each
// (FirstChildElement) except where `repeatable`. since: the URDF version that
// first reads an attribute. snippet: the attributes a new element starts with
// (default: the required ones); body: its first lines.
const SCHEMA = {
    robot: {
        doc: 'Root of a URDF. ROS reads `<link>`, `<joint>` and `<material>` here.',
        attributes: {
            name: { required: true, doc: 'Robot name. A xacro file included by another may leave it out.' },
            version: { type: 'version', doc: 'URDF version, `1.0` to `1.2`; `1.1` adds `quat_xyzw` and `<capsule>`, `1.2` acceleration, deceleration and jerk limits.', default: '1.0' }
        },
        children: ['link', 'joint', 'material'],
        repeatable: ['link', 'joint', 'material'],
        body: ['$0']
    },
    link: {
        doc: 'A rigid body: its mass, what it looks like and what it collides with.',
        attributes: { name: { required: true, doc: 'Link name, unique in the robot.' } },
        children: ['inertial', 'visual', 'collision'],
        repeatable: ['visual', 'collision'],
        body: ['<visual>', '\t<geometry>', '\t\t$0', '\t</geometry>', '</visual>']
    },
    inertial: {
        doc: 'Mass and inertia of the link. Gazebo drops or merges a link without one.',
        attributes: {},
        children: ['origin', 'mass', 'inertia'],
        requiredChildren: ['inertia'],
        body: ['<origin xyz="${1:0 0 0}" rpy="0 0 0"/>', '<mass value="${2:1}"/>', '<inertia ixx="${3:0.01}" ixy="0" ixz="0" iyy="${4:0.01}" iyz="0" izz="${5:0.01}"/>']
    },
    origin: {
        doc: 'A pose relative to the enclosing frame.',
        snippet: ['xyz', 'rpy'],
        docIn: {
            joint: 'Pose of the child link frame in the parent link frame.',
            inertial: 'Centre of mass, and the frame of `<inertia>`, in the link frame.',
            visual: 'Pose of the geometry in the link frame.',
            collision: 'Pose of the geometry in the link frame.'
        },
        attributes: POSE,
        children: []
    },
    mass: {
        doc: 'Mass of the link.',
        attributes: { value: { ...NUMBER, required: true, doc: 'Mass in kilograms.' } },
        children: []
    },
    inertia: {
        doc: 'Rotational inertia about the centre of mass. The diagonal terms must satisfy the triangle inequality.',
        attributes: { ixx: inertiaTerm, ixy: inertiaTerm, ixz: inertiaTerm, iyy: inertiaTerm, iyz: inertiaTerm, izz: inertiaTerm },
        // Not typos: the lower triangle of a symmetric tensor.
        ignoredNotes: { iyx: 'the tensor is symmetric, so ROS reads ixy only', izx: 'the tensor is symmetric, so ROS reads ixz only', izy: 'the tensor is symmetric, so ROS reads iyz only' },
        children: []
    },
    visual: {
        doc: 'What the link looks like. A link can have several.',
        attributes: { name: { doc: 'Optional name.' } },
        children: ['origin', 'geometry', 'material'],
        requiredChildren: ['geometry'],
        body: ['<geometry>', '\t$0', '</geometry>']
    },
    collision: {
        doc: 'Shape used for collision checking. A link can have several; simpler shapes than the visual make planning faster.',
        attributes: { name: { doc: 'Optional name.' } },
        children: ['origin', 'geometry'],
        requiredChildren: ['geometry'],
        body: ['<geometry>', '\t$0', '</geometry>']
    },
    geometry: {
        doc: 'Exactly one shape: `<box>`, `<cylinder>`, `<sphere>`, `<mesh>` or `<capsule>`.',
        attributes: {},
        children: ['box', 'cylinder', 'sphere', 'mesh', 'capsule'],
        body: ['$0']
    },
    box: {
        doc: 'A box centred on the origin.',
        attributes: { size: { ...VECTOR3, positiveFrom: [1, 2], required: true, doc: 'Side lengths along x, y and z in metres.' } },
        children: []
    },
    cylinder: {
        doc: 'A cylinder along z, centred on the origin.',
        attributes: {
            radius: { ...NUMBER, positiveFrom: [1, 2], required: true, doc: 'Radius in metres.' },
            length: { ...NUMBER, positiveFrom: [1, 2], required: true, doc: 'Length along z in metres.' }
        },
        children: []
    },
    sphere: {
        doc: 'A sphere centred on the origin.',
        attributes: { radius: { ...NUMBER, positiveFrom: [1, 2], required: true, doc: 'Radius in metres.' } },
        children: []
    },
    capsule: {
        doc: 'A cylinder along z with hemispherical ends, centred on the origin. Needs `<robot version="1.1">` and urdfdom from February 2026 (ros/urdfdom#238); older urdfdom drops the rest of the link.',
        attributes: {
            radius: { ...NUMBER, positiveFrom: [1, 2], required: true, doc: 'Radius in metres.' },
            length: { ...NUMBER, positiveFrom: [1, 2], required: true, doc: 'Length of the cylindrical part along z in metres.' }
        },
        children: []
    },
    mesh: {
        doc: 'A mesh file: STL, DAE, OBJ or glTF.',
        attributes: {
            filename: { required: true, doc: 'Usually `package://<package>/<path>`.' },
            scale: { ...VECTOR3, doc: 'Scale along x, y and z; `0.001 0.001 0.001` turns millimetres into metres.', default: '1 1 1' }
        },
        children: []
    },
    material: {
        doc: 'Colour or texture. One defined under `<robot>` can be used by name from any `<visual>`.',
        attributes: { name: { required: true, doc: 'Material name; a `<visual>` may give only the name to reuse a top-level material.' } },
        children: ['color', 'texture']
    },
    color: {
        doc: 'Plain colour.',
        // A wrong count is not an error in urdfdom: Color::init returns false unchecked and leaves black.
        attributes: { rgba: { ...VECTOR4, range: [0, 1], wrongCount: 'ROS shows it black', required: true, doc: 'Red, green, blue and alpha, each from 0 to 1.' } },
        children: []
    },
    texture: {
        doc: 'Image texture.',
        attributes: { filename: { doc: 'Image file, usually `package://<package>/<path>`.' } },
        children: []
    },
    joint: {
        doc: 'Connects a parent link to a child link and sets how the child moves.',
        attributes: {
            name: { required: true, doc: 'Joint name, unique in the robot.' },
            type: { type: 'enum', values: JOINT_TYPES, required: true, doc: 'How the child link moves.' }
        },
        children: ['origin', 'parent', 'child', 'axis', 'calibration', 'dynamics', 'limit', 'mimic', 'safety_controller'],
        requiredChildren: ['parent', 'child'],
        body: ['<parent link="$3"/>', '<child link="$4"/>', '<origin xyz="${5:0 0 0}" rpy="${6:0 0 0}"/>$0']
    },
    parent: {
        doc: 'The link this joint is attached to.',
        attributes: { link: { required: true, doc: 'Parent link name.' } },
        children: []
    },
    child: {
        doc: 'The link this joint moves.',
        attributes: { link: { required: true, doc: 'Child link name.' } },
        children: []
    },
    axis: {
        doc: 'Axis of motion in the joint frame. Not read for fixed and floating joints.',
        attributes: { xyz: { ...VECTOR3, doc: 'Axis direction; give a unit vector, urdfdom does not normalise it.', default: '1 0 0' } },
        children: []
    },
    calibration: {
        doc: 'Joint positions of the calibration reference edges.',
        attributes: {
            rising: { ...NUMBER, doc: 'Position of the rising edge.' },
            falling: { ...NUMBER, doc: 'Position of the falling edge.' }
        },
        children: []
    },
    dynamics: {
        doc: 'Damping and friction, used by simulators. Needs at least one of the two.',
        snippet: ['damping', 'friction'],
        requiresOneOf: ['damping', 'friction'],
        attributes: {
            damping: { ...NUMBER, doc: 'Viscous damping: N·s/m for prismatic, N·m·s/rad for revolute joints.', default: '0' },
            friction: { ...NUMBER, doc: 'Static friction: N for prismatic, N·m for revolute joints.', default: '0' }
        },
        children: []
    },
    limit: {
        doc: 'Motion limits. Required for revolute and prismatic joints.',
        snippet: ['lower', 'upper', 'effort', 'velocity'],
        attributes: {
            lower: { ...NUMBER, doc: 'Lower position in radians or metres. 0 when left out before URDF 1.2; from 1.2 required for revolute and prismatic joints.' },
            upper: { ...NUMBER, doc: 'Upper position in radians or metres. 0 when left out before URDF 1.2; from 1.2 required for revolute and prismatic joints.' },
            effort: { ...NUMBER, nonNegativeFrom: [1, 2], required: true, doc: 'Maximum force (N) or torque (N·m). Optional from URDF 1.2.' },
            velocity: { ...NUMBER, nonNegativeFrom: [1, 2], required: true, doc: 'Maximum speed in m/s or rad/s. Optional from URDF 1.2.' },
            acceleration: { ...NUMBER, nonNegativeFrom: [1, 2], since: [1, 2], doc: 'Maximum acceleration in m/s² or rad/s².' },
            deceleration: { ...NUMBER, nonNegativeFrom: [1, 2], since: [1, 2], doc: 'Maximum deceleration in m/s² or rad/s².' },
            jerk: { ...NUMBER, nonNegativeFrom: [1, 2], since: [1, 2], doc: 'Maximum jerk in m/s³ or rad/s³.' }
        },
        children: []
    },
    mimic: {
        doc: 'Makes this joint follow another: position = multiplier × other + offset.',
        attributes: {
            joint: { required: true, doc: 'Name of the joint to follow.' },
            multiplier: { ...NUMBER, doc: 'Multiplier.', default: '1' },
            offset: { ...NUMBER, doc: 'Offset in radians or metres.', default: '0' }
        },
        children: []
    },
    safety_controller: {
        doc: 'Soft limits enforced by the PR2-style safety controller.',
        attributes: {
            soft_lower_limit: { ...NUMBER, doc: 'Lower soft limit.', default: '0' },
            soft_upper_limit: { ...NUMBER, doc: 'Upper soft limit.', default: '0' },
            k_position: { ...NUMBER, doc: 'Position gain.', default: '0' },
            k_velocity: { ...NUMBER, required: true, doc: 'Velocity gain.' }
        },
        children: []
    }
};


const SHAPES = SCHEMA.geometry.children;

// Read by other tools (Gazebo, ros2_control, MuJoCo's compiler, Webots), so
// their contents follow other schemas. The rest are SRDF, whose root is <robot> too.
const FOREIGN = new Set(['gazebo', 'transmission', 'ros2_control', 'sensor', 'mujoco', 'webots',
    'group', 'group_state', 'end_effector', 'virtual_joint', 'passive_joint', 'disable_collisions', 'disable_default_collisions', 'enable_collisions', 'link_sphere_approximation']);

const FOREIGN_SNIPPETS = {
    gazebo: { doc: 'Gazebo settings for the robot, or for one link or joint with `reference`. Read by Gazebo, not urdfdom.', snippet: 'gazebo reference="$1">\n\t$0\n</gazebo>' },
    ros2_control: { doc: 'ros2_control hardware and its joint interfaces. Read by ros2_control, not urdfdom.', snippet: 'ros2_control name="$1" type="${2|system,actuator,sensor|}">\n\t<hardware>\n\t\t<plugin>$3</plugin>\n\t</hardware>\n\t$0\n</ros2_control>' },
    transmission: { doc: 'ROS 1 transmission between actuators and joints. Read by transmission_interface, not urdfdom.', snippet: 'transmission name="$1">\n\t$0\n</transmission>' }
};

const XACRO_DIRECTIVES = {
    property: { doc: 'Defines a value used as `${name}`.', snippet: 'property name="$1" value="$2"/>' },
    arg: { doc: 'Declares an argument read with `$(arg name)`.', snippet: 'arg name="$1" default="$2"/>' },
    macro: { doc: 'Defines a macro called as `<xacro:name>`; a `*name` parameter takes a block.', snippet: 'macro name="$1" params="$2">\n\t$0\n</xacro:macro>' },
    include: { doc: 'Includes another xacro file.', snippet: 'include filename="$1"/>' },
    if: { doc: 'Keeps its contents when `value` is true.', snippet: 'if value="$1">\n\t$0\n</xacro:if>' },
    unless: { doc: 'Keeps its contents when `value` is false.', snippet: 'unless value="$1">\n\t$0\n</xacro:unless>' },
    insert_block: { doc: 'Inserts a block parameter of the enclosing macro.', snippet: 'insert_block name="$1"/>' },
    element: { doc: 'An element whose name is computed.', snippet: 'element xacro:name="$1">\n\t$0\n</xacro:element>' },
    attribute: { doc: 'Adds an attribute with a computed name to the enclosing element.', snippet: 'attribute name="$1" value="$2"/>' }
};

// Left to the model checks in the preview (missing-limit).
const REPORTED_ELSEWHERE = new Set(['limit.effort', 'limit.velocity']);

const RULES = {
    'ignored-element': 'warning',
    'ignored-attribute': 'warning',
    'missing-attribute': 'error',
    'missing-element': 'error',
    'invalid-value': 'error',
    'invalid-geometry': 'error'
};

// docs/vscode-extension.md, "Structure checks": which failure has which effect.
const CONSEQUENCE = {
    model: 'ROS rejects the model',
    link: 'ROS drops the rest of this link',
    material: 'ROS does not use this colour'
};
const JOINT_PARTS = new Set(['joint', ...SCHEMA.joint.children.filter(name => name !== 'origin')]);

// Plain objects answer `toString` and `constructor` through their prototype.
const own = (object, key) => (object && Object.hasOwn(object, key) ? object[key] : undefined);
const specOf = name => own(SCHEMA, name);
const isSchemaContext = context => specOf(context) !== undefined;
const XACRO_PREFIX = 'xacro:';
const isXacro = name => name.startsWith(XACRO_PREFIX);
const isRepeatable = (context, name) => Boolean(specOf(context)?.repeatable?.includes(name));
// The context outside the root element.
const DOCUMENT = '#document';
const QUOTED_RE = /"[^"]*"|'[^']*'/g;
const literalAttribute = (token, name) => token.attributes.find(attribute => attribute.name === name)?.value;

// Opening ('open'), closing ('close') and self-closing ('empty') tags; comments,
// CDATA and declarations are skipped, and quoted values may hold '<' and '>'.
const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][\s\S]*?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function attributesOf(source, offset) {
    return Array.from(source.matchAll(ATTRIBUTE_RE), match => ({
        name: match[1],
        value: match[3] ?? match[4],
        nameStart: offset + match.index,
        valueStart: offset + match.index + match[0].length - 1 - (match[3] ?? match[4]).length
    }));
}

// A '<' that starts no complete tag is skipped; `partial` is the last one, if
// nothing complete follows it.
function tokenize(text) {
    const tokens = [];
    let partial = null;
    for (let at = text.indexOf('<'); at !== -1;) {
        TOKEN_RE.lastIndex = at;
        const match = TOKEN_RE.exec(text);
        if (!match) {
            partial = at;
            at = text.indexOf('<', at + 1);
            continue;
        }
        if (match[1]) {
            tokens.push({ kind: 'close', name: match[1], start: at, nameStart: at + 2, end: TOKEN_RE.lastIndex });
        } else if (match[2]) {
            tokens.push({
                kind: match[4] ? 'empty' : 'open',
                name: match[2],
                start: at,
                nameStart: at + 1,
                end: TOKEN_RE.lastIndex,
                attributes: attributesOf(match[3], at + 1 + match[2].length)
            });
        }
        at = text.indexOf('<', TOKEN_RE.lastIndex);
    }
    if (partial !== null && partial < (tokens.at(-1)?.end ?? 0)) partial = null;
    return { tokens, partial };
}

// What an element's children are read as: a schema element name, 'any' when
// xacro decides it later (a macro body or block argument), or null when
// nothing is checked (foreign or unknown content).
function childContext(parentContext, name, attributes = []) {
    if (parentContext === null) return null;
    if (parentContext === DOCUMENT) return name === 'robot' ? 'robot' : null;
    if (isXacro(name)) {
        const directive = name.slice(XACRO_PREFIX.length);
        if (directive === 'if' || directive === 'unless') return parentContext;
        if (directive === 'attribute') return null;
        return 'any';
    }
    if (name.includes(':')) return null;
    // A macro body's <joint> without a type is a ros2_control or transmission joint.
    if (parentContext === 'any') return specOf(name) && !(name === 'joint' && !attributes.some(a => a.name === 'type')) ? name : null;
    return specOf(parentContext).children.includes(name) ? name : null;
}

// What urdfdom does with an unreadable element, from the nearest enclosing
// joint, link or material; inside a macro body, from what the element can belong to.
function scopeOf(stack, context) {
    for (let i = stack.length - 1; i >= 0; i--) {
        const frame = stack[i];
        if (frame.context === 'any') break;
        if (frame.context === 'color' || frame.context === 'texture') return 'material';
        if (frame.context === 'material' && stack[i - 1]?.context === 'robot') return 'material';
        if (frame.context === 'joint' || frame.context === 'robot') return 'model';
        if (['link', 'inertial', 'visual', 'collision', 'geometry'].includes(frame.context)) return 'link';
    }
    if (context === 'color' || context === 'texture') return 'material';
    if (JOINT_PARTS.has(context)) return 'model';
    return context === 'origin' || context === 'material' ? null : 'link';
}

// In a macro body a <material> may land under <robot>, where urdfdom only logs it.
const severityOf = (scope, context) => (scope === 'material' || (scope === null && context === 'material') ? 'warning' : 'error');
const consequenceOf = scope => CONSEQUENCE[scope] ?? 'ROS cannot read it';

// urdfdom reads a number with strToDouble, a stringstream that skips leading
// whitespace but must then consume the rest, so trailing whitespace (an
// attribute value broken over lines) fails. A list is split on single spaces first.
const NUMBER_RE = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const isLiteral = value => !value.includes('$');

function parseVersion(value) {
    const match = /^(\d+)\.(\d+)$/.exec(value);
    return match && [Number(match[1]), Number(match[2])];
}
const below = (version, since) => version[0] < since[0] || (version[0] === since[0] && version[1] < since[1]);

const piecesOf = (spec, value) => (spec.size ? value.split(' ').filter(Boolean) : [value]);
const from = (version, since) => since && version && !below(version, since);

function invalidNumbers(spec, value, version) {
    const count = spec.size ?? 1;
    const parts = piecesOf(spec, value);
    if (parts.length !== count || !parts.every(part => NUMBER_RE.test(part))) {
        if (parts.every(part => NUMBER_RE.test(part.trimEnd())) && parts.length === count) return 'ends in whitespace, which urdfdom does not read as a number';
        return count === 1 ? 'must be a number' : `must be ${count} numbers separated by spaces`;
    }
    const numbers = parts.map(Number);
    if (spec.range && numbers.some(number => number < spec.range[0] || number > spec.range[1])) return `must be from ${spec.range[0]} to ${spec.range[1]}`;
    if (from(version, spec.nonNegativeFrom) && numbers.some(number => number < 0)) return `must not be negative from URDF ${spec.nonNegativeFrom.join('.')}`;
    if (from(version, spec.positiveFrom) && numbers.some(number => number <= 0)) return `must be above zero from URDF ${spec.positiveFrom.join('.')}`;
    return null;
}

// Every piece a number in range but the count wrong: what `wrongCount` describes.
const onlyCountWrong = (spec, value) => {
    const parts = piecesOf(spec, value);
    return parts.length !== spec.size && parts.every(part => NUMBER_RE.test(part) && (!spec.range || (Number(part) >= spec.range[0] && Number(part) <= spec.range[1])));
};

const TYPES = {
    number: { label: () => 'number', invalid: invalidNumbers },
    vector: { label: spec => `${spec.size} numbers`, invalid: invalidNumbers },
    enum: {
        label: spec => Object.keys(spec.values).map(value => `\`${value}\``).join(' '),
        invalid: (spec, value) => (own(spec.values, value) ? null : `must be one of ${Object.keys(spec.values).join(', ')}`)
    },
    version: {
        label: () => '`x.y`',
        invalid: (spec, value) => {
            const version = parseVersion(value);
            return version && !below(version, [1, 0]) && !below([1, 2], version) ? null : 'must be 1.0, 1.1 or 1.2';
        }
    }
};

const invalidValue = (spec, value, version) => (isLiteral(value) ? own(TYPES, spec.type)?.invalid(spec, value, version) ?? null : null);

function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const next = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = row[j];
            row[j] = next;
        }
    }
    return row[b.length];
}

// The closest name within two edits, as a typo fix.
function closest(name, candidates) {
    let best = null;
    let bestDistance = 3;
    for (const candidate of candidates) {
        const distance = editDistance(name.toLowerCase(), candidate);
        if (distance < bestDistance) [best, bestDistance] = [candidate, distance];
    }
    return best;
}

const elementsReading = name => Object.keys(SCHEMA).filter(parent => SCHEMA[parent].children.includes(name));
const rename = (start, length, text) => text && { text, openStart: start, length };

// Problems with offsets into `text`. Returns nothing unless the root is
// <robot>. `xacro`: the file may be included by another, so its root needs no
// name and its URDF version is unknown unless stated.
function checkStructure(text, { xacro = false } = {}) {
    const { tokens } = tokenize(text);
    const issues = [];
    const add = (rule, start, length, message, { scope, context, replacement } = {}) => issues.push({
        rule, severity: scope === undefined ? RULES[rule] : severityOf(scope, context), start, end: start + length, message, replacement: replacement || undefined
    });
    const materialNames = new Map();
    const stack = [];
    let version = null;

    const checkAttributes = (token, context, scope) => {
        const spec = specOf(context);
        const names = new Set(token.attributes.map(attribute => attribute.name));
        for (const attribute of token.attributes) {
            if (attribute.name.includes(':') || attribute.name === 'xmlns') continue;
            const attributeSpec = own(spec.attributes, attribute.name);
            if (!attributeSpec) {
                const note = own(spec.ignoredNotes, attribute.name);
                const suggestion = note ? null : closest(attribute.name, Object.keys(spec.attributes));
                add('ignored-attribute', attribute.nameStart, attribute.name.length,
                    `<${token.name}> has no attribute "${attribute.name}"; ${note ?? 'ROS ignores it'}${suggestion ? `. Did you mean "${suggestion}"?` : ''}`,
                    { replacement: rename(attribute.nameStart, attribute.name.length, suggestion) });
                continue;
            }
            if (attributeSpec.since && version && below(version, attributeSpec.since)) {
                add('ignored-attribute', attribute.nameStart, attribute.name.length,
                    `"${attribute.name}" is read only from <robot version="${attributeSpec.since.join('.')}">; ROS ignores it here`);
                continue;
            }
            const problem = invalidValue(attributeSpec, attribute.value, version);
            if (problem) {
                const suggestion = attributeSpec.values ? closest(attribute.value, Object.keys(attributeSpec.values)) : null;
                const countOnly = attributeSpec.wrongCount && onlyCountWrong(attributeSpec, attribute.value);
                add('invalid-value', attribute.valueStart, attribute.value.length,
                    `${attribute.name}="${attribute.value}" ${problem}; ${countOnly ? attributeSpec.wrongCount : consequenceOf(scope)}`,
                    { scope: countOnly ? 'material' : scope, context, replacement: rename(attribute.valueStart, attribute.value.length, suggestion) });
            }
        }
        if (names.has('rpy') && names.has('quat_xyzw') && !(version && below(version, [1, 1]))) {
            const quat = token.attributes.find(attribute => attribute.name === 'quat_xyzw');
            add('invalid-value', quat.nameStart, quat.name.length, `<${token.name}> sets both rpy and quat_xyzw; ${consequenceOf(scope)}`, { scope, context });
        }
    };

    const boundsRequired = frame => frame.context === 'limit' && version && !below(version, [1, 2])
        && ['revolute', 'prismatic'].includes(literalAttribute(frame.owner.token, 'type'));

    const missingAttributes = frame => {
        const { token, context, scope } = frame;
        const spec = specOf(context);
        const present = new Set(token.attributes.map(attribute => attribute.name));
        const required = name => spec.attributes[name].required || (boundsRequired(frame) && (name === 'lower' || name === 'upper'));
        const missing = Object.keys(spec.attributes).filter(name => required(name) && !present.has(name)
            && !REPORTED_ELSEWHERE.has(`${context}.${name}`) && !(context === 'robot' && xacro));
        if (missing.length) {
            add('missing-attribute', token.nameStart, token.name.length,
                `<${token.name}> needs ${missing.map(name => `"${name}"`).join(', ')}; ${consequenceOf(scope)} without ${missing.length > 1 ? 'them' : 'it'}`, { scope, context });
        }
        if (spec.requiresOneOf && !spec.requiresOneOf.some(name => present.has(name))) {
            add('missing-attribute', token.nameStart, token.name.length,
                `<${token.name}> needs ${spec.requiresOneOf.map(name => `"${name}"`).join(' or ')}; ${consequenceOf(scope)}`, { scope, context });
        }
    };

    const missingChildren = frame => {
        if (frame.xacroChildren) return;
        const { token, context, scope } = frame;
        for (const child of specOf(context).requiredChildren ?? []) {
            if (!frame.childNames.includes(child)) add('missing-element', token.nameStart, token.name.length, `<${token.name}> has no <${child}>; ${consequenceOf(scope)}`, { scope });
        }
        if (context === 'geometry' && !frame.childNames.length) {
            add('missing-element', token.nameStart, token.name.length, `<geometry> has no shape; ${consequenceOf(scope)}`, { scope });
        }
    };

    const close = frame => {
        if (frame.closeNameStart !== undefined && frame.replacement) frame.replacement.closeStart = frame.closeNameStart;
        if (!isSchemaContext(frame.context) || isXacro(frame.token.name)) return;
        missingChildren(frame);
        if (!frame.xacroAttributes) missingAttributes(frame);
    };

    // An element in <geometry>: the first must be a shape, the rest are ignored.
    // With xacro inside, which element comes first is not known.
    const geometryChild = (geometry, token, context, frame) => {
        if (geometry.xacroChildren) return context;
        const first = geometry.childNames.length === 1;
        const scope = geometry.scope;
        if (!first) {
            add('ignored-element', token.nameStart, token.name.length, `only the first shape in <geometry> is read; ROS ignores <${token.name}>`);
        } else if (!context) {
            const suggestion = closest(token.name, SHAPES);
            frame.replacement = rename(token.nameStart, token.name.length, suggestion);
            add('invalid-geometry', token.nameStart, token.name.length,
                `<${token.name}> is not a shape; ${consequenceOf(scope)}${suggestion ? `. Did you mean <${suggestion}>?` : ''}`, { scope, replacement: frame.replacement });
        } else if (context === 'capsule' && version && below(version, [1, 1])) {
            add('invalid-geometry', token.nameStart, token.name.length, `<capsule> is read only from <robot version="1.1">; ${consequenceOf(scope)}`, { scope });
        }
        return first ? context : null;
    };

    const unreadElement = (parent, token, frame) => {
        const readers = elementsReading(token.name);
        if (specOf(token.name) && readers.length) {
            const where = readers.map(name => `<${name}>`).join(', ');
            add('ignored-element', token.nameStart, token.name.length, `<${token.name}> is not read inside <${parent.context}>; ROS reads it in ${where}`);
            return;
        }
        const known = specOf(parent.context).children;
        const suggestion = closest(token.name, parent.context === 'robot' ? known.concat(...FOREIGN) : known);
        frame.replacement = rename(token.nameStart, token.name.length, suggestion);
        add('ignored-element', token.nameStart, token.name.length,
            `<${token.name}> is not a URDF element; ROS ignores it${suggestion ? `. Did you mean <${suggestion}>?` : ''}`, { replacement: frame.replacement });
    };

    const open = token => {
        const parent = stack.at(-1);
        if (!parent) {
            if (token.name !== 'robot') return null;
            const declared = literalAttribute(token, 'version');
            version = declared !== undefined ? parseVersion(declared) : xacro ? null : [1, 0];
            checkAttributes(token, 'robot', 'model');
            return { token, context: 'robot', scope: 'model', childNames: [] };
        }
        const owner = stack.findLast(frame => !isXacro(frame.token.name));
        if (token.name === 'xacro:attribute') owner.xacroAttributes = true;
        const repeated = !isXacro(token.name) && !owner.xacroChildren && owner.childNames.includes(token.name);
        if (isXacro(token.name)) owner.xacroChildren = true;
        else owner.childNames.push(token.name);
        let context = childContext(parent.context, token.name, token.attributes);
        const frame = { token, context, owner, childNames: [] };
        const checked = isSchemaContext(parent.context) && !token.name.includes(':');
        if (checked && parent.context === 'geometry') {
            context = geometryChild(owner, token, context, frame);
        } else if (checked && !context && !(parent.context === 'robot' && FOREIGN.has(token.name))) {
            unreadElement(parent, token, frame);
        } else if (checked && context && repeated && !isRepeatable(parent.context, token.name)) {
            add('ignored-element', token.nameStart, token.name.length, `only the first <${token.name}> in <${parent.context}> is read; ROS ignores this one`);
            context = null;
        } else if (context === 'axis' && ['fixed', 'floating'].includes(literalAttribute(owner.token, 'type'))) {
            context = null;
        }
        frame.context = context;
        frame.scope = isSchemaContext(context) ? scopeOf([...stack, frame], context) : null;
        if (isSchemaContext(context) && !isXacro(token.name)) checkAttributes(token, context, frame.scope);
        // Under <xacro:if> or in a macro two materials of one name need not both reach <robot>.
        if (context === 'material' && parent.token.name === 'robot') duplicateMaterial(token);
        return frame;
    };

    // model.cpp rejects a second top-level material of the same name.
    const duplicateMaterial = token => {
        const name = token.attributes.find(attribute => attribute.name === 'name');
        if (!name || !isLiteral(name.value)) return;
        if (materialNames.has(name.value)) {
            add('invalid-value', name.valueStart, name.value.length, `material "${name.value}" is defined twice under <robot>; ROS rejects the model`, { scope: 'model' });
        }
        materialNames.set(name.value, true);
    };

    for (const token of tokens) {
        if (token.kind === 'close') {
            const index = stack.findLastIndex(frame => frame.token.name === token.name);
            if (index === -1) continue;
            stack[index].closeNameStart = token.nameStart;
            while (stack.length > index) close(stack.pop());
            continue;
        }
        const frame = open(token);
        if (!frame) return [];
        if (token.kind === 'open') stack.push(frame);
        else close(frame);
    }
    while (stack.length) close(stack.pop());
    return issues;
}

function contextAt(text, offset) {
    const before = text.slice(0, offset);
    const { tokens, partial } = tokenize(before);
    const stack = [{ name: null, context: DOCUMENT, childNames: [] }];
    for (const token of tokens) {
        if (token.kind === 'close') {
            const index = stack.findLastIndex(frame => frame.name === token.name);
            if (index > 0) stack.length = index;
            continue;
        }
        const parent = stack.at(-1);
        parent.childNames.push(token.name);
        if (token.kind === 'open') stack.push({ name: token.name, context: childContext(parent.context, token.name, token.attributes), childNames: [] });
    }
    const inComment = before.lastIndexOf('<!--') > before.lastIndexOf('-->');
    const unfinished = partial !== null && !inComment && !/>/.test(before.slice(partial).replace(QUOTED_RE, '')) ? before.slice(partial) : null;
    return { parent: stack.at(-1).context, siblings: stack.at(-1).childNames, unfinished };
}

function tagAt(text, offset) {
    const { parent, siblings, unfinished } = contextAt(text, offset);
    if (unfinished === null) return null;
    const tagStart = offset - unfinished.length;
    if (/^<([\w.-]*)$/.test(unfinished)) return { kind: 'element', parent, siblings, start: tagStart + 1 };
    const head = unfinished.match(/^<([\w:.-]+)\s/);
    if (!head) return null;
    const attributes = attributesOf(unfinished, tagStart);
    // A <joint> being typed in a macro body has no type yet, which childContext reads as ros2_control.
    const element = parent === 'any' && head[1] === 'joint' ? 'joint' : childContext(parent, head[1], attributes);
    if (!isSchemaContext(element)) return null;
    const VALUE_RE = /([\w:-]+)\s*=\s*["']([^"']*)$/;
    const rest = unfinished.replace(QUOTED_RE, match => ' '.repeat(match.length));
    if (VALUE_RE.test(rest)) {
        const [, attribute, typed] = unfinished.match(VALUE_RE);
        return { kind: 'value', element, attribute, start: offset - typed.length };
    }
    const attribute = unfinished.match(/\s([\w-]*)$/);
    if (attribute && /\s[\w-]*$/.test(rest)) return { kind: 'attribute', element, present: attributes.map(a => a.name), start: offset - attribute[1].length };
    return null;
}

function attributeSnippet(name, spec, index) {
    if (spec.values) return `${name}="\${${index}|${Object.keys(spec.values).join(',')}|}"`;
    return spec.default !== undefined ? `${name}="\${${index}:${spec.default}}"` : `${name}="$${index}"`;
}

function elementSnippet(name) {
    const spec = specOf(name);
    const shown = spec.snippet ?? Object.keys(spec.attributes).filter(attribute => spec.attributes[attribute].required);
    const attributes = shown.map((attribute, i) => ' ' + attributeSnippet(attribute, spec.attributes[attribute], i + 1)).join('');
    if (!spec.body) return `${name}${attributes}/>`;
    return [`${name}${attributes}>`, ...spec.body.map(line => '\t' + line), `</${name}>`].join('\n');
}

// Only the first of a non-repeatable element is read, and only the first shape.
function elementsAt(context, siblings = []) {
    if (context === DOCUMENT) return siblings.length ? [] : [{ name: 'robot', snippet: elementSnippet('robot'), doc: elementDoc('robot') }];
    if (context !== 'any' && !isSchemaContext(context)) return [];
    if (context === 'geometry' && siblings.some(name => SHAPES.includes(name))) return [];
    const names = context === 'any' ? Object.keys(SCHEMA).filter(name => name !== 'robot')
        : specOf(context).children.filter(name => !siblings.includes(name) || isRepeatable(context, name));
    const elements = names.map(name => ({ name, snippet: elementSnippet(name), doc: elementDoc(name, context) }));
    if (context === 'robot') elements.push(...Object.entries(FOREIGN_SNIPPETS).map(([name, { doc, snippet }]) => ({ name, snippet, doc })));
    return elements;
}

const xacroDirectives = () => Object.entries(XACRO_DIRECTIVES).map(([name, { doc, snippet }]) => ({ name, snippet, doc }));

const valueLabel = spec => own(TYPES, spec.type)?.label(spec) ?? 'text';

function flagOf(spec) {
    const since = spec.since ? `, from URDF ${spec.since.join('.')}` : '';
    if (spec.required) return `required${since}`;
    return (spec.default !== undefined ? `default \`${spec.default}\`` : 'optional') + since;
}

function elementDoc(name, parent) {
    const spec = specOf(name);
    if (!spec) return null;
    const lines = [`**<${name}>** ${own(spec.docIn, parent) ?? spec.doc}`];
    const attributes = Object.entries(spec.attributes);
    if (attributes.length) {
        lines.push('', '| attribute | value | | |', '|---|---|---|---|');
        for (const [attribute, attributeSpec] of attributes) lines.push(`| \`${attribute}\` | ${valueLabel(attributeSpec)} | ${flagOf(attributeSpec)} | ${attributeSpec.doc} |`);
    }
    return lines.join('\n');
}

function attributeDoc(element, attribute) {
    const spec = own(specOf(element)?.attributes, attribute);
    if (!spec) return null;
    const values = spec.values ? '\n\n' + Object.entries(spec.values).map(([value, doc]) => `- \`${value}\`: ${doc}`).join('\n') : '';
    return `**${attribute}** on \`<${element}>\` (${valueLabel(spec)}, ${flagOf(spec)}): ${spec.doc}${values}`;
}

function valueDoc(element, attribute, value) {
    const doc = own(own(specOf(element)?.attributes, attribute)?.values, value);
    return doc ? `**${value}**: ${doc}` : null;
}

const attributesOfElement = element => Object.entries(specOf(element)?.attributes ?? {}).map(([name, spec]) => ({
    name, required: Boolean(spec.required), snippet: attributeSnippet(name, spec, 1), doc: attributeDoc(element, name)
}));
function valuesOf(element, attribute) {
    const values = own(own(specOf(element)?.attributes, attribute), 'values');
    return values ? Object.entries(values).map(([value, doc]) => ({ value, doc })) : [];
}

module.exports = {
    RULES, XACRO_DIRECTIVES, tokenize, childContext, checkStructure, contextAt, tagAt,
    elementsAt, xacroDirectives, attributesOfElement, valuesOf, elementSnippet, elementDoc, attributeDoc, valueDoc
};
