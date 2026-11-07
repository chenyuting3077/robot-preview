/**
 * 国际化工具 - 支持中文和英文
 */

// 获取版本号（构建时会替换为实际版本号）
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

export const translations = {
    'zh-CN': {
        'help': '操作说明',
        'screenshot': '保存截图',
        'helpKeyOrbit': '左键拖曳',
        'helpOrbit': '旋转',
        'helpKeyPan': '右键／中键拖曳',
        'helpPan': '平移',
        'helpKeyZoom': '滚轮',
        'helpZoom': '朝光标缩放',
        'helpKeyPivot': '双击',
        'helpPivot': '设置旋转中心',
        'helpKeyFly': 'W A S D',
        'helpFly': '移动',
        'helpKeyTurn': 'Q E',
        'helpTurn': '转向',
        'helpKeyFast': 'Shift',
        'helpFast': '加速',
        'helpKeyFrame': 'F',
        'helpFrame': '回到全貌',
        'helpKeySelect': '点选 link',
        'helpSelect': '跳到源代码',
        'helpKeyJoint': '拖曳 link',
        'helpJoint': '转动关节',
        // 顶部控制栏
        'display': '显示',
        'visual': '视觉',
        'collision': '碰撞',
        'com': '质心',
        'inertia': '惯量',
        'axes': '坐标系',
        'jointAxes': '关节轴',
        'shadow': '阴影',
        'lighting': '光照',
        'grid': '网格',
        'files': '文件',
        'joints': '关节',
        'structure': '树状图',
        'edit': '编辑',
        'animation': '动画',
        'help': '帮助',
        'theme': '主题',
        'language': '语言',
        'viewOrientation': '视角方向',
        'alignViewAxis': '沿轴查看',
        'flipViewAxis': '再次点击查看反面',

        // 面板标题
        'fileList': '文件',
        'jointControl': '关节',
        'modelStructure': '运动学树',
        'codeEditor': '编辑',
        'animationEditor': '动画编辑器',
        'animationExperimental': '实验功能 · 仍在开发中',

        // 动画编辑器
        'autoKey': '自动关键帧',
        'addKeyframe': '添加关键帧',
        'deleteKeyframe': '删除关键帧',
        'time': '时间',
        'duration': '时长',
        'loop': '循环',
        'importAnimation': '导入',
        'exportAnimation': '导出',
        'animationNoModel': '请加载 URDF、Xacro 或 MJCF 模型后制作动画。',
        'animationHint': '双击轨道添加关键帧；拖动菱形可调整关键帧时间。',
        'dopeSheet': '时间表',
        'graphView': '曲线',
        'addMarker': '标记',
        'addMedia': '媒体',
        'snapFrames': '吸附 30fps',
        'zoom': '缩放',
        'keyTime': '关键帧时间',
        'keyValue': '数值',
        'interpolation': '插值',
        'autoSmooth': '自动平滑',
        'smooth': '平滑',
        'broken': '自由手柄',
        'linear': '线性',
        'step': '阶跃',
        'selectionHint': 'Shift 多选，Ctrl/Cmd 切换选择，拖动空白区域框选。',
        'animationName': '动画名称',
        'markerName': '标记名称',
        'animationGuideStartTitle': '先记录起始姿势',
        'animationGuideStartText': '保持模型当前姿势，点击“记录起始姿势”。系统会记录全部关节并自动前进 1 秒。',
        'animationGuideStartButton': '记录起始姿势',
        'animationGuideAdjustTitle': '调整下一个姿势',
        'animationGuideAdjustText': '时间已到 {time}。在左侧关节面板拖动滑块，自动关键帧会记录变化；完成后继续。',
        'animationGuideContinueTitle': '继续添加姿势',
        'animationGuideContinueText': '已有 {count} 个姿势时间点，当前 {time}。调整模型后记录并前进，或直接播放预览。',
        'animationGuideRecord': '记录当前姿势',
        'animationGuideNext': '记录并前进 1 秒',
        'animationGuidePlay': '播放',
        'animationPoseRecorded': '已在 {time} 记录 {count} 个关节',
        'animationPoseRecordedNext': '姿势已记录，时间已前进到 {time}',
        'animationAutoKeyOn': '自动关键帧已开启：调整关节后会自动记录',
        'animationAutoKeyOff': '自动关键帧已关闭',
        'animationAutoKeyed': '已自动记录 {joint} · {time}',
        'animationImported': '已导入动画“{name}”',
        'animationAdd': '添加',
        'animationAddPose': '记录当前完整姿势',
        'animationAddPoseNext': '记录姿势并前进 1 秒',
        'animationAddSelectedKey': '仅给选中轨道添加关键帧',
        'animationAddMedia': '添加音频或视频',
        'animationAddEvent': '添加事件轨道',
        'animationAddMarker': '添加时间标记',
        'animationSavePose': '保存为可复用姿势',
        'animationKeySavedPose': '记录已保存姿势',
        'animationAudioReactive': '从音频生成关键帧',

        // 关节控制
        'radian': '弧度',
        'degree': '角度',
        'reset': '重置',
        'limits': '限位',

        // MuJoCo 仿真
        'mujocoReset': '重置',
        'mujocoSimulate': '仿真',
        'mujocoPause': '暂停',

        // 代码编辑器
        'reload': '重新加载',
        'download': '下载',
        'saved': '已保存',
        'unsaved': '未保存',
        'noFileOpen': '未打开文件',

        // 帮助对话框
        'helpTitle': `Robot Viewer v${APP_VERSION}`,
        'about': '关于',
        'aboutContent': 'Robot Viewer 是一个基于 Three.js 的网页端机器人模型 3D 查看器，提供直观的可视化界面，帮助您在浏览器中查看和分析机器人的结构、关节和物理属性，无需安装任何软件。<br><br>格式支持：URDF、Xacro、MJCF、USD（部分支持）<br>机器人类型：串联、分支结构及 MJCF 并联机构<br>并联机构支持关节联动，调整姿态时自动保持闭环。<br><br>由 <strong>范子琦</strong> 开发。',
        'projectHome': '项目主页',
        'email': '邮箱',
        'myGithub': '我的GitHub',
        'operations': '操作指南',
        'leftDrag': '左键拖动',
        'rotateView': '旋转视角',
        'rightDrag': '右键拖动',
        'panView': '平移视角',
        'scroll': '滚轮',
        'zoom': '缩放视图',
        'clickModel': '点击模型',
        'controlJoint': '控制关节（可拖动）',
        'dragFile': '拖拽文件',
        'loadModel': '加载机器人模型',
        'contact': '联系方式',
        'support': '支持',

        // 其他
        'noFolder': '未加载文件夹',
        'noModel': '未加载模型',
        'load': '加载',
        'loadFiles': '加载文件',
        'loadFolder': '加载文件夹',
        'orClickButton': '或点击下面的按钮加载',
        'noControllableJoints': '未找到可控制关节',
        'closedChainReady': '闭链约束已闭合',
        'closedChainPartial': '此模型含有暂未支持的约束',
        'actuatedJoint': '驱动',
        'springJoint': '弹性',
        'springJointHint': '弹簧关节；刚性网格不显示弹簧弯曲，较大偏转时外观可能出现间隙',
        'closedChainUnreachable': '此位置无法闭合，已保留上一姿态',
        'clickToEditMin': '点击编辑下限',
        'clickToEditMax': '点击编辑上限',
        'dropHint': '拖拽机器人模型文件或文件夹到页面任意位置',
        'dropHintSub': '支持 URDF, Xacro, MJCF 格式<br>支持拖拽文件夹以加载mesh文件',
        'graphHint': '拖动: 移动 | 滚轮: 缩放 | 右键: 隐藏/显示 | Ctrl+左键: 测量',
        'copyright': '© 2025 范子琦 版权所有。',

        // 模型信息
        'type': '类型',
        'links': 'Links',
        'joints': '关节',
        'controllable': '可控',
        'rootLink': '根Link',

        // 悬浮信息
        'linkName': 'Link名称',
        'jointName': '关节',
        'mass': '质量',
        'mergedLinks': '合并的Links',

        // 文件类型
        'model': '模型',
        'mesh': '网格',
        'link': '链接',

        // 单位
        'kg': 'kg',
        'rad': 'rad',
        'deg': 'deg',
        'm': 'm',

        // 状态消息
        'loading': '正在加载',
        'unsupportedFormat': '不支持的文件格式',
        'loadFailed': '加载失败',
        'noSupportedFiles': '未找到支持的文件（URDF, Xacro, MJCF, DAE, STL, OBJ）',
        'loadSuccess': '模型加载成功',
        'cannotLoadMesh': '无法加载 mesh 文件',

        // 编辑器消息
        'unsavedChanges': '您有未保存的更改，确定要关闭吗？',
        'newFile': '新文件.xml',
        'noFileToReload': '没有可重新加载的文件',
        'saveFirst': '请先保存为文件后再加载',
        'reloadingModel': '正在重新加载模型...',
        'modelReloaded': '模型已重新加载（未保存）',
        'reloadFailed': '重新加载失败',
        'downloadFailed': '下载失败',
        'fileDownloaded': '文件已下载',
        'emptyContent': '编辑器内容为空，无法加载',
        'fileType': '文件类型'
    },
    'zh-TW': {
        'help': '操作說明',
        'screenshot': '儲存截圖',
        'helpKeyOrbit': '左鍵拖曳',
        'helpOrbit': '旋轉',
        'helpKeyPan': '右鍵／中鍵拖曳',
        'helpPan': '平移',
        'helpKeyZoom': '滾輪',
        'helpZoom': '朝游標縮放',
        'helpKeyPivot': '雙擊',
        'helpPivot': '設定旋轉中心',
        'helpKeyFly': 'W A S D',
        'helpFly': '移動',
        'helpKeyTurn': 'Q E',
        'helpTurn': '轉向',
        'helpKeyFast': 'Shift',
        'helpFast': '加速',
        'helpKeyFrame': 'F',
        'helpFrame': '回到全貌',
        'helpKeySelect': '點選 link',
        'helpSelect': '跳到原始碼',
        'helpKeyJoint': '拖曳 link',
        'helpJoint': '轉動關節',
        'display': '顯示',
        'visual': '視覺',
        'collision': '碰撞',
        'com': '質心',
        'inertia': '慣量',
        'axes': '座標系',
        'jointAxes': '關節軸',
        'shadow': '陰影',
        'lighting': '光照',
        'grid': '網格',
        'files': '檔案',
        'joints': '關節',
        'structure': '樹狀圖',
        'edit': '編輯',
        'animation': '動畫',
        'help': '說明',
        'theme': '主題',
        'language': '語言',
        'viewOrientation': '視角方向',
        'alignViewAxis': '沿軸檢視',
        'flipViewAxis': '再次點擊檢視背面',

        'fileList': '檔案',
        'jointControl': '關節',
        'modelStructure': '運動學樹',
        'codeEditor': '編輯',
        'animationEditor': '動畫編輯器',
        'animationExperimental': '實驗功能 · 仍在開發中',

        'autoKey': '自動關鍵影格',
        'addKeyframe': '新增關鍵影格',
        'deleteKeyframe': '刪除關鍵影格',
        'time': '時間',
        'duration': '長度',
        'loop': '循環',
        'importAnimation': '匯入',
        'exportAnimation': '匯出',
        'animationNoModel': '請載入 URDF、Xacro 或 MJCF 模型後製作動畫。',
        'animationHint': '雙擊軌道新增關鍵影格；拖曳菱形可調整關鍵影格時間。',
        'dopeSheet': '時間表',
        'graphView': '曲線',
        'addMarker': '標記',
        'addMedia': '媒體',
        'snapFrames': '貼齊 30fps',
        'zoom': '縮放',
        'keyTime': '關鍵影格時間',
        'keyValue': '數值',
        'interpolation': '內插',
        'autoSmooth': '自動平滑',
        'smooth': '平滑',
        'broken': '自由控制點',
        'linear': '線性',
        'step': '步階',
        'selectionHint': 'Shift 多選，Ctrl/Cmd 切換選取，拖曳空白區域框選。',
        'animationName': '動畫名稱',
        'markerName': '標記名稱',
        'animationGuideStartTitle': '先記錄起始姿勢',
        'animationGuideStartText': '保持模型目前的姿勢，點擊「記錄起始姿勢」。系統會記錄全部關節並自動前進 1 秒。',
        'animationGuideStartButton': '記錄起始姿勢',
        'animationGuideAdjustTitle': '調整下一個姿勢',
        'animationGuideAdjustText': '時間已到 {time}。在左側關節面板拖曳滑桿，自動關鍵影格會記錄變化；完成後繼續。',
        'animationGuideContinueTitle': '繼續新增姿勢',
        'animationGuideContinueText': '已有 {count} 個姿勢時間點，目前 {time}。調整模型後記錄並前進，或直接播放預覽。',
        'animationGuideRecord': '記錄目前姿勢',
        'animationGuideNext': '記錄並前進 1 秒',
        'animationGuidePlay': '播放',
        'animationPoseRecorded': '已在 {time} 記錄 {count} 個關節',
        'animationPoseRecordedNext': '姿勢已記錄，時間已前進到 {time}',
        'animationAutoKeyOn': '自動關鍵影格已開啟：調整關節後會自動記錄',
        'animationAutoKeyOff': '自動關鍵影格已關閉',
        'animationAutoKeyed': '已自動記錄 {joint} · {time}',
        'animationImported': '已匯入動畫「{name}」',
        'animationAdd': '新增',
        'animationAddPose': '記錄目前完整姿勢',
        'animationAddPoseNext': '記錄姿勢並前進 1 秒',
        'animationAddSelectedKey': '僅為選取的軌道新增關鍵影格',
        'animationAddMedia': '新增音訊或影片',
        'animationAddEvent': '新增事件軌道',
        'animationAddMarker': '新增時間標記',
        'animationSavePose': '儲存為可重複使用的姿勢',
        'animationKeySavedPose': '記錄已儲存的姿勢',
        'animationAudioReactive': '從音訊產生關鍵影格',

        'radian': '弧度',
        'degree': '角度',
        'reset': '重設',
        'limits': '限位',

        'mujocoReset': '重設',
        'mujocoSimulate': '模擬',
        'mujocoPause': '暫停',

        'reload': '重新載入',
        'download': '下載',
        'saved': '已儲存',
        'unsaved': '未儲存',
        'noFileOpen': '未開啟檔案',

        'helpTitle': `Robot Viewer v${APP_VERSION}`,
        'about': '關於',
        'aboutContent': 'Robot Viewer 是一個基於 Three.js 的網頁版機器人模型 3D 檢視器，提供直覺的視覺化介面，協助您在瀏覽器中檢視和分析機器人的結構、關節和物理屬性，無需安裝任何軟體。<br><br>格式支援：URDF、Xacro、MJCF、USD（部分支援）<br>機器人類型：串聯、分支結構及 MJCF 並聯機構<br>並聯機構支援關節連動，調整姿態時自動保持閉迴路。<br><br>由 <strong>范子琦</strong> 開發。',
        'projectHome': '專案首頁',
        'email': '電子郵件',
        'myGithub': '我的GitHub',
        'operations': '操作指南',
        'leftDrag': '左鍵拖曳',
        'rotateView': '旋轉視角',
        'rightDrag': '右鍵拖曳',
        'panView': '平移視角',
        'scroll': '滾輪',
        'zoom': '縮放檢視',
        'clickModel': '點擊模型',
        'controlJoint': '控制關節（可拖曳）',
        'dragFile': '拖放檔案',
        'loadModel': '載入機器人模型',
        'contact': '聯絡方式',
        'support': '支援',

        'noFolder': '未載入資料夾',
        'noModel': '未載入模型',
        'load': '載入',
        'loadFiles': '載入檔案',
        'loadFolder': '載入資料夾',
        'orClickButton': '或點擊下方按鈕載入',
        'noControllableJoints': '找不到可控制的關節',
        'closedChainReady': '閉鏈約束已閉合',
        'closedChainPartial': '此模型含有尚未支援的約束',
        'actuatedJoint': '驅動',
        'springJoint': '彈性',
        'springJointHint': '彈簧關節；剛性網格不顯示彈簧彎曲，偏轉較大時外觀可能出現間隙',
        'closedChainUnreachable': '此位置無法閉合，已保留上一個姿態',
        'clickToEditMin': '點擊編輯下限',
        'clickToEditMax': '點擊編輯上限',
        'dropHint': '將機器人模型檔案或資料夾拖放到頁面任意位置',
        'dropHintSub': '支援 URDF, Xacro, MJCF 格式<br>支援拖放資料夾以載入mesh檔案',
        'graphHint': '拖曳: 移動 | 滾輪: 縮放 | 右鍵: 隱藏/顯示 | Ctrl+左鍵: 測量',
        'copyright': '© 2025 范子琦 版權所有。',

        'type': '類型',
        'links': 'Links',
        'joints': '關節',
        'controllable': '可控',
        'rootLink': '根Link',

        'linkName': 'Link名稱',
        'jointName': '關節',
        'mass': '質量',
        'mergedLinks': '合併的Links',

        'model': '模型',
        'mesh': '網格',
        'link': '連結',

        'kg': 'kg',
        'rad': 'rad',
        'deg': 'deg',
        'm': 'm',

        'loading': '正在載入',
        'unsupportedFormat': '不支援的檔案格式',
        'loadFailed': '載入失敗',
        'noSupportedFiles': '找不到支援的檔案（URDF, Xacro, MJCF, DAE, STL, OBJ）',
        'loadSuccess': '模型載入成功',
        'cannotLoadMesh': '無法載入 mesh 檔案',

        'unsavedChanges': '您有未儲存的變更，確定要關閉嗎？',
        'newFile': '新檔案.xml',
        'noFileToReload': '沒有可重新載入的檔案',
        'saveFirst': '請先儲存為檔案後再載入',
        'reloadingModel': '正在重新載入模型...',
        'modelReloaded': '模型已重新載入（未儲存）',
        'reloadFailed': '重新載入失敗',
        'downloadFailed': '下載失敗',
        'fileDownloaded': '檔案已下載',
        'emptyContent': '編輯器內容為空，無法載入',
        'fileType': '檔案類型'
    },
    'en-US': {
        'help': 'Controls',
        'screenshot': 'Save screenshot',
        'helpKeyOrbit': 'Left drag',
        'helpOrbit': 'Rotate',
        'helpKeyPan': 'Right / middle drag',
        'helpPan': 'Pan',
        'helpKeyZoom': 'Wheel',
        'helpZoom': 'Zoom toward the cursor',
        'helpKeyPivot': 'Double-click',
        'helpPivot': 'Set the rotation center',
        'helpKeyFly': 'W A S D',
        'helpFly': 'Move',
        'helpKeyTurn': 'Q E',
        'helpTurn': 'Turn',
        'helpKeyFast': 'Shift',
        'helpFast': 'Faster',
        'helpKeyFrame': 'F',
        'helpFrame': 'Frame the model',
        'helpKeySelect': 'Click a link',
        'helpSelect': 'Jump to its source',
        'helpKeyJoint': 'Drag a link',
        'helpJoint': 'Move its joint',
        // Top control bar
        'display': 'Display',
        'visual': 'Visual',
        'collision': 'Collision',
        'com': 'Center of Mass',
        'inertia': 'Inertia',
        'axes': 'Frames',
        'jointAxes': 'Joint Axes',
        'shadow': 'Shadow',
        'lighting': 'Lighting',
        'grid': 'Grid',
        'files': 'Files',
        'joints': 'Joints',
        'structure': 'Tree',
        'edit': 'Edit',
        'animation': 'Animation',
        'help': 'Help',
        'theme': 'Theme',
        'language': 'Language',
        'viewOrientation': 'View orientation',
        'alignViewAxis': 'View along axis',
        'flipViewAxis': 'Click again for the opposite view',

        // Panel titles
        'fileList': 'Files',
        'jointControl': 'Joints',
        'modelStructure': 'Kinematic Tree',
        'codeEditor': 'Editor',
        'animationEditor': 'Animation Editor',
        'animationExperimental': 'Experimental · In development',

        // Animation editor
        'autoKey': 'Auto Key',
        'addKeyframe': 'Add Key',
        'deleteKeyframe': 'Delete Key',
        'time': 'Time',
        'duration': 'Duration',
        'loop': 'Loop',
        'importAnimation': 'Import',
        'exportAnimation': 'Export',
        'animationNoModel': 'Load a URDF, Xacro or MJCF model to animate it.',
        'animationHint': 'Double-click a track to add a keyframe. Drag a diamond to move it.',
        'dopeSheet': 'Dope Sheet',
        'graphView': 'Graph',
        'addMarker': 'Marker',
        'addMedia': 'Media',
        'snapFrames': 'Snap 30fps',
        'zoom': 'Zoom',
        'keyTime': 'Key Time',
        'keyValue': 'Value',
        'interpolation': 'Interpolation',
        'autoSmooth': 'Auto Smooth',
        'smooth': 'Smooth',
        'broken': 'Broken',
        'linear': 'Linear',
        'step': 'Step',
        'selectionHint': 'Shift adds, Ctrl/Cmd toggles, and dragging empty space box-selects.',
        'animationName': 'Animation name',
        'markerName': 'Marker name',
        'animationGuideStartTitle': 'Record the starting pose',
        'animationGuideStartText': 'Leave the model in its current pose. This records every joint and moves the playhead forward by one second.',
        'animationGuideStartButton': 'Record starting pose',
        'animationGuideAdjustTitle': 'Create the next pose',
        'animationGuideAdjustText': 'The playhead is at {time}. Adjust joints in the Joints panel; Auto Key records each change. Continue when the pose is ready.',
        'animationGuideContinueTitle': 'Keep adding poses',
        'animationGuideContinueText': '{count} pose times are ready. You are at {time}; adjust the model, record and advance, or preview the result.',
        'animationGuideRecord': 'Record current pose',
        'animationGuideNext': 'Record and advance 1s',
        'animationGuidePlay': 'Play',
        'animationPoseRecorded': 'Recorded {count} joints at {time}',
        'animationPoseRecordedNext': 'Pose recorded; moved to {time}',
        'animationAutoKeyOn': 'Auto Key is on: joint changes will be recorded',
        'animationAutoKeyOff': 'Auto Key is off',
        'animationAutoKeyed': 'Auto-keyed {joint} at {time}',
        'animationImported': 'Imported “{name}”',
        'animationAdd': 'Add',
        'animationAddPose': 'Record current pose',
        'animationAddPoseNext': 'Record pose and advance 1s',
        'animationAddSelectedKey': 'Key selected track only',
        'animationAddMedia': 'Add audio or video',
        'animationAddEvent': 'Add event track',
        'animationAddMarker': 'Add time marker',
        'animationSavePose': 'Save reusable pose',
        'animationKeySavedPose': 'Key saved pose',
        'animationAudioReactive': 'Generate keys from audio',

        // Joint control
        'radian': 'Radian',
        'degree': 'Degree',
        'reset': 'Reset',
        'limits': 'Limits',

        // MuJoCo simulation
        'mujocoReset': 'Reset',
        'mujocoSimulate': 'Simulate',
        'mujocoPause': 'Pause',

        // Code editor
        'reload': 'Reload',
        'download': 'Download',
        'saved': 'Saved',
        'unsaved': 'Unsaved',
        'noFileOpen': 'No File Open',

        // Help dialog
        'helpTitle': `Robot Viewer v${APP_VERSION}`,
        'about': 'About',
        'aboutContent': 'Robot Viewer is a web-based 3D viewer for robot models and scenes. Built on top of Three.js, it provides an intuitive interface for visualizing, editing, and simulating robots directly in the browser without any installation required. This tool helps you visualize and analyze robot structures, joints, and physical properties.<br><br>Format Support: URDF, Xacro, MJCF, USD (partial support)<br>Robot Types: Serial and branched robots, plus MJCF parallel mechanisms<br>Linked joints automatically maintain closed chains while editing parallel mechanism poses.<br><br>Developed by <strong>Ziqi Fan</strong>.',
        'projectHome': 'Project Home',
        'email': 'Email',
        'myGithub': 'My GitHub',
        'operations': 'Operations',
        'leftDrag': 'Left Drag',
        'rotateView': 'Rotate View',
        'rightDrag': 'Right Drag',
        'panView': 'Pan View',
        'scroll': 'Scroll',
        'zoom': 'Zoom',
        'clickModel': 'Click Model',
        'controlJoint': 'Control Joint (Draggable)',
        'dragFile': 'Drag File',
        'loadModel': 'Load Robot Model',
        'contact': 'Contact',
        'support': 'Support',

        // Others
        'noFolder': 'No Folder Loaded',
        'noModel': 'No Model Loaded',
        'load': 'Load',
        'loadFiles': 'Load Files',
        'loadFolder': 'Load Folder',
        'orClickButton': 'or click the button below to load',
        'noControllableJoints': 'No Controllable Joints Found',
        'closedChainReady': 'Closed-chain constraints satisfied',
        'closedChainPartial': 'This model includes unsupported constraints',
        'actuatedJoint': 'Drive',
        'springJoint': 'Spring',
        'springJointHint': 'Spring joint; rigid meshes do not show spring bending and may separate visually at large deflections',
        'closedChainUnreachable': 'Position cannot close the chain; previous pose restored',
        'clickToEditMin': 'Click to edit minimum',
        'clickToEditMax': 'Click to edit maximum',
        'dropHint': 'Drag and drop robot model files or folders anywhere',
        'dropHintSub': 'Supports URDF, Xacro, MJCF formats<br>Supports folder dragging to load mesh files',
        'graphHint': 'Drag: Move | Scroll: Zoom | Right-click: Hide/Show | Ctrl+Click: Measure',
        'copyright': '© 2025 Ziqi Fan. All rights reserved.',

        // Model info
        'type': 'Type',
        'links': 'Links',
        'joints': 'Joints',
        'controllable': 'Controllable',
        'rootLink': 'Root Link',

        // Hover info
        'linkName': 'Link Name',
        'jointName': 'Joint',
        'mass': 'Mass',
        'mergedLinks': 'Merged Links',

        // File types
        'model': 'Model',
        'mesh': 'Mesh',
        'link': 'Link',

        // Units
        'kg': 'kg',
        'rad': 'rad',
        'deg': 'deg',
        'm': 'm',

        // Status messages
        'loading': 'Loading',
        'unsupportedFormat': 'Unsupported file format',
        'loadFailed': 'Load failed',
        'noSupportedFiles': 'No supported files found (URDF, Xacro, MJCF, DAE, STL, OBJ)',
        'loadSuccess': 'Model loaded successfully',
        'cannotLoadMesh': 'Cannot load mesh file',

        // Editor messages
        'unsavedChanges': 'You have unsaved changes. Are you sure you want to close?',
        'newFile': 'newfile.xml',
        'noFileToReload': 'No file to reload',
        'saveFirst': 'Please save the file first before loading',
        'reloadingModel': 'Reloading model...',
        'modelReloaded': 'Model reloaded (unsaved)',
        'reloadFailed': 'Reload failed',
        'downloadFailed': 'Download failed',
        'fileDownloaded': 'File downloaded',
        'emptyContent': 'Editor content is empty, cannot load',
        'fileType': 'File Type'
    }
};

class I18n {
    constructor() {
        const lang = document.documentElement.lang.toLowerCase();
        this.currentLang = /^zh-(tw|hk|mo|hant)/.test(lang) ? 'zh-TW' : lang.startsWith('zh') ? 'zh-CN' : 'en-US';
    }

    /**
     * 获取翻译文本
     */
    t(key) {
        const lang = translations[this.currentLang] || translations['zh-CN'];
        return lang[key] || key;
    }

    /**
     * 获取当前语言
     */
    getCurrentLanguage() {
        return this.currentLang;
    }

    /**
     * 更新页面上所有带有data-i18n属性的元素
     */
    updatePageLanguage() {
        // 更新所有带有data-i18n属性的元素
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const text = this.t(key);

            // 如果是input或textarea，更新placeholder
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = text;
            } else {
                // 如果包含HTML标签（如<br>），使用innerHTML
                if (text.includes('<br>') || text.includes('<strong>')) {
                    element.innerHTML = text;
                } else {
                    element.textContent = text;
                }
            }
        });

        // 更新HTML lang属性
        document.documentElement.lang = this.currentLang;
    }

    /**
     * 初始化页面语言
     */
    init() {
        this.updatePageLanguage();
    }
}

// 创建全局实例
export const i18n = new I18n();
