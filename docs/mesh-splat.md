# Robot Preview: Mesh & Splat

Load times and memory are measured in VS Code 1.144 with `tests/e2e/vscode.mjs` (2026-11-17, old and new builds interleaved in one session) unless marked otherwise. Pitfalls met along the way: issues #1, #2, #4.

## Splats: Spark

- Spark, not PlayCanvas: PlayCanvas rendered nothing under ANGLE's Vulkan backend, and Spark is three.js, so meshes and splats share one scene. Both stay far above 60 FPS (headless Chrome, RTX PRO 1000, 881 k splats: Spark 330–380, PlayCanvas 390–400).
- Spark needs three ≥ 0.180 while the URDF viewer is on 0.163, so this package keeps its own `node_modules`.
- 2DGS PLY has no `scale_2`; one of `ln(1e-6)` is added so Spark draws each disc as a flat Gaussian (binary little-endian only).

## Defaults

- Files that declare no up axis start at `+Z`, as in ROS; raw COLMAP / 3DGS splats need `-Y` by hand.
- The camera frames the 2nd–98th percentile of splat centres, so floaters don't shrink the view.
- `.asc` and `.usda` are optional editors (PGP signatures, hand-edited text). `retainContextWhenHidden` is on: re-reading a 200 MB splat on a tab switch takes seconds.

## Large point clouds

- VS Code reads a fetched webview resource whole before handing it over: a 1.2 GB PCD grew the webview by 1.6 GB with the viewer keeping one point. Binary PCD is therefore read by the extension in 16 MB pieces, three in flight (one at a time: 17 s against 7.6 s).
- Past 10M points an even 10M are shown, and the info popover says so. Not a LOD: zooming in never shows the dropped points.
- 1.2 GB, 38.9M-point Livox map: 5.0–5.3 s, +1.2–1.5 GB, 21 fps orbiting (7 runs); 0.2.0 cannot open it. 181 MB, 4.5M-face binary PLY mesh: 1.8 s, +1.05 GB; 0.2.0 went past 6 GB.

## USD

- three 0.187's `USDLoader` reads USDA / USDC / USDZ. `@needle-tools/usd` is non-commercial; TinyUSDZ 0.9.1 failed all five test files.
- Composition (references, payloads, sublayers, variants) is done here, not by three: three stacked a whole H1 humanoid on every link (10.6 M faces instead of 0.39 M). Its crate-reader fixes override private methods, so three is pinned to an exact version.
- Not supported: USDA `variantSet` blocks, MaterialX / MDL materials, PointInstancer, `specializes`, `inherits`, time-sampled visibility, `!resetXformStack!`.

## STEP

foxtrot (Rust, patched) tessellates; OpenCascade (`occt-import-js`, rebuilt at `-O3`) runs only when the length unit is ambiguous or foxtrot aborts. Time to the first frame and growth of all processes:

| File | OpenCascade | foxtrot, first open | foxtrot, cached |
|---|---|---|---|
| Respeaker, 2.7 MB | 3.0 s, +0.76 GB | 1.0–1.2 s, +0.50 GB | 0.9–1.0 s, +0.43–0.50 GB |
| 719E, 18 MB | 7.3 s, +1.09 GB | 1.6 s, +0.71–0.74 GB | 0.9 s, +0.44 GB |
| EEP500T, 30 MB | 18.1 s, +2.46 GB | 2.4–2.5 s, +1.26–1.28 GB | 1.3 s, +0.64 GB |
| AMR, 39 MB | 59.3 s, +2.78 GB | 3.0–3.1 s, +1.45–1.48 GB | 1.2 s, +0.61–0.63 GB |
| Assembly, 161 MB | no triangles after 116 s | 13.7–15.1 s, +2.15–2.20 GB | 1.3–1.4 s, +0.67–0.72 GB |

- foxtrot leaves under 1% of faces as holes (native: AMR 117 of 18,255 faces). Filling them would mean an OpenCascade run (table) on every open, so the holes stay.
- OpenCascade is rebuilt at `-O3` (12.1 MB of WASM against 7.6 MB) from the shipped `-Oz`: the AMR in 55–59 s against 80–82 s, EEP500T in 17.8 s against 20.1–20.2 s, with the same faces.
- foxtrot runs up to 4 workers, each parsing the whole file, fewer for big files so their memory stays under 1.5 GB. One worker against that: EEP500T 3.9–4.0 s against 2.4 s, the AMR 5.9–6.0 s against 2.9–3.1 s, the 161 MB file 24.1–24.2 s against 14.0–14.1 s for 0.2–0.3 GB less memory.
- Memory peaks the second before the first frame, while every worker is alive, and WASM memory never shrinks: the 161 MB first open grows the webview by 1.56–1.69 GB, against the 1.5 GB aimed for.
- The cache is meshopt buffers, not glTF: 25.6 MB against 139 MB as GLB for the 161 MB assembly, and glTF's meshopt extension would have meant writing its accessors by hand for no reader but ours.
- truck (`truck-stepio` 0.3.0) is no replacement: EEP500T took 8.7 s native against foxtrot's 2.9 s in one WASM worker (Node), the 161 MB file went past 6 GB, and it drops assembly placements.
- STEP has no up axis; it starts `+Y` because the AMR (Autodesk) is Y-up.
- Panics foxtrot still has abort the whole file: issue #3.

## Not supported

E57, PTX, NXS, X3D and other MeshLab-only formats, Draco / Meshopt compressed glTF, ASCII 2DGS PLY, ASCII or `binary_compressed` PCD of a few hundred MB.
