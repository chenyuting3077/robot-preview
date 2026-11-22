# Changelog

## Unreleased

- The link info shown on hover waits until the pointer rests for half a second, so moving across the robot to orbit or drag a joint no longer flashes it; right after one closes, the next link's info opens at once. The highlight still follows the pointer immediately.
- A floating panel snaps to a corner when dragged along an edge into the quarter of the view nearest that corner, instead of only inside a 24 px square in the corner.
- Visuals are shown whenever a preview opens. Turning them off is no longer kept, so a model opened later does not come up empty.

## 0.5.0

- Marketplace description and keywords mention SDF, Gazebo, completion and model checks.
- URDF completion: typing `<` offers the elements ROS reads at that spot, each a snippet with its required attributes (a `<joint>` comes with `<parent>`, `<child>` and `<origin>`), plus `<gazebo>`, `<ros2_control>` and `<transmission>` under `<robot>`; `<xacro:` offers the xacro directives; attribute names, joint types, and link and joint names for `<parent>`, `<child>` and `<mimic>`.
- Hover on a URDF element, attribute or joint type explains it with what it takes, units and defaults.
- Structure checks while typing, without the preview: elements and attributes ROS ignores (typos, an `<origin>` directly in a `<link>`, a second `<origin>`, `quat_xyzw` below URDF 1.1), missing required attributes and children, malformed values (including a number broken over two lines) and missing shapes, each saying whether ROS rejects the model or drops part of a link; a quick fix for typos. Rule ids `ignored-element`, `ignored-attribute`, `missing-attribute`, `missing-element`, `invalid-value`, `invalid-geometry`.
- `robotPreviewUrdf.packageSearchPaths` searches folders for ROS packages at any depth, for another workspace or a pixi environment's `share`.
- SDF preview: `.sdf` model and `.world` files, with nested models, `<include>` of `model://` and relative models (the newest SDF their `model.config` lists), `relative_to` / `expressed_in` poses and the older SDF axis rules. Meshes, capsules, ellipsoids, cones and planes are drawn; Gazebo material scripts such as `Gazebo/Grey` get their colors. Click a link to jump to it, also inside an included model. An include that cannot be found, such as a Fuel URL, is skipped and named in Problems.
- MJCF textures: 2D `<texture>` files and builtin checker, gradient and flat textures with their marks, placed by `texrepeat` and `texuniform` as MuJoCo does, also while simulating. The MuJoCo Menagerie floor and Cassie's texture now look as they do in MuJoCo.
- MJCF geoms directly in `<worldbody>` (a scene floor) take their material's color; a geom's `rgba` overrides its material unless it is MuJoCo's default `0.5 0.5 0.5 1`.
- The preview button and menu entries also show for upper-case extensions (`.URDF`, `.XML`, `.Xacro`, `.SDF`).
- Hidden parts no longer react to the pointer: with visuals off the empty space is not highlighted or dragged, and with only collision shown, hovering a collision shape highlights its link and dragging it moves the joint. With both shown, the visual seen through a collision shape is the one picked.
- The link info shown on hover opens at the pointer as a right-click menu does, below-right and flipped near the view's edges, and stays there until another link is hovered, instead of covering the bottom of the model.
- The arrow button in the toolbar turns picking off, as in the USD viewer: the view then answers no hover, drag or click (joints move from the Joints panel, a click still clears the selection), also while simulating. The choice is kept.
- A hovered floor (MJCF or SDF plane) keeps its color and texture with a faint glow instead of turning plain white.
- MJCF planes are drawn while simulating, with their texture; the floor used to disappear on Simulate.
- Pause keeps the simulated pose on screen, as MuJoCo's viewer does, instead of showing the starting pose while the physics kept its state. Reset while paused returns to the model, and the next Simulate starts from the initial state.
- The editor title's preview button has its own icon (code beside an axis tripod) instead of the generic preview icon Markdown uses too.

## 0.4.6

- Orbiting the camera no longer stutters on large models: the hover check is skipped while a mouse button is held. In VS Code a 1.24M-triangle AMR URDF orbits at 57-59 fps against 43-49 fps with 0.4.5.

## 0.4.5

- Large DAE meshes load faster: their geometry is parsed in WebAssembly. In VS Code the RealSense camera preview (16 MB `d435.dae`) opens in 1.98-2.07 s against 2.14-2.38 s with 0.4.4.

## 0.4.4

- DAE meshes without normals (SketchUp exports such as the RealSense `d435.dae`) are lit instead of black; normals are computed as RViz does.
- Small models are no longer cut by the near plane: it follows the fitted camera distance instead of a fixed 0.1 m.
- The grid follows the model size (1 cm cells for a 9 cm camera, up to 0.5 m for robots over 1 m; 40 cells across) and fades toward its edge, so far lines no longer pile into a flickering band at low view angles.
- The Grid button reads "Grid: auto (1 cm)" with the current cell size, or "Grid: off".

## 0.4.3

- A single STL, OBJ or DAE preview now starts Z-up and follows the up menu like robots do; DAE files are placed by their `<up_axis>`, a missing one counting as Z-up.

## 0.4.2

- The first preview of a model that names another ROS package opens faster: the package index reads each `package.xml` once and in parallel (Jazzy, 399 packages: 153-269 -> 59-83 ms).
- Reloading is faster: sent files are hashed four bytes at a time (30 MB model: unchanged reload 255 -> about 195 ms).

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
