# Robot Preview: URDF & MJCF

Live 3D preview of URDF, Xacro and MJCF robot models beside the VS Code text editor, with two-way link selection, joint control and MuJoCo simulation.

## Install

```bash
pnpm install
pnpm run package
code --install-extension vscode-extension/robot-viewer-*.vsix
```

## Usage

Open a `.urdf`, `.xacro` or MJCF `.xml` file; the preview opens beside the editor and follows your edits.

```bash
pnpm test
pnpm test:e2e
```

## Contents

- [docs/vscode-extension.md](docs/vscode-extension.md) — design decisions, limits and pitfalls
- [docs/mjcf-parallel-mechanisms.md](docs/mjcf-parallel-mechanisms.md) — supported MJCF constraints and closed-chain behaviour
- [vscode-extension/extension.js](vscode-extension/extension.js) — extension host
- [src/main.js](src/main.js) — webview viewer
- [tests/fixtures/mjcf/](tests/fixtures/mjcf/) — regression models with licenses
- [vscode-extension/CHANGELOG.md](vscode-extension/CHANGELOG.md) — release notes
- Based on [fan-ziqi/robot_viewer](https://github.com/fan-ziqi/robot_viewer) (Apache-2.0), using [three.js](https://threejs.org/), [urdf-loader](https://github.com/gkjohnson/urdf-loaders), [xacro-parser](https://github.com/gkjohnson/xacro-parser), [mujoco_wasm](https://github.com/zalo/mujoco_wasm) and [d3](https://d3js.org/)
