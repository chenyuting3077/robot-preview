import { referenceOf } from './distance.mjs';

let reference = null;
const PROGRESS_EVERY = 250_000;

self.onmessage = ({ data }) => {
    try {
        if (data.type === 'reference') {
            reference = referenceOf(data.parts);
            self.postMessage({ type: 'ready' });
            return;
        }
        const total = data.parts.reduce((n, part) => n + part.positions.length / 3, 0);
        let done = 0;
        const values = data.parts.map(({ positions, matrix }) => {
            const out = new Float32Array(positions.length / 3);
            for (let at = 0; at < out.length; at += PROGRESS_EVERY) {
                const end = Math.min(out.length, at + PROGRESS_EVERY);
                reference.distances(positions.subarray(at * 3, end * 3), matrix, out.subarray(at, end));
                done += end - at;
                self.postMessage({ type: 'progress', job: data.job, done, total });
            }
            return out;
        });
        self.postMessage({ type: 'distances', job: data.job, values }, values.map(value => value.buffer));
    } catch (error) {
        self.postMessage({ type: 'error', job: data.job, message: error?.message ?? String(error) });
    }
};
