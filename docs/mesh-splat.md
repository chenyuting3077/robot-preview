# Robot Preview: Mesh & Splat

## Why Spark instead of PlayCanvas / supersplat-viewer

Measured 2026-11-05 on an RTX PRO 1000 Blackwell Laptop GPU, headless Chrome, 1280×720, same camera orbit for 8 s, 3 runs each:

| File | Spark load / FPS | PlayCanvas 2.23 load / FPS |
|---|---|---|
| 3DGS, 881,110 splats | 1.1–1.3 s / 330–380 | 1.3–1.4 s / 390–400 |
| 3DGS, 240,709 splats | 0.37 s / 570–620 | 0.50–0.57 s / 600–620 |

- Both are far above 60 FPS; vsync was off, so the numbers say "fast enough", not which is faster. Image quality at the same view was indistinguishable.
- PlayCanvas rendered nothing under ANGLE's Vulkan backend (`FRAMEBUFFER_UNSUPPORTED` on `GsplatWorkBuffer`, no visible error); it only worked with `--use-angle=gl`. Spark worked on both.
- Spark is three.js, so meshes and splats share one scene, camera and loader set with the URDF & MJCF extension.
- Spark needs three ≥ 0.180 while the URDF viewer is on 0.163, so this package keeps its own `node_modules` instead of sharing code with the root.

## 2DGS files

2DGS PLY files store only `scale_0` and `scale_1`; Spark throws `Missing scale_2 property` and PlayCanvas crashes. On load a `scale_2 = ln(1e-6)` is inserted per splat (binary little-endian PLY only), turning each disc into a flat 3D Gaussian. Edge-on views differ slightly from the 2DGS ray–splat intersection renderer (推測; compare a grazing-angle screenshot against the official 2DGS viewer to confirm).

## Defaults

- The up menu starts at the file's declared up axis (glTF / VRML `+Y`, DAE `<up_axis>`, USD `upAxis`); three's rotation of Z-up DAE / USD to Y-up is undone so the menu shows `+Z` for them. Everything that declares none, STL / OBJ / PLY / point clouds / splats and DAE / USD without the field, starts at `+Z` as in ROS, at the user's request. Raw COLMAP / 3DGS splats need `-Y` by hand.
- The camera frames the 2nd–98th percentile of splat centres so floaters far from the scene do not shrink it.
- `.asc` is an optional editor because the extension is also used by PGP signatures.
- The URDF & MJCF extension's mesh editor became optional in 0.2.0 so the two extensions do not both claim `.stl` / `.dae` / `.obj`.
- `.xyz` / `.pts` columns after x y z are read as colors only when every point has integer 0–255 RGB; `x y z nx ny nz` normals would otherwise turn into colors.
- `customEditors` selectors list only lowercase patterns: VS Code matches them case-insensitively (`foo.STL` opens fine), and listing both `*.stl` and `*.STL` makes it report two default editors for the same file.
- `retainContextWhenHidden` is on: re-reading a 200 MB splat on every tab switch takes seconds.

## Camera controls

The camera key handling creates vectors only by cloning the camera's own, so one copy runs on three 0.163 (URDF) and 0.187 (Spark, USD) alike.

- Middle-drag pans (RViz, Unity, Fusion 360) instead of OrbitControls' default dolly; the wheel already zooms.
- `W` `S` move along the view direction (Unity / Unreal fly mode) rather than SuperSplat's level forward, `A` `D` strafe level, and `Q` `E` turn in place around the camera's own up axis (perpendicular to the view, so a tilted view sweeps sideways on screen) instead of moving down / up, at the user's request. Speed scales with the distance to the pivot so small parts and room scans feel the same.
- Damping is off in both, matching the original URDF viewer.

## USD

