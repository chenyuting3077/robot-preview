# Robot Preview: Mesh & Splat

Load times and memory are measured in VS Code 1.144 with `tests/e2e/vscode.mjs` (2026-11-17, old and new builds interleaved in one session) unless marked otherwise. Pitfalls met along the way: issues #1, #2, #4.

## Splats: Spark

- Spark, not PlayCanvas: PlayCanvas rendered nothing under ANGLE's Vulkan backend, and Spark is three.js, so meshes and splats share one scene.
- Spark is 2.4 MB of inlined WASM and loads only when a splat opens. 881 k splats show in 2.1–2.2 s and orbit at the 60 fps vsync limit, as with 0.2.0 (2.0–2.1 s); 243 k splats in 1.3–1.4 s.
- Spark needs three ≥ 0.180 while the URDF viewer is on 0.163, so this package keeps its own `node_modules`.
- 2DGS PLY has no `scale_2`; one of `ln(1e-6)` is added so Spark draws each disc as a flat Gaussian (binary little-endian only).

## Defaults

- Files that declare no up axis start at `+Z`, as in ROS; raw COLMAP / 3DGS splats need `-Y` by hand.
- The camera frames the 2nd–98th percentile of splat centres, so floaters don't shrink the view.
- Frames are drawn only for 1.5 s after input, camera motion or a load: Spark finishes sorting splats for a camera that stopped within that, and an idle view makes no draw calls (`tests/e2e/mesh-splat.mjs` counts them).
- Point-cloud PLY keeps up to 16 vertex properties besides position, normal, uv, color and alpha as colorable fields; meshes keep none, so a 181 MB mesh does not grow.
- `.asc`, `.bin`, `.usda`, `.yaml` and `.yml` are optional editors (PGP signatures, firmware and model weights, hand-edited text, config files that are not maps). `retainContextWhenHidden` is on: re-reading a 200 MB splat on a tab switch takes seconds. A view whose files add up to 100 MB or more drops its page after 5 minutes hidden, and loads again with the camera kept when shown, so a GB cloud left in a background tab does not hold its 1–1.5 GB until the tab closes. A page still loading is left alone until it reports done, so a hidden OpenCascade run is not thrown away.

## Large point clouds

- VS Code reads a fetched webview resource whole before handing it over: a 1.2 GB PCD grew the webview by 1.6 GB with the viewer keeping one point. PCD (binary, ASCII and `binary_compressed`) is therefore read by the extension in 16 MB pieces, three in flight (one at a time: 17 s against 7.6 s). `binary_compressed` stores columns, so it is inflated whole before its points are read. A 7.1M-point map against PCDLoader: ASCII 238 MB 3.8–4.1 s, +1.1–1.2 GB against 4.4–5.7 s, +2.4–2.5 GB; `binary_compressed` 84 MB 2.1 s, +0.9 GB against 2.4–3.0 s, +1.4–1.7 GB.
- Past 10M points an even 10M are shown, and the info popover says so. "Load detail in view" (Display menu) reads the file again for the points in the camera's view, up to 10M more, instead of a Potree-style octree, which would follow the camera but needs a converted copy of the file. Livox map zoomed in: 4.5 s, +0.6 GB (2 runs). The intensity / height range stays the one of the loaded sample, so the detail does not recolor the rest.
- KITTI / nuScenes `.bin` scans have no header: the layout comes from the name (`*.pcd.bin` is nuScenes' 5 floats, any other `.bin` KITTI's 4), and a size that is not whole points is the only sign that some other `.bin` was opened, so it is refused before reading. They stream and sample like PCD.
- 1.2 GB, 38.9M-point Livox map: 5.0–5.3 s, +1.2–1.5 GB, 21 fps orbiting (7 runs); 0.2.0 cannot open it. 181 MB, 4.5M-face binary PLY mesh: 1.8 s, +1.05 GB; 0.2.0 went past 6 GB.

## UTM coordinates

