// URDF vocabulary as ROS's urdfdom reads it, shared by completion, hover and
// the structure checks. docs/vscode-extension.md, "Structure checks": why a
// tag scanner rather than an XSD, and how xacro is handled.

const VECTOR3 = { type: 'vector', size: 3 };
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
    rpy: { ...VECTOR3, doc: 'Roll, pitch, yaw in radians, about the fixed X, Y and Z axes in that order.', default: '0 0 0' }
};

const inertiaTerm = { ...NUMBER, required: true, doc: 'Inertia tensor term in kg·m², about the centre of mass, in the frame of the inertial `<origin>`.' };

// children: elements urdfdom reads inside this one. snippet: attributes a new
// element starts with (default: the required ones). body: its first lines.
const SCHEMA = {
    robot: {
        doc: 'Root of a URDF. ROS reads `<link>`, `<joint>` and `<material>` here.',
        attributes: { name: { doc: 'Robot name.' }, version: { doc: 'URDF version, `1.0` or `1.1`.' } },
        children: ['link', 'joint', 'material']
    },
    link: {
        doc: 'A rigid body: its mass, what it looks like and what it collides with.',
        attributes: { name: { required: true, doc: 'Link name, unique in the robot.' } },
        children: ['inertial', 'visual', 'collision'],
        body: ['<visual>', '\t<geometry>', '\t\t$0', '\t</geometry>', '</visual>']
    },
    inertial: {
        doc: 'Mass and inertia of the link. Gazebo drops or merges a link without one.',
        attributes: {},
        children: ['origin', 'mass', 'inertia'],
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
        body: ['<geometry>', '\t$0', '</geometry>']
    },
    collision: {
        doc: 'Shape used for collision checking. A link can have several; simpler shapes than the visual make planning faster.',
        attributes: { name: { doc: 'Optional name.' } },
        children: ['origin', 'geometry'],
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
        attributes: { size: { ...VECTOR3, required: true, doc: 'Side lengths along x, y and z in metres.' } },
        children: []
    },
    cylinder: {
        doc: 'A cylinder along z, centred on the origin.',
        attributes: {
            radius: { ...NUMBER, required: true, doc: 'Radius in metres.' },
            length: { ...NUMBER, required: true, doc: 'Length along z in metres.' }
        },
        children: []
    },
    sphere: {
        doc: 'A sphere centred on the origin.',
        attributes: { radius: { ...NUMBER, required: true, doc: 'Radius in metres.' } },
        children: []
    },
    capsule: {
        doc: 'A cylinder along z with hemispherical ends, centred on the origin. Needs `<robot version="1.1">` and urdfdom from February 2026 (ros/urdfdom#238); older urdfdom rejects the model.',
        attributes: {
            radius: { ...NUMBER, required: true, doc: 'Radius in metres.' },
            length: { ...NUMBER, required: true, doc: 'Length of the cylindrical part along z in metres.' }
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
        attributes: { rgba: { type: 'vector', size: 4, required: true, doc: 'Red, green, blue and alpha, each from 0 to 1.' } },
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
        doc: 'Axis of motion in the joint frame. Ignored by fixed and floating joints.',
        attributes: { xyz: { ...VECTOR3, doc: 'Axis direction; normalised by ROS.', default: '1 0 0' } },
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
        doc: 'Damping and friction, used by simulators.',
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
            lower: { ...NUMBER, doc: 'Lower position in radians or metres.', default: '0' },
            upper: { ...NUMBER, doc: 'Upper position in radians or metres.', default: '0' },
            effort: { ...NUMBER, required: true, doc: 'Maximum force (N) or torque (N·m).' },
            velocity: { ...NUMBER, required: true, doc: 'Maximum speed in m/s or rad/s.' }
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

// Read by other tools (Gazebo, ros2_control, MuJoCo's compiler, Webots), so
// their contents follow other schemas. The rest are SRDF, whose root is <robot> too.
const FOREIGN = new Set(['gazebo', 'transmission', 'ros2_control', 'sensor', 'mujoco', 'webots',
    'group', 'group_state', 'end_effector', 'virtual_joint', 'passive_joint', 'disable_collisions', 'disable_default_collisions', 'enable_collisions', 'link_sphere_approximation']);

// Reported by the model checks in the preview (missing-limit, missing-mass,
// nonpositive-mass), so the structure check does not repeat them.
const REPORTED_ELSEWHERE = new Set(['limit.effort', 'limit.velocity', 'mass.value']);

const RULES = {
    'ignored-element': 'warning',
    'ignored-attribute': 'warning',
    'missing-attribute': 'error',
    'invalid-value': 'error'
};

// Comments, CDATA, declarations, closing tags and opening tags whose quoted values may hold '<' and '>'.
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

// Opening ('open'), closing ('close') and self-closing tags in document order.
// A '<' that starts no complete tag is skipped; `partial` is the last one.
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
    if (name.startsWith('xacro:')) {
        const directive = name.slice(6);
        if (directive === 'if' || directive === 'unless') return parentContext;
        if (directive === 'attribute') return null;
        return 'any';
    }
    if (name.includes(':')) return null;
    // A macro body's <joint> without a type is a ros2_control or transmission joint.
    if (parentContext === 'any') return SCHEMA[name] && !(name === 'joint' && !attributes.some(a => a.name === 'type')) ? name : null;
    return SCHEMA[parentContext].children.includes(name) ? name : null;
}

const isLiteral = value => !value.includes('$');

function invalidValue(spec, value) {
    if (!isLiteral(value)) return null;
    if (spec.type === 'enum') return spec.values[value] ? null : `must be one of ${Object.keys(spec.values).join(', ')}`;
    const parts = value.trim().split(/\s+/).filter(Boolean);
    const count = spec.type === 'vector' ? spec.size : spec.type === 'number' ? 1 : null;
    if (count === null) return null;
    if (parts.length !== count || parts.some(part => !Number.isFinite(Number(part)))) {
        return count === 1 ? 'must be a number' : `must be ${count} numbers separated by spaces`;
    }
    return null;
}

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

// Problems with offsets into `text`. Returns nothing unless the root is <robot>.
function checkStructure(text) {
    const { tokens } = tokenize(text);
    const issues = [];
    const add = (rule, start, length, message, replacement) => issues.push({ rule, severity: RULES[rule], start, end: start + length, message, replacement: replacement || undefined });
    const stack = [];

    const close = frame => {
        if (frame.closeNameStart !== undefined && frame.rename) {
            frame.rename.closeStart = frame.closeNameStart;
        }
        const spec = frame.context && frame.context !== 'any' && !frame.token.name.includes(':') && SCHEMA[frame.context];
        if (!spec || frame.xacroAttributes) return;
        const present = new Set(frame.token.attributes.map(attribute => attribute.name));
        const missing = Object.keys(spec.attributes).filter(name =>
            spec.attributes[name].required && !present.has(name) && !REPORTED_ELSEWHERE.has(`${frame.context}.${name}`));
        if (missing.length) {
            const list = missing.map(name => `"${name}"`).join(', ');
            add('missing-attribute', frame.token.nameStart, frame.token.name.length, `<${frame.token.name}> needs ${list}; ROS rejects the model without ${missing.length > 1 ? 'them' : 'it'}`);
        }
    };

    const open = token => {
        const parent = stack.at(-1);
        if (!parent) {
            if (token.name !== 'robot') return false;
            checkAttributes(token, 'robot');
            return { token, context: 'robot' };
        }
        if (token.name === 'xacro:attribute') stack.findLast(frame => !frame.token.name.includes(':')).xacroAttributes = true;
        const context = childContext(parent.context, token.name, token.attributes);
        const frame = { token, context };
        const checked = parent.context && parent.context !== 'any' && !token.name.includes(':');
        if (checked && !context && !(parent.context === 'robot' && FOREIGN.has(token.name))) {
            const readers = elementsReading(token.name);
            if (SCHEMA[token.name] && readers.length) {
                const where = readers.map(name => `<${name}>`).join(', ');
                add('ignored-element', token.nameStart, token.name.length, `<${token.name}> is not read inside <${parent.context}>; ROS reads it in ${where}`);
            } else {
                const known = SCHEMA[parent.context].children;
                const suggestion = closest(token.name, parent.context === 'robot' ? known.concat(...FOREIGN) : known);
                add('ignored-element', token.nameStart, token.name.length,
                    `<${token.name}> is not a URDF element; ROS ignores it${suggestion ? `. Did you mean <${suggestion}>?` : ''}`,
                    suggestion && (frame.rename = { text: suggestion, openStart: token.nameStart, length: token.name.length }));
            }
        }
        if (context && context !== 'any' && !token.name.includes(':')) checkAttributes(token, context);
        return frame;
    };

    const checkAttributes = (token, context) => {
        const spec = SCHEMA[context];
        for (const attribute of token.attributes) {
            if (attribute.name.includes(':') || attribute.name === 'xmlns') continue;
            const attributeSpec = spec.attributes[attribute.name];
            if (!attributeSpec) {
                const note = spec.ignoredNotes?.[attribute.name];
                const suggestion = note ? null : closest(attribute.name, Object.keys(spec.attributes));
                add('ignored-attribute', attribute.nameStart, attribute.name.length,
                    `<${token.name}> has no attribute "${attribute.name}"; ${note ?? 'ROS ignores it'}${suggestion ? `. Did you mean "${suggestion}"?` : ''}`,
                    suggestion && { text: suggestion, openStart: attribute.nameStart, length: attribute.name.length });
                continue;
            }
            const problem = invalidValue(attributeSpec, attribute.value);
            const suggestion = problem && attributeSpec.type === 'enum' && closest(attribute.value, Object.keys(attributeSpec.values));
            if (problem) {
                add('invalid-value', attribute.valueStart, attribute.value.length, `${attribute.name}="${attribute.value}" ${problem}`,
                    suggestion && { text: suggestion, openStart: attribute.valueStart, length: attribute.value.length });
            }
        }
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
        if (frame === false) return [];
        if (token.kind === 'open') stack.push(frame);
        else close(frame);
    }
    while (stack.length) close(stack.pop());
    return issues;
}

// The element and context around `offset`, for completion and hover.
// `partial` is the unfinished tag the cursor is in, if any.
function contextAt(text, offset) {
    const before = text.slice(0, offset);
    const { tokens, partial } = tokenize(before);
    const stack = [];
    for (const token of tokens) {
        if (token.kind === 'close') {
            const index = stack.findLastIndex(frame => frame.name === token.name);
            if (index !== -1) stack.length = index;
            continue;
        }
        const parent = stack.at(-1);
        const context = parent ? childContext(parent.context, token.name, token.attributes) : token.name === 'robot' ? 'robot' : null;
        if (token.kind === 'open') stack.push({ name: token.name, context });
    }
    const unfinished = partial !== null && !/>/.test(before.slice(partial).replace(/"[^"]*"|'[^']*'/g, '')) ? before.slice(partial) : null;
    return { parent: stack.at(-1)?.context ?? null, unfinished };
}

// What the cursor is typing inside an unfinished tag: the element name
// ('element'), an attribute name ('attribute') or an attribute value
// ('value'), with `start` where the typed text begins.
function tagAt(text, offset) {
    const { parent, unfinished } = contextAt(text, offset);
    if (unfinished === null) return null;
    const tagStart = offset - unfinished.length;
    const name = unfinished.match(/^<([\w:.-]*)$/);
    if (name) return { kind: 'element', parent, start: tagStart + 1 };
    const head = unfinished.match(/^<([\w:.-]+)\s/);
    if (!head) return null;
    const attributes = attributesOf(unfinished, tagStart);
    const element = parent === 'any' ? (SCHEMA[head[1]] ? head[1] : null) : childContext(parent, head[1], attributes);
    if (!element || element === 'any' || head[1].includes(':')) return null;
    const rest = unfinished.replace(/"[^"]*"|'[^']*'/g, match => ' '.repeat(match.length));
    const value = rest.match(/([\w:-]+)\s*=\s*["']([^"']*)$/) && unfinished.match(/([\w:-]+)\s*=\s*["']([^"']*)$/);
    if (value) return { kind: 'value', element, attribute: value[1], start: offset - value[2].length };
    const attribute = rest.match(/\s([\w-]*)$/);
    if (attribute) return { kind: 'attribute', element, present: attributes.map(a => a.name), start: offset - attribute[1].length };
    return null;
}

// Elements that may be typed at this context, for completion.
function childrenOf(context) {
    if (context === 'any') return Object.keys(SCHEMA).filter(name => name !== 'robot');
    return SCHEMA[context]?.children ?? [];
}

function attributeSnippet(name, spec, index) {
    if (spec.type === 'enum') return `${name}="\${${index}|${Object.keys(spec.values).join(',')}|}"`;
    return spec.default !== undefined ? `${name}="\${${index}:${spec.default}}"` : `${name}="$${index}"`;
}

// A new element with its required attributes (and pose defaults) as tab stops.
function elementSnippet(name) {
    const spec = SCHEMA[name];
    const shown = spec.snippet ?? Object.keys(spec.attributes).filter(attribute => spec.attributes[attribute].required);
    const attributes = shown.map((attribute, i) => ' ' + attributeSnippet(attribute, spec.attributes[attribute], i + 1)).join('');
    if (!spec.body) return `${name}${attributes}/>`;
    return [`${name}${attributes}>`, ...spec.body.map(line => '\t' + line), `</${name}>`].join('\n');
}

function elementDoc(name, parent) {
    const spec = SCHEMA[name];
    if (!spec?.doc) return null;
    const lines = [`**<${name}>** ${spec.docIn?.[parent] ?? spec.doc}`];
    const attributes = Object.entries(spec.attributes);
    if (attributes.length) {
        lines.push('', '| attribute | | |', '|---|---|---|');
        for (const [attribute, attributeSpec] of attributes) {
            const flag = attributeSpec.required ? 'required' : attributeSpec.default !== undefined ? `default \`${attributeSpec.default}\`` : 'optional';
            lines.push(`| \`${attribute}\` | ${flag} | ${attributeSpec.doc ?? ''} |`);
        }
    }
    return lines.join('\n');
}

function attributeDoc(element, attribute) {
    const spec = SCHEMA[element]?.attributes[attribute];
    if (!spec?.doc) return null;
    const flag = spec.required ? ' Required.' : spec.default !== undefined ? ` Default \`${spec.default}\`.` : '';
    const values = spec.type === 'enum' ? '\n\n' + Object.entries(spec.values).map(([value, doc]) => `- \`${value}\`: ${doc}`).join('\n') : '';
    return `**${attribute}** on \`<${element}>\`: ${spec.doc}${flag}${values}`;
}

module.exports = { SCHEMA, RULES, tokenize, childContext, checkStructure, contextAt, tagAt, childrenOf, attributeSnippet, elementSnippet, elementDoc, attributeDoc };
