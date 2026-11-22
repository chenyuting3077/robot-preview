# Changelog

## Unreleased

- `.obj` `.gltf` `.dae` `.wrl` and `.xyz` open in the text editor again: they are text people edit, and `.xyz` is also a molecule format. The editor title's *Open 3D Preview* button (*Open as Point Cloud* for `.xyz`), the Explorer menu or *Reopen Editor With…* opens the view, and *Reopen Editor With… → Configure default editor* brings back the old behavior.
- A view of large files (100 MB or more) in a tab hidden for 5 minutes gives its memory back, and loads again with the camera kept when you return.

## 0.5.0

- Now listed as "Robot Preview: Point Cloud & Splat Viewer".
- Several files in one view: *Add file…*, or *Add to Point Cloud View* in the Explorer's menu for a selection of files, adds point clouds, meshes, splats and ROS maps to the view, each a Stage row with a visibility toggle, a remove button and its own colors, including one solid color per file. All share one frame and camera, and height and field colors share one range.
- ROS occupancy grid maps: a `.pgm` opens as a map with the same-named `.yaml` beside it (or open the `.yaml` with *Reopen Editor With…*, PNG images too), at its origin, yaw and resolution, with cells read as Nav2's map_server reads them and colored as RViz's Map display. Info shows cells, meters, resolution and origin. A `.pgm` without a map YAML (none, or a same-named YAML that is not a map) shows as a greyscale image.
- KITTI LiDAR scans (`.bin`, x y z intensity) open from the editor title's *Open as Point Cloud* button, the Explorer menu or *Reopen Editor With…*, colored by intensity and streamed like PCD; `.bin` is not opened by default since firmware and weights share it. nuScenes `.pcd.bin` scans open directly and add `ring` as a field. Info names the layout, and a file whose size is not whole points is refused.
- Point clouds open with the grid shown on their z = 0 plane (the up axis's zero), not under their lowest point; a cloud farther from it than twice its largest side keeps the grid under its lowest point.
- A point cloud below its z = 0 plane, within twice its largest side of it, opens (and returns on F) with the camera above the plane, looking down through the grid.
- Point clouds also open with the axes shown, unless their origin is too far away to draw (UTM coordinates), and their Display menu leaves out Bounds.
- Point sizes take one row of dots in the Display menu instead of three rows.
- The ground grid reaches the horizon, as in Isaac Sim, with minor and 10x major lines whose spacing follows the zoom.
- Grid, axes and bounds stay as last left, for point clouds, maps and other models apart; a model opens with the grid the first time.
- Point size and Original / Height colouring stay as last left, and each file reopens with the up axis last chosen for it.
- Point clouds at UTM coordinates no longer jump while orbiting, and keep millimetre detail instead of snapping to a 0.25 m lattice where the file stores more than float32 (xyz / pts / asc, ASCII or double PCD and PLY); float32 files (binary PCD and PLY `float`, KITTI / nuScenes `.bin`) stop jumping but keep the precision they were written with. Info shows the offset taken out.
- The colour legend gives both ends as many decimals as their difference needs: elevations of 1,234.5–1,236.0 no longer read as 1,230 and 1,240.

## 0.4.0

- Now listed as "Robot Preview: Gaussian Splat, Point Cloud, STEP & STL Viewer".
- Save the view as a PNG screenshot with the camera button.
- IGES (`.igs` `.iges`) opens through OpenCascade and reopens from the cache like STEP.
- glTF with Draco or meshopt compression opens.
- Grid, axes and bounding box in the Display menu, for splats too.
- Point-cloud PLY colors by any other property (confidence, curvature, ...), with a legend of the range; PCD intensity is one of these.
- An idle view draws nothing instead of redrawing every frame, so a large model left open no longer keeps the GPU busy.

## 0.3.1

- Marketplace description and keywords mention STEP CAD models.

## 0.3.0

- STEP (`.stp` `.step`) opens as meshes with part and face colors; a 39 MB assembly in about 3 s, a 161 MB one in 16–17 s with about 2 GB of memory, and an unchanged file again in about 1 s.
- Large point clouds: PCD (binary, ASCII and `binary_compressed`) streams from the extension, past 10M points an even 10M are shown and "Load detail in view" (Display menu) reads the points in view, and NaN points are dropped. A 1.2 GB map opens in about 5 s; 0.2.0 could not open it.
- Point clouds color by original color, height or intensity (Display menu).
- Binary PLY meshes load directly into typed arrays (181 MB: 1.8 s; 0.2.0 ran out of memory), and double-precision PLY renders.

## 0.2.0

- Files start with +Z up, as in ROS, unless they declare their own up axis (glTF and VRML +Y, DAE `<up_axis>`, USD `upAxis`). Gaussian splats too: raw COLMAP / 3DGS output needs -Y from the up menu.
- Z-up DAE and USD files now show +Z in the up menu instead of +Y; the view is unchanged.

## 0.1.4

- Binary PLY point clouds load 10-40x faster (ASCII about 3x) with about a quarter of the memory; clouds past ~44M points no longer fail.
- XYZ, PTS and ASC point clouds load about 2.5x faster.
- Large Gaussian splat files are framed in milliseconds instead of seconds.

## 0.1.2

- File info moved behind an "i" button, collapsed until opened.
- Point display keeps working when a mesh is hidden; framing ignores hidden objects.
- three.js 0.187.
- Links to the other Robot Preview extensions.

## 0.1.1

- Clearer Marketplace description and search keywords.

## 0.1.0

First release.

- 3D view for meshes, point clouds and Gaussian splats, opened directly from the explorer.
- PLY files are detected as mesh, point cloud or splat from their header.
- 2DGS PLY files (two scales) are flattened into 3DGS splats on load.
- Display mode, up axis and file information in the same toolbar style as Robot Preview: URDF & MJCF.
- Camera: middle-drag pans, the wheel zooms toward the cursor, double-click sets the orbit pivot, `F` frames the model, `W` `A` `S` `D` fly and `Q` `E` turn (hold `Shift` for faster).
- `?` in the toolbar lists the mouse and keyboard controls.
- Point size for point clouds; `.xyz` / `.pts` files with 0–255 RGB columns keep their colors.
- Works in Restricted Mode (untrusted workspaces).
- Reloads when the file changes on disk; follows the VS Code theme and display language (English, 简体中文, 繁體中文).
