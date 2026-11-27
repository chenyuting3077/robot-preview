/**
 * Xacro Adapter
 *
 * Expands xacro with xacro-parser, patched in patches/xacro-parser@0.3.11.patch
 * where it differs from ROS xacro; docs/vscode-extension.md lists why.
 */
import { XacroParser } from 'xacro-parser';
import yaml from 'js-yaml';
import { resolveFileMatch, cleanFilePath, directoryOf } from '../utils/FileUtils.js';
import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';

// ROS xacro's yaml unit tags, converted to radians and metres.
const YAML_UNITS = {
    '!radians': 1,
    '!degrees': Math.PI / 180,
    '!meters': 1,
    '!millimeters': 0.001,
    '!foot': 0.3048,
    '!inches': 0.0254
};

// Python that xacro-parser cannot evaluate is rewritten into calls it can; a scanner, not a regex, so strings and nesting survive.
const isQuote = c => c === '"' || c === "'";

function skipString(text, i) {
    const end = text.indexOf(text[i], i + 1);
    return end === -1 ? text.length : end + 1;
}

function closingBracket(text, i) {
    const open = text[i];
    const close = open === '(' ? ')' : ']';
    let depth = 0;
    for (let j = i; j < text.length; j++) {
        if (isQuote(text[j])) {
            j = skipString(text, j) - 1;
        } else if (text[j] === open) {
            depth++;
        } else if (text[j] === close && --depth === 0) {
            return j;
        }
    }
    return text.length;
}

function topLevelKeyword(text, word, from = 0) {
    for (let j = from; j < text.length; j++) {
        if (isQuote(text[j])) {
            j = skipString(text, j) - 1;
        } else if (text[j] === '(' || text[j] === '[') {
            j = closingBracket(text, j);
        } else if (text.startsWith(word, j) && (!/\w/.test(word) || (!/\w/.test(text[j - 1] ?? '') && !/\w/.test(text[j + word.length] ?? '')))) {
            return j;
        }
    }
    return -1;
}

function splitTopLevel(text, separator) {
    const parts = [];
    for (let at = topLevelKeyword(text, separator); at !== -1; at = topLevelKeyword(text, separator)) {
        parts.push(text.slice(0, at));
        text = text.slice(at + separator.length);
    }
    return [...parts, text];
}

// Operators expr-eval lacks, or xacro-parser's tokenizer splits (>=), become a op S op b around a sentinel S; marks hold their place meanwhile.
const SPELLED = {
    '//': { mark: '\u0001', op: '/', sentinel: 'py_floordiv__', apply: (a, b) => Math.floor(a / b) },
    'not in': { mark: '\u0002', op: 'in', sentinel: 'py_notin__', apply: (a, b, contains) => !contains(a, b) },
    '>=': { mark: '\u0003', op: '>', sentinel: 'py_ge__', apply: (a, b) => a >= b },
    '<=': { mark: '\u0004', op: '<', sentinel: 'py_le__', apply: (a, b) => a <= b }
};
const COMPARISON = /^(==|!=|<|>|[\u0002-\u0004]|in(?!\w))/;

// a < b <= c is (a < b) and (b <= c) in Python; expr-eval would compare the first result with c.
function splitComparisonChains(text) {
    const pieces = [];
    let segment = { start: 0, ops: [] };
    const close = end => pieces.push({ ...segment, end });
    for (let j = 0; j < text.length; j++) {
        const boundary = /^(?:(?:and|or|not|if|else)(?!\w)|,)/.exec(text.slice(j));
        const op = !/\w/.test(text[j - 1] ?? '') || !/\w/.test(text[j]) ? COMPARISON.exec(text.slice(j)) : null;
        if (isQuote(text[j])) {
            j = skipString(text, j) - 1;
        } else if (text[j] === '(' || text[j] === '[') {
            j = closingBracket(text, j);
        } else if (boundary && !/\w/.test(text[j - 1] ?? '')) {
            close(j);
            segment = { start: j + boundary[0].length, ops: [] };
            j += boundary[0].length - 1;
        } else if (op) {
            segment.ops.push({ at: j, length: op[0].length });
            j += op[0].length - 1;
        }
    }
    close(text.length);
    let out = text;
    for (const { start, end, ops } of pieces.reverse()) {
        if (ops.length < 2) continue;
        const operands = [start, ...ops.map(op => op.at + op.length)].map((from, k) => text.slice(from, ops[k]?.at ?? end).trim());
        const chain = ops.map((op, k) => `(${operands[k]} ${text.substr(op.at, op.length)} ${operands[k + 1]})`).join(' and ');
        out = `${out.slice(0, start)} ${chain} ${out.slice(end)}`;
    }
    return out;
}

