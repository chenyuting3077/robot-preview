// Downloads real-world USD files into test-files/usd/ (gitignored) for tests/mesh-splat/usd-fixtures.test.mjs.
// Isaac assets: NVIDIA Isaac Sim Additional Software and Materials License, so they are fetched rather than committed.
// NuRec scenes: CC-BY-4.0 but gated on Hugging Face; accept the terms at
// https://huggingface.co/datasets/nvidia/PhysicalAI-Robotics-NuRec and set HF_TOKEN, or they are skipped.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLayer } from '../packages/mesh-splat/webview/usd.mjs';

const OUT = fileURLToPath(new URL('../test-files/usd/', import.meta.url));
const ISAAC = 'https://omniverse-content-production.s3-us-west-2.amazonaws.com/Assets/Isaac/';
const NUREC = 'https://huggingface.co/datasets/nvidia/PhysicalAI-Robotics-NuRec/resolve/main/';

const SOURCES = [
    { name: 'isaac', base: ISAAC, crawl: true, files: [
        '4.5/Isaac/Robots/Franka/franka.usd',
        '5.1/Isaac/IsaacLab/Robots/FrankaEmika/panda_instanceable.usd',
        '5.1/Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd',
        '5.1/Isaac/Robots/Unitree/G1/g1.usd'
    ] },
    { name: 'nurec', base: NUREC, gated: true, files: [
        'zh_lounge/usd/zh_lounge.usda',
        'zh_lounge/usd/gauss.usda',
        'zh_lounge/usd/export_last.nurec',
        'xgrid-wormhole/stage_particle.usd',
        'xgrid-wormhole/stage_particle_with_sim_objects.usd',
        'xgrid-wormhole/wormhole.usdz'
    ] }
];

const LAYER = /\.usd[ac]?$/i;
const ASSET = /\.(usd[acz]?|png|jpe?g|exr|hdr)$/i;

// Every asset path a layer mentions: arcs, sublayers, variant arcs and asset-valued attributes.
function assetPaths(specs) {
    const found = new Set();
    const visit = value => {
        if (typeof value === 'string') {
            for (const [, asset] of value.matchAll(/@([^@]+)@/g)) found.add(asset);
            if (ASSET.test(value)) found.add(value);
        } else if (Array.isArray(value)) {
            if (value.length < 10000) value.forEach(visit);
        } else if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
            if (typeof value.assetPath === 'string') found.add(value.assetPath);
            Object.values(value).forEach(visit);
        }
    };
    for (const spec of Object.values(specs)) visit(spec.fields);
    return [...found].filter(asset => asset && !/^[a-z]+:/i.test(asset));
}

async function download(url, file, token) {
    try {
        const { size } = await fs.stat(file);
        if (size > 0) return fs.readFile(file);
    } catch {}
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    console.log(`  ${(bytes.length / 1e6).toFixed(1).padStart(7)} MB  ${url}`);
    return bytes;
}

const token = process.env.HF_TOKEN;

for (const { name, base, crawl, gated, files } of SOURCES) {
    if (gated && !token) {
        console.log(`${name}: skipped, set HF_TOKEN after accepting the dataset terms`);
        continue;
    }
    console.log(`${name}:`);
    const queue = files.map(file => new URL(file, base).href);
    const seen = new Set();
    while (queue.length) {
        const url = queue.shift();
        if (seen.has(url)) continue;
        seen.add(url);
        const file = path.join(OUT, name, decodeURIComponent(url.slice(base.length)));
        let bytes;
        try {
            bytes = await download(url, file, gated ? token : undefined);
        } catch (error) {
            console.log(`  missing  ${error.message}`);
            continue;
        }
        if (!crawl || !LAYER.test(url)) continue;
        for (const asset of assetPaths(parseLayer(new Uint8Array(bytes)).specsByPath)) queue.push(new URL(asset, url).href);
    }
}
