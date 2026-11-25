# Coding standards

審查時讀。只列檢查工具抓不到、而且是這個 repo 特有的判斷題；跨專案的通則在 `allen:review` 裡。

- 開檔時間、記憶體、FPS 在 VS Code 裡用 `tests/e2e/vscode.mjs` 量；寫進 docs、註解、CHANGELOG 的數字附 VS Code 版本、檔案大小和幾次量測的範圍。用 Node 或 headless Chrome 量的只用在內部細節，並標明。
- 兩個以上 extension 或 reader 都要的邏輯放共用模組（例如 `src/utils/camera-keys.js`、`packages/mesh-splat/webview/materials.mjs`、`main.js` 的 `geometryFrom`）；加新格式前先找有沒有可以用的。共用模組不 import three，由呼叫端傳入（#23）。
- 解析要寬容：其他工具輸出的檔案（SolidWorks、Fusion 匯出的 URDF，還沒 build 的 ROS workspace），關鍵參數對就要開得起來；不合規的地方報到 Problems 面板。只為單一資料集寫的特例不加。
- 測試 fixture 和截圖素材只用開源授權的模型，附 LICENSE 和來源；README 致謝用到的開源專案。
- `packages/*/README.md` 是 Marketplace 商品頁，可以列支援格式和功能。三個 extension 的工具列、面板、用詞和翻譯以 Mesh & Splat 版為準。
- 回報裡的「已知問題」只留修不了的，並寫為什麼修不了；能修的先修。
