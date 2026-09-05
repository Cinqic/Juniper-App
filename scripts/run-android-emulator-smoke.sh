#!/usr/bin/env bash
set -euo pipefail

apk_path=${1:?APK path is required}
package_name=${2:-com.cinqic.juniper}
evidence_dir=${3:-release-artifacts/android-lifecycle}
avd_name=${4:-juniper-api-35}
emulator_port=${ANDROID_EMULATOR_PORT:-5554}
serial=${ANDROID_SERIAL:-emulator-${emulator_port}}
sdk_root=${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Android SDK root is required}}
android_config_home=${ANDROID_SDK_HOME:-${HOME}/.android}
avd_home=${ANDROID_AVD_HOME:-${android_config_home}/avd}

export ANDROID_SDK_HOME="$android_config_home"
export ANDROID_AVD_HOME="$avd_home"

resolve_tool() {
  local tool_name=$1
  shift
  local candidate
  if candidate=$(command -v "$tool_name" 2>/dev/null); then
    printf '%s\n' "$candidate"
    return 0
  fi
  for candidate in "$@"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf 'Required Android tool was not found: %s\n' "$tool_name" >&2
  return 1
}

adb_bin=$(resolve_tool adb "$sdk_root/platform-tools/adb")
avdmanager_bin=$(resolve_tool avdmanager \
  "$sdk_root/cmdline-tools/latest/bin/avdmanager" \
  "$sdk_root/tools/bin/avdmanager")
emulator_bin=$(resolve_tool emulator "$sdk_root/emulator/emulator")
emulator_pid=''
emulator_log="$evidence_dir/emulator.log"

adb_args=(-s "$serial")

adb_timeout() {
  local seconds=$1
  shift
  timeout --foreground "${seconds}s" "$adb_bin" "${adb_args[@]}" "$@"
}

capture_failure_evidence() {
  mkdir -p "$evidence_dir"
  if [[ -f "$emulator_log" ]]; then
    tail -n 500 "$emulator_log" > "$evidence_dir/emulator-failure-tail.txt" || true
  fi
  adb_timeout 10 shell getprop > "$evidence_dir/failure-getprop.txt" 2>&1 || true
  adb_timeout 10 logcat -d -t 500 > "$evidence_dir/failure-logcat.txt" 2>&1 || true
  adb_timeout 10 devices -l > "$evidence_dir/failure-adb-devices.txt" 2>&1 || true
}

cleanup() {
  local status=$?
  if ((status != 0)); then
    capture_failure_evidence
  fi
  adb_timeout 10 emu kill >/dev/null 2>&1 || true
  if [[ -n "$emulator_pid" ]] && kill -0 "$emulator_pid" 2>/dev/null; then
    kill "$emulator_pid" 2>/dev/null || true
  fi
  if [[ -n "$emulator_pid" ]]; then
    wait "$emulator_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT

mkdir -p "$evidence_dir"
mkdir -p "$avd_home"
printf 'Creating clean Android emulator AVD: %s\n' "$avd_name"
"$avdmanager_bin" delete avd --name "$avd_name" >/dev/null 2>&1 || true
printf 'no\n' | "$avdmanager_bin" create avd \
  --force \
  --name "$avd_name" \
  --package 'system-images;android-35;google_apis;x86_64' \
  --device 'pixel_6' \
  > "$evidence_dir/avd-create.txt" 2>&1

if ! "$emulator_bin" -list-avds | grep -Fxq "$avd_name"; then
  printf 'Android emulator AVD was not created at %s.\n' "$avd_home" >&2
  "$emulator_bin" -list-avds > "$evidence_dir/avd-list.txt" 2>&1 || true
  exit 1
fi

printf 'Starting emulator on %s (%s)\n' "$serial" "$emulator_bin"
"$emulator_bin" -accel-check > "$evidence_dir/accel-check.txt" 2>&1 || true
ANDROID_SERIAL="$serial" "$emulator_bin" \
  -avd "$avd_name" \
  -port "$emulator_port" \
  -no-accel \
  -no-window \
  -gpu swiftshader_indirect \
  -no-snapshot \
  -wipe-data \
  -noaudio \
  -no-boot-anim \
  -camera-back none \
  -no-metrics \
  > "$emulator_log" 2>&1 &
emulator_pid=$!
printf '%s\n' "$emulator_pid" > "$evidence_dir/emulator.pid"

wait_for_boot() {
  local seconds=${1:-900}
  local deadline=$((SECONDS + seconds))
  local boot_completed
  local boot_animation
  while ((SECONDS < deadline)); do
    if adb_timeout 5 get-state 2>/dev/null | grep -Fxq device; then
      boot_completed=$(adb_timeout 5 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r') || boot_completed=''
      boot_animation=$(adb_timeout 5 shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r') || boot_animation=''
      if [[ "$boot_completed" == '1' || "$boot_animation" == 'stopped' ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

if ! wait_for_boot; then
  printf 'Android emulator did not become ADB-ready before the deadline.\n' >&2
  exit 1
fi

export ANDROID_SERIAL="$serial"
adb_timeout 10 devices -l | tee "$evidence_dir/adb-devices.txt"
timeout --foreground 12m bash scripts/verify-android-lifecycle.sh "$apk_path" "$package_name" "$evidence_dir"
