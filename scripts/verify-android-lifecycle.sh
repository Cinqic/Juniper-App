#!/usr/bin/env bash
set -euo pipefail

apk_path=${1:?APK path is required}
package_name=${2:-com.cinqic.juniper}
component="$package_name/.MainActivity"
evidence_dir=${3:-release-artifacts/android-lifecycle}
uninstalled=0
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

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
  adb_timeout 10 shell dumpsys activity activities > "$evidence_dir/${label}-activity.txt" 2>&1 || true
  adb_timeout 10 shell dumpsys window windows > "$evidence_dir/${label}-windows.txt" 2>&1 || true
  adb_timeout 10 logcat -d -t 500 > "$evidence_dir/${label}-logcat.txt" 2>&1 || true
  adb_timeout 10 exec-out screencap -p > "$evidence_dir/${label}.png" 2>/dev/null || true
}

foreground_activity_ready() {
  local activities windows
  activities=$(adb_timeout 5 shell dumpsys activity activities 2>/dev/null) || return 1
  grep -E 'mResumedActivity|ResumedActivity' <<<"$activities" | grep -F "$component" >/dev/null || return 1

  windows=$(adb_timeout 5 shell dumpsys window windows 2>/dev/null) || return 1
  if grep -E 'mCurrentFocus|mFocusedApp' <<<"$windows" | grep -F "$package_name" >/dev/null; then
    return 0
  fi

  # API 30's window service omits the focus summary even though the activity
  # service reports the same focused app alongside the resumed activity.
  grep -E 'mCurrentFocus|mFocusedApp' <<<"$activities" | grep -F "$package_name" >/dev/null
}

