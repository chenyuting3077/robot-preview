# What users of robotics 3D viewers in VS Code ask for

Surveyed 2026-11-25. Companion to [competitors.md](competitors.md): that note lists what competitors offer; this one lists what their users asked for or complained about.

## Method

- GitHub issues and PRs, all states, via `gh issue list --state all`: [OTL/vscode-urdf][otl] (the repo behind smilerobotics.urdf; 3 issues, 6 PRs), [Ranch-Hand-Robotics/rde-urdf][rde] (68), [MorningFrog/urdf-visualizer][mf] (21), [deyuf/urdf-studio][studio] (0 issues; 43 of 44 PRs by the author), [julien-blanchon/mujoco-viewer][mjv] (0), [ms-iot/vscode-ros][ros] (archived; 47 of 333 issues are about URDF preview), [gkjohnson/vscode-urdf-preview][gk] (10, all from 2018 to 2024), [tatsy/vscode-3d-preview][tatsy] (14), [kleinicke/ply-visualizer][klein] (8), [azurity/vscode-pcd-viewer][azurity] (2), [stef-levesque/vscode-3dviewer][slev] (25), [reagan99/GaussianViewer][gv] (3), [AssetTool-Labs/mesh-viewer][atl] (34), [sssooonnnggg/usdc-viewer][usdc] (3). Repos come from each extension's Marketplace `Links.Source` property.
- About 125 threads read in full, chosen by comment and reaction count plus every feature request. Counts below are distinct people: the author, commenters who say they have the same problem, and reactions on the issue.
- Marketplace reviews from `_apis/public/gallery/publishers/{pub}/extensions/{ext}/reviews?count=100`: 54 reviews over 15 extensions. Open VSX `/api/{ns}/{ext}/reviews`: 2 reviews, both without text.
- Forums: ROS Discourse search API (now served from discourse.openrobotics.org), Robotics Stack Exchange and Stack Overflow through the Stack Exchange API, MuJoCo GitHub Discussions through GraphQL, NVIDIA developer forums search API.
- One survey: [Tola & Corke, "Understanding URDF: A Survey Based on User Experience"][survey] (510 responses, December 2022), announced on [ROS Discourse][survey-post].

Limits:
- Reddit could not be read: its JSON API returns 403 and the search tool refuses the domain. r/ROS, r/robotics, r/computervision and r/GaussianSplatting are not covered.
- ROS Answers is archived and was only reached through Robotics Stack Exchange, where nothing asked for an in-editor viewer.
- Marketplace Q&A was not read; these extensions send Q&A to their GitHub issues.
- 25 of the 34 AssetTool-Labs issues were filed by a maintainer from an automated test run, and most rde-urdf feature issues were filed by its maintainer, many moved over from vscode-ros. These count as the maintainer's intent, not as user demand.
- smilerobotics.urdf (278k installs) is not a viewer. Its [README][otl-readme] lists only "Associates .urdf/.xacro files with xml format" and snippets. It has 3 issues, so it cannot explain why users leave a viewer. The one text review praises its ["autocompletion snippets"][rev-smile]. An outside [PR adding a language server][otl-9] has been open since 2026-05 waiting on the author.
- MuJoCo Viewer has no issues, so MJCF demand comes only from MuJoCo's own tracker.
- Our own repo has no outside feedback: all 23 issues were filed by the author.

## URDF / Xacro

### Bugs and pain with competitors

