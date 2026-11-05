import { defineConfig } from 'vite';

export default defineConfig({
    root: 'webview',
    base: './',
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 5000,
        rollupOptions: { output: { entryFileNames: 'main.js', chunkFileNames: '[name].js', assetFileNames: '[name][extname]' } }
    }
});
