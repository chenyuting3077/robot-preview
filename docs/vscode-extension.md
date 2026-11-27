# VS Code Extension

Pitfalls of building and publishing it: issues #1 and #5.

## Files sent to the viewer

- The webview cannot read the disk, so the extension lists the nearest `package.xml` package (or the workspace folder) plus every package a `package://` / `$(find)` names, recursively, and sends their files.
- Meshes (STL, DAE, OBJ, glTF, GLB, MSH) cross only when the webview reads one, since a package often carries every model of a product line: realsense2_description is 96 MB for the D435's 16 MB, franka_description 198 MB for the FR3's 27 MB. D435 1.46–1.78 s, +1.06–1.20 GB before against 1.16–1.44 s, +0.57–0.67 GB after; FR3 2.07–2.93 s, +1.70–1.75 GB against 1.15–1.49 s, +0.72–0.85 GB (VS Code 1.147, Apple Silicon, all processes, 3 runs each, interleaved; an empty URDF takes 0.87 s, +0.55 GB). Textures and the rest are still sent up front: three asks for a texture synchronously.
- The `robotPreviewUrdf.packages` setting is searched before everything else: it is the only fix for a package without `package.xml` or shadowed by another checkout. `/opt/ros` is searched too, so packages resolve in a VS Code started outside a sourced shell.
- `robotPreviewUrdf.packageSearchPaths` walks folders as colcon does, so the packages found match what a build there would find; it ranks after the workspace so an overlay checkout still wins. It walks every folder below, which a `share` of an environment full of non-ROS files makes slow: a conda `share` with 1408 folders took 478 ms cold and 160 ms warm (once per session, then cached).
- A reference outside every package sends only that file and the textures it names; sending its directory would upload all of `~/Downloads` for one STL.
- `$(env)` values: only the variables the model references are sent, because the environment can hold tokens.

## Editing

- Like the Markdown preview: the source stays in the text editor, unsaved text rebuilds 300 ms after typing stops, and the tab's ● is the only unsaved marker.
- A rebuild builds the new model off-screen and swaps it in one frame; adding it first and letting meshes and camera catch up made the robot flash.
- Parsed meshes are cached per file content and deep-copied per build: cheaper than reparsing, and a copy keeps material colours and MJCF scaling from leaking between instances.
- Go to definition and hover search only the include chain of the edited file; the whole package offered definitions from sibling robots.
- Joint limits are written back only for a literal URDF `<joint>`: a xacro macro would change every instance, and an MJCF `range` depends on the compiler's angle unit.

## Model checks

- An error is what ROS's URDF parser rejects; a warning is what breaks simulation or planning.
- The scale rule fires at a 100x visual / collision size gap: a mm / m mistake is 1000x, a simplified collision shape a few x.
- Elements inside a `<xacro:macro>` are reported once, at the macro, without a quick fix, since an edit there changes every instance. MJCF is not checked: MuJoCo's compiler already is.

## Structure checks