function rewriteExpression(text) {
    let out = '';
    for (let i = 0; i < text.length;) {
        if (isQuote(text[i])) {
            const end = skipString(text, i);
            out += text.slice(i, end);
            i = end;
        } else if (text[i] === '(') {
            const end = closingBracket(text, i);
            const inner = rewriteExpression(text.slice(i + 1, end));
            // A tuple, as in '%s_%s' % (a, b), is read as a list; a call's parentheses stay.
            const call = /[)\]]\s*$/.test(out) || !['', 'in', 'and', 'or', 'not', 'if', 'else'].includes(/(\w*)\s*$/.exec(out)[1]);
            const tuple = !call && topLevelKeyword(inner, ',') !== -1;
            out += tuple ? `[${inner}]` : `(${inner})`;
            i = end + 1;
        } else if (text.startsWith('**', i)) {
            // expr-eval's ^ binds like Python's ** (-2**2 is -4); spaced, since xacro-parser's tokenizer does not split on ^.
            out += ' ^ ';
            i += 2;
        } else if (['//', '>=', '<='].some(op => text.startsWith(op, i))) {
            out += ` ${SPELLED[text.slice(i, i + 2)].mark} `;
            i += 2;
        } else if (/[A-Za-z_]/.test(text[i]) && !/[\w.]/.test(text[i - 1] ?? '')) {
            let name = /^[A-Za-z_]\w*/.exec(text.slice(i))[0];
            let j = i + name.length;
            if (name === 'for' || name === 'lambda') throw new Error(`unsupported Python ${name === 'for' ? 'comprehension' : 'lambda'}`);
            const notIn = name === 'not' && /^\s+in(?!\w)/.exec(text.slice(j));
            if (notIn) {
                out += ` ${SPELLED['not in'].mark} `;
                i = j + notIn[0].length;
                continue;
            }
            // math.*, python.* and xacro.* are namespaces, not values.
            const namespaced = ['math', 'python', 'xacro'].includes(name) && /^\.([A-Za-z_]\w*)/.exec(text.slice(j));
            if (namespaced) {
                name = name === 'xacro' ? `__xacro_${namespaced[1]}__` : namespaced[1];
                j += namespaced[0].length;
            }
            let value = name;
            if (name === 'dict' && text[j] === '(') {
                const end = closingBracket(text, j);
                const pairs = splitTopLevel(text.slice(j + 1, end), ',').filter(arg => arg.trim()).map(arg => {
                    const keyword = /^\s*([A-Za-z_]\w*)\s*=(?!=)([\s\S]*)$/.exec(arg);
                    if (!keyword) throw new Error('unsupported Python dict() without keyword arguments');
                    return `"${keyword[1]}",${rewriteExpression(keyword[2].trim())}`;
                });
                // No space, = or ': xacro-parser splits a macro's params="name:=${dict(a=1)}" on them.
                value = `__dict__(${pairs.join(',')})`;
                j = end + 1;
            }
            for (;;) {
                const member = /^\.([A-Za-z_]\w*)(\(?)/.exec(text.slice(j));
                if (text[j] === '[') {
                    const end = closingBracket(text, j);
                    const inner = text.slice(j + 1, end);
                    const colon = topLevelKeyword(inner, ':');
                    if (colon === -1) value = `__read_property__(${value}, ${rewriteExpression(inner)})`;
                    else {
                        const start = rewriteExpression(inner.slice(0, colon).trim()) || '0';
                        const stop = rewriteExpression(inner.slice(colon + 1).trim());
                        value = `__slice__(${value}, ${start}${stop ? `, ${stop}` : ''})`;
                    }
                    j = end + 1;
                } else if (member?.[2]) {
                    const open = j + member[0].length - 1;
                    const end = closingBracket(text, open);
                    const args = text.slice(open + 1, end).trim();
                    value = `__call_method__(${value}, '${member[1]}'${args ? `, ${rewriteExpression(args)}` : ''})`;
                    j = end + 1;
                } else if (member) {
                    // A yaml dictionary's d.key, as ROS xacro's YamlDictWrapper allows.
                    value = `__read_property__(${value}, '${member[1]}')`;
                    j += member[0].length;
                } else break;
            }
            out += value;
            i = j;
        } else {
            out += text[i++];
        }
    }
    out = splitComparisonChains(out);
    // Lowest precedence and right-associative, so only the top level splits.
    const at = topLevelKeyword(out, 'if');
    const elseAt = at === -1 ? -1 : topLevelKeyword(out, 'else', at + 2);
    if (elseAt === -1) return out;
    return `(${out.slice(at + 2, elseAt).trim()}) ? (${out.slice(0, at).trim()}) : (${rewriteExpression(out.slice(elseAt + 4)).trim()})`;
}

