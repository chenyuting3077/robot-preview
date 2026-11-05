const numbers = line => line.trim().split(/[\s,;]+/).map(Number);

const isByte = value => Number.isInteger(value) && value >= 0 && value <= 255;

export function parsePointsText(text) {
    const positions = [];
    const colors = [];
    let colored = true;
    for (const line of text.split('\n')) {
        const values = numbers(line);
        if (values.length < 3 || !values.slice(0, 3).every(Number.isFinite)) continue;
        positions.push(values[0], values[1], values[2]);
        const rgb = values.slice(values.length >= 7 ? 4 : 3, values.length >= 7 ? 7 : 6);
        if (rgb.length === 3 && rgb.every(isByte)) colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
        else colored = false;
    }
    return { positions, colors: colored && colors.length ? colors : null };
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
