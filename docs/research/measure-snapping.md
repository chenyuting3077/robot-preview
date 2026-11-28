# Snapping when measuring in 3D viewers

Surveyed 2026-11-28. Companion to [competitors.md](competitors.md) and [user-needs.md](user-needs.md). Question: after the measure mode of [#29][i29] (a click reads a coordinate, two clicks give a distance), should Mesh & Splat snap, and to what?

## Method

- Only primary sources: source code (shallow clones at the commits below, read line by line), official docs and changelogs, GitHub issues themselves. Search results and AI page summaries were used to find leads only; every claim below was traced to the file or page that owns it.
- Source commits read: [xeokit-sdk][xk] `a7aa362`, [Potree][po] `b58a590`, [CloudCompare][cc] `d38474b`, [MeshLab][ml] `71e7b0b` (its `vcglib` submodule from the `devel` branch), [Online3DViewer][o3] `d025663`, [SuperSplat][ss] `70bbed7`, [3D Visualizer][klein-src] `bfd5981`, [URDF Visualizer][mf-src] `9fa820e`, [foxtrot][fx] `69fb376` and [occt-import-js][oij] `41e4708` (the two commits `packages/mesh-splat/vendor/build.sh` builds from).
- Pixel figures marked "computed" are arithmetic on a constant in the source, not measurements.
- Nothing was installed and run. "Hover marker" means the code draws something at the cursor before the click.

Limits:

- Foxglove's 3D panel is closed source, so its snap radius and what "near" means are not known. Onshape and Autodesk Viewer are closed source too; only their docs were read.
- CAD Preview, q3dviewer and 3D Mesh Viewer have no readable source or no measuring docs beyond the Marketplace page; only the page was read.
- Reddit and the CloudCompare forum search were not read in bulk (see [user-needs.md](user-needs.md) for the Reddit limit). The CloudCompare forum was only searched through the web search tool, which found no thread asking for snapping.

## What competitors snap to

Radius is in screen pixels unless noted. "Nearest point" means the point cloud's own sample.

| Tool | Point cloud | Mesh | CAD / B-rep | Preview before the click | Radius |
|---|---|---|---|---|---|
| [CloudCompare][cc] | Nearest point inside a pick window (`pointPicking`, then the nearest by distance) | Position inside the triangle, with barycentric coordinates; no vertex or edge snap. In wireframe display only the edges are tested | none; the Align tool can ask to use a sphere entity's center ([CHANGELOG v2.11.0][cc-log]) | None found: picking runs on the click, deferred by a 100 ms timer; the cursor changes to a cross ([v2.13.0][cc-log]) | `DefaultPickRadius = 5` px |
| [MeshLab][ml] | not applicable | Depth buffer read at the pixel, unprojected (`Pick`): the exact surface point, no snapping. PickPoints also reads the face for its normal | none | A rubber-band line follows the cursor after the first pin; a custom cursor image | none |
| [Potree][po] | GPU pick of a 65 x 65 px window around the cursor, keeps the hit nearest the window center. Clipped-away points are skipped (`pickClipped`) | not applicable | not applicable | The marker sphere is dragged under the cursor while placing | 65 px window (about 32 px each way) |
| [SuperSplat][ss] | splats: `camera.intersect` at the click, no snap | same | not applicable | None: the `pointermove` handler only cancels a click after more than 4 px | none |
| [Foxglove][fg-3d] | Alt / Option held: snaps to point cloud points, cube faces and line segments "when the cursor is near one"; without it the endpoint lands on the ground plane | as above (only cube faces are named) | not applicable | not documented | not documented |
| [Rerun][rr-sel] | no measure tool | no measure tool | not applicable | not applicable | not applicable |
| [xeokit][xk] | not applicable | Vertex and edge snap, on by default, one flag for both; edges come from a normal-angle threshold (10 to 20 degrees by format) for formats without B-rep | Same code path for XKT/BIM models | Marker turns green when snapped and pink when on a surface; an optional magnifier ("pointer lens") shows the snap | 30 px (`CameraControl#snapRadius`) |
| [Online3DViewer][o3] | not applicable | Ray hit on a face, no snap; the marker is a circle and cross oriented by the face normal, sized to 1/20 of the model's bounding sphere. Also reports the angle between the two faces and, when parallel, the distance between the planes | STEP loaded as meshes, so the same | Yes, a marker follows the cursor | none |
| [Autodesk Viewer][aps-snap] | not applicable | Snap result has `getVertex()`, `getEdge()`, `getFace()`; geometry types (`SnapType`, from the [blog][aps-blog]) include vertex, midpoint, intersection, circle center, edge, circular arc, curved edge, face, curved face | same | An indicator overlay, drawn in the example tool only for the point-like types | not documented |
| [Onshape][on-measure] | not applicable | not applicable | Measure takes selected faces, edges and vertices (entities, not cursor points); a circle's center is measured by selecting its face or edge. The page does not mention snapping | Hovering a measurement row draws it; hover over entities not documented | not applicable |

VS Code extensions (from [competitors.md](competitors.md)):

| Extension | What was read | Snapping |
|---|---|---|
| [URDF Visualizer][mf] | Source: `measure-controller.ts` | None. A raycast hit on the robot; a temporary point, a live coordinate label and a live distance label follow the cursor on `mousemove` |
| [3D Visualizer][klein] | Source: `SelectionManager.ts`, `WebGPUPointPicker.ts` | Point picking is screen space: the front-most point whose rendered footprint (point size / 2 + 3 px + padding, capped at 150 px) covers the cursor. It avoids `Raycaster` because that costs more when a zoomed-out view puts the whole cloud near the cursor. I did not trace whether its Shift-double-click measure uses this exact function |
| [q3dviewer][q3d] | Marketplace page | Ctrl + click distance; the page mentions no snapping |
| [CAD Preview][kratos] | Marketplace page | Measures distance, edge length, angle and circle / arc radius. The only snapping the page names is "snap onto nearby existing vertices" for the transform gizmo, off by default |
| [3D Mesh Viewer][atl] | not read for measuring | Not checked in depth |

Observations:

- Nobody snaps in a point cloud beyond "the nearest real sample in a pixel window" (CloudCompare 5 px, Potree about 32 px). Foxglove adds a modifier key for it.
- Vertex and edge snapping is a CAD / BIM feature (xeokit, Autodesk Viewer). Even there, xeokit derives edges from triangle normals when it has no B-rep, which is exactly our situation for meshes.
- Foxglove ships snapping off by default and on while Alt / Option is held ([changelog v2.52.0][fg-log], 2026-05-05); xeokit ships it on by default. No source says which default users prefer.
- A hover marker is common among tools that show their measuring state (Online3DViewer, URDF Visualizer, Potree, MeshLab's rubber band, xeokit), absent in CloudCompare and SuperSplat.

## What we do now

From `packages/mesh-splat/webview/main.js` (`pickAt`, the measure click handler) at `5020123`:

- Clouds: `Raycaster` with `Points.threshold = camera distance to target * 0.01`, the first hit along the ray (front-most), then the hit point's own position. Computed: with the 50 degree vertical field of view (`PerspectiveCamera(50, ...)`), the threshold is 0.01 * H / (2 tan 25 degrees) = about 0.0107 H px at the target's depth, 8.6 px for an 800 px tall view; it is larger for points nearer the camera and smaller for farther ones, because three.js applies one world-space threshold to all points.
- Meshes: the ray-triangle intersection, no snapping, no hover marker. Splats are not picked.
- Front-most is the rule that avoids the complaint in [Potree #1486][po-1486] (snapping to points behind the surface).
- Per-move cost is not measured: a `Points` raycast is linear in the point count, and 3D Visualizer's comment above says it moved away from it for that reason. A hover marker needs the pick on every move, so this has to be timed on the largest cloud in `test-files/` first (call `pickAt` 100 times, take the median).

## Demand

Counts are distinct people (author, commenters who ask for the same thing, reactions). All of these were read in full or by their comments; the ones counted ask for snapping, not for measuring in general.

Point cloud and splat users:

| Request | People | Source |
|---|---|---|
| Distance tool snaps to points removed by the clipping volume instead of the visible ones (closed 2015) | 3 | [Potree #188][po-188] |
| Point and line tools snap to points far behind the surface | 1 | [Potree #1486][po-1486] (open, no reply) |
| Snap the measurement to an axis | 1 | [SuperSplat #128][ss-128] (comment by CiberNin; the issue itself asks to measure between splats) |
| A click on a paper's corner needs to land on the corner or the error grows | 1 | [SuperSplat #35][ss-35] (comment, one of about 12 participants asking for measuring) |

Nobody asked for snapping in the CloudCompare, MeshLab, Rerun or Foxglove trackers I searched. The Rerun requests ([#6254][rr-6254], 7 thumbs up; [#6751][rr-6751]) and the Foxglove [discussion 1245][fg-1245] (angles in the measure tool) are about having a measure tool and its readout. The issues cited by #29 for point cloud users (Potree #247 and #514) are about exporting measurements.

CAD, BIM and mesh users (web viewers, the closest to STEP and meshes):

| Request | People | Source |
|---|---|---|
| Cursor should snap to vertices when measuring (closed 2019 by xeokit's own snap pass) | 5 (including the maintainer) | [xeokit #128][xk-128] |
| Snap the distance endpoints to object edges / vertices | 3 | [xeokit #981][xk-981] |
| Snapping too aggressive between close edges; the pointer is tiny; highlight the edge it snapped to; tune the radius | maintainer, 1 commenter, 3 thumbs up | [xeokit #1255][xk-1255] |
| Magnet-like snap to mesh corners and edges, as Autodesk Viewer does | 2 | [three.js forum, 2024-05][tj-66192]; the answer was "nearest vertex of the hit face, average of each vertex pair" |

Two more BIM viewer issues ask for snapping or report snap bugs ([magnusfjeldolsen/ifcviewer #60][ifc-60], [LTplus-AG/ifc-lite #8659][ifc-8659]), but their authors are the maintainers, so they are not counted. [user-needs.md](user-needs.md) records no snapping request in the VS Code extension trackers (its only measuring item is mm units, MorningFrog #18); I did not re-search them.

Reading: demand for snapping comes from CAD / BIM and mesh measuring, where the numbers must hit a corner. Among point cloud users it is thin (a handful of people), and what they ask for is picking the right point (not one behind the surface, not a clipped one), which the front-most rule already does.

## STEP / IGES: is there topology to snap to?

Our STEP path (`packages/mesh-splat/webview/step-worker.js`, `step-load.mjs`, `step.mjs`, `step-cache.mjs`):

- foxtrot first, for STEP with a known length unit; OpenCascade (`occt-import-js`) for IGES, an unknown unit, or when foxtrot fails or yields nothing.
- Whichever runs, the page ends with `positions`, `normals`, `indices` and color groups only. The cache (`robot-preview-step-cache-3`) stores the same four things. No face id, edge, curve or surface type survives to the page.

foxtrot (read at `69fb376` plus our patch):

- Internally it has the B-rep: `advanced_face` triangulates each face, `face_bound`, `edge_loop`, `edge_curve` and `curve` walk the bounds and turn each edge curve (circles included) into a polyline that constrains the face's triangulation ([triangulate.rs][fx-tri]).
- It outputs none of it: `Mesh` is `verts` (position, normal, color) and `triangles`; our patched `StepMesh` adds `positions`, `normals`, `colors`, `indices`, `faces` (a count) and `failed` (a count). Each assembly instance is copied with new vertices (`triangulate`); whether vertices are shared between faces was not checked.
- So edges, circle centers, radii and face planes are all computed inside foxtrot and thrown away. Emitting them means patching the Rust (the repo already carries `patches/foxtrot.patch` and a nightly-Rust WASM build, `vendor/build.sh`).

OpenCascade via occt-import-js (read at `41e4708`):

- The binding ([js-interface.cpp][oij-js]) writes per mesh `attributes.position`, `attributes.normal`, `index` and `brep_faces`. A `brep_faces` entry is only `{ first, last, color }`: the triangle range of one B-rep face and its color. The README documents the same fields ([README][oij-readme]). There are no edges and no surface or curve types in the output.
- Each face's vertices are its own nodes (`OcctFace::EnumerateVertices` walks `triangulation->Node`), so a vertex on a shared edge appears once per face.
- Our `occtObject` uses `brep_faces` only to color triangles, then `groupByFace` reorders triangles by color and the face ranges are dropped.
- The topology exists in OpenCascade itself: `BRepMesh_IncrementalMesh` (called in `importer-utils.cpp`) discretizes edges too; [`BRep_Tool::PolygonOnTriangulation`][occt-tool] returns an edge's polyline on the face triangulation, [`BRepAdaptor_Curve::GetType`][occt-curve] distinguishes Line / Circle / Ellipse / ... and `Circle()` gives a `gp_Circ`, and [`BRepAdaptor_Surface::GetType`][occt-surf] distinguishes Plane / Cylinder / Cone / ... . Getting those out needs a C++ change to occt-import-js and a rebuild of the WASM (the repo builds it from a pinned commit plus `patches/occt-import-js.patch`).

So: B-rep edges, circle centers and face types are not available today from either library's published output. They exist inside both, and both would need a patch plus a cache-format change; the two paths would have to emit the same shape.

What the tessellation does give, with no patch:

- Triangle vertices. On a planar face, foxtrot's and OpenCascade's triangulations take their vertices from the face boundary (and possibly extra interior points), so a vertex snap lands on real corners there. On curved faces the vertices are arbitrary samples along arcs. This is inference from how constrained triangulation works, not checked on our files; to verify, load `test-files/` STEP samples and print the nearest-vertex distances to known corners.
- Crease and boundary edges from adjacent triangles, the way xeokit does for glTF/STL/OBJ (`buildEdgeIndices`, `edgeThreshold` default 10 or 20 degrees). It needs a welded vertex lookup, because OpenCascade's vertices are per face and foxtrot's may be.
- Face normals, so "distance between parallel faces" and "angle between faces" (Online3DViewer) cost almost nothing.

## Recommendation (80/20)

Ordered by value for work. File names are in `packages/mesh-splat/webview/`; the sizes are my estimates, not measurements.

1. **Hover marker with live readout, no snapping.** Evidence: most tools that show measuring state have it (table above), and xeokit's own maintainer lists a hard-to-see pointer as the first UX fix ([#1255][xk-1255]). Change: a throttled `pointermove` handler in `main.js` that reuses `pickAt` and draws the existing mark style (`measureMarks`), a crosshair cursor in measure mode, and the coordinate shown in `#measure-readout`. Small. Do the cost check first (above); if `Points` raycasting is too slow on the big clouds, preview on meshes only or pick only after the pointer rests.
2. **Mesh vertex snap inside a pixel radius, with the marker changing when it snaps.** Evidence: xeokit and Autodesk Viewer ship it; five xeokit and three.js threads ask for it; it is the cheapest of the CAD snaps. Change: a pure function in `measure.mjs` taking the hit's triangle (`hit.face.a/b/c` into `geometry.attributes.position`, through `matrixWorld`), the camera and a radius, returning the nearest projected vertex within the radius; unit test in `tests/mesh-splat/measure.test.mjs`; the click handler and the hover handler call it for `isMesh` hits. Small to medium. Radius: start near CloudCompare's 5 px to xeokit's 30 px and tune; xeokit users found 30 too aggressive between close edges ([#1255][xk-1255]), so expose it as a constant first and pick by trying. A key that turns snapping off (Foxglove's Alt inverts it: snap only while held) is cheap and settles the "too aggressive" complaint either way.
3. **Cheap extras from face normals** (not snapping): angle between the two picked faces, distance between parallel faces. Evidence: Online3DViewer implements them; no user asked in the trackers read. Small, in `measure.mjs`, only if a mesh or CAD user asks.

Not now:

- **Edge and midpoint snap.** On a triangulated mesh the nearest triangle edge is usually an interior diagonal, not a feature, so it needs crease / boundary edge extraction with welded vertices (xeokit's `buildEdgeIndices` is the precedent). Medium to large; it must be built lazily per hovered mesh because the big STEP assemblies have millions of triangles (3.67M in `docs/mesh-splat.md`). Do it only if vertex snap is used and people still miss edges.
- **B-rep edges, circle / arc centers, face-plane snaps for STEP / IGES.** Large: patch foxtrot's Rust and occt-import-js's C++, add edge and face tables to the worker messages and to the cache format (and invalidate existing caches), and keep both paths in agreement. It is also the only way to get circle centers. No user of our viewers or of the other STEP viewers asked for it, and the one STEP competitor that measures radius and edge length (CAD Preview) does it as entity measurement, not as cursor snapping. Revisit if a STEP user files it.
- **Point cloud snapping beyond the nearest real point.** No competitor does it except Foxglove's modifier-key snap; the demand is about picking the right point, which the front-most rule covers. Keep the current rule. Switching the world-space threshold to a pixel one is a possible later tweak (CloudCompare 5 px, Potree about 32 px) but nobody asked.
- **Snap to axis** (one comment in [SuperSplat #128][ss-128]) and **splat snapping** (splats are excluded in #29).

## Not found or in conflict

- Foxglove: snap radius and the hover indicator are not documented, and the source is closed; the docs name "cube faces, point cloud points, and line segments", the changelog says "scene objects". Both agree it needs Alt / Option.
- Autodesk Viewer: the `SnapResult` reference lists vertex / edge / face only and its link to `SnapType` is broken. The full type list above comes from the APS blog post "Snappy viewer tools" ([blog][aps-blog]); the snap radius is not documented anywhere I found.
- xeokit has two constants for the default radius: `CameraControl.js` uses 30, `PickController.js` declares 45; the 45 is not used in that file (the radius is read from the control's config), so the effective default is 30.
- CloudCompare: I found no hover marker, but did not rule out one in the Point picking tool's own overlay; no forum thread asking for snapping was found.
- Onshape: the Measure page does not mention snapping or hover highlighting of entities; whether Onshape snaps at all is unknown from primary sources.
- 3D Visualizer: not confirmed that its measure path uses the screen-space picker.
- Demand counts are small and from different years (Potree #188 is from 2015), so they say what kind of user asks, not how many would.

[i29]: https://github.com/chenyuting3077/robot-preview/issues/29
[xk]: https://github.com/xeokit/xeokit-sdk/tree/a7aa362
[po]: https://github.com/potree/potree/tree/b58a590
[cc]: https://github.com/CloudCompare/CloudCompare/tree/d38474b
[cc-log]: https://github.com/CloudCompare/CloudCompare/blob/d38474b/CHANGELOG.md
[ml]: https://github.com/cnr-isti-vclab/meshlab/tree/71e7b0b
[o3]: https://github.com/kovacsv/Online3DViewer/blob/d025663/source/website/measuretool.js
[ss]: https://github.com/playcanvas/supersplat/blob/70bbed7/src/tools/measure-tool.ts
[klein-src]: https://github.com/kleinicke/ply-visualizer/tree/bfd5981
[mf-src]: https://github.com/MorningFrog/urdf-visualizer/blob/9fa820e/webview/src/modules/measure-controller.ts
[fx]: https://github.com/Formlabs/foxtrot/tree/69fb376
[fx-tri]: https://github.com/Formlabs/foxtrot/blob/69fb37688892246e670fc08eb60b7d3a92d70d3f/triangulate/src/triangulate.rs
[oij]: https://github.com/kovacsv/occt-import-js/tree/41e4708
[oij-js]: https://github.com/kovacsv/occt-import-js/blob/41e470890ae0f9dc69ac50ffd5fc73e03576f4eb/occt-import-js/src/js-interface.cpp
[oij-readme]: https://github.com/kovacsv/occt-import-js/blob/41e470890ae0f9dc69ac50ffd5fc73e03576f4eb/README.md
[occt-tool]: https://occt3d.com/dev/doc/refman/html/class_b_rep___tool.html
[occt-curve]: https://occt3d.com/dev/doc/refman/html/class_b_rep_adaptor___curve.html
[occt-surf]: https://occt3d.com/dev/doc/refman/html/class_b_rep_adaptor___surface.html
[fg-3d]: https://docs.foxglove.dev/docs/visualization/panels/3d
[fg-log]: https://docs.foxglove.dev/changelog/foxglove/v2.52.0
[fg-1245]: https://github.com/foxglove/community/discussions/1245
[rr-sel]: https://rerun.io/docs/reference/viewer/selection
[rr-6254]: https://github.com/rerun-io/rerun/issues/6254
[rr-6751]: https://github.com/rerun-io/rerun/issues/6751
[aps-snap]: https://aps.autodesk.com/en/docs/viewer/v7/reference/MeasureCommon/SnapResult
[aps-blog]: https://aps.autodesk.com/blog/snappy-viewer-tools
[on-measure]: https://cad.onshape.com/help/Content/View/measure_tool.htm
[mf]: https://marketplace.visualstudio.com/items?itemName=morningfrog.urdf-visualizer
[klein]: https://marketplace.visualstudio.com/items?itemName=kleinicke.ply-visualizer
[q3d]: https://marketplace.visualstudio.com/items?itemName=panasonic-ad.q3dviewer
[kratos]: https://marketplace.visualstudio.com/items?itemName=kratos-multiphysics.cad-preview
[atl]: https://marketplace.visualstudio.com/items?itemName=AssetToolLabs.mesh-viewer-vscode
[po-188]: https://github.com/potree/potree/issues/188
[po-1486]: https://github.com/potree/potree/issues/1486
[ss-35]: https://github.com/playcanvas/supersplat/issues/35
[ss-128]: https://github.com/playcanvas/supersplat/issues/128
[xk-128]: https://github.com/xeokit/xeokit-sdk/issues/128
[xk-981]: https://github.com/xeokit/xeokit-sdk/issues/981
[xk-1255]: https://github.com/xeokit/xeokit-sdk/issues/1255
[tj-66192]: https://discourse.threejs.org/t/bim-software-measurment-snapping-to-corners-and-edges/66192
[ifc-60]: https://github.com/magnusfjeldolsen/ifcviewer/issues/60
[ifc-8659]: https://github.com/LTplus-AG/ifc-lite/issues/8659
