#!/usr/bin/env bash
# Rebuilds vendor/foxtrot and vendor/occt from source with the patches in ../../../patches.
# Needs git, cmake, make, rustup (wasm32-unknown-unknown) and wasm-bindgen-cli matching
# foxtrot's wasm-bindgen version; emsdk 3.1.69 is fetched into the work directory.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
patches=$(cd "$here/../../../patches" && pwd)
work=${1:-$(mktemp -d)}
cd "$work"

git clone https://github.com/Formlabs/foxtrot
git -C foxtrot checkout 69fb37688892246e670fc08eb60b7d3a92d70d3f
git -C foxtrot apply "$patches/foxtrot.patch"
(cd foxtrot/wasm && cargo build --release --target wasm32-unknown-unknown)
wasm-bindgen --target web --out-dir "$here/foxtrot" --out-name foxtrot foxtrot/wasm/target/wasm32-unknown-unknown/release/wasm.wasm
rm -f "$here"/foxtrot/*.d.ts
# The caller always passes the wasm bytes; the default `new URL(..., import.meta.url)` makes vite emit a second copy.
sed -i "s|module_or_path = new URL('foxtrot_bg.wasm', import.meta.url);|throw new Error('foxtrot: pass the wasm URL');|" "$here/foxtrot/foxtrot.js"
grep -q "foxtrot: pass the wasm URL" "$here/foxtrot/foxtrot.js"

git clone https://github.com/kovacsv/occt-import-js
git -C occt-import-js checkout 41e470890ae0f9dc69ac50ffd5fc73e03576f4eb
git -C occt-import-js apply "$patches/occt-import-js.patch"
git -C occt-import-js config submodule.occt.url https://github.com/Open-Cascade-SAS/OCCT.git
git -C occt-import-js submodule update --init --depth 1 occt
git clone --depth 1 https://github.com/emscripten-core/emsdk
emsdk/emsdk install 3.1.69
emsdk/emsdk activate 3.1.69
source emsdk/emsdk_env.sh
mkdir -p occt-import-js/build && cd occt-import-js/build
emcmake cmake -DCMAKE_BUILD_TYPE=Release ..
make -j"$(nproc)"
cp Release/occt-import-js.js Release/occt-import-js.wasm "$here/occt/"
