# Changelog

## Unreleased

- Point clouds open with the grid shown on their z = 0 plane (the up axis's zero), not under their lowest point; a cloud farther from it than twice its largest side keeps the grid under its lowest point.
- Point clouds also open with the axes shown, and their Display menu leaves out Bounds.
- Point sizes take one row of dots in the Display menu instead of three rows.
- The grid spans the model's largest side, not its footprint: a standing robot got 1 cm cells.
- Grid, axes and bounds stay as last left, for point clouds and for other models apart; a model opens with the grid the first time.

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
