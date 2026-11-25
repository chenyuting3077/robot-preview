# Robot Preview: URDF, Xacro & MJCF

Live 3D preview of URDF, Xacro, MJCF and SDF beside the text editor.

- Updates as you type; click a link to jump to its source, move the cursor to highlight it.
- Resolves `package://`, `$(find)`, `model://`, absolute and `file://` paths across ROS packages; xacro `load_yaml` and `$(env)`.
- Reports XML errors, missing meshes and paths ROS would not find in the Problems panel, with quick fixes.
- Model checks: broken kinematic trees, missing limits and inertia, impossible inertia and mm/m scale mistakes; typos and missing attributes as you type.
- Go to Definition, hover and completion for URDF elements and attributes, xacro directives, macros, properties, arguments, links and include paths.
- Save the view as a PNG screenshot.
- Xacro arguments, expanded URDF export, mesh preview and MuJoCo simulation.

![preview](images/preview.png)

Part of the Robot Preview series with [Robot Preview: Point Cloud & Splat Viewer](https://marketplace.visualstudio.com/items?itemName=chenyuting3077.robot-preview-mesh-splat) ([Open VSX](https://open-vsx.org/extension/chenyuting3077/robot-preview-mesh-splat)) and [Robot Preview: USD Viewer (OpenUSD, Isaac Sim)](https://marketplace.visualstudio.com/items?itemName=chenyuting3077.robot-preview-usd) ([Open VSX](https://open-vsx.org/extension/chenyuting3077/robot-preview-usd)).

Based on [fan-ziqi/robot_viewer](https://github.com/fan-ziqi/robot_viewer), with [three.js](https://threejs.org/), [urdf-loader](https://github.com/gkjohnson/urdf-loaders), [xacro-parser](https://github.com/gkjohnson/xacro-parser), [mujoco_wasm](https://github.com/zalo/mujoco_wasm) and [d3](https://d3js.org/).
