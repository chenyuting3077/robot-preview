---
name: try-in-vscode
description: 要把這個 repo 的改動開在 VS Code 裡給使用者試（使用者試的切片、UI 觀感、設定、看實際效果）時使用：build、開 Extension Development Host、挑樣本、改了之後重新載入。
---
- 先 `npm run build`；三個 extension 都讀 build 出來的檔案。
- 開視窗用 `"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --new-window --extensionDevelopmentPath="$PWD/packages/mesh-splat" --extensionDevelopmentPath="$PWD/packages/usd" --extensionDevelopmentPath="$PWD/packages/urdf-mjcf" "$PWD" <樣本>`，因為 `code` 不在 PATH；這時使用者裝的版本不作用。
- 開發視窗已經開著時，改完 build 再請使用者執行「Developer: Reload Window」，不另開新視窗，免得兩個版本混在一起。
- 樣本挑點一下就會開 viewer 的副檔名（`.usd`、`.pcd`、`.ply`、`.las`、`.stl`、`.step`）；`.usda`、`.obj`、`.gltf`、`.xyz`、`.yaml` 預設開在文字編輯器，要按右上角的預覽按鈕；URDF / Xacro / MJCF 也是用右上角的「Open Preview to the Side」。
- 自己做的樣本放 `test-files/<主題>/`（gitignored），量測用的大檔已經在 `test-files/`。
- 完成條件：視窗已開、標題列有「Extension Development Host」；回報開的是哪個 commit 的 build，以及一份要試的勾選清單（檔案的完整路徑、操作、應該看到什麼）。
