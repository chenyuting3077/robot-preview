# Changelog

## 0.1.0

First release.

- 3D view for meshes, point clouds and Gaussian splats, opened directly from the explorer.
- PLY files are detected as mesh, point cloud or splat from their header.
- 2DGS PLY files (two scales) are flattened into 3DGS splats on load.
- Display mode, up axis and file information in the same toolbar style as Robot Preview: URDF & MJCF.
- Camera: middle-drag pans, the wheel zooms toward the cursor, double-click sets the orbit pivot, `F` frames the model, `W` `A` `S` `D` fly and `Q` `E` turn (hold `Shift` for faster).
- Reloads when the file changes on disk; follows the VS Code theme and display language (English, 简体中文, 繁體中文).
