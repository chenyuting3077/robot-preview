const numbers = line => line.trim().split(/[\s,;]+/).map(Number);

export function parsePointsText(text) {
    const positions = [];
    for (const line of text.split('\n')) {
        const values = numbers(line);
        if (values.length >= 3 && values.slice(0, 3).every(Number.isFinite)) positions.push(values[0], values[1], values[2]);
    }
    return positions;
}

export function parseOff(text) {
    const lines = text.split('\n').map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
    const first = lines.shift().replace(/^[A-Z]*OFF/, '').trim();
    const [vertexCount, faceCount] = numbers(first || lines.shift());
    const positions = lines.slice(0, vertexCount).flatMap(line => numbers(line).slice(0, 3));
    const indices = [];
    for (const line of lines.slice(vertexCount, vertexCount + faceCount)) {
        const [n, ...rest] = numbers(line);
        for (let k = 1; k < n - 1; k++) indices.push(rest[0], rest[k], rest[k + 1]);
    }
    return { positions, indices };
}