// Python's split() without a separator drops empty fields; split(' ') keeps them.
const STRING_METHODS = {
    split: (s, sep, ...maxsplit) => {
        // JS's second argument truncates the result where Python's merges the rest, so it is refused rather than wrong.
        if (maxsplit.length) throw new Error('unsupported Python split() with maxsplit');
        return sep == null ? s.split(/\s+/).filter(Boolean) : s.split(sep);
    },
    lower: s => s.toLowerCase(),
    upper: s => s.toUpperCase(),
    replace: (s, from, to) => s.split(from).join(to),
    startswith: (s, prefix) => s.startsWith(prefix),
    endswith: (s, suffix) => s.endsWith(suffix)
};

function callMethod(value, method, ...args) {
    const fn = typeof value === 'string' && Object.hasOwn(STRING_METHODS, method) ? STRING_METHODS[method] : null;
    if (!fn) throw new Error(`unsupported Python method .${method}() on ${typeof value}`);
    return fn(value, ...args);
}

// An unsupported construct fails only when xacro would evaluate it, so one in a comment or an unused branch passes.
function toExprEval(expression) {
    try {
        return Object.values(SPELLED)
            .reduce((text, { mark, op, sentinel }) => text.replaceAll(mark, ` ${op} ${sentinel} ${op} `), rewriteExpression(expression));
    } catch (error) {
        return `__unsupported__("${error.message}")`;
    }
}

const XML_ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const decodeXml = text => text.replace(/&(?:lt|gt|quot|amp);/g, entity => XML_ENTITIES[entity]);
const encodeXml = text => text.replace(/[&<"]/g, char => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;' })[char]);

/**
 * Rewrites one file's ${} for xacro-parser and keeps what it needs to show a failing expression where and as it was written.
 * Usage: const sources = new XacroSources(); text = sources.rewrite(text, key); error = sources.locate(error);
 */
class XacroSources {
    files = new Map();
    written = new Map();

    // ' stays as written: either quote may delimit the attribute.
    rewrite(text, key) {
        const rewritten = text.replace(/\$\{([^}]*)\}/g, (whole, expression) => {
            const original = decodeXml(expression);
            const forParser = toExprEval(original.replace(/\b(?:xacro\.)?load_yaml\s*\(/g, '__load_yaml__('));
            this.written.set(forParser, original);
            return `\${${encodeXml(forParser)}}`;
        });
        this.files.set(key, rewritten.replace(/&(?:lt|gt|quot|apos|amp);/g, entity => XML_ENTITIES[entity]));
        return rewritten;
    }

    // xacro-parser reports the failing attribute as rewritten; its line is the same in the file as written.
    locate(error) {
        const failed = /^XacroParser: Failed to process expression "([\s\S]*)"\. \n([\s\S]*)$/.exec(error.message);
        if (!failed) return error;
        const [, attribute, reason] = failed;
        const asWritten = attribute.replace(/\$\{([^}]*)\}/g, (whole, expression) => `\${${this.written.get(expression) ?? expression}}`);
        const limit = /^unsupported /.test(reason.trim()) ? ' (a limit of the preview; ROS xacro evaluates it)' : '';
        const message = `Failed to process expression "${asWritten}": ${reason.trim()}${limit}`;
        for (const needle of [attribute, ...(attribute.match(/\$[{(][^})]*[})]/g) || [])]) {
            for (const [key, text] of this.files) {
                const at = text.indexOf(needle);
                if (at === -1) continue;
                const before = text.slice(0, at).split('\n');
                return Object.assign(new Error(message), { location: { key, line: before.length - 1, column: before.at(-1).length } });
            }
        }
        return new Error(message);
    }
}

