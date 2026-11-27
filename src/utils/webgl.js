// What a view says when WebGL cannot start or its context is lost (#24), shared by both webviews.
// Usage: renderer = createRenderer(() => new THREE.WebGLRenderer(...)), showing a WebGLUnavailable's message;
// watchContext(renderer.domElement, { lost: text => show(text), restored: () => redraw() }).

const TEXTS = {
    en: {
        unavailable: 'WebGL is not available, so this view cannot draw. Common causes: the snap build of VS Code, GPU acceleration turned off (--disable-gpu, or "disable-hardware-acceleration" in argv.json), or a remote desktop session. Install VS Code from code.visualstudio.com or the .deb, turn GPU acceleration back on, or open VS Code on this machine directly.',
        lost: 'The view lost its graphics context (the GPU or its driver reset). It comes back on its own when the GPU does; if it stays empty, close this view and open it again.'
    },
    'zh-TW': {
        unavailable: 'WebGL 無法使用，這個檢視畫不出來。常見原因：snap 版的 VS Code、關閉了 GPU 加速（--disable-gpu，或 argv.json 的 "disable-hardware-acceleration"）、透過遠端桌面連線。請改裝 code.visualstudio.com 或 .deb 版的 VS Code、重新開啟 GPU 加速，或直接在這台電腦上開 VS Code。',
        lost: '這個檢視的繪圖環境遺失了（GPU 或驅動程式重設）。GPU 恢復後會自動重畫；一直空白的話，請關掉這個檢視再重新開啟。'
    },
    'zh-CN': {
        unavailable: 'WebGL 无法使用，这个视图画不出来。常见原因：snap 版的 VS Code、关闭了 GPU 加速（--disable-gpu，或 argv.json 的 "disable-hardware-acceleration"）、通过远程桌面连接。请改装 code.visualstudio.com 或 .deb 版的 VS Code、重新开启 GPU 加速，或直接在这台电脑上打开 VS Code。',
        lost: '这个视图的绘图环境丢失了（GPU 或驱动程序重置）。GPU 恢复后会自动重绘；一直空白的话，请关闭这个视图再重新打开。'
    }
};

export function webglText(key) {
    const lang = document.documentElement.lang.toLowerCase();
    return TEXTS[/^zh-(tw|hk|mo|hant)/.test(lang) ? 'zh-TW' : lang.startsWith('zh') ? 'zh-CN' : 'en'][key];
}

export class WebGLUnavailable extends Error {
    constructor(cause) {
        super(webglText('unavailable'), { cause });
        this.name = 'WebGLUnavailable';
    }
}

// three's WebGLRenderer throws when the canvas gives no context.
export function createRenderer(create) {
    try {
        return create();
    } catch (error) {
        throw new WebGLUnavailable(error);
    }
}

// three stops drawing while the context is lost and sets its GPU state up again, before these run, when it is back.
export function watchContext(canvas, { lost, restored }) {
    canvas.addEventListener('webglcontextlost', () => lost(webglText('lost')));
    canvas.addEventListener('webglcontextrestored', restored);
}
