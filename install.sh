#!/usr/bin/env sh
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -f "$here/dist/server/index.js" ]; then
  exec sh "$here/scripts/install.sh" "$@"
fi

repo="${OPENCODE_SUPERAGENT_REPO:-}"
if [ -z "$repo" ]; then
  echo "请在解压后的仓库目录运行本脚本，或设置 OPENCODE_SUPERAGENT_REPO=owner/repository。" >&2
  exit 1
fi

tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT INT TERM

echo "正在下载 $repo ..."
if ! curl -fsSL "https://github.com/$repo/archive/refs/heads/main.tar.gz" -o "$tmp/source.tar.gz"; then
  curl -fsSL "https://github.com/$repo/archive/refs/heads/master.tar.gz" -o "$tmp/source.tar.gz"
fi
tar -xzf "$tmp/source.tar.gz" -C "$tmp"
source=$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)
if [ -z "$source" ]; then
  echo "无法解压仓库压缩包。" >&2
  exit 1
fi

exec sh "$source/scripts/install.sh" "$@"
