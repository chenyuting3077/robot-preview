/**
 * File operation utility functions
 */

/**
 * Read file content as text
 */
export function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

export const directoryOf = fileName => (fileName.includes('/') ? fileName.slice(0, fileName.lastIndexOf('/') + 1) : '');

/**
 * Normalize path
 */
export function normalizePath(path) {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

/**
 * Normalize path segments, resolving "." and ".." without touching protocol-like prefixes.
 */
export function cleanFilePath(path) {
    return normalizePath(path)
        .split('/')
        .reduce((parts, part) => {
            if (!part || part === '.') {
                return parts;
            }
            if (part === '..') {
                parts.pop();
                return parts;
            }
            parts.push(part);
            return parts;
        }, [])
        .join('/');
}

function stripBlobPath(path) {
    if (!path || !path.startsWith('blob:')) {
        return path;
    }

    const blobMatch = path.match(/^blob:[^/]+\/\/[^/]+\/(.+)$/);
    return blobMatch?.[1] || path;
}

function addCandidate(candidates, path) {
    if (!path) return;

    const withoutBlob = stripBlobPath(path);
    const normalized = normalizePath(withoutBlob);
    const cleaned = cleanFilePath(withoutBlob);

    [path, withoutBlob, normalized, cleaned].forEach(candidate => {
        if (candidate) {
            candidates.push(candidate);
        }
    });
}

function getUniqueEntryByPredicate(fileMap, predicate) {
    let matched = null;
    let matchCount = 0;

    for (const entry of fileMap.entries()) {
        if (predicate(entry[0])) {
            matched = entry;
            matchCount++;
        }
    }

    return matchCount === 1 ? matched : null;
}

function countMatchingPathTail(leftPath, rightPath, caseSensitive) {
    const normalizeSegment = caseSensitive
        ? value => value
        : value => value.toLowerCase();
    const leftParts = cleanFilePath(leftPath).split('/').filter(Boolean).map(normalizeSegment);
    const rightParts = cleanFilePath(rightPath).split('/').filter(Boolean).map(normalizeSegment);

    let matched = 0;
    while (
        matched < leftParts.length &&
        matched < rightParts.length &&
        leftParts[leftParts.length - 1 - matched] === rightParts[rightParts.length - 1 - matched]
    ) {
        matched++;
    }

    return matched;
}

function findUniqueFileByLongestPathTail(candidates, fileMap) {
    let bestPathScore = 1; // One segment is only a basename and carries no directory identity.
    let bestCaseScore = 0;
    const bestFiles = new Map();

    for (const [key, file] of fileMap.entries()) {
        let pathScore = 0;
        let caseScore = 0;
        for (const candidate of candidates) {
            pathScore = Math.max(
                pathScore,
                countMatchingPathTail(candidate, key, false)
            );
            caseScore = Math.max(
                caseScore,
                countMatchingPathTail(candidate, key, true)
            );
        }

        if (pathScore <= 1) {
            continue;
        }

        if (
            pathScore > bestPathScore ||
            (pathScore === bestPathScore && caseScore > bestCaseScore)
        ) {
            bestPathScore = pathScore;
            bestCaseScore = caseScore;
            bestFiles.clear();
            bestFiles.set(key, file);
        } else if (
            pathScore === bestPathScore &&
            caseScore === bestCaseScore &&
            pathScore > 1
        ) {
            bestFiles.set(key, file);
        }
    }

    if (bestFiles.size !== 1) return null;
    const [[key, file]] = bestFiles;
    return { key, file, exactCase: bestCaseScore === bestPathScore };
}

/**
 * Resolve a file from a path-keyed map without guessing among duplicate basenames.
 * Exact and normalized path matches are preferred; basename fallback is only used
 * when exactly one file matches.
 */
export function resolveFileFromMap(path, fileMap, options = {}) {
    return resolveFileMatch(path, fileMap, options)?.file ?? null;
}

/**
 * Like resolveFileFromMap, plus how the file was found: 'exact', 'tail' (the
 * path ends like a unique file), or the guesses 'case' (only when ignoring
 * case, which fails on Linux) and 'basename' (only the file name matched).
 */
export function resolveFileMatch(path, fileMap, options = {}) {
    if (!path || !fileMap) {
        return null;
    }

    const baseDir = options.baseDir || '';
    const candidates = [];
    const rawPath = stripBlobPath(path);

    addCandidate(candidates, rawPath);
    if (rawPath.startsWith('file://')) {
        addCandidate(candidates, rawPath.replace(/^file:\/\/(localhost)?/, ''));
    }

    // model:// names a Gazebo model directory the way package:// names a package.
    if (/^(package|model):\/\//.test(rawPath)) {
        const packagePath = rawPath.replace(/^(package|model):\/\//, '');
        addCandidate(candidates, packagePath);

        const parts = packagePath.split('/');
        if (parts.length > 1) {
            addCandidate(candidates, parts.slice(1).join('/'));
        }
    }

    const normalizedPath = normalizePath(rawPath.replace(/^(package|model):\/\//, ''));
    const normalizedParts = normalizedPath.split('/');
    if (normalizedParts.length > 1) {
        addCandidate(candidates, normalizedParts.slice(1).join('/'));
    }

    if (baseDir && normalizedPath && !normalizedPath.startsWith(baseDir)) {
        addCandidate(candidates, `${baseDir.replace(/[\\/]+$/, '')}/${normalizedPath}`);
        if (normalizedParts.length > 1) {
            addCandidate(candidates, `${baseDir.replace(/[\\/]+$/, '')}/${normalizedParts.slice(1).join('/')}`);
        }
    }

    // A literal '%' is legal in a file name, so decoded forms only follow.
    for (const candidate of [...candidates]) {
        try {
            const decoded = decodeURIComponent(candidate);
            if (decoded !== candidate) addCandidate(candidates, decoded);
        } catch {
            // Not percent-encoded.
        }
    }

    for (const candidate of candidates) {
        if (fileMap.has(candidate)) {
            return { key: candidate, file: fileMap.get(candidate), match: 'exact' };
        }
    }

    const normalizedCandidates = new Set(candidates.map(candidate => cleanFilePath(candidate)));
    const exactNormalizedMatch = getUniqueEntryByPredicate(fileMap, key => (
        normalizedCandidates.has(cleanFilePath(key))
    ));
    if (exactNormalizedMatch) {
        return { key: exactNormalizedMatch[0], file: exactNormalizedMatch[1], match: 'exact' };
    }

    const lowerCandidates = new Set(Array.from(normalizedCandidates, candidate => candidate.toLowerCase()));
    const exactCaseInsensitiveMatch = getUniqueEntryByPredicate(fileMap, key => (
        lowerCandidates.has(cleanFilePath(key).toLowerCase())
    ));
    if (exactCaseInsensitiveMatch) {
        return { key: exactCaseInsensitiveMatch[0], file: exactCaseInsensitiveMatch[1], match: 'case' };
    }

    // A dragged subtree may omit leading package directories. Preserve file
    // identity by comparing complete trailing path segments and selecting only
    // a unique best match. For example, "meshes/roban/base_link.STL" must not
    // collide with "meshes/arm/collision/base_link.stl" just because their
    // basenames are equal.
    const pathTailMatch = findUniqueFileByLongestPathTail(
        normalizedCandidates,
        fileMap
    );
    if (pathTailMatch) {
        return { key: pathTailMatch.key, file: pathTailMatch.file, match: pathTailMatch.exactCase ? 'tail' : 'case' };
    }

    const fileName = cleanFilePath(rawPath).split('/').pop()?.toLowerCase();
    if (!fileName) {
        return null;
    }

    const byName = getUniqueEntryByPredicate(fileMap, key => (
        cleanFilePath(key).split('/').pop()?.toLowerCase() === fileName
    ));
    return byName ? { key: byName[0], file: byName[1], match: 'basename' } : null;
}

/**
 * Resolve a mesh reference, recording guesses ('case', 'basename') in
 * `guessed` so the extension can warn that ROS would not find the file.
 */
export function resolveMeshFile(path, fileMap, baseDir, guessed) {
    const found = resolveFileMatch(path, fileMap, { baseDir });
    if (found && guessed && (found.match === 'case' || found.match === 'basename')) {
        guessed.push({ path, resolved: found.key, match: found.match });
    }
    return found?.file ?? null;
}

export function fileUrlModifier(fileMap, baseDir) {
    return url => {
        if (url.startsWith('blob:')) {
            const fileName = url.match(/^blob:[^/]+\/\/[^/]+\/(.+)$/)?.[1];
            if (!fileName || !/\.(jpe?g|png|gif|bmp|tga|tiff|webp|dae|stl|obj|gltf|glb|bin)$/i.test(fileName)) return url;
            url = fileName;
        }
        let path = url;
        if (/^https?:\/\//.test(path)) {
            try {
                path = new URL(path).pathname.replace(/^\//, '');
            } catch {
                path = url;
            }
        }
        const file = resolveFileFromMap(path, fileMap, { baseDir });
        return file ? URL.createObjectURL(file) : url;
    };
}
