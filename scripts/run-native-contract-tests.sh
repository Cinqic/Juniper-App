#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
compiler=${CXX:-c++}
build_dir=${TMPDIR:-/tmp}/juniper-native-contract-tests
binary="$build_dir/juniper_llama_contract_test"
mkdir -p "$build_dir"
trap 'rm -f "$binary"' EXIT

"$compiler" -std=c++17 -Wall -Wextra -Werror \
  -I"$root_dir/src-tauri/plugins/juniper-local/android/src/main/cpp" \
  "$root_dir/tests/native/juniper_llama_contract_test.cpp" \
  -o "$binary"
"$binary"
echo "Native contract tests passed."
