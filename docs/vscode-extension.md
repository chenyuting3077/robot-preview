# VS Code Extension

Pitfalls of building and publishing it: issues #1 and #5.

## Files sent to the viewer

- The webview cannot read the disk, so the extension sends the nearest `package.xml` package (or the workspace folder) plus every package a `package://` / `$(find)` names, recursively.
- The `robotPreviewUrdf.packages` setting is searched before everything else: it is the only fix for a package without `package.xml` or shadowed by another checkout. `/opt/ros` is searched too, so packages resolve in a VS Code started outside a sourced shell.
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

## Xacro

- xacro-parser 0.3.11 with `patches/xacro-parser@0.3.11.patch`, checked against ROS 2 xacro's output for the UR5e (`tests/fixtures/xacro/`). Upstream breaks `ur_description` on scopes, `^` defaults, dictionaries, quoted whitespace and `True` / `False`.
- `load_yaml` files must match the path exactly: the mesh resolver's case and name guesses would load a file ROS would not.

## DAE geometry in Rust

- Only the geometry is parsed in Rust (`rust/dae`, 100 KB of WASM); ColladaLoader still reads materials, units and the node tree, so its material and node-collapse rules hold by construction. Unhandled features (vertex colors, a second UV set, skinning, CDATA) go to ColladaLoader alone.
- Release 0.4.4 against this build: the RealSense xacro 2.14–2.38 s against 1.98–2.07 s, Franka 1.34–1.48 s against 1.33–1.35 s (VS Code 1.144, 3 runs each, interleaved).

## Limits

- The CSP keeps `'unsafe-eval'`: mujoco-js builds its bindings with `new Function`.
- USD stays in its own extension: the removed USD viewer needed `SharedArrayBuffer`, which VS Code webviews cannot isolate for.

## Tests

`pnpm test` runs viewer and extension tests in Node against a mocked `vscode`; `pnpm test:e2e` drives the webview in headless Chrome under the extension's CSP (Node 22, `google-chrome` or `CHROME=`). Load time and memory are measured in VS Code itself with `tests/e2e/vscode.mjs`, old and new builds interleaved.
