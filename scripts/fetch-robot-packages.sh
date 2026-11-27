#!/usr/bin/env bash
# Clones the ROS description packages docs/vscode-extension.md measures into test-files/urdf/ (gitignored). Usage: scripts/fetch-robot-packages.sh
set -euo pipefail
out="$(dirname "$0")/../test-files/urdf"
mkdir -p "$out"
clone() {
  if [ -d "$out/$2" ]; then
    [ "$(git -C "$out/$2" describe --tags 2>/dev/null)" = "$3" ] || echo "warning: $out/$2 is not at $3; delete it to fetch again" >&2
  else
    git clone -q --depth 1 --branch "$3" "$1" "$out/$2"
  fi
}
clone https://github.com/IntelRealSense/realsense-ros.git realsense-ros 4.59.2
clone https://github.com/frankaemika/franka_description.git franka_description 2.9.0
clone https://github.com/UniversalRobots/Universal_Robots_ROS2_Description.git ur_description 4.4.1
echo "packages in $(cd "$out" && pwd)"
