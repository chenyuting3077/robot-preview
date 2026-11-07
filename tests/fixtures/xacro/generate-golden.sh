#!/usr/bin/env bash
# Regenerates ur5e.urdf with the real ROS 2 xacro, the reference the viewer's
# expansion is compared against. Needs Docker; run after updating ur_description.
# The fixture is registered in a throwaway ament index so $(find ur_description)
# resolves to these files, not to an apt package of another version.
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm -v "$PWD:/fx" ros:jazzy bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq ros-jazzy-xacro > /dev/null
  mkdir -p /ws/share/ament_index/resource_index/packages
  touch /ws/share/ament_index/resource_index/packages/ur_description
  ln -s /fx/ur_description /ws/share/ur_description
  source /opt/ros/jazzy/setup.bash
  AMENT_PREFIX_PATH=/ws:$AMENT_PREFIX_PATH xacro /fx/ur_description/urdf/ur.urdf.xacro ur_type:=ur5e name:=ur5e > /fx/ur5e.urdf
'
echo "wrote $(pwd)/ur5e.urdf"
