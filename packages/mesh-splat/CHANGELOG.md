# Changelog

## Unreleased

- PLY files with double-precision coordinates render; WebGL rejected their Float64 attributes and the view stayed empty.
- Binary PLY meshes load without PLYLoader: in VS Code a 181 MB, 4.5M-face mesh opens in 1.8 s and grows memory by 1.05 GB; 0.2.0 went past 6 GB.
- Binary PCD point clouds load into typed arrays instead of PCDLoader's growing arrays, keeping only position, color and intensity; NaN points are dropped.
- STEP files (`.stp` `.step`) open as meshes, in meters, with part and face colors, starting +Y up, with under 1% of faces left as small holes. In VS Code a 39 MB assembly shows in 3.0 s and a 161 MB one in 13.7-15.1 s with 2.0-2.2 GB of memory; later opens of the unchanged file load a cached copy in 0.8-1.4 s. The cache is dropped when the extension updates and trimmed to 1 GB.
- Large binary PCD files are streamed from the extension, and past 10M points an even 10M are shown. A 1.2 GB, 38.9M-point map opens in 5.1-5.5 s with 1.1-1.3 GB of memory and orbits at 21 fps; 0.2.0 went past 6 GB in two of three runs.
- Point clouds can be colored by original color, height or intensity (Display menu); clouds without RGB start in intensity or height.

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
