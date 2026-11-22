# Robot Preview: Point Cloud & Splat Viewer

Open point clouds and LiDAR scans, Gaussian splats, ROS maps, STEP and IGES CAD models and meshes in VS Code as a 3D view, including the large files other viewers give up on.

![preview](images/preview.png)

## Highlights

- **Large point clouds**: a 1.2 GB, 39M-point PCD opens in about 5 s and orbits at 21 fps. Past 10M points, *Load detail in view* (Display menu) reads more points where the camera looks.
- **Fast STEP**: a 39 MB assembly opens in about 3 s and a 161 MB one in about 16 s; unchanged files reopen from cache in about 1 s.
- **3DGS and 2DGS**: 2D Gaussian splatting PLY renders as flat discs, and 881k splats show in about 2 s at 60 fps.
- **Large meshes**: a 181 MB, 4.5M-face binary PLY opens in about 2 s.

Times are measured in VS Code 1.144; see the [design notes](https://github.com/chenyuting3077/robot-preview/blob/HEAD/docs/mesh-splat.md).

## Formats

- Meshes: `.stl` `.ply` `.off` `.glb` (including Draco and meshopt compression) `.3mf` `.3ds`, and text formats `.obj` (+ `.mtl`) `.gltf` `.dae` `.wrl` from the editor title's *Open 3D Preview* button (*Reopen Editor With… → Configure default editor* makes the view their default)
- CAD: `.stp` `.step` with part and face colors, `.igs` `.iges`
- Point clouds: `.ply` `.pcd` (binary, ASCII, `binary_compressed`) `.pts`, and `.xyz` `.asc` and KITTI / nuScenes LiDAR `.bin` from the editor title's *Open as Point Cloud* button
- Gaussian splats: 3DGS / 2DGS `.ply`, `.splat` `.ksplat` `.spz` `.sog`
- [ROS occupancy grid maps](https://github.com/chenyuting3077/robot-preview/blob/HEAD/docs/mesh-splat.md#occupancy-grid-maps): `.pgm`, and `.yaml` `.yml` through *Reopen Editor With…*

## Viewing

- Solid, wireframe and point display, point size, up-axis selection, and vertex / face / splat counts.
- Color point clouds by their original color, height, intensity or any other PLY property (confidence, curvature, ...), with a legend.
- Grid, axes and bounding box from the Display menu, kept as last left for point clouds, maps and other models.
- [Several files in one view](https://github.com/chenyuting3077/robot-preview/blob/HEAD/docs/mesh-splat.md#several-files-in-one-view), such as a scan over its map; drag files onto the *Point Cloud View* list in the Explorer to add them.
- [Compare files](https://github.com/chenyuting3077/robot-preview/blob/HEAD/docs/mesh-splat.md#comparing-files) from the toolbar's *Compare* menu: color a cloud or mesh by its distance to another (C2C / C2M) with a tolerance and statistics, or show two files side by side with one camera.
- Save the view as a PNG screenshot.
- Orbit with the mouse, double-click to set the pivot, `F` to frame, `W` `A` `S` `D` to fly and `Q` `E` to turn; `?` lists the controls.
- Draws only while the view changes, so a large model left open does not keep the GPU busy, and a large file in a tab hidden for 5 minutes gives its memory back.
- Works in Restricted Mode.

Part of the Robot Preview series with [Robot Preview: URDF, Xacro & MJCF](https://marketplace.visualstudio.com/items?itemName=chenyuting3077.robot-preview-urdf-mjcf) and [Robot Preview: USD Viewer (OpenUSD, Isaac Sim)](https://marketplace.visualstudio.com/items?itemName=chenyuting3077.robot-preview-usd).

Built with [three.js](https://threejs.org/) and [Spark](https://sparkjs.dev/) by World Labs, STEP with [foxtrot](https://github.com/Formlabs/foxtrot) and [OpenCascade](https://dev.opencascade.org/) ([occt-import-js](https://github.com/kovacsv/occt-import-js)); format coverage follows [MeshLab](https://www.meshlab.net/). Screenshot: a splat derived from [Marble Bust 01](https://polyhaven.com/a/marble_bust_01) by James Ray Cock, Poly Haven (CC0).