// Prints as Python prints a list, where a plain array would print as 1,2.
class PyList extends Array {
    toString() {
        return `[${this.map(pyRepr).join(', ')}]`;
    }
}

const toPyList = value => (Array.isArray(value) && !(value instanceof PyList) ? PyList.from(value, toPyList) : value);
const pyStr = value => (typeof value === 'boolean' ? (value ? 'True' : 'False') : value == null ? 'None' : String(value));
const pyRepr = value => (typeof value === 'string' ? `'${value}'` : pyStr(value));
const pyTruthy = value => (value && typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value));
const iterable = args => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);

function pyInt(value, base) {
    if (typeof value !== 'string') return Math.trunc(Number(value));
    const number = base ? parseInt(value, base) : Number(value.trim());
    if (value.trim() === '' || !Number.isInteger(number)) throw new Error(`invalid literal for int(): '${value}'`);
    return number;
}

function pyFloat(value) {
    const number = Number(value);
    if (typeof value === 'string' && (value.trim() === '' || Number.isNaN(number))) throw new Error(`could not convert string to float: '${value}'`);
    return number;
}

// Python rounds a tie to the even neighbour: round(2.5) is 2.
function pyRound(value, digits = 0) {
    const scale = 10 ** digits;
    const scaled = value * scale;
    const floor = Math.floor(scaled);
    const rest = scaled - floor;
    return (rest > 0.5 || (rest === 0.5 && floor % 2 !== 0) ? floor + 1 : floor) / scale;
}

function pyRange(start, stop, step = 1) {
    if (stop === undefined) [start, stop] = [0, start];
    const out = [];
    for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(i);
    return PyList.from(out);
}

function pyFormat(format, args) {
    const values = Array.isArray(args) ? [...args] : [args];
    return format.replace(/%(?:\.(\d+))?([sdif%])|%./g, (spec, precision, kind) => {
        if (!kind) throw new Error(`unsupported Python format ${spec}`);
        if (kind === '%') return '%';
        const value = values.shift();
        if (kind === 's') return pyStr(value);
        if (kind === 'f') return Number(value).toFixed(precision === undefined ? 6 : Number(precision));
        return String(Math.trunc(Number(value)));
    });
}

// Python's builtins and math functions that xacro exposes, with and without their python. and math. prefixes.
const PY_FUNCTIONS = {
    int: pyInt,
    float: pyFloat,
    str: pyStr,
    bool: pyTruthy,
    round: pyRound,
    min: (...args) => Math.min(...iterable(args)),
    max: (...args) => Math.max(...iterable(args)),
    len: value => (typeof value === 'string' || Array.isArray(value) ? value.length : Object.keys(value).length),
    abs: Math.abs,
    sum: (values, start = 0) => values.reduce((total, value) => total + value, start),
    sorted: values => PyList.from(values).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    list: value => PyList.from(value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : value),
    range: pyRange,
    ord: text => text.codePointAt(0),
    all: values => values.every(pyTruthy),
    any: values => values.some(pyTruthy),
    sqrt: Math.sqrt,
    floor: Math.floor,
    ceil: Math.ceil,
    trunc: Math.trunc,
    fabs: Math.abs,
    exp: Math.exp,
    hypot: Math.hypot,
    log: (value, base) => (base === undefined ? Math.log(value) : Math.log(value) / Math.log(base)),
    log10: Math.log10,
    __dict__: (...pairs) => Object.fromEntries(Array.from({ length: pairs.length / 2 }, (_, k) => [pairs[2 * k], pairs[2 * k + 1]])),
    // xacro.error, warning and message print and expand to nothing; xacro.fatal stops.
    __xacro_error__: (...args) => (console.warn(...args), ''),
    __xacro_warning__: (...args) => (console.warn(...args), ''),
    __xacro_message__: (...args) => (console.log(...args), ''),
    __xacro_fatal__: (...args) => {
        throw new Error(args.map(pyStr).join(' '));
    },
    __unsupported__: message => {
        throw new Error(message);
    }
};