- float32 positions snap to 0.25 m at a northing of 4e6 (0.5 m past 4,194,304) and 3 cm at an easting of 5e5: `cloud-utm.ply` (3000 points in a 2 m disc) drew as about 100 dots, 0.09% of the frame against 2.88% for the same disc at the origin. Point-cloud readers (xyz / pts / asc, PCD, point-cloud PLY, KITTI / nuScenes `.bin`) therefore take an offset out in float64 before float32 from every axis whose median reaches 10 km, rounded to a whole km, whichever axis is up: elevations stay as stored, and the height legend adds the cloud's position back, so it reads real heights. Height colours are computed as float32 absolute heights, though: with the up axis set to a far axis (a northing near 4e6 m) they band at 0.25 m, even though the points themselves keep their detail. Info shows the offset. This restores detail only where the file holds it, in text, ASCII and double (PCD F8, PLY `double`) positions; a file that stores float32 (PCD SIZE 4 TYPE F, the usual PCL output, PLY `float`, every KITTI / nuScenes `.bin`) was snapped when written and only stops jittering. Meshes, splats and STEP keep their coordinates.
- The offset comes from the first 65,536 real points, held in float64, and the rest are written as float32 straight away: the streamed PCD reader cannot see the whole file first, and recentering a whole float64 copy took a 10M-point UTM xyz (310 MB) from +512 MB to +868–871 MB at its peak and the same cloud as ASCII PLY from +462 to +703 MB; now +515 and +465 MB (Node 22, Apple M2, 3 runs each, within 3 MB). Rows at exactly 0 0 0, which organized and sensor-ordered clouds use for no return, often for whole leading scan lines, are left out like non-finite ones, holding up to 524,288 rows (12.6 MB) to find real points. The median, not the bounds, so one stray point 10 km out leaves an indoor scan alone; and an axis moves only when its median lies farther out than the sample's 2nd–98th percentiles span, so a local corridor 22 km long keeps its origin end. Later points lie at most the cloud's extent from the offset, and float32 keeps 1 mm up to 16 km, so only a cloud wider than ~15 km loses detail; what the first points do not show, the offset cannot allow for.
- The cloud object is then put back at the offset instead of drawing the scene in recentered coordinates: three.js composes each model-view matrix in float64, so the GPU only gets the camera-to-cloud step, while the file's origin (the axes) and the grid's lines stay at real coordinates without knowing the offset; only Load detail in view hands it to the reader, so the points it reads again come out the same. Orbiting in 1-pixel drags moved the drawn points' centroid 5–18 px per step before and 0.1–0.6 px after, the same as at the origin. A 400-point lattice whose UTM coordinates float32 holds exactly still jumped up to 13 px before (up to 2.2 px after, 1.7 px at the origin), so the jitter came from the GPU rounding the large translation, not only from the snapped points (Chrome, ANGLE Metal, Apple M2).
- A PCD that PCDLoader reads (one this reader does not know) and a PLY that PLYLoader reads were stored as float32 by the loader: the cloud is placed the same way, but the lost precision does not come back. Their bounding sphere, computed at the file's coordinates, culled the placed cloud until it was dropped.
- Time with recentering, 10M UTM points: binary PLY 153–166 ms against 126–130 ms without (medians of 7, three orders), ASCII PLY 3.47–3.60 s against 3.30–3.48 s, xyz 2.75–2.79 s against 2.80–2.91 s (3 runs each; Node 22, Apple M2).
- The colour legend gives both ends the decimals their difference needs, up to what float32 holds at their size. Extreme ranges may still round or show equal ends: a range only one or two float32 steps wide, a flat range of 10 million or more (digits past the 7th rounded), and values around 1e20, whose labels no longer fit side by side.

## Several files in one view

