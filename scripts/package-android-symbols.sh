#!/usr/bin/env bash
set -euo pipefail

symbols_dir=${1:?Directory containing unstripped Android native libraries is required}
output_zip=${2:?Output zip path is required}

[[ -d "$symbols_dir" ]] || { echo "Symbols directory not found: $symbols_dir" >&2; exit 1; }
find "$symbols_dir" -type f -name '*.so' -print -quit | grep -q . || {
  echo "No native symbols found below: $symbols_dir" >&2
  exit 1
}

mkdir -p "$(dirname "$output_zip")"
output_zip="$(cd "$(dirname "$output_zip")" && pwd)/$(basename "$output_zip")"
rm -f "$output_zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$symbols_dir" && zip -q -r "$output_zip" . -i '*.so')
elif command -v jar >/dev/null 2>&1; then
  mapfile -t symbol_files < <(cd "$symbols_dir" && find . -type f -name '*.so' | sort)
  (cd "$symbols_dir" && jar cf "$output_zip" "${symbol_files[@]}")
else
  echo 'zip or jar is required' >&2
  exit 1
fi
unzip -t "$output_zip" >/dev/null
sha256sum "$output_zip"