function addPythonOperators(expressionParser) {
    const ops = expressionParser.binaryOps;
    const { '*': multiply, '+': add } = ops;
    for (const { op, sentinel, apply } of Object.values(SPELLED)) {
        const original = ops[op];
        const marker = { sentinel };
        expressionParser.consts[sentinel] = marker;
        ops[op] = (a, b) => (b === marker ? { marker, left: a } : a?.marker === marker ? apply(a.left, b, original) : original(a, b));
    }
    // Python's % takes the divisor's sign: -7 % 3 is 2.
    ops['%'] = (a, b) => (typeof a === 'string' && isNaN(a) ? pyFormat(a, b) : a - b * Math.floor(a / b));
    ops['*'] = (a, b) => {
        if (Number.isInteger(b) && (typeof a === 'string' || Array.isArray(a))) [a, b] = [b, a];
        if (typeof b === 'string') return b.repeat(a);
        if (Array.isArray(b)) return PyList.from(Array.from({ length: a }, () => b).flat());
        return multiply(a, b);
    };
    ops['+'] = (a, b) => (Array.isArray(a) && Array.isArray(b) ? PyList.from([...a, ...b]) : add(a, b));
    Object.assign(expressionParser.functions, PY_FUNCTIONS);
    const evaluate = expressionParser.evaluate.bind(expressionParser);
    expressionParser.evaluate = (...args) => toPyList(evaluate(...args));
}