| Pain | People | Sources |
|---|---|---|
| Meshes fail to load because of paths: `package://` without a configured package, `file://$(find …)`, relative and absolute paths, files outside the workspace | ~15 | vscode-ros [#261][ros-261] (2), [#623][ros-623] (3), [#848][ros-848] (3), [#183][ros-183]; MorningFrog [#1][mf-1], [#3][mf-3], [#7][mf-7], [#8][mf-8] (2), [#14][mf-14]; rde-urdf [#6][rde-6], [#89][rde-89] (23 comments), [#90][rde-90] |
| Preview stays blank or shows only the grid. Causes found: a remote CDN going down, VS Code updates changing webview URIs, the snap build of VS Code lacking WebGL, a too-new NVIDIA driver | ~12 | vscode-ros [#908][ros-908] (20 comments, [Stack Overflow][so-75958461]), [#443][ros-443], [#93][ros-93] (2 reactions); rde-urdf [#101][rde-101] (also breaks URDF Visualizer; fixed by switching from snap to deb), [#59][rde-59]; MorningFrog [#9][mf-9]; snap vs deb also on [ROS Discourse][disc-urdf-8] |
| Xacro features the built-in evaluator lacks: `**`, `int()`, `eval`, `optenv`, `$(arg)`, non-standard expressions in vendor files such as UR | ~6 | rde-urdf [#105][rde-105], [#100][rde-100], [#43][rde-43], [#45][rde-45], [#13][rde-13] (from vscode-ros [#1210][ros-1210]); MorningFrog [#8][mf-8] |
| Xacro in a file named `.urdf` is not expanded (the Nav2 and Automatic Addison tutorials do this) | 2 | vscode-ros [#97][ros-97], [#746][ros-746] |
| Rendering differs from RViz: mirrored meshes, wrong STL axes, misplaced joints, only the last `<visual>` drawn, URDF material colors ignored, GLB `origin` ignored, `.STL` upper case not matched | ~10 | vscode-ros [#1139][ros-1139], [#1019][ros-1019], [#939][ros-939], [#239][ros-239] (2 reactions), [#958][ros-958]; rde-urdf [#84][rde-84], [#39][rde-39]; MorningFrog [#6][mf-6], [#22][mf-22], [#15][mf-15] |
| Remote SSH, Dev Containers and WSL: mesh URLs break or nothing renders | 6 | MorningFrog [#2][mf-2] (Dev Container), [#11][mf-11], [#14][mf-14] (SSH); rde-urdf [#15][rde-15] (SSH to a Raspberry Pi); vscode-ros [#261][ros-261], [#939][ros-939] (WSL2) |
| Preview needs a sourced ROS workspace | 4 | vscode-ros [#315][ros-315] (12 comments; Docker and zsh users); rde-urdf [#29][rde-29] |
| Not on Open VSX, so unusable in Cursor and Windsurf | 4 | MorningFrog [#4][mf-4]; rde-urdf [#46][rde-46] (3 reactions), [#39][rde-39] |
| `continuous` joints without `<limit>` cannot be moved | 2 | MorningFrog [#5][mf-5] (1 reaction) |

Cases that are neither ROS 1 nor ROS 2 specific: `file://$(find)` is the ROS 2 Gazebo idiom, and users who switched to it lost the preview ([vscode-ros #848][ros-848]). Nothing else found splits by ROS version.

### Feature requests

| Request | People | Sources |
|---|---|---|
| Live preview while editing, without reloading in RViz | survey + 4 | Survey Table III: "you need to reload the URDF into a visualization tool every time you make a change", "a light preview tool for live editing" ([survey][survey]); [ROS Discourse][disc-urdf-1]; reviews of [URDF Visualizer][rev-mf] and [vscode-ros][rev-ros] |
| Validation and readable errors | survey (65%) + 4 | 65% chose "better tools for validating URDF files" ([survey][survey]); vscode-ros [#850][ros-850] and [#751][ros-751] (filed by maintainers, 2 reactions each); [#623][ros-623] asks where the error log is; [Stack Exchange][se-23966] asks for a check_urdf that reports the line number |
| Completion and snippets | 278k installs of a snippet-only extension, 2 reviews | [smilerobotics.urdf][otl-readme]; [review][rev-smile]; [OTL #6][otl-6] (completion inside xacro macros) |
| Reset joints and view | 2 | rde-urdf [#40][rde-40] (from a user in [#39][rde-39]); [URDF Studio review][rev-studio] ("the one thing it's missing") |
| Show collision geometry | 2 | vscode-ros [#1224][ros-1224] (3 comments) |
| Hide the world axes and grid | 1 | MorningFrog [#12][mf-12]; also a maintainer item in vscode-ros [#1015][ros-1015] |
| Light / dark background | 1 | rde-urdf [#94][rde-94] (1 reaction) |
| Link names on hover | 1 | MorningFrog [#13][mf-13] |
| Measurement in mm | 1 | MorningFrog [#18][mf-18] |
| GLB / glTF meshes in URDF, as Blender 5 drops Collada | 3 | [ROS Discourse][disc-mesh] (5 posts); rde-urdf [#84][rde-84]; MorningFrog [#21][mf-21] |
| Publish frames from outside at runtime | 1 | MorningFrog [#16][mf-16] (declined) |

No user asked for saved joint values, saved camera per file, or joint values exported as JSON.

## MJCF

- No requests found inside VS Code: MuJoCo Viewer has 0 issues.
- The edit, save, reload loop is the pain named in MuJoCo's tracker ([RobolaWeb][mj-2999], 5 upvotes), and MuJoCo 4 now ships hot reload in its own Studio and a browser viewer at live.mujoco.org ([release discussion][mj-3773], 19 upvotes; one comment welcomes the hot reload).
- The URDF survey puts MuJoCo at 11% of the respondents who use tools besides those listed ([survey][survey]).
- No evidence found for contact forces or keyframes.

## Point clouds

### Bugs and pain

| Pain | People | Sources |
|---|---|---|
| Large files crash (130 MB PCD) | 1 | 3D Visualizer [#3][klein-3] |
| Compressed PCD with NaN shows nothing | 1 | 3D Visualizer [#3][klein-3] (same thread) |
| Colors lost after an update; points invisible in a PLY | 2 | vscode-3d-preview [#11][tatsy-11]; mesh-viewer [#96][atl-96] |
| UTM coordinates: the cloud is far from the origin and off screen | 1 | 3D Visualizer [#7][klein-7] |

### Feature requests

| Request | People | Sources |
|---|---|---|
| Remember settings between files: point size, camera convention (OpenCV), up axis, panel hidden | 9 | vscode-3d-preview [#7][tatsy-7] (3 + 1 reaction), [#2][tatsy-2], [#14][tatsy-14] (1 reaction); 3D Visualizer [#2][klein-2]; vscode-3dviewer [#6][slev-6] (1 reaction); mesh-viewer [#14][atl-14] (1 reaction) |
| Hide toolbars that cover the cloud | 3 | 3D Visualizer [#14][klein-14]; pcd-viewer [#3][azurity-3]; vscode-3d-preview [#2][tatsy-2] |
| Larger or fixed-size points (4K screens, zoomed-out LiDAR) | 2 | 3D Visualizer [#1][klein-1]; vscode-3d-preview [#4][tatsy-4] (1 reaction) |
| Color by intensity or another scalar field | 2 | 3D Visualizer [#10][klein-10] (6 comments); vscode-3d-preview [#3][tatsy-3] |
| Several clouds or meshes in one view | 3 | vscode-3d-preview [#8][tatsy-8] (1 reaction); [review][rev-tatsy] |
| Rotation pivot inside the cloud | 1 | 3D Visualizer [#6][klein-6] |
| `.npy` arrays | 1 | vscode-3d-preview [#9][tatsy-9] (declined) |
| Works on a remote SSH server | 3 reviews | reviews of [vscode-3d-preview][rev-tatsy] (two mention remote servers) |

No user asked for LAS / LAZ, Eye-Dome Lighting, normals, point picking or MCAP. The only LAS issue is a color bug in the Python tool [scomup/q3dviewer #1][q3d-1]; the q3dviewer Marketplace listing gives no repository, so whether that repo is the extension is not confirmed. 3D Visualizer added EDL on its own initiative ([#7][klein-7]).

## Gaussian splats

| Request | People | Sources |
|---|---|---|
| Edit and clean up splats, then export (SuperSplat selection tools, PLY export) | 3 | Gaussian Viewer [#1][gv-1], [#2][gv-2], [#3][gv-3]; a [review][rev-gv] uses it with LichtFeld Studio as a replacement for Postshot |
| A better splat renderer (Spark) in a mesh viewer | 1 | mesh-viewer [#21][atl-21] |
| COLMAP's Y-up coordinate convention | 1 | vscode-3d-preview [#14][tatsy-14] |

No user asked for COLMAP cameras or sparse points.

## Meshes and CAD

| Need | People | Sources |
|---|---|---|
| How do I open the viewer? Commands are hidden, "Open With" is not obvious, search by file extension does not find the extension | ~12 | vscode-3dviewer [#3][slev-3], [#4][slev-4], [#15][slev-15] (9 comments), and 4 reviews ([reviews][rev-slev]); vscode-3d-preview [#1][tatsy-1]; usdc-viewer [#3][usdc-3] |
| Reload when the file changes on disk | 6 | vscode-3dviewer [#5][slev-5] (5 reactions) |
| OBJ materials (.mtl) and textures next to the file | 5 | vscode-3dviewer [#22][slev-22] (3 + 1 reaction); vscode-3d-preview [#15][tatsy-15]; mesh-viewer [#20][atl-20] |
| Solid background instead of an HDRI; white background for papers | ~10 | vscode-3dviewer [#18][slev-18] (8 reactions, 4 commenters); pcd-viewer [#1][azurity-1]; 3D Visualizer [#9][klein-9]; mesh-viewer [#31][atl-31] |
| STEP (CadQuery workflow) | 2 | vscode-3dviewer [#28][slev-28] |
| Draco-compressed GLB | 1 | mesh-viewer [#19][atl-19] |
| Mesh in the git diff view | 1 | mesh-viewer [#32][atl-32]; the same person's [review][rev-atl] |
| A light that follows the camera so vertical faces are shaded | 1 | vscode-3d-preview [#13][tatsy-13] |
| Z-up for robot models | 2 | mesh-viewer [#14][atl-14], [#17][atl-17] |

## USD

- Text-dump viewer usdc-viewer: users fail to set up the USD tools it shells out to (`usdcat` not found, missing PySide2): [#1][usdc-1], [#2][usdc-2]. One asks for a custom editor instead of a command: [#3][usdc-3].
- NVIDIA forums: one user wants Isaac Sim as a viewport-only app ([thread][nv-345082]; NVIDIA answers with the Kit USD Viewer template and a licensing warning). Another cannot run usdview on an iPad; NVIDIA replies it is "exploring browser-friendly options" ([thread][nv-333589]).
- rde-urdf's maintainer opened [#104 "Add USD"][rde-104], citing "ROS 2 REP-0158". No REP-0158 exists in [ros-infrastructure/rep][rep] as of this survey, so that claim is unconfirmed.
- No user asked for joint sliders on Isaac Sim articulations. AssetTool-Labs' own test run found USD references and sublayers unresolved in three.js's loader ([#68][atl-68]).

## Cross-cutting

| Need | People | Sources |
|---|---|---|
| Blank or green view on remote servers, WSL, after VS Code updates, with no message | ~45 | vscode-3dviewer [#32][slev-32] (19 comments, 19 reactions; remote), [#10][slev-10] (14 comments, 9 reactions), [#11][slev-11], [#9][slev-9] (10 reactions), [#35][slev-35]; vscode-3d-preview [#10][tatsy-10] (WSL2, 3); plus the URDF rows above |
| Files outside the workspace cannot be read | 4 | MorningFrog [#1][mf-1], [#10][mf-10]; rde-urdf [#90][rde-90]; vscode-3dviewer [#8][slev-8] |
| Open VSX for VS Code forks | 4 | see URDF; we already publish there |
| Too many features or panels for a quick look | 3 | [review][rev-slev] ("too big and too much features"); vscode-3d-preview [#2][tatsy-2]; pcd-viewer [#3][azurity-3] |

## Against the Proposed order

The items below are the first list in competitors.md (commit baf381e); its current Order was rebuilt from this note.

| competitors.md item | Demand found |
|---|---|
| 1. Point picking and two-point distance | None in issues or reviews. Closest: a URDF Visualizer user wants measurements in mm ([#18][mf-18]) |
| 2. LAS / LAZ (#11) | None from VS Code users. One LAS bug in a Python tool that may not be the extension ([q3dviewer #1][q3d-1]) |
| 3. EDL, normals, default settings | Default settings: strongest point-cloud request, 9 people. EDL: none. Normals: none |
| 4. NuRec screenshot and README (#13) | No user signal (marketing task) |
| 5. URDF: remember joints and camera; joints as JSON | None. Users asked instead for a joint reset (2) |
| 6. USD joint sliders | None |
| 7. COLMAP (#12); MJCF contacts and keyframes | COLMAP: 1 asks only for its coordinate convention. MJCF: none |
| 8. PointCloud2 from MCAP (#14) | None in these trackers |

Demands missing from the list, most requested first:
1. Never show a blank view without a reason: a WebGL check, mesh-load errors and path errors shown in the view (~45 people across competitors, the largest signal in this survey). Ours already reports missing meshes in Problems for URDF; Mesh & Splat and USD were not checked.
2. Mesh path resolution and Xacro coverage (~20). Ours already covers `package://`, `$(find)` and `file://`. Expressions such as `**`, `int()`, `$(arg)` defaults and UR's description files were not tested here.
3. Default settings for Mesh & Splat and USD: both contribute no settings today (9).
4. A plain background option and a light theme (~11).
5. Remote SSH, Dev Containers and WSL (~10). None of the evidence above covers ours.
6. Making the viewer easy to find: default editor associations and Marketplace keywords per file extension (~12).
7. A joint reset button for URDF (2).
8. Splat cleanup and export (3): editing, not viewing. Probably out of scope.

## Contradictions and unknowns

- The [ROS Discourse post][disc-urdf-1] proposing a URDF viewer says "Using RViz for this was considered cumbersome by 65% of users", citing the survey. The [paper][survey] has no such figure; its 65% is the share asking for "better tools for validating URDF files". RViz is mentioned only as used by 78%.
- The URDF Visualizer maintainer keeps OBJ materials over URDF `<material>` ([#22][mf-22]) and leaves STL meshes uncolored like RViz ([#6][mf-6]). Users asked for the opposite in both cases. rde-urdf instead adopted RViz's rule that an uncolored visual takes the robot's first material ([#21][rde-21]).
- The install counts in competitors.md are not satisfaction: smilerobotics.urdf has 278k installs and only snippets, and vscode-3dviewer has 214k installs with the lowest rating found (3.36 from 14 ratings, gallery API).

## Round 2

Same day, 2026-11-25. Round 1 covered VS Code extensions only. This round covers the tools the same users fall back to, Hacker News, ROS Discourse announcement threads, and agent (MCP) workflows. People are counted as in round 1: participants plus reactions. Reactions may overlap with commenters, and that overlap was not removed.

### Method and limits

- Fallback tools: issue titles with reaction counts from [openrr/urdf-viz][r2-uv] (61, all), [foxglove/community][r2-fc] (301 issues and 867 discussions; foxglove/studio is archived with issues off), [rerun-io/rerun][r2-rr] (the 3,000 most recent), [playcanvas/supersplat][r2-ss] (447), [potree/potree][r2-pt] (1,214), [CloudCompare/CloudCompare][r2-cc] (1,274), [PixarAnimationStudios/OpenUSD][r2-usd] and [google-deepmind/mujoco][r2-mj] (2,000 each, the cap used). These were downloaded with `gh issue list` and searched locally by keyword. About 45 threads were opened to count participants.
- GitHub's REST search hit its rate limit (HTTP 403 "API rate limit exceeded") after a few calls. GraphQL search was used for repositories and discussions instead.
- Reddit is still blocked:
  - `old.reddit.com/r/ROS/search.json` redirects (302) to `/login/?reason=lor2`.
  - `www.reddit.com/r/ROS/search.rss` returns 404 with an Atom feed titled "Not Found", then 429 on retry.
  - The web search tool rejects `allowed_domains: reddit.com` ("not accessible to our user agent"). With `site:reddit.com` in the query it returned no r/ROS, r/GaussianSplatting or r/LiDAR thread, only a third-party mirror, which was not used.
  - r/robotics, r/computervision, r/GaussianSplatting, r/LiDAR and r/vscode remain uncovered.
- Hacker News through the [Algolia API][r2-hn-api]: few robotics viewer threads, and few comments on them.
- Isaac Sim forums: the search API was queried again for joint and articulation viewing. Nothing beyond Isaac's own tools came up.

### Proposed order against the wider sources

| Item | Evidence outside VS Code | People | Verdict |
|---|---|---|---|
| 1. Point picking and measurement | SuperSplat [#35][r2-ss-35] (12 participants, 3 reactions), [#128][r2-ss-128] (5), [#709][r2-ss-709] units (1); Rerun [#6254][r2-rr-6254] (3 + 7 reactions), [#6751][r2-rr-6751] (2); Foxglove [angles in Measure][r2-fc-1245] (1); Potree [#247][r2-pt-247] export measurements (8 reactions), [#514][r2-pt-514] save measurements (3 reactions); CloudCompare picking bug reports [#2027][r2-cc-2027], [#2021][r2-cc-2021] show it in daily use | ~25 to 30 | Backed: robotics and splat users ask for it in Rerun and SuperSplat, though not yet of a VS Code extension |
| 2. LAS / LAZ | Potree [#1065][r2-pt-1065] COPC (5 + 6 reactions); CloudCompare LAS export bugs [#1356][r2-cc-1356] (3 reactions), [#2371][r2-cc-2371]; SuperSplat [#482][r2-ss-482] wants LiDAR next to splats, any format (4) | ~10, almost all GIS users | Weak for robotics; no request in Rerun, Foxglove or urdf-viz |
| 3a. EDL | Only bug reports in tools that have it: CloudCompare [#1745][r2-cc-1745], [#1837][r2-cc-1837]; Potree [#892][r2-pt-892], [#707][r2-pt-707] | 0 requests | No demand signal |
| 3b. Normals display | Rerun [#1848][r2-rr-1848] (1 + 2 reactions); OpenUSD [#1186][r2-usd-1186] usdview (2 + 2 reactions); SuperSplat [#1106][r2-ss-1106] (1) | ~5 | Weak |
| 3c. Default / remembered settings | SuperSplat [#235][r2-ss-235], [#661][r2-ss-661]; CloudCompare [#164][r2-cc-164] (2); Foxglove [#356][r2-fc-356]; Rerun [#6825][r2-rr-6825] (filed by Rerun's team, 6 reactions) | ~6 here, 9 in round 1 | Backed |
| 4. NuRec screenshot and README | Not searched (marketing task) | n/a | n/a |
| 5. Saved joint poses, JSON export | None. Related: urdf-viz [#193][r2-uv-193] set the joint step (3), [#43][r2-uv-43] reset pose with a key (2); MuJoCo [D3263][r2-mj-3263] reset to a keyframe (2 upvotes) | 0 for saving | Not backed; reset and exact joint input are what is asked |
| 6. USD articulation joint sliders | None. Isaac Sim users rely on Isaac's own Joint Inspector ([forum thread][r2-nv-244712], about it missing DOFs) | 0 | Not backed |
| 7a. COLMAP cameras over splats | SuperSplat [#636][r2-ss-636] COLMAP keyframes (2), [#224][r2-ss-224] export camera poses (3) | ~5 | Weak |
| 7b. MJCF contact forces and keyframes | Viewing MJCF at all: Rerun [#8634][r2-rr-8634] (filed by jleibs, a Rerun contributor; 4 participants, 14 reactions). Contact visualization: MuJoCo [D2671][r2-mj-2671] (1) | 1 for contacts | Not backed. MJCF viewing itself is backed, and MuJoCo's own viewer already shows contacts and keyframes |
| 8. PointCloud2 from MCAP / bags | Rerun [#1537][r2-rr-1537] native ROS support (a tracking issue by jleibs; 10 participants, 34 reactions), [#10177][r2-rr-10177] MCAP loader (4, 3); Foxglove [#109][r2-fc-109] split bags (5, 6); [BAGEL][r2-bagel] MCP for bags, 407 stars | ~20 | Demand is real but served by Foxglove and Rerun; none of it asks for bags inside VS Code |

### Other needs from the wider sources

| Need | People | Sources | Round 1 |
|---|---|---|---|
| URDF mesh paths (`package://`, `file://`, relative, drag-and-drop) | ~13 | Foxglove [#377][r2-fc-377] (4), [#494][r2-fc-494] (2), [`file://` from Docker in WSL][r2-fc-1244] (1); Rerun [#10182][r2-rr-10182] (2); MuJoCo [#1432][r2-mj-1432] (4 + 6 reactions) | Same top pain; about 28 people in total |
| Gaussian splats in general viewers | ~10 + 27 reactions | Rerun [#4529][r2-rr-4529] (5, 11); Potree [#1382][r2-pt-1382] (5, 16) | We have it |
| Background color | 11 reactions | Rerun [#754][r2-rr-754] (filed by Rerun's team) | Confirms round 1 |
| OBJ with MTL | 9 reactions | Rerun [#3773][r2-rr-3773] | We have it |
| Collision toggle in a URDF view | 3 + 5 reactions | Rerun [#10328][r2-rr-10328] | We have it |
| WASD fly | ~17 | CloudCompare [#1336][r2-cc-1336] (8 reactions), [#586][r2-cc-586] (4 reactions); SuperSplat [#372][r2-ss-372] (4); [HN comment][r2-hn-splat] | We have it |
| Screenshots and video export | 17 reactions | Rerun [#2305][r2-rr-2305] | We have PNG |
| Orthographic camera | 17 reactions | Rerun [#2497][r2-rr-2497] (filed by Rerun's team) | Not in ours; rde-urdf [#97][rde-97] |
| Inertia display, frame names | 1 + 3 reactions; 2 | urdf-viz [#29][r2-uv-29]; [#165][r2-uv-165], [#287][r2-uv-287] | We have both |
| Xacro beyond the basics: `xacro.load_yaml`, deep includes | 2 | [ROS Discourse][r2-disc-55049] (Andino uses `load_yaml`); [peci1 on LinkForge][r2-disc-51808] | Ours claims `load_yaml` |
| USD without building it: browser viewer, CLI tools in the PyPI package | 2 + 2 reactions; 3 + 3 | OpenUSD [#634][r2-usd-634], [#2730][r2-usd-2730] | Matches usdc-viewer setup pain |

### Agent / LLM workflows

- A third party built [ocp-viewer-mcp][r2-ocpmcp] (4 stars) so that an AI assistant can capture screenshots of OCP CAD Viewer, a VS Code extension, to "see your 3D CAD models". OCP CAD Viewer's own `save_screenshot` was not implemented in standalone mode until a user reported it ([#147][r2-ocp-147]).
- One user of [ros-mcp-server][r2-rosmcp] (1,536 stars; robot control, not model viewing) asks how to show camera images in the Claude window ([#241][r2-rosmcp-241]).
- Competitors that ship MCP did so on the maintainer's initiative: rde-urdf ([#67][r2-rde-67], [#69][r2-rde-69], 1 reaction each; [#85][rde-85] notes previews opening in the wrong window), and 3D Visualizer (its [README][r2-klein-readme]: "open scenes, control the camera and inspect rendered screenshots").
- A GraphQL repository search for "urdf mcp" finds 13 repos. None is a URDF viewer with users: the largest are [omnisim][r2-omnisim] (200 stars, simulation) and CAD exporters with at most 4 stars. Simulator MCPs are larger: [isaac-sim-mcp][r2-isaacmcp] has 205 stars and [mujoco-mcp-server][r2-mujocomcp] has 12.
- Verdict: 2 independent user signals for agents seeing renders. The rest is supply from maintainers.

### Hacker News and ROS Discourse announcements

- HN: [mechaverse][r2-hn-mecha] (URDF, MJCF and USD in the browser; 14 comments) drew one request, downloading the example models. [Open-source Robotics][r2-hn-osr] (4 comments) drew no requests. The only splat thread with feature talk, [Maps and Splats][r2-hn-splat], drew WASD fly controls.
- ROS Discourse:
  - On [urdf-viz][r2-disc-2472] (2017), a user's URDF crashed it, and he asked for known-good example models.
  - On the [web URDF viewer][disc-web] (2026), the one suggestion was bundled sample URDFs.
  - On the [browser URDF playground][r2-disc-55049], one user asks for `xacro.load_yaml`, and other users push back on repeated self-promotion.
  - [fastviz][r2-disc-54723] got "rerun.io, cough" from a user.
  - At least six web URDF viewers or editors were announced in 2025 and 2026 ([1][disc-web], [2][r2-disc-52442], [3][r2-disc-55049], [4][r2-disc-56379], [5][r2-disc-51484], [6][r2-disc-51808]), each with at most 9 likes. Supply is crowded; replies ask for xacro coverage and sample models, not features.

### Top needs after round 2

| Need | People (round 1 + round 2) | In ours |
|---|---|---|
| Never a blank view without a reason | ~45 + 0 | Partly (URDF Problems panel) |
| Mesh path resolution for URDF | ~15 + ~13 | Yes; WSL, Docker and `file://` cases untested |
| Point picking and measurement | 0 + ~25 to 30 | Between two objects only (URDF) |
| Bag / MCAP viewing | 0 + ~20 | No; served by Foxglove and Rerun |
| Remembered default settings | 9 + ~6 | No settings in Mesh & Splat or USD |
| Plain background color | ~11 + 11 reactions | Not checked |
| Easy to find and open | ~12 + 0 | Partly |
| Remote SSH, Dev Containers, WSL | ~10 + 1 | Untested |
| Splats in a general viewer | 3 + ~10 | Yes |
| Xacro coverage | ~8 + 2 | Partly; expressions untested |

### Still not accessible

- Reddit (errors above).
- foxglove/studio: archived with issues turned off; only foxglove/community was read.
- Chat communities (Foxglove, Rerun) and CloudCompare's forum: not tried.
- Issues older than the most recent 3,000 in Rerun and 2,000 in OpenUSD and MuJoCo.
- The GitHub REST search API, until its rate limit resets.

[survey]: https://arxiv.org/abs/2302.13442
[survey-post]: https://discourse.openrobotics.org/t/urdf-survey-results-conducted-december-2022/30025
[disc-urdf-1]: https://discourse.openrobotics.org/t/urdf-improvements/30520
[disc-urdf-8]: https://discourse.openrobotics.org/t/urdf-improvements/30520/8
[disc-mesh]: https://discourse.openrobotics.org/t/ros2-urdf-mesh-file-types/54954
[se-23966]: https://robotics.stackexchange.com/questions/23966/is-there-a-better-command-line-tool-than-check-urdf
[so-75958461]: https://stackoverflow.com/questions/75958461/how-can-i-use-visual-studio-codes-ros-extension-to-display-urdf-models
[mj-2999]: https://github.com/google-deepmind/mujoco/discussions/2999
[mj-3773]: https://github.com/google-deepmind/mujoco/discussions/3773
[nv-345082]: https://forums.developer.nvidia.com/t/how-to-run-a-viewport-only-application-without-loading-the-full-editor/345082
[nv-333589]: https://forums.developer.nvidia.com/t/openusd-on-an-ipad/333589
[rep]: https://github.com/ros-infrastructure/rep
[otl]: https://github.com/OTL/vscode-urdf
[otl-readme]: https://github.com/OTL/vscode-urdf#readme
[otl-6]: https://github.com/OTL/vscode-urdf/issues/6
[otl-9]: https://github.com/OTL/vscode-urdf/pull/9
[rde]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues
[mf]: https://github.com/MorningFrog/urdf-visualizer/issues
[studio]: https://github.com/deyuf/urdf-studio
[mjv]: https://github.com/julien-blanchon/mujoco-viewer
[ros]: https://github.com/ms-iot/vscode-ros/issues
[gk]: https://github.com/gkjohnson/vscode-urdf-preview/issues
[tatsy]: https://github.com/tatsy/vscode-3d-preview/issues
[klein]: https://github.com/kleinicke/ply-visualizer/issues
[azurity]: https://github.com/azurity/vscode-pcd-viewer/issues
[slev]: https://github.com/stef-levesque/vscode-3dviewer/issues
[gv]: https://github.com/reagan99/GaussianViewer/issues
[atl]: https://github.com/AssetTool-Labs/mesh-viewer/issues
[usdc]: https://github.com/sssooonnnggg/usdc-viewer/issues
[q3d-1]: https://github.com/scomup/q3dviewer/issues/1
[rev-smile]: https://marketplace.visualstudio.com/items?itemName=smilerobotics.urdf&ssr=false#review-details
[rev-mf]: https://marketplace.visualstudio.com/items?itemName=morningfrog.urdf-visualizer&ssr=false#review-details
[rev-ros]: https://marketplace.visualstudio.com/items?itemName=ms-iot.vscode-ros&ssr=false#review-details
[rev-studio]: https://marketplace.visualstudio.com/items?itemName=deyuf.urdf-studio&ssr=false#review-details
[rev-tatsy]: https://marketplace.visualstudio.com/items?itemName=tatsy.vscode-3d-preview&ssr=false#review-details
[rev-slev]: https://marketplace.visualstudio.com/items?itemName=slevesque.vscode-3dviewer&ssr=false#review-details
[rev-gv]: https://marketplace.visualstudio.com/items?itemName=GaussianViewer.gaussian-viewer&ssr=false#review-details
[rev-atl]: https://marketplace.visualstudio.com/items?itemName=AssetToolLabs.mesh-viewer-vscode&ssr=false#review-details
[ros-93]: https://github.com/ms-iot/vscode-ros/issues/93
[ros-97]: https://github.com/ms-iot/vscode-ros/issues/97
[ros-183]: https://github.com/ms-iot/vscode-ros/issues/183
[ros-239]: https://github.com/ms-iot/vscode-ros/issues/239
[ros-261]: https://github.com/ms-iot/vscode-ros/issues/261
[ros-315]: https://github.com/ms-iot/vscode-ros/issues/315
[ros-443]: https://github.com/ms-iot/vscode-ros/issues/443
[ros-623]: https://github.com/ms-iot/vscode-ros/issues/623
[ros-746]: https://github.com/ms-iot/vscode-ros/issues/746
[ros-751]: https://github.com/ms-iot/vscode-ros/issues/751
[ros-848]: https://github.com/ms-iot/vscode-ros/issues/848
[ros-850]: https://github.com/ms-iot/vscode-ros/issues/850
[ros-908]: https://github.com/ms-iot/vscode-ros/issues/908
[ros-939]: https://github.com/ms-iot/vscode-ros/issues/939
[ros-958]: https://github.com/ms-iot/vscode-ros/issues/958
[ros-1015]: https://github.com/ms-iot/vscode-ros/issues/1015
[ros-1019]: https://github.com/ms-iot/vscode-ros/issues/1019
[ros-1139]: https://github.com/ms-iot/vscode-ros/issues/1139
[ros-1210]: https://github.com/ms-iot/vscode-ros/issues/1210
[ros-1224]: https://github.com/ms-iot/vscode-ros/issues/1224
[rde-6]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/6
[rde-13]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/13
[rde-15]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/15
[rde-21]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/21
[rde-29]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/29
[rde-39]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/39
[rde-40]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/40
[rde-43]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/43
[rde-45]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/45
[rde-46]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/46
[rde-59]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/59
[rde-84]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/84
[rde-89]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/89
[rde-90]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/90
[rde-94]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/94
[rde-100]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/100
[rde-101]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/101
[rde-104]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/104
[rde-105]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/105
[mf-1]: https://github.com/MorningFrog/urdf-visualizer/issues/1
[mf-2]: https://github.com/MorningFrog/urdf-visualizer/issues/2
[mf-3]: https://github.com/MorningFrog/urdf-visualizer/issues/3
[mf-4]: https://github.com/MorningFrog/urdf-visualizer/issues/4
[mf-5]: https://github.com/MorningFrog/urdf-visualizer/issues/5
[mf-6]: https://github.com/MorningFrog/urdf-visualizer/issues/6
[mf-7]: https://github.com/MorningFrog/urdf-visualizer/issues/7
[mf-8]: https://github.com/MorningFrog/urdf-visualizer/issues/8
[mf-9]: https://github.com/MorningFrog/urdf-visualizer/issues/9
[mf-10]: https://github.com/MorningFrog/urdf-visualizer/issues/10
[mf-11]: https://github.com/MorningFrog/urdf-visualizer/issues/11
[mf-12]: https://github.com/MorningFrog/urdf-visualizer/issues/12
[mf-13]: https://github.com/MorningFrog/urdf-visualizer/issues/13
[mf-14]: https://github.com/MorningFrog/urdf-visualizer/issues/14
[mf-15]: https://github.com/MorningFrog/urdf-visualizer/issues/15
[mf-16]: https://github.com/MorningFrog/urdf-visualizer/issues/16
[mf-18]: https://github.com/MorningFrog/urdf-visualizer/issues/18
[mf-21]: https://github.com/MorningFrog/urdf-visualizer/issues/21
[mf-22]: https://github.com/MorningFrog/urdf-visualizer/issues/22
[tatsy-1]: https://github.com/tatsy/vscode-3d-preview/issues/1
[tatsy-2]: https://github.com/tatsy/vscode-3d-preview/issues/2
[tatsy-3]: https://github.com/tatsy/vscode-3d-preview/issues/3
[tatsy-4]: https://github.com/tatsy/vscode-3d-preview/issues/4
[tatsy-7]: https://github.com/tatsy/vscode-3d-preview/issues/7
[tatsy-8]: https://github.com/tatsy/vscode-3d-preview/issues/8
[tatsy-9]: https://github.com/tatsy/vscode-3d-preview/issues/9
[tatsy-10]: https://github.com/tatsy/vscode-3d-preview/issues/10
[tatsy-11]: https://github.com/tatsy/vscode-3d-preview/issues/11
[tatsy-13]: https://github.com/tatsy/vscode-3d-preview/issues/13
[tatsy-14]: https://github.com/tatsy/vscode-3d-preview/issues/14
[tatsy-15]: https://github.com/tatsy/vscode-3d-preview/issues/15
[klein-1]: https://github.com/kleinicke/ply-visualizer/issues/1
[klein-2]: https://github.com/kleinicke/ply-visualizer/issues/2
[klein-3]: https://github.com/kleinicke/ply-visualizer/issues/3
[klein-6]: https://github.com/kleinicke/ply-visualizer/issues/6
[klein-7]: https://github.com/kleinicke/ply-visualizer/issues/7
[klein-9]: https://github.com/kleinicke/ply-visualizer/issues/9
[klein-10]: https://github.com/kleinicke/ply-visualizer/issues/10
[klein-14]: https://github.com/kleinicke/ply-visualizer/issues/14
[azurity-1]: https://github.com/azurity/vscode-pcd-viewer/issues/1
[azurity-3]: https://github.com/azurity/vscode-pcd-viewer/issues/3
[slev-3]: https://github.com/stef-levesque/vscode-3dviewer/issues/3
[slev-4]: https://github.com/stef-levesque/vscode-3dviewer/issues/4
[slev-5]: https://github.com/stef-levesque/vscode-3dviewer/issues/5
[slev-6]: https://github.com/stef-levesque/vscode-3dviewer/issues/6
[slev-8]: https://github.com/stef-levesque/vscode-3dviewer/issues/8
[slev-9]: https://github.com/stef-levesque/vscode-3dviewer/issues/9
[slev-10]: https://github.com/stef-levesque/vscode-3dviewer/issues/10
[slev-11]: https://github.com/stef-levesque/vscode-3dviewer/issues/11
[slev-15]: https://github.com/stef-levesque/vscode-3dviewer/issues/15
[slev-18]: https://github.com/stef-levesque/vscode-3dviewer/issues/18
[slev-22]: https://github.com/stef-levesque/vscode-3dviewer/issues/22
[slev-28]: https://github.com/stef-levesque/vscode-3dviewer/issues/28
[slev-32]: https://github.com/stef-levesque/vscode-3dviewer/issues/32
[slev-35]: https://github.com/stef-levesque/vscode-3dviewer/issues/35
[gv-1]: https://github.com/reagan99/GaussianViewer/issues/1
[gv-2]: https://github.com/reagan99/GaussianViewer/issues/2
[gv-3]: https://github.com/reagan99/GaussianViewer/issues/3
[atl-14]: https://github.com/AssetTool-Labs/mesh-viewer/issues/14
[atl-17]: https://github.com/AssetTool-Labs/mesh-viewer/issues/17
[atl-19]: https://github.com/AssetTool-Labs/mesh-viewer/issues/19
[atl-20]: https://github.com/AssetTool-Labs/mesh-viewer/issues/20
[atl-21]: https://github.com/AssetTool-Labs/mesh-viewer/issues/21
[atl-31]: https://github.com/AssetTool-Labs/mesh-viewer/issues/31
[atl-32]: https://github.com/AssetTool-Labs/mesh-viewer/issues/32
[atl-68]: https://github.com/AssetTool-Labs/mesh-viewer/issues/68
[atl-96]: https://github.com/AssetTool-Labs/mesh-viewer/issues/96
[usdc-1]: https://github.com/sssooonnnggg/usdc-viewer/issues/1
[usdc-2]: https://github.com/sssooonnnggg/usdc-viewer/issues/2
[usdc-3]: https://github.com/sssooonnnggg/usdc-viewer/issues/3
[rde-85]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/85
[rde-97]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/97
[disc-web]: https://discourse.openrobotics.org/t/web-urdf-viewer-by-frontend-developer-seeking-robotics-feedback/52743
[r2-uv]: https://github.com/openrr/urdf-viz/issues
[r2-fc]: https://github.com/foxglove/community
[r2-rr]: https://github.com/rerun-io/rerun/issues
[r2-ss]: https://github.com/playcanvas/supersplat/issues
[r2-pt]: https://github.com/potree/potree/issues
[r2-cc]: https://github.com/CloudCompare/CloudCompare/issues
[r2-usd]: https://github.com/PixarAnimationStudios/OpenUSD/issues
[r2-mj]: https://github.com/google-deepmind/mujoco/issues
[r2-hn-api]: https://hn.algolia.com/api
[r2-ss-35]: https://github.com/playcanvas/supersplat/issues/35
[r2-ss-128]: https://github.com/playcanvas/supersplat/issues/128
[r2-ss-709]: https://github.com/playcanvas/supersplat/issues/709
[r2-ss-482]: https://github.com/playcanvas/supersplat/issues/482
[r2-ss-1106]: https://github.com/playcanvas/supersplat/issues/1106
[r2-ss-235]: https://github.com/playcanvas/supersplat/issues/235
[r2-ss-661]: https://github.com/playcanvas/supersplat/issues/661
[r2-ss-636]: https://github.com/playcanvas/supersplat/issues/636
[r2-ss-224]: https://github.com/playcanvas/supersplat/issues/224
[r2-ss-372]: https://github.com/playcanvas/supersplat/issues/372
[r2-rr-6254]: https://github.com/rerun-io/rerun/issues/6254
[r2-rr-6751]: https://github.com/rerun-io/rerun/issues/6751
[r2-rr-1848]: https://github.com/rerun-io/rerun/issues/1848
[r2-rr-6825]: https://github.com/rerun-io/rerun/issues/6825
[r2-rr-8634]: https://github.com/rerun-io/rerun/issues/8634
[r2-rr-1537]: https://github.com/rerun-io/rerun/issues/1537
[r2-rr-10177]: https://github.com/rerun-io/rerun/issues/10177
[r2-rr-10182]: https://github.com/rerun-io/rerun/issues/10182
[r2-rr-4529]: https://github.com/rerun-io/rerun/issues/4529
[r2-rr-754]: https://github.com/rerun-io/rerun/issues/754
[r2-rr-3773]: https://github.com/rerun-io/rerun/issues/3773
[r2-rr-10328]: https://github.com/rerun-io/rerun/issues/10328
[r2-rr-2305]: https://github.com/rerun-io/rerun/issues/2305
[r2-rr-2497]: https://github.com/rerun-io/rerun/issues/2497
[r2-fc-1245]: https://github.com/foxglove/community/discussions/1245
[r2-fc-1244]: https://github.com/foxglove/community/discussions/1244
[r2-fc-356]: https://github.com/foxglove/community/issues/356
[r2-fc-109]: https://github.com/foxglove/community/issues/109
[r2-fc-377]: https://github.com/foxglove/community/issues/377
[r2-fc-494]: https://github.com/foxglove/community/issues/494
[r2-pt-247]: https://github.com/potree/potree/issues/247
[r2-pt-514]: https://github.com/potree/potree/issues/514
[r2-pt-1065]: https://github.com/potree/potree/issues/1065
[r2-pt-892]: https://github.com/potree/potree/issues/892
[r2-pt-707]: https://github.com/potree/potree/issues/707
[r2-pt-1382]: https://github.com/potree/potree/issues/1382
[r2-cc-2027]: https://github.com/CloudCompare/CloudCompare/issues/2027
[r2-cc-2021]: https://github.com/CloudCompare/CloudCompare/issues/2021
[r2-cc-1356]: https://github.com/CloudCompare/CloudCompare/issues/1356
[r2-cc-2371]: https://github.com/CloudCompare/CloudCompare/issues/2371
[r2-cc-1745]: https://github.com/CloudCompare/CloudCompare/issues/1745
[r2-cc-1837]: https://github.com/CloudCompare/CloudCompare/issues/1837
[r2-cc-164]: https://github.com/CloudCompare/CloudCompare/issues/164
[r2-cc-1336]: https://github.com/CloudCompare/CloudCompare/issues/1336
[r2-cc-586]: https://github.com/CloudCompare/CloudCompare/issues/586
[r2-usd-1186]: https://github.com/PixarAnimationStudios/OpenUSD/issues/1186
[r2-usd-634]: https://github.com/PixarAnimationStudios/OpenUSD/issues/634
[r2-usd-2730]: https://github.com/PixarAnimationStudios/OpenUSD/issues/2730
[r2-uv-193]: https://github.com/openrr/urdf-viz/issues/193
[r2-uv-43]: https://github.com/openrr/urdf-viz/issues/43
[r2-uv-29]: https://github.com/openrr/urdf-viz/issues/29
[r2-uv-165]: https://github.com/openrr/urdf-viz/issues/165
[r2-uv-287]: https://github.com/openrr/urdf-viz/issues/287
[r2-mj-3263]: https://github.com/google-deepmind/mujoco/discussions/3263
[r2-mj-2671]: https://github.com/google-deepmind/mujoco/discussions/2671
[r2-mj-1432]: https://github.com/google-deepmind/mujoco/issues/1432
[r2-nv-244712]: https://forums.developer.nvidia.com/t/isaac-joint-inspector-does-not-recognize-all-degrees-of-freedom-for-custom-robot/244712
[r2-bagel]: https://github.com/Extelligence-ai/bagel
[r2-ocpmcp]: https://github.com/dmilad/ocp-viewer-mcp
[r2-ocp-147]: https://github.com/bernhard-42/vscode-ocp-cad-viewer/issues/147
[r2-rosmcp]: https://github.com/robotmcp/ros-mcp-server
[r2-rosmcp-241]: https://github.com/robotmcp/ros-mcp-server/issues/241
[r2-rde-67]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/67
[r2-rde-69]: https://github.com/Ranch-Hand-Robotics/rde-urdf/issues/69
[r2-klein-readme]: https://github.com/kleinicke/ply-visualizer#readme
[r2-omnisim]: https://github.com/omnilink-tech/omnisim
[r2-isaacmcp]: https://github.com/omni-mcp/isaac-sim-mcp
[r2-mujocomcp]: https://github.com/Rongxuan-Zhou/mujoco-mcp-server
[r2-hn-mecha]: https://news.ycombinator.com/item?id=44898764
[r2-hn-osr]: https://news.ycombinator.com/item?id=46786021
[r2-hn-splat]: https://news.ycombinator.com/item?id=40223510
[r2-disc-2472]: https://discourse.openrobotics.org/t/urdf-viz-urdf-file-viewer/2472
[r2-disc-55049]: https://discourse.openrobotics.org/t/built-a-browser-based-urdf-playground-for-ros-developers/55049
[r2-disc-54723]: https://discourse.openrobotics.org/t/introducing-an-rviz-alternative-that-runs-super-fast/54723
[r2-disc-52442]: https://discourse.openrobotics.org/t/urdf-viewer-a-robotic-workcell-analysis-and-visualization-tool/52442
[r2-disc-56379]: https://discourse.openrobotics.org/t/12-free-browser-based-tools-for-urdf-and-simulation-work-validator-3d-viewer-format-converters-mesh-inertia-no-install-files-never-leave-your-browser/56379
[r2-disc-51484]: https://discourse.openrobotics.org/t/urdfarchitect-a-ai-powered-visual-editor-to-build-robot-models-without-manual-xml-coding/51484
[r2-disc-51808]: https://discourse.openrobotics.org/t/announcing-linkforge-a-native-blender-extension-for-visual-urdf-xacro-editing-ros-2-support/51808
