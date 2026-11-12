# Changelog

## 0.4.1

- A URDF whose ROS package cannot be found (a CAD export copied without `package.xml`, a renamed folder, or only the URDF and its meshes kept) loads from the nearby folder holding its meshes, as the web viewer did with a dragged folder; Problems warns that ROS will not find the package.
- fusion2urdf exports load: their `.gazebo` and `.trans` xacro includes were never sent to the preview.
- The kinematic tree no longer overlaps labels under a link with many children, and every label fits its box.
- A dragged panel stays inside the view when maximized.

## 0.4.0

- Renamed to Robot Preview: URDF, Xacro & MJCF.
- Model checks in Problems: errors for what the ROS URDF parser rejects (unknown or duplicate names, a link with two parents, several root links, loops, a missing or incomplete `<limit>`, an `<inertial>` without `<mass>`) and warnings for what breaks simulation or planning (missing or impossible inertia, a zero axis, inverted limits, zero effort or velocity, a collision mesh 100x the size of its visual, likely a mm/m mistake). Quick fixes for inverted limits, bounds on continuous joints and a missing `<limit>`; `robotPreviewUrdf.checks.disabled` turns rules off.
- Xacro navigation without opening the preview: Go to Definition (F12 or Cmd/Ctrl+click) and hover for macros, properties, arguments, link names and include paths; completion after `${`, `<xacro:` and `$(arg `; clickable paths.
- Save Screenshot (camera button or command) saves the view as a PNG at twice its size beside the model.
- Faster and lighter: reloading reuses parsed meshes (UR5e full reload 259 -> 62 ms) and frees the previous model's GPU memory; syntax errors and checks appear before meshes finish loading; the package shrinks from 3.3 to 1.7 MB and a MuJoCo simulation starts about twice as fast.

## 0.3.1

- Grid lines no longer flicker while the camera moves.

## 0.3.0

- Xacro `load_yaml()` (with `!degrees`, `!millimeters` and the other unit tags), `$(env)`, `$(optenv)`, `$(dirname)` and `$(eval)`; Universal Robots descriptions expand exactly as ROS 2 xacro does. Python conditionals work inside parentheses and alongside strings.
- Xacro fixes: `False` and `"false"` are false in `xacro:if` and conditionals, macro defaults `name:=^`, properties set with `scope="parent"`, and empty `xacro:arg` defaults.
- Meshes referenced by absolute path, `file://`, a `../` outside the package, Gazebo `model://` or a percent-encoded name now load, including from files included from outside every package. Only the referenced file and the materials and textures it names are sent.
- `robotPreviewUrdf.packages` maps package names to folders for packages without a `package.xml` or a sourced ROS environment.
- A mesh found only by ignoring case or by file name is flagged, since ROS on Linux would not find it; the case has a quick fix.
- Clicking a link made by a xacro macro with an empty prefix (`${tf_prefix}base_link` with `tf_prefix=""`) jumps to its definition.
- An unknown package is a Problems entry listing where it was searched, with a quick fix to choose its folder; missing meshes name the path that was tried at every reference; YAML errors point at their line, and a missing YAML file shows its path.

## 0.2.2

- Links to the other Robot Preview extensions.

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
