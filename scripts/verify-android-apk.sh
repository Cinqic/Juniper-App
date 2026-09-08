#!/usr/bin/env bash
set -euo pipefail

apk_path=${1:?APK path is required}
evidence_dir=${2:-release-artifacts/android-apk-audit}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
manifest="$repo_root/config/llama-cpp.json"

[[ -f "$apk_path" ]] || { echo "APK not found: $apk_path" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo 'unzip is required' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum is required' >&2; exit 1; }

readelf_bin=${READELF:-}
if [[ -z "$readelf_bin" ]]; then
  readelf_bin=$(command -v llvm-readelf 2>/dev/null || command -v readelf 2>/dev/null || true)
fi
[[ -n "$readelf_bin" ]] || { echo 'llvm-readelf or readelf is required' >&2; exit 1; }

sdk_root=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
zipalign_bin=${ZIPALIGN:-}
if [[ -z "$zipalign_bin" && -n "$sdk_root" ]]; then
  zipalign_bin="$sdk_root/build-tools/35.0.0/zipalign"
fi
if [[ -z "$zipalign_bin" ]]; then
  zipalign_bin=$(command -v zipalign 2>/dev/null || true)
fi
[[ -n "$zipalign_bin" && -x "$zipalign_bin" ]] || {
  echo 'Pinned Android build-tools zipalign is required' >&2
  exit 1
}

rm -rf "$evidence_dir"
mkdir -p "$evidence_dir"
tmp_dir=$(mktemp -d)
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

unzip -t "$apk_path" > "$evidence_dir/zip-test.txt"
"$zipalign_bin" -c -P 16 -v 4 "$apk_path" > "$evidence_dir/zipalign.txt"
# Match the shared objects directly below each ABI directory. Some unzip
# implementations do not treat an absent explicit `lib/` directory entry as
# a match for the shorter `lib/*` pattern.
unzip -q "$apk_path" 'lib/*/*' -d "$tmp_dir"

expected_abis=(arm64-v8a x86_64)
if [[ -n "${JUNIPER_EXPECTED_ANDROID_ABIS:-}" ]]; then
  IFS=',' read -r -a expected_abis <<< "$JUNIPER_EXPECTED_ANDROID_ABIS"
fi
mapfile -t actual_abis < <(find "$tmp_dir/lib" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort)
printf '%s\n' "${actual_abis[@]}" > "$evidence_dir/abis.txt"
if [[ "${actual_abis[*]}" != "${expected_abis[*]}" ]]; then
  echo "Unexpected APK ABIs: ${actual_abis[*]} (expected ${expected_abis[*]})" >&2
  exit 1
fi

mapfile -t native_entries < <(unzip -Z1 "$apk_path" | awk '/^lib\/(arm64-v8a|x86_64)\/.*\.so$/ { print }' | sort)
printf '%s\n' "${native_entries[@]}" > "$evidence_dir/native-libraries.txt"
[[ "${#native_entries[@]}" -gt 0 ]] || { echo 'APK contains no native libraries' >&2; exit 1; }

for forbidden in llama-server libllama-server; do
  if printf '%s\n' "${native_entries[@]}" | grep -Fqi "$forbidden"; then
    echo "Forbidden server runtime found in APK: $forbidden" >&2
    exit 1
  fi
done

for abi in "${expected_abis[@]}"; do
  jni="$tmp_dir/lib/$abi/libjuniper_llama_jni.so"
  [[ -f "$jni" ]] || { echo "Missing JNI bridge for $abi" >&2; exit 1; }
  while IFS= read -r so_path; do
    [[ -f "$so_path" ]] || continue
    if ! "$readelf_bin" -lW "$so_path" | awk '/^[[:space:]]*LOAD[[:space:]]/ { if ($NF != "0x4000") bad=1 } END { exit bad }'; then
      echo "16 KiB LOAD alignment check failed: $so_path" >&2
      exit 1
    fi
  done < <(find "$tmp_dir/lib/$abi" -type f -name '*.so' | sort)
done

sha256sum "$apk_path" | tee "$evidence_dir/SHA256SUMS"
{
  echo "APK=$apk_path"
  echo "READELF=$readelf_bin"
  echo "ZIPALIGN=$zipalign_bin"
  echo "EXPECTED_ABIS=${expected_abis[*]}"
  echo "NATIVE_LIBRARY_COUNT=${#native_entries[@]}"
  echo "LLAMA_CPP_COMMIT=$(node -e "const fs=require('fs'); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).commit)" "$manifest")"
  echo 'SERVER_RUNTIME_LIBRARIES=0'
  echo 'LOAD_ALIGNMENT=0x4000'
  echo 'ZIP_ALIGNMENT=16'
} | tee "$evidence_dir/summary.txt"