export class XacroAdapter {
    /**
     * Expand xacro to URDF text, before anything the viewer strips for display.
     * @returns {Promise<string>}
     */
    static async expand(xacroContent, fileName, fileMap = null, { args = {}, env = {} } = {}) {
        const parser = new XacroParser();
        // ROS Jade and later semantics.
        parser.inOrder = true;
        parser.requirePrefix = true;
        parser.localProperties = true;
        const workingPath = directoryOf(fileName);
        parser.workingPath = workingPath;
        // The webview has no process.env; the extension sends the variables
        // the model files reference.
        // argumentDefaults comes from patches/xacro-parser@0.3.11.patch.
        const allArguments = () => ({ ...parser.argumentDefaults, ...parser.arguments });
        parser.rospackCommands = (stem, ...args) => {
            if (stem === 'find') return `/${args[0]}`;
            if (stem === 'env') {
                if (env[args[0]] == null) throw new Error(`environment variable '${args[0]}' is not set`);
                return env[args[0]];
            }
            if (stem === 'optenv') return env[args[0]] ?? args.slice(1).join(' ');
            // currentWorkingPath comes from patches/xacro-parser@0.3.11.patch.
            if (stem === 'dirname') return parser.currentWorkingPath.replace(/\/+$/, '');
            if (stem === 'eval') {
                const scope = Object.fromEntries(Object.entries(allArguments())
                    .map(([name, value]) => [name, value !== '' && !isNaN(value) ? Number(value) : value]));
                return String(parser.expressionParser.evaluate(toExprEval(args.join(' ')), scope));
            }
            return null;
        };

        // DEBUG and SELF_COLLIDE are used without a declaration by older ROS models.
        const xacroArgs = this.extractXacroArguments(xacroContent);
        if (!xacroArgs.hasOwnProperty('DEBUG')) {
            xacroArgs.DEBUG = 'false';
        }
        if (!xacroArgs.hasOwnProperty('SELF_COLLIDE')) {
            xacroArgs.SELF_COLLIDE = 'false';
        }

        parser.arguments = { ...xacroArgs, ...args };

        // load_yaml is synchronous inside an expression (why upstream lacks it,
        // issue #91), so the yaml files are read beforehand, and only once some
        // file calls it: a package carries many config yaml files and this runs
        // on every keystroke.
        const yamlTexts = new Map();
        const readYamlOnce = async text => {
            if (yamlTexts.size || !text.includes('__load_yaml__')) return text;
            for (const [key, entry] of fileMap || []) {
                if (/\.ya?ml$/i.test(key)) yamlTexts.set(key, await entry.text());
            }
            return text;
        };
        const units = Object.entries(YAML_UNITS).map(([tag, factor]) => new yaml.Type(tag, {
            kind: 'scalar',
            construct: value => Number(parser.expressionParser.evaluate(String(value))) * factor
        }));
        const schema = yaml.DEFAULT_SCHEMA.extend(units);
        // xacro-parser rewraps errors as text, so a yaml error's position is
        // kept here and reattached once parse() fails.
        let yamlError = null;
        addPythonOperators(parser.expressionParser);
        parser.expressionParser.functions.__xacro_arg__ = name => {
            if (allArguments()[name] === undefined) throw new Error(`undefined xacro argument '${name}'`);
            return allArguments()[name];
        };
        parser.expressionParser.functions.__call_method__ = callMethod;
        parser.expressionParser.functions.__slice__ = (value, start, end) => value.slice(start, end);
        // Python counts a negative index from the end.
        parser.expressionParser.functions.__read_property__ = (value, ...keys) => keys.reduce((at, key) =>
            (typeof key === 'number' && key < 0 && (Array.isArray(at) || typeof at === 'string') ? at[at.length + key] : at[key]), value);
        parser.expressionParser.functions.__load_yaml__ = filename => {
            const target = /^[/\\]/.test(filename) ? filename : `${parser.currentWorkingPath}${filename}`;
            // Exact only: the mesh resolver's case/tail/basename guesses would
            // load a different file where ROS fails.
            const key = `/${cleanFilePath(target)}`;
            const found = resolveFileMatch(key, yamlTexts);
            if (found?.match !== 'exact') {
                yamlError = { message: `load_yaml: cannot find ${key}`, location: { missing: key } };
                throw new Error(yamlError.message);
            }
            try {
                // json: a repeated key keeps the last value, as PyYAML does (franka_description's fp3/inertials.yaml).
                return yaml.load(found.file, { schema, filename, json: true });
            } catch (error) {
                yamlError = { message: `YAML error in ${filename}: ${error.reason || error.message}`, location: { key: found.key, line: error.mark?.line ?? 0, column: error.mark?.column ?? 0 } };
                throw error;
            }
        };
        const sources = new XacroSources();
        xacroContent = await readYamlOnce(sources.rewrite(xacroContent, fileName));

        if (fileMap) {
            parser.getFileContents = async (path) => {
                const { key, text } = await this.loadFileFromMap(path, fileMap, workingPath);
                return readYamlOnce(sources.rewrite(text, key));
            };
        }

        let urdfXML;
        try {
            urdfXML = await parser.parse(xacroContent);
        } catch (error) {
            if (!yamlError) throw sources.locate(error);
            throw Object.assign(new Error(yamlError.message), { location: yamlError.location });
        }

        return new XMLSerializer().serializeToString(urdfXML).replace(/\sxmlns=""/g, '');
    }

    /**
     * Expand xacro and load it as a model. <gazebo>, <transmission> and empty
     * geometry are stripped for urdf-loader; expandedUrdf keeps the full text
     * for export.
     */
    static async parse(xacroContent, fileName, fileMap = null, { args = {}, env = {} } = {}) {
        try {
            const urdfString = await this.expand(xacroContent, fileName, fileMap, { args, env });
            const doc = new DOMParser().parseFromString(urdfString, 'text/xml');
            const parseError = doc.querySelector('parsererror');
            if (parseError) throw new Error('Generated URDF has invalid XML: ' + parseError.textContent);
            doc.querySelectorAll('gazebo, transmission').forEach(el => el.parentNode?.removeChild(el));
            this.removeEmptyGeometry(doc);
            this.cleanXMLNodes(doc.documentElement);
            const model = await ModelLoaderFactory.loadURDF(new XMLSerializer().serializeToString(doc), fileName, fileMap);
            model.expandedUrdf = urdfString;
            return model;
        } catch (error) {
            throw Object.assign(new Error('Xacro parsing failed: ' + error.message), { location: error.location });
        }
    }

    /**
     * Load file from fileMap for xacro includes
     * @param {string} path - File path
     * @param {Map} fileMap - File map
     * @param {string} workingPath - Working directory
     * @returns {Promise<object>} The fileMap key found and its text.
     */
    static async loadFileFromMap(path, fileMap, workingPath) {
        // Clean path - remove leading slash if present
        let cleanPath = path;
        if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
        }

