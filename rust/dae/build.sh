#!/usr/bin/env bash
# Rebuilds src/wasm/dae.wasm. Needs rustup with the wasm32-unknown-unknown target; no crates are fetched.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cargo build --manifest-path "$here/Cargo.toml" --release --target wasm32-unknown-unknown
cp "$here/target/wasm32-unknown-unknown/release/dae.wasm" "$here/../../src/wasm/dae.wasm"
