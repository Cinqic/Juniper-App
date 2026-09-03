#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
runtime_dir="${JUNIPER_RUNTIME_DIR:-$repo_root/src-tauri/runtime}"
build_root="${JUNIPER_LLAMA_BUILD_DIR:-$(mktemp -d)}"
source_dir="$build_root/llama.cpp"
build_dir="$source_dir/build"
llama_commit="e107984bcffcfd701e82738092a2b000b6fda7a2"

for tool in git cmake; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required build tool: $tool" >&2
    exit 1
  }
done

cleanup() {
  if [[ -z "${JUNIPER_LLAMA_BUILD_DIR:-}" ]]; then
    rm -rf "$build_root"
  fi
}
trap cleanup EXIT

if [[ -e "$source_dir" ]]; then
  git -C "$source_dir" fetch --depth 1 origin "$llama_commit"
else
  git clone --filter=blob:none --no-checkout https://github.com/ggml-org/llama.cpp.git "$source_dir"
fi
git -C "$source_dir" checkout --force "$llama_commit"

cmake -S "$source_dir" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DLLAMA_BUILD_COMMON=ON \
  -DLLAMA_BUILD_EXAMPLES=ON \
  -DLLAMA_BUILD_TOOLS=OFF \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_UI=OFF \
  -DLLAMA_USE_PREBUILT_UI=OFF
cmake --build "$build_dir" --config Release --target llama-server --parallel

server_path=$(find "$build_dir" -type f \( -name llama-server -o -name llama-server.exe \) -perm -u+x -print -quit)
if [[ -z "$server_path" ]]; then
  server_path=$(find "$build_dir" -type f \( -name llama-server -o -name llama-server.exe \) -print -quit)
fi
test -n "$server_path"
mkdir -p "$runtime_dir"
case "$server_path" in
  *.exe) cp "$server_path" "$runtime_dir/llama-server.exe" ;;
  *) cp "$server_path" "$runtime_dir/llama-server"; chmod 0755 "$runtime_dir/llama-server" ;;
esac
printf 'Built llama-server from %s\n' "$llama_commit"
