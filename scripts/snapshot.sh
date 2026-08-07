#!/usr/bin/env bash
# サイクルごとのアプリのスナップショットを組み立てる。
#
#   bash scripts/snapshot.sh <出力先ディレクトリ>
#
# cycle-N タグ（wrap が完走時に打つ）を古い順にたどり、各サイクル時点の
# app/ を <出力先>/cycle-N/ に取り出したうえで、一覧ページ index.html を
# 生成する。タグが1つも無ければ、一覧だけを作って正常終了する。
#
# 履歴からの取り出しなので、リポジトリ本体は一切汚さない。
set -euo pipefail

OUT="${1:?出力先ディレクトリを指定してください（例: bash scripts/snapshot.sh snapshots）}"

# タグは cycle-2 が cycle-10 より前に来るよう数値順に並べる。
# mapfile は bash 4+ 専用で macOS 標準の bash 3.2 では動かないため read で回す。
TAGS=()
while IFS= read -r n; do
  [ -n "$n" ] && TAGS+=("$n")
done < <(git tag --list 'cycle-*' | sed -E 's/^cycle-//' | sort -n)

mkdir -p "$OUT"

# bash 3.2 では set -u 下で空配列を展開するとエラーになるため件数で分岐する
if [ "${#TAGS[@]}" -gt 0 ]; then
  for N in "${TAGS[@]}"; do
    DEST="${OUT}/cycle-${N}"
    rm -rf "$DEST"
    mkdir -p "$DEST"
    # タグ時点の app/ だけをワークツリーに触れず取り出す
    git archive "cycle-${N}" app | tar -x -C "$DEST" --strip-components=1
    echo "  ✓ cycle-${N} → ${DEST}"
  done
fi

# --- 一覧ページ -------------------------------------------------------
{
  cat <<'HEAD'
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>かわりばんこ — サイクル別スナップショット</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
    max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem;
    line-height: 1.75;
  }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  p.lead { opacity: .75; margin-top: 0; }
  ul { list-style: none; padding: 0; }
  li { margin: .5rem 0; }
  a.cycle {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 1rem; padding: .85rem 1.1rem; border: 1px solid;
    border-color: color-mix(in srgb, currentColor 20%, transparent);
    border-radius: .6rem; text-decoration: none; color: inherit;
  }
  a.cycle:hover {
    border-color: color-mix(in srgb, currentColor 45%, transparent);
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  a.cycle strong { font-size: 1.05rem; }
  a.cycle span { opacity: .6; font-size: .85rem; font-variant-numeric: tabular-nums; }
  .empty { opacity: .6; font-style: italic; }
  footer { margin-top: 2.5rem; font-size: .85rem; opacity: .6; }
</style>
<h1>かわりばんこ — サイクル別スナップショット</h1>
<p class="lead">各サイクル終了時点のアプリをそのまま保存したものです。日を追って何が増えたかを比較できます。</p>
<ul>
HEAD

  if [ "${#TAGS[@]}" -eq 0 ]; then
    echo '<li class="empty">まだ完走したサイクルがありません。</li>'
  else
    # 新しいサイクルを上に
    for (( i=${#TAGS[@]}-1; i>=0; i-- )); do
      N="${TAGS[$i]}"
      DATE="$(git log -1 --format=%cs "cycle-${N}" 2>/dev/null || echo '')"
      printf '<li><a class="cycle" href="cycle-%s/index.html"><strong>サイクル %s</strong><span>%s</span></a></li>\n' \
        "$N" "$N" "$DATE"
    done
  fi

  cat <<'FOOT'
</ul>
<footer>各サイクルの詳細は docs/journal/ と docs/reviews/ に、実測値は metrics/ にあります。</footer>
FOOT
} > "${OUT}/index.html"

echo "  ✓ 一覧 → ${OUT}/index.html（${#TAGS[@]} サイクル）"
