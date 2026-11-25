# Competing VS Code extensions

Surveyed 2026-11-25. Install counts and last-updated dates come from the Marketplace gallery API (`_apis/public/gallery/extensionquery`, searched by keyword); features come from each extension's Marketplace page. None of the extensions was installed and tried, so a feature listed here is what its page claims.

## Installs

| Area | Competitors (installs, last updated) | Ours |
|---|---|---|
| URDF | [Robot Developer Extensions for URDF][rde] (200k, 2026-09), [URDF Visualizer][mf] (55k, 2026-10), [URDF Studio][studio] (2.2k, 2026-11); [URDF][smile] (278k) has had no update since 2022 | urdf-mjcf: 121 |
| MJCF | [MuJoCo Viewer][mujoco] (2.8k, 2026-07) | (urdf-mjcf) |
| Point clouds, meshes | [3D Viewer for VSCode][slev] (214k, last updated 2020), [vscode-3d-preview][tatsy] (106k, 2026-09), [pcd-viewer][azurity] (32k), [3D Visualizer][klein] (15.8k, 2026-10), [q3dviewer][q3d] (475, 2026-11) | mesh-splat: 22 |
| Splats | [Gaussian Viewer][gv] (3.8k, 2026-11), [ViS-3DGS][vis] (481) | (mesh-splat) |
| CAD | [CAD Viewer][cadv] (5.9k), [CAD Preview][kratos] (496) | (mesh-splat) |
| USD | [3D Mesh Viewer][atl] (2.4k, renders USD among many formats), [Usdc Viewer][usdc] (5.6k, text dump only) | usd: 66 |
| MCAP | [MCAP Explorer][mcapx] (480, no point clouds), [MCAP Viewer][mcapv] (561, images and joint states only) | none |

## Gaps in Mesh & Splat

| Feature | Who has it |
|---|---|
| Pick a point for its coordinates; distance between two points | q3dviewer, 3D Visualizer, 3D Mesh Viewer, CAD Preview (and URDF Visualizer for robots) |
| LAS / LAZ, E57 (#11) | 3D Visualizer, q3dviewer |
| Eye-Dome Lighting for uncolored clouds | 3D Visualizer |
| Normals display | 3D Visualizer, 3D Mesh Viewer |
| Default settings (background, point size, up axis) or remembered view settings | vscode-3d-preview, 3D Mesh Viewer; Mesh & Splat and USD contribute no settings |
| Recorded camera paths as video | q3dviewer, 3D Visualizer |
| COLMAP sparse points and cameras over a splat (#12) | Gaussian Viewer |
| Clipping planes | CAD Preview |
| Depth images to point clouds | 3D Visualizer |
| Live PointCloud2 over rosbridge | q3dviewer |

Ahead of all of them: load time on large files, STEP / IGES, ROS occupancy maps, C2C / C2M distance colors, panes with one camera, 2DGS.

## Gaps in URDF / MJCF

Already there: joint panel and dragging joints in the view, visual / collision / inertia / COM / joint axes, model tree, diagnostics with quick fixes, MuJoCo simulation.

- Measurement: ours measures between two objects; URDF Visualizer measures coordinates, distance, angle and area by clicking.
- Saved poses: URDF Visualizer restores joint values and camera per file; URDF Studio has pose bookmarks and joint values as JSON.
- MJCF debugging: MuJoCo Viewer has contact forces, applying keyframes, dragging a body to apply force, tracking a body, and inspector edits written back to the XML.
- MoveIt preparation: URDF Studio has SRDF named states, a never-colliding pair list and a reachability cloud.

## Gaps in USD

3D Mesh Viewer, the one other extension that renders USD, targets art assets: animation timeline, UV and material inspection, skin weights. No extension offers joint sliders for Isaac Sim articulations.

## Proposed order

1. Point picking with coordinates and two-point distance, shared by Mesh & Splat and USD: nearly every competitor has it.
2. LAS / LAZ (#11).
3. EDL, normals display and default settings, as one small issue.
4. NuRec screenshot and README (#13).
5. URDF: remember joint values and camera per file; export joint values as JSON.
6. USD: joint sliders for articulations, which no competitor has.
7. COLMAP (#12); MJCF contact forces and keyframes.
8. PointCloud2 from MCAP (#14): nobody has it, but it is the largest.

Left out for now:
- Clipping: only CAD Preview has it.
- FBX, glTF animation, UV: art-asset needs, not robotics.
- Depth images: only 3D Visualizer has it.
- Live rosbridge: viewing a running system is outside opening files.
- MCP server: a trend (3D Visualizer, Robot Developer Extensions, CAD Preview), not a basic feature.
- SRDF / MoveIt: advanced.
- Writing inspector edits back to the XML: large.

[rde]: https://marketplace.visualstudio.com/items?itemName=Ranch-Hand-Robotics.urdf-editor
[mf]: https://marketplace.visualstudio.com/items?itemName=morningfrog.urdf-visualizer
[studio]: https://marketplace.visualstudio.com/items?itemName=deyuf.urdf-studio
[smile]: https://marketplace.visualstudio.com/items?itemName=smilerobotics.urdf
[mujoco]: https://marketplace.visualstudio.com/items?itemName=JulienBlanchon.mujoco-viewer
[slev]: https://marketplace.visualstudio.com/items?itemName=slevesque.vscode-3dviewer
[tatsy]: https://marketplace.visualstudio.com/items?itemName=tatsy.vscode-3d-preview
[azurity]: https://marketplace.visualstudio.com/items?itemName=azurity.pcd-viewer
[klein]: https://marketplace.visualstudio.com/items?itemName=kleinicke.ply-visualizer
[q3d]: https://marketplace.visualstudio.com/items?itemName=panasonic-ad.q3dviewer
[gv]: https://marketplace.visualstudio.com/items?itemName=GaussianViewer.gaussian-viewer
[vis]: https://marketplace.visualstudio.com/items?itemName=batuoz.vis-3dgs-viewer
[cadv]: https://marketplace.visualstudio.com/items?itemName=thingraph.cad-viewer
[kratos]: https://marketplace.visualstudio.com/items?itemName=kratos-multiphysics.cad-preview
[atl]: https://marketplace.visualstudio.com/items?itemName=AssetToolLabs.mesh-viewer-vscode
[usdc]: https://marketplace.visualstudio.com/items?itemName=sssooonnnggg.usdc-viewer
[mcapx]: https://marketplace.visualstudio.com/items?itemName=gagalo123.mcap-explorer
[mcapv]: https://marketplace.visualstudio.com/items?itemName=codevilot.mcap-viewer
