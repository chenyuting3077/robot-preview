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

- Splats start with `-Y` up (COLMAP / 3DGS convention), meshes with `+Y` (glTF / OBJ).
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

## Not supported

E57, PTX, NXS, X3D and other MeshLab-only formats, Draco / Meshopt compressed glTF, ASCII 2DGS PLY.
