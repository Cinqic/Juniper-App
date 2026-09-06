#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 MODEL_PATH TEST_APK [SERIAL]" >&2
  exit 2
fi

model_path="$1"
test_apk="$2"
serial=""
if [[ $# -ge 3 ]]; then
  serial="$3"
elif [[ -n "${ANDROID_SERIAL:-}" ]]; then
  serial="$ANDROID_SERIAL"
fi

expected_sha256="${JUNIPER_TEST_MODEL_SHA256:-8030f04528538d47bda434f6f0bdf3952c40a58123e4d5e755332f23731a8684}"
target_package="${JUNIPER_TEST_TARGET_PACKAGE:-com.cinqic.juniper.local_runtime.test}"
test_package="${JUNIPER_TEST_PACKAGE:-$target_package}"
remote_name="juniper-inference-smoke.gguf"
remote_path="/data/data/$target_package/files/$remote_name"
adb_args=()
if [[ -n "$serial" ]]; then adb_args+=( -s "$serial" ); fi
adb=(adb "${adb_args[@]}")
adb_timeout() {
  local seconds=$1
  shift
  timeout --foreground "${seconds}s" "${adb[@]}" "$@"
}

[[ -f "$model_path" ]] || { echo "Model not found: $model_path" >&2; exit 1; }
[[ -f "$test_apk" ]] || { echo "Test APK not found: $test_apk" >&2; exit 1; }
actual_sha256=$(sha256sum "$model_path" | awk '{print tolower($1)}')
expected_sha256=$(printf '%s' "$expected_sha256" | tr '[:upper:]' '[:lower:]')
[[ "$actual_sha256" == "$expected_sha256" ]] || {
  echo "Model SHA-256 mismatch: expected $expected_sha256, got $actual_sha256" >&2
  exit 1
}
adb_timeout 60 wait-for-device
[[ "$(adb_timeout 10 get-state)" == "device" ]] || {
  echo "ADB device is not ready" >&2
  exit 1
}

package_deadline=$((SECONDS + 6 * 60))
while (( SECONDS < package_deadline )); do
  boot_completed=$(adb_timeout 10 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  package_marker=$(timeout --foreground 20s "${adb[@]}" shell cmd package list packages 2>/dev/null \
    | grep -Fx 'package:android' || true)
  package_system_ready=$(timeout --foreground 20s "${adb[@]}" shell dumpsys package 2>/dev/null \
    | grep -E -m1 'mSystemReady[=:[:space:]]+true|isSystemReady[=:[:space:]]+true' || true)
  settings_value=$(adb_timeout 10 shell settings get global airplane_mode_on 2>/dev/null \
    | tr -d '\r' || true)
  # Package and settings queries can succeed while system_server is still
  # completing PackageManager initialization. Probe its system-ready marker as
  # the final install gate to avoid a transient freeStorage null dereference.
  if [[ "$boot_completed" == "1" && -n "$package_marker" && -n "$package_system_ready" \
    && "$settings_value" =~ ^(0|1)$ ]]; then
    break
  fi
  sleep 2
done
if (( SECONDS >= package_deadline )); then
  echo "Android system providers are not ready" >&2
  adb_timeout 10 shell getprop sys.boot_completed >&2 || true
  timeout --foreground 20s "${adb[@]}" shell dumpsys package >&2 || true
  adb_timeout 10 shell settings get global airplane_mode_on >&2 || true
  exit 1
fi

cleanup() {
  adb_timeout 10 shell run-as "$target_package" rm -f "files/$remote_name" 2>/dev/null || true
  adb_timeout 10 shell rm -f "/data/local/tmp/$remote_name" 2>/dev/null || true
}
trap cleanup EXIT

for install_attempt in 1 2 3; do
  if adb_timeout 180 install -r "$test_apk" >/dev/null; then
    break
  fi
  if (( install_attempt == 3 )); then
    echo "Android instrumentation APK install failed after ${install_attempt} attempts" >&2
    exit 1
  fi
  echo "Android instrumentation APK install attempt ${install_attempt} failed; reconnecting ADB" >&2
  adb_timeout 30 reconnect offline >/dev/null 2>&1 || true
  adb_timeout 30 reconnect device >/dev/null 2>&1 || true
  sleep 10
done
adb_timeout 300 push "$model_path" "/data/local/tmp/$remote_name" >/dev/null
adb_timeout 10 shell run-as "$target_package" cp "/data/local/tmp/$remote_name" "files/$remote_name"
adb_timeout 10 shell run-as "$target_package" chmod 600 "files/$remote_name"

model_size=$(stat -c '%s' "$model_path")
echo "Running Android native inference smoke: sha256=$actual_sha256 bytes=$model_size serial=${serial:-default}"
timeout --foreground 8m "${adb[@]}" shell am instrument -w \
  -e model_path "$remote_path" \
  "$test_package/androidx.test.runner.AndroidJUnitRunner"
