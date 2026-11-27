#!/usr/bin/env bash
# Regenerates the golden URDFs with ROS 2 Jazzy's xacro in Docker, or with PyPI's xacro when Docker is not running. Usage: ./generate-golden.sh
set -euo pipefail
cd "$(dirname "$0")"
if ! docker info > /dev/null 2>&1; then
  ROS_OUT=ur5e.urdf node ../../../scripts/xacro-vs-ros.mjs ur_description urdf/ur.urdf.xacro ur_type:=ur5e name:=ur5e || true
  ROS_OUT=fr3.urdf node ../../../scripts/xacro-vs-ros.mjs franka_description robots/fr3/fr3.urdf.xacro || true
  exit
fi
# A throwaway ament index, so $(find) resolves to these fixtures, not to an apt package of another version.
docker run --rm -v "$PWD:/fx" ros:jazzy bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq ros-jazzy-xacro > /dev/null
  mkdir -p /ws/share/ament_index/resource_index/packages
  for pkg in ur_description franka_description; do
    touch /ws/share/ament_index/resource_index/packages/$pkg
    ln -s /fx/$pkg /ws/share/$pkg
  done
  source /opt/ros/jazzy/setup.bash
  AMENT_PREFIX_PATH=/ws:$AMENT_PREFIX_PATH xacro /fx/ur_description/urdf/ur.urdf.xacro ur_type:=ur5e name:=ur5e > /fx/ur5e.urdf
  AMENT_PREFIX_PATH=/ws:$AMENT_PREFIX_PATH xacro /fx/franka_description/robots/fr3/fr3.urdf.xacro > /fx/fr3.urdf
'
echo "wrote $(pwd)/ur5e.urdf and fr3.urdf"
