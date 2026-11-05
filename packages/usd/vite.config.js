import config from '../mesh-splat/vite.config.js';

export default { ...config, root: '../mesh-splat/webview', build: { ...config.build, outDir: '../../usd/dist' } };
