#!/usr/bin/env bash
# slides/report.md を Marp で HTML / PDF にビルドする。
# ローカルでも CI でも同じコマンドで動く。
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="slides/report.md"
OUT="slides/build"

if [ ! -f "$SRC" ]; then
  echo "::warning::${SRC} が無いためスライドビルドをスキップします"
  exit 0
fi

mkdir -p "$OUT"

MARP="npx --yes @marp-team/marp-cli@4"

echo "==> building HTML"
$MARP "$SRC" --html --allow-local-files --theme slides/theme.css -o "$OUT/report.html"

echo "==> building PDF"
if ! $MARP "$SRC" --pdf --allow-local-files --theme slides/theme.css -o "$OUT/report.pdf"; then
  echo "::warning::PDF のビルドに失敗しました（HTML は生成済み）"
fi

echo "==> done"
ls -la "$OUT"
