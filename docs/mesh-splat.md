# Robot Preview: Mesh & Splat

Load times and memory are measured in VS Code 1.144 with `tests/e2e/vscode.mjs` (2026-11-17, old and new builds interleaved in one session) unless marked otherwise. Pitfalls met along the way: issues #1, #2, #4.

## Splats: Spark

- Spark, not PlayCanvas: PlayCanvas rendered nothing under ANGLE's Vulkan backend, and Spark is three.js, so meshes and splats share one scene.
- Spark is 2.4 MB of inlined WASM and loads only when a splat opens. 881 k splats show in 2.1–2.2 s and orbit at the 60 fps vsync limit, as with 0.2.0 (2.0–2.1 s); 243 k splats in 1.3–1.4 s.
- Spark needs three ≥ 0.180 while the URDF viewer is on 0.163, so this package keeps its own `node_modules`.
- 2DGS PLY has no `scale_2`; one of `ln(1e-6)` is added so Spark draws each disc as a flat Gaussian (binary little-endian only).

## Defaults

- Files that declare no up axis start at `+Z`, as in ROS; raw COLMAP / 3DGS splats need `-Y` by hand.
- The camera frames the 2nd–98th percentile of splat centres, so floaters don't shrink the view.
- `.asc` and `.usda` are optional editors (PGP signatures, hand-edited text). `retainContextWhenHidden` is on: re-reading a 200 MB splat on a tab switch takes seconds.

## Large point clouds

- VS Code reads a fetched webview resource whole before handing it over: a 1.2 GB PCD grew the webview by 1.6 GB with the viewer keeping one point. PCD (binary, ASCII and `binary_compressed`) is therefore read by the extension in 16 MB pieces, three in flight (one at a time: 17 s against 7.6 s). `binary_compressed` stores columns, so it is inflated whole before its points are read. A 7.1M-point map against PCDLoader: ASCII 238 MB 3.8–4.1 s, +1.1–1.2 GB against 4.4–5.7 s, +2.4–2.5 GB; `binary_compressed` 84 MB 2.1 s, +0.9 GB against 2.4–3.0 s, +1.4–1.7 GB.
- Past 10M points an even 10M are shown, and the info popover says so. "Load detail in view" (Display menu) reads the file again for the points in the camera's view, up to 10M more, instead of a Potree-style octree, which would follow the camera but needs a converted copy of the file. Livox map zoomed in: 4.5 s, +0.6 GB (2 runs). The intensity / height range stays the one of the loaded sample, so the detail does not recolor the rest.
- 1.2 GB, 38.9M-point Livox map: 5.0–5.3 s, +1.2–1.5 GB, 21 fps orbiting (7 runs); 0.2.0 cannot open it. 181 MB, 4.5M-face binary PLY mesh: 1.8 s, +1.05 GB; 0.2.0 went past 6 GB.

## USD

- three 0.187's `USDLoader` reads USDA / USDC / USDZ. `@needle-tools/usd` is non-commercial; TinyUSDZ 0.9.1 failed all five test files.
- Composition (references, payloads, sublayers, variants) is done here, not by three: three stacked a whole H1 humanoid on every link (10.6 M faces instead of 0.39 M). Its crate-reader fixes override private methods, so three is pinned to an exact version.
- MDL is not run: OmniPBR shaders (every sampled Isaac Sim robot) map their diffuse colour / texture, metallic, roughness, emission and opacity onto three's physical material.
- Legacy NuRec volumes (`omni:nurec:isNuRecVolume`, a gzipped MessagePack `.nurec` of float16 3DGUT tensors) are copied into a 3DGS PLY as stored: their logit density, log scale, w-first rotation and SH are already PLY's parameters.
- Prim types that are not drawn (physics joints, unknown schemas) are listed under *Not shown* in the info popover; `metersPerUnit` is shown as *Unit*.
- Real-file tests: `tests/fixtures/usd/usd-wg` (committed) and `npm run fixtures:usd` (Isaac Sim robots and NuRec scenes into `test-files/usd/`, `HF_TOKEN` for NuRec), both read by `tests/mesh-splat/usd-fixtures.test.mjs`.
- Not supported: MaterialX and MDL shaders other than OmniPBR, PointInstancer, `specializes`, `inherits`, time-sampled visibility, `!resetXformStack!`, `omniverse://` paths.

## STEP

