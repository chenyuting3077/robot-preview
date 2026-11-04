# MJCF Parallel Mechanisms

Example mechanisms include the [Robotiq 2F-85 four-bar gripper](https://github.com/google-deepmind/mujoco_menagerie/tree/main/robotiq_2f85) and a [Stewart platform with six closed branches](https://github.com/duccuongvu/stewart_platform_mujoco). Obtain the XML and assets from the source repository and open the robot XML in VS Code; open `scene.xml` instead for the complete scene. Keep the XML and `assets/` together.

Move a Robotiq driver joint or a Stewart `joint_lu_*` slider. The selected coordinate stays fixed at your requested value while passive joints follow to close all branches. The solver changes only joints in the affected closed chain; shared ancestors and unrelated branches keep their poses. Other actuators stay fixed unless coupled to the selected actuator by a joint equality. Sliders, viewport dragging and reset use the same constraint solver. Unreachable edits restore the previous valid pose and show a message in the joint panel.

Supported MJCF constraints are body/site `connect`, body/site `weld` (including relative poses), and polynomial joint equalities. Passive ball joints and floating platforms participate in closure; scalar sliders control hinge/slide joints. The pose editor performs kinematic closure; use **Simulate** for MuJoCo dynamics. Tendon equalities, contact-based closure and arbitrary mechanism-specific inverse kinematics are outside this support.

The importer also handles nested includes, default classes and `childclass`, multiple joints per body, joint anchors/references, degree/radian units and MJCF frame orientations. Controls use radians for rotation and meters for translation.

Additional regression models include Cassie, Robotiq 2F-85 v4, ToddlerBot 2XC and IIT SoftFoot. SoftFoot's original `scene.xml` is supported, including its loading slide and attached foot.

MJCF [`<attach>` model composition](https://mujoco.readthedocs.io/en/stable/XMLreference.html#body-attach) uses the bundled MuJoCo compiler to preserve prefixes, defaults, assets, actuators, sensors and equality references. It supports external body subtrees or whole models, nested/repeated attachments, and placement inside frames. Keep all referenced XML and asset files together; assembly imports require a model that compiles in MuJoCo. Newer self-attachment and named-frame selection syntax are outside the bundled runtime's support and report explicit errors.

On import, joints outside their limits are clamped to the nearest limit. Closed mechanisms then project the assembly within those limits, keeping already valid actuators fixed; linked joints may need to move together to achieve closure. Passive spring joints retain their current deflection whenever closure permits. Spring meshes remain rigid, so directly changing a spring joint can create a visible gap rather than a bent spring.

Run the regression suite with:

```bash
pnpm test
```

Tests cover all six parallel models, forward/reverse motion and reset, complete equality import, actuator preservation, passive ball joints and rejection of unreachable poses. Serial regressions compare every body of Panda, UR5e and Lite6 against MuJoCo `mj_forward` in five poses each. Original XML, licenses, source revisions and references are in `tests/fixtures/mjcf/`. Mesh rendering and physics compilation require the full downloaded examples.
