# Changelog

## Unreleased

- PLY files with double-precision coordinates render; WebGL rejected their Float64 attributes and the view stayed empty.
- Binary PLY meshes load without PLYLoader: a 181 MB, 4.5M-face mesh parses in 0.18 s instead of 2.0 s, with half the memory.
- Binary PCD point clouds load into typed arrays instead of PCDLoader's growing arrays, keeping only position and color.
- STEP files (`.stp` `.step`) open as meshes, in meters, with part and face colors, starting +Y up. A 39 MB assembly shows in about 8 s (was about 100 s), with under 1% of faces left as small holes; later opens of the unchanged file load a cached copy in about 1 s. A 161 MB assembly that used to fall back to OpenCascade and never finish opens in 24 s.
- STEP files tessellate on up to 4 threads: the 39 MB assembly 8 s -> 5 s, a 30 MB one 3.8 -> 1.9 s, the 161 MB one 24 -> 14 s, using less memory: the 161 MB file needs about 2.9 GB in VS Code instead of 4.8 GB.
- The STEP cache is about a quarter smaller, is dropped when the extension updates, and is trimmed to 1 GB.
- Large binary PCD files open faster with less memory: the extension streams them to the viewer, and past 10M points an even 10M are shown. A 1.2 GB, 38.9M-point map: 18.8 -> 7.6 s, 5 -> 20 fps when orbiting, 4.3 -> 1.6 GB.

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