foxtrot (Rust, patched) tessellates; OpenCascade (`occt-import-js`, rebuilt at `-O3`) runs only when the length unit is ambiguous or foxtrot fails. Time to the first frame and growth of all processes:

| File | OpenCascade | foxtrot, first open | foxtrot, cached |
|---|---|---|---|
| Respeaker, 2.7 MB | 3.0 s, +0.76 GB | 1.1–1.3 s, +0.47–0.49 GB | 0.9–1.0 s, +0.43–0.50 GB |
| 719E, 18 MB | 7.3 s, +1.09 GB | 1.7–1.8 s, +0.73–0.91 GB | 0.9 s, +0.44 GB |
| EEP500T, 30 MB | 18.1 s, +2.46 GB | 2.4–2.5 s, +1.18 GB | 1.3 s, +0.64 GB |
| AMR, 39 MB | 59.3 s, +2.78 GB | 3.0–3.3 s, +1.07–1.18 GB | 1.2 s, +0.61–0.63 GB |
| Assembly, 161 MB | no triangles after 116 s | 16.3–17.1 s, +1.84–1.90 GB | 1.3–1.4 s, +0.67–0.72 GB |

- Upstream foxtrot leaves faces as holes (Respeaker 3, 719E 6, EEP500T 20, AMR 117 of 18,255); the patched one leaves 2 of the AMR's. A bound that crosses itself once lowered to 2D is triangulated without constraints and kept by the even-odd rule; closed B-splines, trimmed curves, swept circles and a non-converging UV search are handled. The Respeaker's surface area is 99.7% of OpenCascade's, against 70% upstream. The extra triangles cost the 161 MB file 15.9–17.2 s against 13.9–14.2 s and the AMR 3.0–3.3 s against 2.9–3.1 s; the others are unchanged (3 runs each, interleaved).
- OpenCascade is rebuilt at `-O3` (12.1 MB of WASM against 7.6 MB) from the shipped `-Oz`: the AMR in 55–59 s against 80–82 s, EEP500T in 17.8 s against 20.1–20.2 s, with the same faces.
- foxtrot runs up to 4 workers, each parsing the whole file, fewer for big files so their memory stays under 1.5 GB. One worker against that: EEP500T 3.9–4.0 s against 2.4 s, the AMR 5.9–6.0 s against 2.9–3.1 s, the 161 MB file 24.1–24.2 s against 14.0–14.1 s for 0.2–0.3 GB less memory.
- Memory peaks the second before the first frame, while every worker is alive, and WASM memory never shrinks. So each worker packs a solid into f32 and drops the entities it parsed for it as soon as the solid is built, instead of holding the whole model in f64 vertices (72 bytes each) and every entity until the end; and it grows its output in 1 MB blocks copied straight into JS arrays, instead of Vecs that double and leave their old space behind. The 161 MB first open grows the webview by 1.23–1.28 GB and all processes by 1.84–1.90 GB; without the blocks the webview grows by 1.31–1.41 GB, and without either change by 1.55–1.58 GB (all processes 2.17–2.29 GB); about 0.5 GB of the total is VS Code's own processes growing in their first 1.2 s, before the file is read (one run). The AMR's webview grows by 0.67–0.69 GB against 0.93–1.02 GB. Same speed (3 runs each, interleaved).
- Each editor writes the cache to its own `.part` and renames it into place, so two editors of one file opened at once (`SPLIT=1` in `tests/e2e/vscode.mjs`) leave one cache file and no `.part`, which the next open reads (AMR: 1.4 s, 2 runs).
- The cache is meshopt buffers, not glTF: 25.6 MB against 139 MB as GLB for the 161 MB assembly, and glTF's meshopt extension would have meant writing its accessors by hand for no reader but ours.
- truck (`truck-stepio` 0.3.0) is no replacement: it drops assembly placements, and was slower than foxtrot and ran out of memory on the 161 MB file outside VS Code.
- STEP has no up axis; it starts `+Y` because the AMR (Autodesk) is Y-up.
- foxtrot's WASM is built with unwinding (nightly `-Zbuild-std`, `vendor/build.sh`), so a panic skips its face; stable Rust's WASM std only aborts, which loses the whole file to OpenCascade.

## Not supported

E57, PTX, NXS, X3D and other MeshLab-only formats, Draco / Meshopt compressed glTF, ASCII 2DGS PLY.
