#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(dirname "$script_dir")

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js。请从 https://nodejs.org 安装后重新运行。" >&2
  exit 1
fi

exec node "$plugin_root/scripts/install.mjs" "$@"
