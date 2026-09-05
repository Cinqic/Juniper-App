#!/usr/bin/env bash
set -euo pipefail

apk_path=${1:?APK path is required}
package_name=${2:-com.cinqic.juniper}
component="$package_name/.MainActivity"
evidence_dir=${3:-release-artifacts/android-lifecycle}
uninstalled=0

adb_args=()
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  adb_args=(-s "$ANDROID_SERIAL")
fi

adb_timeout() {
  local seconds=$1
  shift
  timeout --foreground "${seconds}s" adb "${adb_args[@]}" "$@"
}

mkdir -p "$evidence_dir"

capture_evidence() {
  local label=$1
  adb_timeout 30 shell dumpsys activity activities > "$evidence_dir/${label}-activity.txt" 2>&1 || true
  adb_timeout 30 shell dumpsys window windows > "$evidence_dir/${label}-windows.txt" 2>&1 || true
  adb_timeout 30 logcat -d -t 500 > "$evidence_dir/${label}-logcat.txt" 2>&1 || true
  adb_timeout 30 exec-out screencap -p > "$evidence_dir/${label}.png" 2>/dev/null || true
}

foreground_activity_ready() {
  local activities windows
  activities=$(adb_timeout 30 shell dumpsys activity activities 2>/dev/null) || return 1
  grep -E 'mResumedActivity|ResumedActivity' <<<"$activities" | grep -F "$component" >/dev/null || return 1

  windows=$(adb_timeout 30 shell dumpsys window windows 2>/dev/null) || return 1
  grep -E 'mCurrentFocus|mFocusedApp' <<<"$windows" | grep -F "$package_name" >/dev/null
}

wait_for_device() {
  local attempt
  for attempt in $(seq 1 30); do
    if adb_timeout 10 get-state 2>/dev/null | grep -Fxq device; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_foreground_activity() {
  local label=$1
  local attempt
  for attempt in $(seq 1 30); do
    if foreground_activity_ready; then
      capture_evidence "$label"
      return 0
    fi
    sleep 1
  done
  capture_evidence "$label-timeout"
  return 1
}

fail_smoke() {
  echo "Android lifecycle smoke failed: $*" >&2
  return 1
}

cleanup() {
  local status=$?
  if ((status != 0)); then
    capture_evidence failure
  fi
  if ((uninstalled == 0)); then
    adb_timeout 30 uninstall "$package_name" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

# Start from a clean package state if an emulator snapshot left an older build.
wait_for_device || fail_smoke "Emulator did not become ready for ADB commands."
adb_timeout 30 uninstall "$package_name" >/dev/null 2>&1 || true
if [[ ! -f "$apk_path" ]]; then
  fail_smoke "APK was not found at $apk_path."
fi
printf 'Installing APK: %s\n' "$apk_path"
adb_timeout 180 install "$apk_path"

adb_timeout 60 shell am start -W -n "$component" | tee "$evidence_dir/initial-start.txt"
wait_for_foreground_activity initial || fail_smoke "MainActivity was not resumed and focused after install."

# Force a configuration change and require the same activity to remain usable.
adb_timeout 30 shell settings put system accelerometer_rotation 0
adb_timeout 30 shell settings put system user_rotation 1
wait_for_foreground_activity rotated || fail_smoke "MainActivity did not survive the rotation/configuration change."
adb_timeout 30 shell settings put system user_rotation 0

adb_timeout 30 shell am force-stop "$package_name"
adb_timeout 60 shell am start -W -n "$component" | tee "$evidence_dir/relaunch-start.txt"
wait_for_foreground_activity relaunched || fail_smoke "MainActivity was not resumed and focused after force-stop/relaunch."

adb_timeout 30 uninstall "$package_name" | tee "$evidence_dir/uninstall.txt"
uninstalled=1
if adb_timeout 30 shell pm path "$package_name" 2>/dev/null | grep -q .; then
  fail_smoke "Package remained installed after uninstall."
fi
