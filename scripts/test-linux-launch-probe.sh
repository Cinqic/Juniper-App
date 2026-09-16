#!/usr/bin/env bash
# Negative controls for scripts/linux-launch-probe.sh. Each case imitates a
# launch that survives a timeout without being usable; the old Linux smoke
# (exit 0 or timeout 124 == pass) accepted every one of them. The probe must
# reject all of them and accept only a ready, rendered, terminable window.
#
#   xvfb-run -a scripts/test-linux-launch-probe.sh <evidence-dir>
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
evidence_dir=${1:?evidence directory is required}
probe="$repo_root/scripts/linux-launch-probe.sh"
fake="$repo_root/tests/linux-probe/fake-juniper.py"
export JUNIPER_PROBE_TIMEOUT=${JUNIPER_PROBE_TIMEOUT:-15}
export JUNIPER_PROBE_SETTLE=${JUNIPER_PROBE_SETTLE:-4}
failures=0

expect() {
  local expected=$1 case_label=$2 pattern=$3
  shift 3
  local status=0 output
  output=$("$probe" "$case_label" "$evidence_dir" -- "$@" 2>&1) || status=$?
  local outcome=FAIL
  ((status == 0)) && outcome=PASS
  if [[ $outcome == "$expected" ]] && grep -Eq "$pattern" <<<"$output"; then
    printf 'ok   %-22s probe=%s (%s)\n' "$case_label" "$outcome" "$(head -n 1 <<<"$output")"
  else
    printf 'BAD  %-22s expected %s matching /%s/, got %s\n%s\n' \
      "$case_label" "$expected" "$pattern" "$outcome" "$output"
    failures=$((failures + 1))
  fi
}

expect FAIL hang-no-window 'no Juniper window and no frontend readiness' sleep 600
expect FAIL immediate-exit 'exited with status 3 before frontend readiness' sh -c 'exit 3'
expect FAIL window-never-ready 'exists but the frontend never reported ready' python3 "$fake" window-never-ready
expect FAIL blank-ready 'blank or unrendered' python3 "$fake" blank-ready
expect FAIL fatal-after-ready 'fatal diagnostic after readiness' python3 "$fake" fatal-after-ready
expect PASS rendered 'PASS: frontend ready' python3 "$fake" rendered

if ((failures > 0)); then
  echo "Linux launch probe self-test failed: $failures case(s) misclassified." >&2
  exit 1
fi
echo 'Linux launch probe self-test passed: every non-usable launch was rejected.'
