#!/usr/bin/env bash
# Positive-readiness launch probe for Juniper's Linux desktop artifacts.
#
#   scripts/linux-launch-probe.sh <label> <evidence-dir> -- <command> [args...]
#
# Requires an X11 display (for example under xvfb-run) plus xwininfo, xprop,
# xwd, and node. A launch PASSES only when all of these are observed:
#   1. Juniper writes "[juniper-startup] frontend ready" to stderr. The frontend
#      sends that over Tauri IPC after the webview loaded, React mounted, and
#      stored state was hydrated from SQLite.
#   2. A viewable top-level window titled "Juniper" owned by the launched
#      process session exists.
#   3. Through a settle period after readiness the process stays alive, the
#      window stays viewable, and no fatal startup, frontend, or panic
#      diagnostic appears.
#   4. A capture of that window is not a blank or single-colour surface.
#   5. The process session exits after SIGTERM.
# The timeout is only a failure guard: running out of time is always a FAIL.
#
# Limits: the probe does not click through the UI, cannot see a main-loop
# freeze that starts after the settle period, and judges rendering from
# colour structure rather than recognizing specific interface elements.
set -euo pipefail

label=${1:?probe label is required}
evidence_dir=${2:?evidence directory is required}
shift 2
[[ ${1:-} == -- ]] && shift
(($# > 0)) || { echo 'A launch command is required after --.' >&2; exit 2; }

timeout_seconds=${JUNIPER_PROBE_TIMEOUT:-120}
settle_seconds=${JUNIPER_PROBE_SETTLE:-10}
title=${JUNIPER_PROBE_WINDOW_TITLE:-Juniper}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

for tool in xwininfo xprop xwd node setsid; do
  command -v "$tool" >/dev/null || { echo "linux-launch-probe requires $tool" >&2; exit 2; }
done
[[ -n ${DISPLAY:-} ]] || { echo 'linux-launch-probe requires an X11 DISPLAY' >&2; exit 2; }

mkdir -p "$evidence_dir"
log="$evidence_dir/$label.log"
result="$evidence_dir/$label-result.txt"
: > "$result"

record() { printf '%s=%s\n' "$1" "$2" >> "$result"; }
record label "$label"
record command "$*"
record display "$DISPLAY"

pid=''
finish() {
  local status=$1 outcome=$2 detail=$3
  if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  record outcome "$outcome"
  record detail "$detail"
  printf '[%s] %s: %s\n' "$label" "$outcome" "$detail"
  if [[ $outcome != PASS ]]; then
    echo "--- last 40 lines of $log ---"
    tail -n 40 "$log" 2>/dev/null || true
  fi
  exit "$status"
}

fatal_diagnostic() {
  grep -E -m1 '\[juniper-startup\] (frontend fatal|stage [^ ]+ failed|fatal:)|panicked at' "$log" 2>/dev/null
}

# Top-level windows with the exact title whose _NET_WM_PID belongs to the
# launched session (AppImage runs Juniper as a child of its runtime).
juniper_window() {
  local id window_pid
  while read -r id; do
    [[ -n $id ]] || continue
    xwininfo -id "$id" 2>/dev/null | grep -q 'Map State: IsViewable' || continue
    window_pid=$(xprop -id "$id" _NET_WM_PID 2>/dev/null | awk '{print $NF}')
    [[ $window_pid =~ ^[0-9]+$ ]] || continue
    [[ $(ps -o sid= -p "$window_pid" 2>/dev/null | tr -d ' ') == "$pid" ]] || continue
    printf '%s\n' "$id"
    return 0
  done < <(xwininfo -root -tree | awk -v quoted="\"$title\":" '$2 == quoted { print $1 }')
  return 1
}

setsid "$@" > "$log" 2>&1 < /dev/null &
pid=$!
record pid "$pid"
start=$SECONDS
deadline=$((SECONDS + timeout_seconds))

window=''
while :; do
  if ! kill -0 "$pid" 2>/dev/null; then
    set +e; wait "$pid"; exit_status=$?; set -e
    finish 1 FAIL "process exited with status $exit_status before frontend readiness"
  fi
  if diagnostic=$(fatal_diagnostic); then
    finish 1 FAIL "fatal diagnostic before readiness: $diagnostic"
  fi
  [[ -n $window ]] || window=$(juniper_window || true)
  if grep -q '\[juniper-startup\] frontend ready' "$log"; then
    break
  fi
  if ((SECONDS >= deadline)); then
    if [[ -n $window ]]; then
      finish 1 FAIL "window $window exists but the frontend never reported ready within ${timeout_seconds}s"
    fi
    finish 1 FAIL "no Juniper window and no frontend readiness within ${timeout_seconds}s"
  fi
  sleep 0.5
done
record ready_after_seconds "$((SECONDS - start))"

while [[ -z $window ]]; do
  window=$(juniper_window || true)
  [[ -n $window ]] && break
  ((SECONDS < deadline)) || finish 1 FAIL 'frontend reported ready but no viewable Juniper window was found'
  sleep 0.5
done
record window "$window"

sleep "$settle_seconds"
kill -0 "$pid" 2>/dev/null || finish 1 FAIL "process exited during the ${settle_seconds}s settle period after readiness"
if diagnostic=$(fatal_diagnostic); then
  finish 1 FAIL "fatal diagnostic after readiness: $diagnostic"
fi
xwininfo -id "$window" 2>/dev/null | grep -q 'Map State: IsViewable' ||
  finish 1 FAIL "window $window disappeared during the settle period"
xwininfo -id "$window" | grep -E 'Width|Height' | tr -d ' ' | tr ':' '=' | tr 'A-Z' 'a-z' >> "$result"

xwd -silent -id "$window" -out "$evidence_dir/$label-window.xwd"
set +e
capture=$(node "$repo_root/scripts/analyze-window-capture.mjs" \
  "$evidence_dir/$label-window.xwd" "$evidence_dir/$label-window.png")
capture_status=$?
set -e
rm -f "$evidence_dir/$label-window.xwd"
record capture "$capture"
((capture_status == 0)) || finish 1 FAIL "window capture is blank or unrendered: $capture"

kill -TERM -- "-$pid" 2>/dev/null || true
for _ in $(seq 1 40); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.25
done
if kill -0 "$pid" 2>/dev/null; then
  finish 1 FAIL 'process did not exit within 10s of SIGTERM after readiness'
fi
# WebKit helper processes and the AppImage runtime can take a moment to exit
# after the main process; they must all be gone within a bounded drain.
drain_start=$SECONDS
for _ in $(seq 1 40); do
  pgrep -s "$pid" >/dev/null 2>&1 || break
  sleep 0.25
done
if pgrep -s "$pid" >/dev/null 2>&1; then
  lingering=$(pgrep -s "$pid" -l | tr '\n' ' ')
  finish 1 FAIL "processes from the launched session remained 10s after SIGTERM: $lingering"
fi
record session_drain_seconds "$((SECONDS - drain_start))"
pid=''
finish 0 PASS "frontend ready, window $window rendered and alive for ${settle_seconds}s, clean SIGTERM exit"
