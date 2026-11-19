# usd-wg/assets fixtures

A subset of [usd-wg/assets](https://github.com/usd-wg/assets) at commit
`091bb5c6f8eb665ad4cf9d6c10025cecc07eda88`, with the upstream paths kept so relative
references still resolve. Licensed under Apache-2.0 (`LICENSE`); individual files keep
their upstream copyright lines.

Used by `tests/mesh-splat/usd-fixtures.test.mjs`. Larger real-world files (Isaac Sim robots,
NuRec Gaussian scenes) are not committed; `node scripts/fetch-usd-fixtures.mjs` downloads
them into `test-files/usd/`.