        // Remove leading ./
        cleanPath = cleanPath.replace(/^\.\//, '');

        // Try different path combinations
        const possiblePaths = [
            cleanPath,
            workingPath + cleanPath,
            path,
            workingPath + path.replace(/^\/+/, ''),
            // Also try without the first directory component
            cleanPath.includes('/') ? cleanPath.substring(cleanPath.indexOf('/') + 1) : cleanPath,
        ];

        // Try each path
        for (const tryPath of possiblePaths) {
            const file = fileMap.get(tryPath);
            if (file) return { key: tryPath, text: await file.text() };
        }

        // Try filename only match
        const fileName = cleanPath.split('/').pop();
        for (const [key, file] of fileMap.entries()) {
            const keyFileName = key.split('/').pop();
            if (keyFileName === fileName) return { key, text: await file.text() };
        }

        console.error('[XacroAdapter] Cannot find included file:', path);
        throw new Error(`Cannot find included file: ${path}`);
    }

    /**
     * Remove visual/collision elements with empty geometry tags
     * xacro-parser may not fully expand conditional geometry (xacro:if)
     * We'll just remove these empty visual elements rather than try to fix them
     * @param {XMLDocument} xmlDoc - XML document to clean
     */
    static removeEmptyGeometry(xmlDoc) {
        // Find all geometry elements
        const geometryElements = xmlDoc.querySelectorAll('geometry');

        geometryElements.forEach(geom => {
            // Check if geometry is empty (no child elements)
            if (!geom.children || geom.children.length === 0) {
                // Find the parent visual or collision element
                let parent = geom.parentNode;
                if (parent) {
                    const grandParent = parent.parentNode;
                    if (grandParent) {
                        if (parent.nodeName === 'visual' || parent.nodeName === 'collision') {
                            // Remove empty visual/collision elements
                            grandParent.removeChild(parent);
                        }
                    }
                }
            }
        });
    }

    /**
     * Recursively clean XML nodes - remove empty text nodes and comments
     * @param {Element} element - Element to clean
     */
    static cleanXMLNodes(element) {
        if (!element || !element.childNodes) return;

        const nodesToRemove = [];

        // Collect nodes to remove
        for (let i = 0; i < element.childNodes.length; i++) {
            const node = element.childNodes[i];

            // Remove comments
            if (node.nodeType === Node.COMMENT_NODE) {
                nodesToRemove.push(node);
            }
            // Remove empty or whitespace-only text nodes
            else if (node.nodeType === Node.TEXT_NODE) {
                if (!node.nodeValue || node.nodeValue.trim() === '') {
                    nodesToRemove.push(node);
                }
            }
            // Recursively clean element nodes
            else if (node.nodeType === Node.ELEMENT_NODE) {
                this.cleanXMLNodes(node);
            }
        }

        // Remove collected nodes
        nodesToRemove.forEach(node => {
            element.removeChild(node);
        });
    }

    /**
     * Extract xacro arguments and their default values from xacro content
     * Xacro files can define arguments using <xacro:arg name="..." default="..."/>
     * These need to be provided to the parser via parser.arguments
     * @param {string} xacroContent - Xacro file content
     * @returns {Object} - Object with argument names as keys and default values
     */
    static extractXacroArguments(xacroContent) {
        const args = {};

        // Match <xacro:arg name="NAME" default="VALUE"/>
        // Also match <arg name="NAME" default="VALUE"/> (without xacro: prefix)
        // Each value ends at its own quote: default="['a','b']" holds the other kind.
        const argPattern = /<(?:xacro:)?arg\s+name=(["'])(.*?)\1(?:\s+default=(["'])(.*?)\3)?/g;

        let match;
        while ((match = argPattern.exec(xacroContent)) !== null) {
            const argName = match[2];
            // A default with a substitution is left to the parser, which
            // evaluates it; prefilling it here would pass "$(find x)" on verbatim.
            if (match[4] !== undefined && /\$[({]/.test(match[4])) continue;
            args[argName] = match[4] ?? 'false'; // 'false' only when no default is given
        }

        return args;
    }
}

