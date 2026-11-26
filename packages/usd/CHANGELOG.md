# Changelog

## Unreleased

- A model whose meshes carry one material per face group opens again instead of failing with `Cannot read properties of undefined (reading 'clip')`.
- The Marketplace page opens with a capture of an Isaac Sim robot being opened from the Explorer, and says how each format opens.

## 0.4.0

- Toolbar menus are opaque, so the model no longer shows through their text, and one opened near the view's right edge stays inside it.
- Drop-down menus are tighter, at least as wide as their button, and open 4 px below it, lined up with its left edge, instead of 2 px below the toolbar.
- The eye in the Stage panel's header hides every row while any is shown, and shows them all again.
- Text in menus and panels lines up with its button's, icon buttons are as tall as the others, and the Stage panel opens under its button as the menus do, right edges lined up.

## 0.3.1

- The icon's top layer is jade, close to the green of the URDF / MJCF icon, so the extensions look like one set.
- Panels and menus have rounded corners, nested ones concentric, and drop-down menus open 2 px below their toolbar.
- `F` fits the whole model in the view's narrower side, so a tall pane takes it all in; a single view frames about 10% farther back than before.
- A view of a large file (100 MB or more) in a tab hidden for 5 minutes gives its memory back, and loads again with the camera kept when you return.

## 0.3.0

- Now listed as "Robot Preview: USD Viewer (OpenUSD, Isaac Sim)".
- The grid shows on opening and grid, axes and bounds stay as last left.
- Each file reopens with the up axis last chosen for it.
- Click a part in the view to select its prim: it is boxed, marked in the Stage panel, and its path shown with each level clickable; a row's name selects too, Esc clears. A closed Stage panel stays closed; opened later, it shows the picked prim.
- Resting the pointer on a part boxes it faintly and names it by the cursor with its path's last three levels, such as `left_hip_roll_link › visuals › mesh`.
- Picking skips Gaussian fields, and the arrow button turns it off for orbiting a scene; the choice is kept. With it off, a click still clears the selection.
- `.usda` `variantSet` blocks are read, with local opinions still stronger than the selected variant.
- Paths into a USDZ (`scene.usdz[0/points.usd]`), as Isaac Sim 6 neural reconstruction stages use, are followed.
- Isaac Sim's OmniPBR materials show their colour, texture, metallic and roughness instead of white.
- Legacy NuRec Gaussian volumes (`.nurec`) open as splats.
- Prims with `active = false` are left out, Cube / Sphere / other primitives take their `displayColor`, and `custom` attributes in `.usda` are read.
- The info popover shows the stage's unit, materials that are bound but not on the stage, and prim types that are not drawn, such as physics joints.

## 0.2.1

- Triangle and quad meshes triangulate into typed arrays: in VS Code a 177 MB, 3.4M-triangle usdc opens in 2.18-2.32 s against 2.40-3.84 s with 0.2.0.

## 0.2.0

- The up menu shows the stage's `upAxis` (+Z for Isaac Sim assets); stages without one start +Z instead of +Y.

## 0.1.1

- USD scenes load about 2-3.5x faster, and large multi-file scenes use less memory.

## 0.1.0

- First release: USD, USDA, USDC and USDZ scenes with meshes and Gaussian splat particle fields.
