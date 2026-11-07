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

// xacro-parser understands neither Python's `a if c else b` nor a `d['k']`
// lookup that is not at the end of an expression (and expr-eval's [] turns a
// string key into index 0), so both are rewritten before parsing. A scanner,
// not a regex: strings and nested parentheses must survive.
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
        } else if (text.startsWith(word, j) && !/\w/.test(text[j - 1] ?? '') && !/\w/.test(text[j + word.length] ?? '')) {
            return j;
        }
    }
    return -1;
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
            out += `(${rewriteExpression(text.slice(i + 1, end))})`;
            i = end + 1;
        } else if (/[A-Za-z_]/.test(text[i]) && !/[\w.]/.test(text[i - 1] ?? '')) {
            const name = /^[A-Za-z_]\w*/.exec(text.slice(i))[0];
            const keys = [];
            let j = i + name.length;
            while (text[j] === '[') {
                const end = closingBracket(text, j);
                keys.push(rewriteExpression(text.slice(j + 1, end)));
                j = end + 1;
            }
            out += keys.length ? `__read_property__(${name}, ${keys.join(', ')})` : name;
            i = j;
        } else {
            out += text[i++];
        }
    }
    // Lowest precedence and right-associative, so only the top level splits.
    const at = topLevelKeyword(out, 'if');
    const elseAt = at === -1 ? -1 : topLevelKeyword(out, 'else', at + 2);
    if (elseAt === -1) return out;
    return `(${out.slice(at + 2, elseAt).trim()}) ? (${out.slice(0, at).trim()}) : (${rewriteExpression(out.slice(elseAt + 4)).trim()})`;
}

function rewritePythonExpressions(text) {
    return text.replace(/\$\{([^}]*)\}/g, (whole, expression) => `\${${rewriteExpression(expression)}}`);
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
                // argumentDefaults comes from patches/xacro-parser@0.3.11.patch.
                const scope = Object.fromEntries(Object.entries({ ...parser.argumentDefaults, ...parser.arguments })
                    .map(([name, value]) => [name, value !== '' && !isNaN(value) ? Number(value) : value]));
                return String(parser.expressionParser.evaluate(args.join(' '), scope));
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
                return yaml.load(found.file, { schema, filename });
            } catch (error) {
                yamlError = { message: `YAML error in ${filename}: ${error.reason || error.message}`, location: { key: found.key, line: error.mark?.line ?? 0, column: error.mark?.column ?? 0 } };
                throw error;
            }
        };
        const renameLoadYaml = text => rewritePythonExpressions(text.replace(/\b(?:xacro\.)?load_yaml\s*\(/g, '__load_yaml__('));
        xacroContent = await readYamlOnce(renameLoadYaml(xacroContent));

        if (fileMap) {
            parser.getFileContents = async (path) => {
                return readYamlOnce(renameLoadYaml(await this.loadFileFromMap(path, fileMap, workingPath)));
            };
        }

        let urdfXML;
        try {
            urdfXML = await parser.parse(xacroContent);
        } catch (error) {
            if (!yamlError) throw error;
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
     * @returns {Promise<string>}
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
            if (file) {
                const content = await file.text();
                return content;
            }
        }

        // Try filename only match
        const fileName = cleanPath.split('/').pop();
        for (const [key, file] of fileMap.entries()) {
            const keyFileName = key.split('/').pop();
            if (keyFileName === fileName) {
                const content = await file.text();
                return content;
            }
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
        const argPattern = /<(?:xacro:)?arg\s+name=["']([^"']+)["'](?:\s+default=["']([^"']*)["'])?/g;

        let match;
        while ((match = argPattern.exec(xacroContent)) !== null) {
            const argName = match[1];
            // A default with a substitution is left to the parser, which
            // evaluates it; prefilling it here would pass "$(find x)" on verbatim.
            if (match[2] !== undefined && /\$[({]/.test(match[2])) continue;
            args[argName] = match[2] ?? 'false'; // 'false' only when no default is given
        }

        return args;
    }
}