- Each file is a Stage row that shows, hides, colors (one solid color per file among the modes) or removes it.
- Adding or removing a file re-renders the page: the list must outlive a reload, and a page can fetch only from the roots the extension sets. The view a page leaves reaches the next through the webview state; that this state outlives `webview.html` being set again is how VS Code's webview host is written, not yet checked in a real window (the e2e harness keeps it in `sessionStorage`). A changed file still resets the view (reloading one file in place is the follow-up if that gets annoying). The roots change in the same step as the page, in case VS Code reloads the old page when they change (not checked in a real window either); reads and image requests from an old page are dropped either way.
- An added file deleted on disk stays listed as not found, the view kept; written again, it comes back the same way. That page is rendered by the extension, not asked for by the page, so it takes the view the page last saved, up to 300 ms old while the camera moves. The opened file deleted leaves the old page up, adding and removing refused; written again, it resets the view like any change.
- A drag from the Explorer does not reach the view on macOS, Shift or not. VS Code (1.147) turns a webview's pointer events off when a workbench drag starts and back on only while its `drag` / `dragover` events report Shift held; on macOS they report it up, so a test page logged `dragenter` with Shift and `dragleave` in the same millisecond, and the drop opened the file in a tab. Windows and Linux are not checked. *Add file…* and the Explorer's *Add to Point Cloud View* (several files at once) are the ways in; the page's drop handler stays for where a drop does arrive. The Explorer entry goes to the view used last; with none open, its first file opens one.
- Height and field ranges count hidden files too, so hiding a file does not recolor the others. The legend shows the Display menu's last mode while a cloud uses it, else the first ranged mode in file order.
- Solid colors are Tableau 10, reordered so the first two files (a map and a scan) are orange and blue: apart from each other, from turbo's middle and from both backgrounds.
- *Load detail in view* reads each sampled cloud that is shown and in view, one after another, each a full re-read of its file.
- STEP and IGES take no part: they start `+Y` and keep their own cache path.
- Defaults follow the opened file: a cloud's grid and axes, a map's top-down camera. An added map keeps its cells under Wireframe and Points, which are for the meshes.

## Comparing files

- Distance colors measure each point (or mesh vertex) to the nearest point of a reference cloud or the nearest triangle of a reference mesh, exact, as CloudCompare's C2C / C2M do; there is no maximum search distance, so a scan's far returns get their true distance. Not signed, and no M3C2: both need normals.
- A bounding-volume hierarchy, built once per reference file in a Web Worker and asked again for every file and detail cloud measured against it; the worker ends when no file uses that reference, giving back its copy of the reference and the tree (not measured in VS Code; the Node benchmark below peaked at 1.7 GB resident with a 10M-point and a 10M-triangle reference and 10M queries alive at once). 10M points against 10M points: 6.1 s to build, 13.4 s to query; against 10M triangles 7.4 s and 15.0 s; 1M against 1M about 0.5 s and 1.2 s (Node 22, Apple M2, one run each, a synthetic floor and wall in scan order; not measured in VS Code).
- Everything goes into the root's frame less the reference file's center in float64 before float32, so two UTM clouds compare at the detail they were stored with.
- The reference is its file's loaded points: past 10M the sample, not *Load detail in view*'s. Detail of a measured cloud is measured when it arrives.
- The scale starts at 0 and ends at the 98th percentile unless a top is typed. The first tolerance is three times the median distance rounded to 1, 2 or 5 of a power of ten, a guess at registration noise, not checked against real pairs. *Hide within tolerance* discards in the shader, so dragging the tolerance recolors nothing.
- A mesh in any mode but Original is drawn through a copy of its geometry that shares every attribute but color, with a plain vertex-colored material; Original puts its own geometry and materials back, textures included. The Display menu's color buttons still set clouds only.
- Side by side draws one canvas twice with a scissor, each half showing its side's files: two canvases would upload every geometry twice. Zoom toward the cursor is off while split (OrbitControls measures the pointer against the whole canvas) and zooms toward the center instead; picking maps the pointer into its half.
- `F` frames for the narrower of the two fields of view, so a half (taller than wide) takes the model in; a single view wider than tall frames as before.

## USD

