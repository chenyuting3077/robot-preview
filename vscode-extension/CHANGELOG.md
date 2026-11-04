# Changelog

## 0.1.0

First Marketplace release.

- Live 3D preview beside the text editor for URDF, Xacro and MJCF; the preview follows the active model and keeps the full robot while editing included xacro files.
- Updates while typing (or on save, `robotPreviewUrdf.updateOn`) without flashing; camera and joint pose are kept and the tab shows ● while the preview contains unsaved edits.
- `package://` and `$(find)` resolved across ROS packages in the workspace, `ROS_PACKAGE_PATH`, `AMENT_PREFIX_PATH` and `/opt/ros`.
- Two-way selection: click a link to jump to its definition, move the cursor to highlight it; xacro macro names supported.
- Joint limits edited in the viewer are written back to the URDF source.
- XML errors, model load errors and missing meshes reported in the Problems panel.
- Xacro arguments per file and export of the expanded URDF.
- Standalone preview for `.stl`, `.dae` and `.obj`.
- MuJoCo simulation for MJCF models.
- Follows the VS Code theme and display language (English, 简体中文, 繁體中文).
