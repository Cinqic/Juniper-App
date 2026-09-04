#!/usr/bin/env bash
set -euo pipefail

artifact_dir=${1:?artifact directory is required}
version=${2:?version is required}
deb="$artifact_dir/Juniper-$version-linux-x86_64.deb"
appimage="$artifact_dir/Juniper-$version-linux-x86_64.AppImage"

test -f "$deb"
test -f "$appimage"
file "$deb" "$appimage"
dpkg-deb --info "$deb" | tee "$artifact_dir/PACKAGE-linux.txt"
dpkg-deb --field "$deb" Version | grep -Fx "$version"
# Tauri resolves Linux resources beside the binary at /usr/lib/juniper, so
# the packaged path is runtime/llama-server rather than resources/runtime/...
dpkg-deb --contents "$deb" | grep -Eq '/runtime/llama-server$'
chmod +x "$appimage"

set +e
APPIMAGE_EXTRACT_AND_RUN=1 timeout 20s xvfb-run -a "$appimage"
appimage_status=$?
set -e
test "$appimage_status" -eq 0 -o "$appimage_status" -eq 124

sudo apt-get install -y "$(realpath "$deb")"
command -v juniper
set +e
timeout 20s xvfb-run -a juniper
deb_status=$?
set -e
test "$deb_status" -eq 0 -o "$deb_status" -eq 124
sudo apt-get purge -y juniper
if command -v juniper; then
  echo 'Juniper executable remained after package purge.' >&2
  exit 1
fi
