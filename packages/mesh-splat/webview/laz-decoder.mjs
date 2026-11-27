import { createLazPerf } from 'laz-perf';
import wasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url';

// laz-perf instances sharing one fetch of the WASM, for lazReader; imported only when a LAZ opens.
export async function lazDecoder() {
    const wasmBinary = await (await fetch(new URL(wasmUrl, document.baseURI))).arrayBuffer();
    return () => createLazPerf({ wasmBinary });
}
