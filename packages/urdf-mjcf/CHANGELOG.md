# Changelog

## 0.2.1

- Clearer Marketplace description and search keywords.

## 0.2.0

- `?` in the toolbar lists the mouse and keyboard controls.
- glTF / GLB meshes (with external `.bin` buffers) referenced from URDF and xacro load instead of being reported missing.
- Moving the text cursor onto a link highlights it without popping up the hover info; the info shows only on mouse hover.
- STL meshes without valid normals are shaded instead of rendering black.
- Works in Restricted Mode (untrusted workspaces).
- Camera: middle-drag pans, the wheel zooms toward the cursor, double-click sets the orbit pivot, `F` frames the model, `W` `A` `S` `D` fly and `Q` `E` turn (hold `Shift` for faster).
- Standalone `.stl` / `.dae` / `.obj` preview is now an optional editor (*Reopen Editor With…*); install Robot Preview: Mesh & Splat for the default mesh viewer.

## 0.1.1

- Marketplace page shows a single screenshot.

## 0.1.0

First Marketplace release.

- Live 3D preview beside the text editor for URDF, Xacro and MJCF; the preview follows the active model and keeps the full robot while editing included xacro files.
- Updates while typing (or on save, `robotPreviewUrdf.updateOn`) without flashing; camera and joint pose are kept.
- `package://` and `$(find)` resolved across ROS packages in the workspace, `ROS_PACKAGE_PATH`, `AMENT_PREFIX_PATH` and `/opt/ros`.
- Two-way selection: click a link to jump to its definition, move the cursor to highlight it; xacro macro names supported.
- Joint limits edited in the viewer are written back to the URDF source.
- XML errors, model load errors and missing meshes reported in the Problems panel.
- Xacro arguments per file and export of the expanded URDF.
- Standalone preview for `.stl`, `.dae` and `.obj`.
- MuJoCo simulation for MJCF models.
- Follows the VS Code theme and display language (English, 简体中文, 繁體中文).