- A tag scanner on the source text, not an XSD: the URDF XSD rejects every `xacro:` element, needs the Red Hat XML extension, and the model checks above only see the expanded URDF, so they cannot point at a typo in an include.
- Severity follows urdfdom's source (`urdf_parser/src`, 2026-07), not the URDF spec: a joint it cannot read rejects the whole model; a link it cannot read is kept but loses what follows (`parseLink`'s result is not checked); a bad colour or top-level material is only logged, and an `rgba` of the wrong count is not even logged (the colour stays black). So a `<visual>` `<material>` without `name` is an error (Unitree's H1-2 URDF has 113), a `<color>` without `rgba` a warning. URDF 1.2 adds rejections (sizes not above zero, negative limits, missing bounds on revolute and prismatic joints, lower > upper) and makes `effort` / `velocity` optional; the model checks follow the version too. urdfdom reads only the first of each child (`FirstChildElement`) except links, joints, materials, visuals and collisions, takes the first element in `<geometry>` as the shape, and skips `<axis>` on fixed and floating joints.
- Numbers follow `strToDouble`: trailing whitespace fails, so an attribute value broken over two lines drops the link (Unitree's dexterous hand URDFs have 16); lists split on single spaces, so a tab fails.
- A missing `effort` / `velocity` is left to the model checks' `missing-limit` so it is reported once; a missing mass `value` moved here from `nonpositive-mass`, which said zero. In a macro body the element's place is unknown: a `<material>` problem is a warning (it may land under `<robot>`), anything else an error.
- xacro: `xacro:if` / `unless` are transparent; a macro body or block argument can land anywhere, so only elements URDF knows are checked there and others pass. A `<joint>` without `type` in a macro body is taken as a ros2_control or transmission joint. Values containing `$` are not checked. An included `.xacro` needs no robot name and its URDF version is unknown unless stated, so version-gated attributes pass there.
- Elements other tools read, and SRDF (which shares the `<robot>` root and `.xacro`), are skipped; `.srdf` / `.srdf.xacro` get no URDF completion or hover.
- Run on 432 URDF / xacro files (urdf_tutorial, franka_description, ros2_control_demos, turtlebot4, robotiq, abb_experimental, moveit_resources, clearpath_common, realsense-ros, unitree_ros, tiago_robot and the development machine's): no false positive left; the one typo was a real `<intertial>` in clearpath_common's `flir_blackfly.urdf.xacro`. Every other warning is something ROS indeed ignores (`<dynamics D K>`, `<axis rpy>`, `<material>` or `<surface>` in `<collision>`, a second `<material>` in a `<visual>`, `dont_collapse`). Under 50 ms per file.

## Xacro

- xacro-parser 0.3.11 with `patches/xacro-parser@0.3.11.patch`, checked against ROS 2 xacro's output for the UR5e, FR3, TurtleBot3 Burger, Kinova Gen3, xArm and PMB2 (`tests/fixtures/xacro/`); every robot of franka_description 2.9.0 (8), realsense2_description's test models (11) and six UR types also matched xacro 2.1.1 element for element (2026-11). Upstream breaks `ur_description` on scopes, `^` defaults, dictionaries, quoted whitespace and `True` / `False`.
- Every file xacro 2.1.1 expands with default arguments in 17 description packages matched it element for element (55 robots, 2026-11): dsr_description2 (21), realsense2 (11), xarm (4), turtlebot3 (3, `.urdf`), turtlebot4, irobot_create, robotiq (2 each), clearpath_platform, husky, kortex (`dof:=7`), pmb2, tiago, pal_hey5, pal_robotiq, pal_robotiq_epick, ros2_control_demo and Nav2's sam_bot (`.urdf`). Before #27, xarm's two devices failed on `len()` and `>=`, pmb2 and tiago on `not in`.
- `load_yaml` files must match the path exactly: the mesh resolver's case and name guesses would load a file ROS would not.
- Python in `${}` is rewritten into xacro-parser's expr-eval, not run by a Python interpreter: `//`, `not in` and chained comparisons, which expr-eval lacks, and `>=` / `<=`, which xacro-parser's tokenizer splits, become expr-eval operators around a sentinel; the builtins and `math` functions xacro exposes are added. Comprehensions, `lambda`, `%` formats other than `%s %d %i %f` and `dict()` without keywords stop with an error naming them, only once xacro would evaluate them; a failing expression is reported at its line as written, found by searching the files for the attribute xacro-parser names, so an identical attribute earlier in another file takes the report. A float prints as JavaScript prints it (`1` where Python prints `1.0`); `tests/fixtures/xacro/expressions/` checks each form against xacro 2.1.1.

## DAE geometry in Rust

- Only the geometry is parsed in Rust (`rust/dae`, 100 KB of WASM); ColladaLoader still reads materials, units and the node tree, so its material and node-collapse rules hold by construction. Unhandled features (vertex colors, a second UV set, skinning, CDATA) go to ColladaLoader alone.
- Release 0.4.4 against this build: the RealSense xacro 2.14–2.38 s against 1.98–2.07 s, Franka 1.34–1.48 s against 1.33–1.35 s (VS Code 1.144, 3 runs each, interleaved).

## MJCF textures

- Matched to MuJoCo's classic renderer (`render_gl3.c` `settexture`, `render_context.c` `makePlane`), not to three.js defaults: an infinite plane is textured in metres from its centre, one repeat every `2 / texrepeat` m with `texuniform`; finite planes, primitives and meshes repeat `texrepeat` times over their texture coordinates.
- MuJoCo flips v of OBJ texture coordinates and keeps image rows top first, so file textures load with `flipY` off and the uv transform flips v. The simulation rebuilds meshes from MuJoCo's own texcoords and flips them back, so the same material works in both.
- Textures are sRGB: MuJoCo puts texture bytes on screen unchanged.
- Not drawn: cube and skybox textures (MuJoCo's default `type` is cube), KTX files, `texuniform` on meshes. Random marks have MuJoCo's density but not its exact dots (it seeds a `mt19937_64`).
- Planes are not drawn while simulating (the simulation builds no geometry for them); this predates textures.

## SDF

- Converted to URDF and loaded as one, so mesh lookup, missing-mesh reports, joint sliders and the tree view are the URDF ones. URDF puts a child link's frame on its joint, so visuals, collisions and inertials are re-expressed in the joint frame; positions match the SDF (`tests/sdf/`).
- Model checks and Export Expanded URDF are off: the checks follow ROS's URDF parser, and the URDF is a lossy stand-in, not an export.
- Not shown faithfully: kinematic loops (URDF is a tree; the joint closing the loop is dropped), the second axis of universal / revolute2 joints, ball and gearbox joints (shown fixed), submeshes, PBR and texture materials, heightmaps and polylines. Unbounded prismatic joints get a ±1 m slider.
- A Collada `<transparent>` without `opaque` is drawn opaque, as gazebo-classic's `ColladaLoader::LoadTransparent` does; by the Collada default (A_ONE) Blender 2.49's `<transparency>0.0</transparency>` makes osrf/gazebo_models' pioneer2dx chassis invisible. The visual's `<transparency>` then applies on top. URDF keeps the Collada default.
- An `<include>` that cannot be found is skipped so the rest of the world still shows, and Problems names it. Fuel URLs are never fetched (the webview has no network); gz-sim's example worlds include many, so such a world shows without them.
- `.sdf` is also a chemistry and a SQL Server Compact extension: a file opens the preview only with `<sdf` in its first 50 lines, and the extension does not claim `.sdf` as XML.
- Checked in headless Chrome on osrf/gazebo_models `pioneer2dx` (SDF 1.5, `model://` meshes, `Gazebo/FlatBlack`) and gz-sim `examples/worlds/shapes.sdf` (SDF 1.11, every primitive).

## Limits

- The CSP keeps `'unsafe-eval'`: mujoco-js builds its bindings with `new Function`.
- USD stays in its own extension: the removed USD viewer needed `SharedArrayBuffer`, which VS Code webviews cannot isolate for.
- Resizing the kinematic tree panel within about 1 s of restoring it from maximized (0.45 s wait, then a 0.6 s graph animation) can leave the graph view part-way to the restored one.
- A model update that redraws the tree graph during one of its animations keeps the mid-animation zoom.

## Tests

`pnpm test` runs viewer and extension tests in Node against a mocked `vscode`; `pnpm test:e2e` drives the webview in headless Chrome under the extension's CSP (Node 22, `google-chrome` or `CHROME=`). Load time and memory are measured in VS Code itself with `tests/e2e/vscode.mjs`, old and new builds interleaved.
