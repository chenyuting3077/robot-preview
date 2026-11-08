# Changelog

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