- three 0.187's `USDLoader` reads USDA / USDC / USDZ. `@needle-tools/usd` is non-commercial; TinyUSDZ 0.9.1 failed all five test files.
- Composition (references, payloads, sublayers, variants) is done here, not by three: three stacked a whole H1 humanoid on every link (10.6 M faces instead of 0.39 M). Its crate-reader fixes override private methods, so three is pinned to an exact version.
- MDL is not run: OmniPBR shaders (every sampled Isaac Sim robot) are mapped onto three's physical material by their constants and textures.
- Legacy NuRec volumes (`omni:nurec:isNuRecVolume`, a gzipped MessagePack `.nurec` of float16 3DGUT tensors) are copied into a 3DGS PLY as stored, without converting their parameters (see `nurec.mjs`).
- NuRec `zh_lounge` (1M Gaussians, SH degree 3, 118 MB `.nurec`) takes 37 s in headless Chrome on SwiftShader, but opens acceptably in VS Code on real hardware, and looks right once framed. Isaac's metallic (`metallic_constant = 1`) parts look dark without an environment map; accepted for now.
- Composition matches `usdcat --flatten` on 50 hand-made and 391 random stages except: a cycle through a variant composes one level more, a variant selection authored only on a weaker reference is not applied, and a relationship to the referencing prim through an internal reference is kept where pxr drops it.
- Variant fallbacks from plugin metadata are not known here: a variant set with no selection applies no variant; a selection authored inside another variant is not read.
- Not supported: MaterialX and MDL shaders other than OmniPBR, PointInstancer, `specializes`, `inherits`, time-sampled visibility, `!resetXformStack!`, `omniverse://` paths.

## STEP

foxtrot (Rust, patched) tessellates; OpenCascade (`occt-import-js`, rebuilt at `-O3`) runs only when the length unit is ambiguous or foxtrot fails. Time to the first frame and growth of all processes:

| File | OpenCascade | foxtrot, first open | foxtrot, cached |
|---|---|---|---|
| Respeaker, 2.7 MB | 3.0 s, +0.76 GB | 1.1–1.3 s, +0.47–0.49 GB | 0.9–1.0 s, +0.43–0.50 GB |
| 719E, 18 MB | 7.3 s, +1.09 GB | 1.7–1.8 s, +0.73–0.91 GB | 0.9 s, +0.44 GB |
| EEP500T, 30 MB | 18.1 s, +2.46 GB | 2.4–2.5 s, +1.18 GB | 1.3 s, +0.64 GB |
| AMR, 39 MB | 59.3 s, +2.78 GB | 3.0–3.3 s, +1.07–1.18 GB | 1.2 s, +0.61–0.63 GB |
| Assembly, 161 MB | no triangles after 116 s | 16.3–17.1 s, +1.84–1.90 GB | 1.3–1.4 s, +0.67–0.72 GB |

