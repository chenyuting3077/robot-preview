import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

function readLeb128(bytes, offset) {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    byte = bytes[offset++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [value, offset];
}

function withoutCustomSections(wasm) {
  const kept = [wasm.subarray(0, 8)];
  for (let offset = 8; offset < wasm.length;) {
    const start = offset;
    const [size, body] = readLeb128(wasm, offset + 1);
    offset = body + size;
    if (wasm[start] !== 0) kept.push(wasm.subarray(start, offset));
  }
  return Buffer.concat(kept);
}

// mujoco-js embeds its wasm as base64 with DWARF and a name section, 4.6 of its
// 8 MB. Dropping custom sections: .vsix 3.3 -> 1.9 MB (vsce package), starting a
// simulation 152 -> 78 ms and its JS heap 17.1 -> 10.9 MB (headless Chrome
// 157, Apple M2, median of 5). Stack traces lose wasm function names.
const stripMujocoDebugInfo = {
  name: 'strip-mujoco-debug-info',
  transform(code, id) {
    if (!id.includes('mujoco-js/dist/mujoco_wasm.js')) return null;
    const embedded = /base64Decode\('(AGFzbQ[A-Za-z0-9+/=]+)'\)/;
    // A mujoco-js update that embeds the wasm differently would silently ship it unstripped.
    if (!embedded.test(code)) throw new Error('strip-mujoco-debug-info: embedded wasm not found in mujoco_wasm.js');
    return code.replace(embedded, (whole, base64) =>
      `base64Decode('${withoutCustomSections(Buffer.from(base64, 'base64')).toString('base64')}')`);
  }
};

export default defineConfig({
  base: './',
  plugins: [stripMujocoDebugInfo],
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  build: {
    outDir: 'packages/urdf-mjcf/dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          d3: ['d3']
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]'
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    chunkSizeWarningLimit: 12000
  },
  optimizeDeps: {
    exclude: ['urdf-loader']
  },
  esbuild: {
    target: 'es2020',
    charset: 'utf8'
  }
});