wait_for_device() {
  local attempt
  for attempt in $(seq 1 30); do
    if adb_timeout 5 get-state 2>/dev/null | grep -Fxq device; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_foreground_activity() {
  local label=$1
  local attempt
  # A clean universal APK can spend several seconds initializing WebView and
  # drawing its first frame on a software-GPU emulator. Keep this bounded,
  # but allow that cold-start work to finish before declaring a lifecycle
  # failure.
  for attempt in $(seq 1 45); do
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
    adb_timeout 10 uninstall "$package_name" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

# Start from a clean package state if an emulator snapshot left an older build.
wait_for_device || fail_smoke "Emulator did not become ready for ADB commands."
adb_timeout 10 uninstall "$package_name" >/dev/null 2>&1 || true
if [[ ! -f "$apk_path" ]]; then
  fail_smoke "APK was not found at $apk_path."
fi
printf 'Installing APK: %s\n' "$apk_path"
adb_timeout 120 install "$apk_path"

# The launcher must resolve Juniper, draw the official Juniper icon, and open
# the app from that entry. Resource-level branding is proven separately by
# scripts/verify-android-branding.mjs; this records what the launcher rendered.
launcher_entry=$(adb_timeout 20 shell cmd package resolve-activity --brief \
  -a android.intent.action.MAIN -c android.intent.category.LAUNCHER "$package_name" | tr -d '\r' | tail -n 1)
printf '%s\n' "$launcher_entry" > "$evidence_dir/launcher-resolve-activity.txt"
[[ $launcher_entry == "$component" ]] || fail_smoke "Launcher resolves $launcher_entry, expected $component."

open_app_drawer_and_find_juniper() {
  local attempt bounds
  for attempt in 1 2 3 4 5; do
    adb_timeout 10 shell input keyevent KEYCODE_WAKEUP
    adb_timeout 10 shell input keyevent KEYCODE_HOME
    sleep 2
    adb_timeout 10 shell input swipe 540 1700 540 300 400
    sleep 3
    adb_timeout 30 shell uiautomator dump /sdcard/juniper-launcher.xml >/dev/null 2>&1 || continue
    adb_timeout 10 shell cat /sdcard/juniper-launcher.xml > "$evidence_dir/launcher-ui.xml" 2>/dev/null || continue
    bounds=$(grep -o '<node[^>]*text="Juniper"[^>]*package="com.android.launcher3"[^>]*' "$evidence_dir/launcher-ui.xml" |
      grep -o 'bounds="[^"]*"' | head -n 1 | sed 's/^bounds="//; s/"$//')
    if [[ -n $bounds ]]; then
      printf '%s\n' "$bounds"
      return 0
    fi
  done
  return 1
}

launcher_bounds=$(open_app_drawer_and_find_juniper) || fail_smoke 'Juniper was not found in the launcher app drawer.'
adb_timeout 10 exec-out screencap -p > "$evidence_dir/launcher-drawer.png"
node "$repo_root/scripts/verify-android-launcher-capture.mjs" \
  "$evidence_dir/launcher-drawer.png" "$launcher_bounds" "$evidence_dir/launcher-icon.png" |
  tee "$evidence_dir/launcher-icon.json" ||
  fail_smoke 'The launcher did not draw the official Juniper icon.'
read -r left top right bottom < <(tr '[],' '   ' <<<"$launcher_bounds")
adb_timeout 10 logcat -c
adb_timeout 10 shell input tap "$(((left + right) / 2))" "$((top + (right - left) / 2))"
wait_for_foreground_activity launcher-start || fail_smoke 'Tapping the Juniper launcher entry did not open MainActivity.'

# Focus alone does not prove a usable app: require the frontend's own
# readiness report (Rust stderr is forwarded to logcat) and rendered content.
frontend_ready=0
for attempt in $(seq 1 60); do
  adb_timeout 10 logcat -d -s RustStdoutStderr:I > "$evidence_dir/launcher-start-juniper-startup.txt" 2>&1 || true
  if grep -Eq '\[juniper-startup\] (frontend fatal|stage [^ ]+ failed|fatal:)' "$evidence_dir/launcher-start-juniper-startup.txt"; then
    fail_smoke "Juniper reported a startup failure: $(grep -m1 -E 'juniper-startup' "$evidence_dir/launcher-start-juniper-startup.txt")"
  fi
  if grep -Fq '[juniper-startup] frontend ready' "$evidence_dir/launcher-start-juniper-startup.txt"; then
    frontend_ready=1
    break
  fi
  sleep 2
done
((frontend_ready == 1)) || fail_smoke 'Juniper never reported frontend readiness after launch from the launcher.'
rendered=0
for attempt in $(seq 1 30); do
  adb_timeout 10 exec-out screencap -p > "$evidence_dir/launcher-start-rendered-capture.png"
  if node "$repo_root/scripts/analyze-window-capture.mjs" \
    "$evidence_dir/launcher-start-rendered-capture.png" "$evidence_dir/launcher-start-rendered.png" \
    --rows 0.06,0.88 > "$evidence_dir/launcher-start-rendered.json"; then
    rendered=1
    break
  fi
  sleep 2
done
cat "$evidence_dir/launcher-start-rendered.json"
((rendered == 1)) || fail_smoke 'Juniper reported ready but its content area stayed blank.'
adb_timeout 10 shell am force-stop "$package_name"

adb_timeout 30 shell am start -W -n "$component" | tee "$evidence_dir/initial-start.txt"
wait_for_foreground_activity initial || fail_smoke "MainActivity was not resumed and focused after install."

# Force a configuration change and require the same activity to remain usable.
adb_timeout 10 shell settings put system accelerometer_rotation 0
adb_timeout 10 shell settings put system user_rotation 1
wait_for_foreground_activity rotated || fail_smoke "MainActivity did not survive the rotation/configuration change."
adb_timeout 10 shell settings put system user_rotation 0

adb_timeout 10 shell am force-stop "$package_name"
adb_timeout 30 shell am start -W -n "$component" | tee "$evidence_dir/relaunch-start.txt"
wait_for_foreground_activity relaunched || fail_smoke "MainActivity was not resumed and focused after force-stop/relaunch."

adb_timeout 10 uninstall "$package_name" | tee "$evidence_dir/uninstall.txt"
uninstalled=1
if adb_timeout 10 shell pm path "$package_name" 2>/dev/null | grep -q .; then
  fail_smoke "Package remained installed after uninstall."
fi
