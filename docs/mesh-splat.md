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
- `customEditors` selectors list only lowercase patterns: VS Code matches them case-insensitively (`foo.STL` opens fine), and listing both `*.stl` and `*.STL` makes it report two default editors for the same file.
- `retainContextWhenHidden` is on: re-reading a 200 MB splat on every tab switch takes seconds.

## Camera controls

The camera key handling creates vectors only by cloning the camera's own, so one copy runs on three 0.163 (URDF) and 0.180 (Spark) alike.

- Middle-drag pans (RViz, Unity, Fusion 360) instead of OrbitControls' default dolly; the wheel already zooms.
- `W` `S` move along the view direction (Unity / Unreal fly mode) rather than SuperSplat's level forward, `A` `D` strafe level, and `Q` `E` turn in place around the camera's own up axis (perpendicular to the view, so a tilted view sweeps sideways on screen) instead of moving down / up, at the user's request. Speed scales with the distance to the pivot so small parts and room scans feel the same.
- Damping is off in both, matching the original URDF viewer.

## Not supported

E57, PTX, NXS, X3D and other MeshLab-only formats, Draco / Meshopt compressed glTF, ASCII 2DGS PLY.