- Upstream foxtrot leaves faces as holes (Respeaker 3, 719E 6, EEP500T 20, AMR 117 of 18,255); the patched one leaves 2 of the AMR's. A bound that crosses itself once lowered to 2D is triangulated without constraints and kept by the even-odd rule; closed B-splines, trimmed curves, swept circles and a non-converging UV search are handled. The Respeaker's surface area is 99.7% of OpenCascade's, against 70% upstream. The extra triangles cost the 161 MB file 15.9–17.2 s against 13.9–14.2 s and the AMR 3.0–3.3 s against 2.9–3.1 s; the others are unchanged (3 runs each, interleaved).
- OpenCascade is rebuilt at `-O3` (12.1 MB of WASM against 7.6 MB) from the shipped `-Oz`: the AMR in 55–59 s against 80–82 s, EEP500T in 17.8 s against 20.1–20.2 s, with the same faces. Zipped in the `.vsix` it is 3.9 MB of 5.8 MB; it ships rather than downloads on the first STEP so STEP opens offline and the webview's CSP needs no network source.
- foxtrot runs up to 4 workers, each parsing the whole file, fewer for big files so their memory stays under 1.5 GB. One worker against that: EEP500T 3.9–4.0 s against 2.4 s, the AMR 5.9–6.0 s against 2.9–3.1 s, the 161 MB file 24.1–24.2 s against 14.0–14.1 s for 0.2–0.3 GB less memory.
- Memory peaks the second before the first frame, while every worker is alive, and WASM memory never shrinks. So each worker packs a solid into f32 and drops the entities it parsed for it as soon as the solid is built, instead of holding the whole model in f64 vertices (72 bytes each) and every entity until the end; and it grows its output in 1 MB blocks copied straight into JS arrays, instead of Vecs that double and leave their old space behind. The 161 MB first open grows the webview by 1.23–1.28 GB and all processes by 1.84–1.90 GB; without the blocks the webview grows by 1.31–1.41 GB, and without either change by 1.55–1.58 GB (all processes 2.17–2.29 GB); about 0.5 GB of the total is VS Code's own processes growing in their first 1.2 s, before the file is read (one run). The AMR's webview grows by 0.67–0.69 GB against 0.93–1.02 GB. Same speed (3 runs each, interleaved).
- Each editor writes the cache to its own `.part` and renames it into place, so two editors of one file opened at once (`SPLIT=1` in `tests/e2e/vscode.mjs`) leave one cache file and no `.part`, which the next open reads (AMR: 1.4 s, 2 runs).
- The cache is meshopt buffers, not glTF: 25.6 MB against 139 MB as GLB for the 161 MB assembly, and glTF's meshopt extension would have meant writing its accessors by hand for no reader but ours.
- truck (`truck-stepio` 0.3.0) is no replacement: it drops assembly placements, and was slower than foxtrot and ran out of memory on the 161 MB file outside VS Code.
- STEP has no up axis; it starts `+Y` because the AMR (Autodesk) is Y-up.
- IGES goes to OpenCascade only (foxtrot reads STEP alone), starts `+Y` like STEP, and is cached like STEP.
- foxtrot's WASM is built with unwinding (nightly `-Zbuild-std`, `vendor/build.sh`), so a panic skips its face; stable Rust's WASM std only aborts, which loses the whole file to OpenCascade.

## Occupancy grid maps

- A `.pgm` opens as a map with the same-named `.yaml` beside it, else as a greyscale image. A `.yaml` / `.yml` opens through *Reopen Editor With…* and may name a PGM or PNG image.
- Cells follow Nav2 Jazzy's `map_io.cpp` (8-bit grey, float32 thresholds, any alpha below 255 unknown in `trinary` and `scale`, `raw` ignoring `negate`). Humble and ROS 1 differ at the edges: strict threshold comparisons, `rint` in `scale`, and in `trinary` alpha averaged into the grey instead of making the cell unknown.
- `occupied_thresh` / `free_thresh` missing from the YAML (Nav2 requires them) default to 0.65 / 0.196, the values most maps carry: with Nav2 map_saver's own default free 0.25, map_saver's unknown grey 205 (occ 0.19608) reads as free.
- Colors are RViz's Map display `map` scheme (`palette_builder.cpp`), opaque; RViz draws the map at alpha 0.7 by default.
- 4000 × 4000 cells (15 MB PGM): shown in 0.4–0.8 s (4 runs, `tests/e2e/mesh-splat.mjs` in headless Chrome on Metal, Apple Silicon; not measured in VS Code).
- An absolute `image:` path (Nav2's map_saver can write one) is outside the webview's resource roots, so the extension reads the image for the page. A YAML is any text file, so it reads only an image type under the YAML's folder or a workspace folder.
- Limits: a map wider or taller than the GPU's texture limit (`MAX_TEXTURE_SIZE`, often 16384) is refused with an error. Color PNGs are turned grey with Rec. 601 luma, assumed to match GraphicsMagick's conversion within one grey level (unverified; compare against `map_server` on a color map). The companion file is not watched, so editing it needs the view reopened (#10). A PNG is decoded through a 2D canvas, which keeps colors premultiplied by alpha: in `raw` mode a fully transparent pixel reads as grey 0 (free) where map_server reads its stored grey, and a translucent one may be a few levels off (from the canvas spec, not measured; `trinary` and `scale` make any such pixel unknown anyway). A PNG decoder of our own would fix it and is not worth it yet.

## Not supported

E57, PTX, NXS, X3D and other MeshLab-only formats, KTX2 / Basis glTF textures, ASCII 2DGS PLY.