- Parser: three.js 0.187's pure-JS `USDLoader` reads USDA, USDC and USDZ (three ≤ 0.180 only had a USDC stub, hence the upgrade). Rejected: `@needle-tools/usd` (PolyForm Noncommercial license). TinyUSDZ 0.9.1 (WASM, has its own composition) failed all five test files in headless Chrome: `PMS_0526.usdc` "Invalid Prim name", the Isaac Sim export "connection ... got `outputs:a`" on a UsdPreviewSurface, and the OpenChessSet / Teapot / Mini Car Kit compositions from [usd-wg/assets](https://github.com/usd-wg/assets) failed to resolve their layers.
- three's own composition is not used: it put every root prim of a referenced layer under the referencing prim and matched `</a/b>` by the last name only, which stacked a whole H1 humanoid on every link (10.6 M faces instead of 0.39 M). References, payloads, sublayers and variants are flattened first and three only builds objects.
- three 0.187 crate reader bugs found on the Isaac Sim 5.0 robot assets: `ReferenceListOp`, `PayloadListOp`, `Payload` and `StringVector` (sublayers) were not decoded at all; inlined `double3` / `half3` vectors such as `xformOp:scale = (1, 1, 1)` came out as the integer 65793; and paths were decoded with the total path count instead of the encoded one, which scrambled every path once the two counts needed different code-table lengths (Franka's `panda_link3.usd`, `h1.usd`). The USDA parser reads only `prepend references` / `payload`, no `subLayers`, no `over` / `class`. The fixes override private methods, so three stays pinned to an exact version.
- three's composer applied only exactly named xformOps, so suffixed ops such as Isaac Sim's `xformOp:rotateX:unitsResolve` and rotation orders other than XYZ were silently dropped; `applyTransform` is replaced. `!resetXformStack!` is not supported (the prim still inherits its parent's transform).
- Some crate prim specs carry no `specifier` (Franka's `over` prims for the unselected Robotiq gripper); a prim without one counts as defined only if something under it has a type.
- `purpose = "guide"` prims (Isaac Sim's collision shapes) start hidden, as in usdview, and can be shown from the Stage panel.
- Load time in Node (parse + composition + three's composer, no GPU upload), and frame rate / heap after `gc()` in headless Chrome on an Intel Arrow Lake iGPU through ANGLE GL (`PERF=1 ANGLE=gl` in the e2e test; headless adds ~3 s of GPU start-up to every page):

  | File | Faces | Load | three composer | FPS | Heap |
  |---|---|---|---|---|---|
  | Franka (14 files) | 94 k | 0.12 s | 0.09 s | 60 | — |
  | Unitree H1 (4 files) | 0.39 M | 0.27 s | 0.19 s | 60 | — |
  | UR10e (3 files) | 1.6 M | 1.0 s | 0.81 s | 60 | 314 MB |
  | Isaac Sim 3DGS export, 141 MB | 2.3 M + 375 k splats | 1.3 s | 0.82 s | 58 | 534 MB |
  | Simple_Warehouse (1848 files) | 0.52 M, 14.5 k objects | 2.0 s | 0.87 s | 52 | 190 MB |

  The heap is mostly the geometry arrays three keeps for raycasting and point mode (推測; confirm with a DevTools heap snapshot of the webview). Looking up a reference's subtree in a sorted key list instead of scanning every spec took the warehouse from 2.3 s to 2.0 s; the rest is spread over crate parsing, GC and three's composer, so nothing more was optimized.
- `ParticleField3DGaussianSplat` is not known to three; its attributes are rewritten as an in-memory 3DGS PLY and handed to Spark, which has no public API for SH coefficients, so view-dependent color survives. Without SH coefficients the color comes from `primvars:displayColor`.
- `.usda` is an optional editor: it is text people edit.
- Files that fail to load or parse are listed as "Not loaded" in the info popover instead of failing the whole stage. three's USDA parser throws on some files (`StandardShaderBall`'s `shaderball.usda`: "Cannot set properties of undefined").
- Checked on Isaac Sim 5.0 assets (Franka, UR10e, Unitree Go2 and H1, TurtleBot3, ANYmal D): all render with correct link poses. TurtleBot3's file carries a 50 m ground plane, which sets the initial framing; hide it in the Stage panel.
- "Stage" stays untranslated in zh-TW / zh-CN, as in Omniverse, so it is not confused with a generic 3D scene.
- Not supported: USDA `variantSet` blocks (the Teapot's geometry lives in one), MaterialX and MDL materials (geometry renders in the default gray), PointInstancer, `specializes`, `inherits` and time-sampled visibility.

## Large point clouds

VS Code hands a webview a fetched resource only after reading all of it into memory: a 1.2 GB binary PCD (Livox Mid-360 + FAST-LIO2 map, 38.9M points) grew the webview by 1.6 GB even when the viewer kept a single point. Binary PCD is therefore read by the extension and posted in 16 MB pieces, three in flight; one at a time took 17 s instead of 7.6 s. ASCII and `binary_compressed` PCD still go through PCDLoader with the whole file.

Past 10M points an evenly spaced 10M are shown, and the info popover says how many of the total; zooming in never shows the dropped points. A Potree-style octree would, at the cost of a converter and a second viewer.

In VS Code 1.144 that file opened in 18.8 s, orbited at 5 fps and grew all processes by 4.3 GB; now 7.5-7.8 s, 19-23 fps, +1.6-1.7 GB.

## Not supported

E57, PTX, NXS, X3D and other MeshLab-only formats, Draco / Meshopt compressed glTF, ASCII 2DGS PLY.

## STEP

STEP is B-rep, so a CAD kernel has to tessellate it. Times to open in headless Chrome, 2026-11-16, Intel Arrow Lake, first open (no cache):

| File | OpenCascade 7.6.1 `-Oz` (occt-import-js 0.0.23) | foxtrot, first view | Cached GLB |
|---|---|---|---|
| Respeaker board, 2.7 MB, 1,468 faces | 1.9–2.9 s | 0.4 s | 0.3–1.2 s |
| EEP500T, 30 MB, 15,362 faces | 21.9–23.5 s | 3.4 s | 0.4–0.9 s |
| AMR assembly, 39 MB, 18,315 faces | 90.5–111.8 s | 7.5 s | 0.7–2.3 s |

- OpenCascade's time is in reading and transferring the STEP model, not tessellation: a 10x coarser deflection cut the AMR triangles by 47% and the time by nothing (145 vs 151 s in Node). The CPU profile has no hot spot to fix from JS.
- occt-import-js ships `-Oz`. Rebuilding the same source with CMake's Release `-O3` (`patches/occt-import-js.patch`) took the AMR from 131–148 s to 72 s in Node with identical triangles; the WASM grows from 7.6 to 12.1 MB.
- foxtrot (Rust, unmaintained since 2021) parses and triangulates without building a B-rep model. Unpatched it skipped 3.5% of the AMR's faces and 12% of the Respeaker's: extrusion and revolution surfaces were missing, and its curve projection used a fixed 0.01 tolerance and an unbounded Newton loop, which reordered points on sub-millimetre arcs. `patches/foxtrot.patch` adds both surfaces, a size-relative tolerance with a ternary-search fallback, per-face colors (`OVER_RIDING_STYLED_ITEM`) and an indexed mesh API. It still skips 0.2–0.6% of faces (closed B-spline edges, `TRIMMED_CURVE`, triangulation errors on spheres / tori), and makes about 4.5x OpenCascade's triangles.
- So foxtrot's mesh is final, holes included (2026-11-17, native foxtrot: AMR 117 of 18,255 faces skipped, EEP500T 20 of 14,919, Respeaker 3 of 1,468). OpenCascade `-O3` runs only when the length unit is not a single assigned one or foxtrot aborts. Refining every file with holes in the background cost 1–2 minutes of CPU per open for under 1% of faces.
- foxtrot aborts on a Rust panic: WASM has no unwinding, so its `catch_unwind` around each face only works natively, and each job gets a fresh worker. The patch turns the panics we hit outside triangulation into skips (an omitted `ref_direction` defaulted to +X even for an X axis, giving a singular frame; unknown shape representations), and the `cdt` asserts a 161 MB assembly hit while inserting nearly collinear points into an error, so those 5 faces are skipped. That file now opens in 24 s (cached 2.9 s); through OpenCascade it had not finished after 32 minutes.
- foxtrot keeps file units; the unit comes from the `LENGTH_UNIT` a `GLOBAL_UNIT_ASSIGNED_CONTEXT` names, because SolidWorks also declares an unused metre next to the millimetre it uses.
- STEP has no up axis. The AMR (Autodesk export) is Y-up with its floor at y = 0, so STEP starts `+Y`; flat boards exported Z-up need `+Z` from the menu.
- Embind builds call wrappers with `new Function`, which the webview CSP blocks; `vite.config.js` replaces them at build time. wasm-bindgen's glue needs no eval.
- foxtrot runs in up to 4 workers that each parse the whole file and triangulate every 4th face (splitting by solid left one AMR worker with most of the time). Node, 2026-11-17: AMR 5.0 s with one worker, 2.2 s with four; EEP500T 2.9 -> 1.5 s; the 161 MB assembly 21 -> 13.5 s with two. Each extra worker costs a parse, about 8x the file size before the fixes below, so the worker count drops with file size to keep that under 1.5 GB.
- WASM memory never shrinks, so the patch frees the input once flattened, writes entities straight into their slots instead of collecting a second copy, and drops the parsed file before packing the mesh. It also boxes the 175 `Entity` variants over 48 bytes (addresses, B-spline surfaces): the enum went from 272 to 56 bytes, and the 161 MB file's 1.93 M entities are mostly 1.08 M `CARTESIAN_POINT`s, so the boxes add 14 MB. Per worker, 161 MB file split in two: 1224 -> 640 MB.
- The cached GLB goes to the extension in 16 MB pieces, each acknowledged before the next, and is written with Node `fs`: as one message the extension host, the main process and a second renderer each grew by 0.2-0.9 GB while it passed through. Posting an `ArrayBuffer` instead of a `Uint8Array` alone did not change that.
- In VS Code 1.144 (2026-11-17, `tests/e2e/vscode.mjs`), first open / cached open, and growth of the webview process / all processes on first open: Respeaker 0.9 / 0.6 s, EEP500T 2.5 / 1.5 s, AMR 2.9-3.1 / 1.3 s (+1.0-1.1 / +1.65-1.74 GB; before the memory work +1.6 / +2.6 GB), the 161 MB assembly 13.6 / 1.9 s (+2.1 / +2.85 GB; before +2.8 / +4.8 GB). One worker instead of two for that file: 23 s and +1.7 GB in the webview, the same total.
- The cache stores foxtrot's mesh with one material per face color instead of per-vertex colors: AMR 85 MB, EEP500T 111 MB (114 and 149 MB with vertex colors). Its file name carries the extension version, so a tessellation fix drops old entries, and the folder is trimmed oldest-first to 1 GB.
- Timing a cached open right after a multi-million-triangle page measures that page's teardown: the Respeaker took 1.9–4.1 s there and 0.2 s alone.
- `vendor/build.sh` rebuilds both WASMs from pinned commits.
