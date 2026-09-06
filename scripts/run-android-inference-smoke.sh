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

[[ -f "$model_path" ]] || { echo "Model not found: $model_path" >&2; exit 1; }
[[ -f "$test_apk" ]] || { echo "Test APK not found: $test_apk" >&2; exit 1; }
actual_sha256=$(sha256sum "$model_path" | awk '{print tolower($1)}')
expected_sha256=$(printf '%s' "$expected_sha256" | tr '[:upper:]' '[:lower:]')
[[ "$actual_sha256" == "$expected_sha256" ]] || {
  echo "Model SHA-256 mismatch: expected $expected_sha256, got $actual_sha256" >&2
  exit 1
}
timeout --foreground 60s "${adb[@]}" wait-for-device
[[ "$("${adb[@]}" get-state)" == "device" ]] || {
  echo "ADB device is not ready" >&2
  exit 1
}

cleanup() {
  "${adb[@]}" shell run-as "$target_package" rm -f "files/$remote_name" 2>/dev/null || true
  "${adb[@]}" shell rm -f "/data/local/tmp/$remote_name" 2>/dev/null || true
}
trap cleanup EXIT

"${adb[@]}" install -r "$test_apk" >/dev/null
"${adb[@]}" push "$model_path" "/data/local/tmp/$remote_name" >/dev/null
"${adb[@]}" shell run-as "$target_package" cp "/data/local/tmp/$remote_name" "files/$remote_name"
"${adb[@]}" shell run-as "$target_package" chmod 600 "files/$remote_name"

model_size=$(stat -c '%s' "$model_path")
echo "Running Android native inference smoke: sha256=$actual_sha256 bytes=$model_size serial=${serial:-default}"
timeout --foreground 8m "${adb[@]}" shell am instrument -w \
  -e model_path "$remote_path" \
  "$test_package/androidx.test.runner.AndroidJUnitRunner"
