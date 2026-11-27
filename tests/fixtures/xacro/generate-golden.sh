#!/usr/bin/env bash
# Regenerates the golden URDFs with ROS 2 Jazzy's xacro in Docker, or with PyPI's xacro when Docker is not running. Usage: ./generate-golden.sh
set -euo pipefail
cd "$(dirname "$0")"
if ! docker info > /dev/null 2>&1; then
  ROS_OUT=ur5e.urdf node ../../../scripts/xacro-vs-ros.mjs ur_description urdf/ur.urdf.xacro ur_type:=ur5e name:=ur5e || true
  ROS_OUT=fr3.urdf node ../../../scripts/xacro-vs-ros.mjs franka_description robots/fr3/fr3.urdf.xacro || true
  for f in expressions/*.urdf.xacro; do ROS_OUT="${f%.xacro}" node ../../../scripts/xacro-vs-ros.mjs expressions "${f#expressions/}" || true; done
  exit
fi
# A throwaway ament index, so $(find) resolves to these fixtures, not to an apt package of another version.
docker run --rm -v "$PWD:/fx" ros:jazzy bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq ros-jazzy-xacro > /dev/null
  mkdir -p /ws/share/ament_index/resource_index/packages
  for pkg in ur_description franka_description turtlebot3_description kortex_description xarm_description pmb2_description pal_urdf_utils; do
    touch /ws/share/ament_index/resource_index/packages/$pkg
    ln -s /fx/$pkg /ws/share/$pkg
  done
  source /opt/ros/jazzy/setup.bash
  export AMENT_PREFIX_PATH=/ws:$AMENT_PREFIX_PATH
  cd /fx
  xacro ur_description/urdf/ur.urdf.xacro ur_type:=ur5e name:=ur5e > ur5e.urdf
  xacro franka_description/robots/fr3/fr3.urdf.xacro > fr3.urdf
  xacro turtlebot3_description/urdf/turtlebot3_burger.urdf > turtlebot3_burger.urdf
  xacro kortex_description/robots/gen3.xacro dof:=7 > gen3.urdf
  xacro xarm_description/urdf/xarm_device.urdf.xacro > xarm_device.urdf
  xacro pmb2_description/robots/pmb2.urdf.xacro > pmb2.urdf
  for f in expressions/*.urdf.xacro; do xacro "$f" > "${f%.xacro}"; done
'
echo "wrote the golden URDFs in $(pwd) and $(pwd)/expressions"
