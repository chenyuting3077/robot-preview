# Robot Preview

VS Code extensions for previewing robot models, meshes, point clouds and Gaussian splats beside the editor.

## Install

```bash
npm install && npm --prefix packages/mesh-splat install
npm run package
code --install-extension packages/urdf-mjcf/robot-preview-urdf-mjcf-*.vsix
code --install-extension packages/mesh-splat/robot-preview-mesh-splat-*.vsix
```

## Usage

Open a `.urdf`, `.xacro` or MJCF `.xml` file for the live robot preview; open a mesh, point cloud or splat file for the 3D view.

```bash
npm test
npm run test:e2e
```

## Contents

- [packages/urdf-mjcf/](packages/urdf-mjcf/) — Robot Preview: URDF & MJCF ([CHANGELOG](packages/urdf-mjcf/CHANGELOG.md))
- [packages/mesh-splat/](packages/mesh-splat/) — Robot Preview: Mesh & Splat ([CHANGELOG](packages/mesh-splat/CHANGELOG.md))
- [docs/vscode-extension.md](docs/vscode-extension.md) — URDF & MJCF design decisions, limits and pitfalls
- [docs/mesh-splat.md](docs/mesh-splat.md) — Mesh & Splat renderer choice, benchmarks and limits
- [docs/mjcf-parallel-mechanisms.md](docs/mjcf-parallel-mechanisms.md) — supported MJCF constraints and closed-chain behaviour
- [tests/fixtures/mjcf/](tests/fixtures/mjcf/) — regression models with licenses
- Based on [fan-ziqi/robot_viewer](https://github.com/fan-ziqi/robot_viewer) (Apache-2.0), using [three.js](https://threejs.org/), [urdf-loader](https://github.com/gkjohnson/urdf-loaders), [xacro-parser](https://github.com/gkjohnson/xacro-parser), [mujoco_wasm](https://github.com/zalo/mujoco_wasm), [d3](https://d3js.org/) and [Spark](https://sparkjs.dev/)
