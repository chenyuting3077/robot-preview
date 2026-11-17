# MJCF Parallel Mechanisms

Examples: the [Robotiq 2F-85 four-bar gripper](https://github.com/google-deepmind/mujoco_menagerie/tree/main/robotiq_2f85) and a [Stewart platform](https://github.com/duccuongvu/stewart_platform_mujoco). Keep each XML beside its `assets/`.

- Moving a driver joint keeps it at the requested value while the passive joints close every branch; only the affected closed chain moves. An unreachable pose restores the previous one.
- Supported constraints: body / site `connect` and `weld` (with relative poses) and polynomial joint equalities. Not supported: tendon equalities, contact-based closure.
- The pose editor is kinematic; **Simulate** runs MuJoCo dynamics.
- `<attach>` composition is compiled by the bundled MuJoCo, so the model must compile there; self-attachment and named-frame selection are newer than that runtime.
- Joints outside their limits are clamped on import. Spring meshes stay rigid, so moving a spring joint directly can leave a gap.
- Sources and licenses of the test models are in `tests/fixtures/mjcf/`.
