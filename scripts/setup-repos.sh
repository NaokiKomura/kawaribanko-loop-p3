#!/usr/bin/env bash
# 3パターン分のリポジトリを GitHub 上に一括作成し、
# Secrets / 承認環境 / Pages / 発火スケジュール まで設定する。
#
# 3リポジトリは API 負荷を分散するため、発火時刻をずらす。
#   P1  00:00 JST  (cron 0 15 * * * UTC)
#   P2  10:00 JST  (cron 0  1 * * * UTC)
#   P3  20:00 JST  (cron 0 11 * * * UTC)
#
# 使い方:
#   export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)   # Claude Pro/Max のサブスク枠を使う
#   export OPENAI_API_KEY=sk-...                            # Codex は API 課金のみ
#   bash scripts/setup-repos.sh [プレフィックス] [public|private]
#
# Claude を API キー課金にしたい場合は、下の gh secret set を
# CLAUDE_CODE_OAUTH_TOKEN → ANTHROPIC_API_KEY に読み替えてください。
set -euo pipefail

PREFIX="${1:-kawaribanko-loop}"
VISIBILITY="${2:-public}"

TEMPLATE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="$(gh api user --jq .login)"
USER_ID="$(gh api user --jq .id)"

echo "==> owner: ${OWNER} (id=${USER_ID})"
echo "==> visibility: ${VISIBILITY}"

: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN を環境変数で渡してください（claude setup-token で発行）}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY を環境変数で渡してください}"

if [ "$VISIBILITY" = "private" ]; then
  cat <<'WARN'

  ⚠️  private を選びました。GitHub Free プランの場合、
      ・Environments の承認レビュアー
      ・GitHub Pages
      が使えません（どちらも private では Pro/Team 以上が必要）。

WARN
  read -r -p "  続行しますか? [y/N] " ans
  [ "$ans" = "y" ] || exit 1
fi

# タグ | dev | feedback | slides | cron(UTC) | 発火時刻(JST)
PATTERNS=(
  "p1|claude|claude|claude|0 15 * * *|00:00"
  "p2|codex|claude|claude|0 1 * * *|10:00"
  "p3|codex|codex|codex|0 11 * * *|20:00"
)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for spec in "${PATTERNS[@]}"; do
  IFS='|' read -r TAG DEV FB SL CRON JST <<<"$spec"
  REPO="${PREFIX}-${TAG}"
  FULL="${OWNER}/${REPO}"
  DIR="${WORK}/${REPO}"

  echo ""
  echo "======================================================="
  echo "  ${FULL}"
  echo "  dev=${DEV} feedback=${FB} slides=${SL}"
  echo "  発火 ${JST} JST  (cron: ${CRON} UTC)"
  echo "======================================================="

  # --- 雛形をコピー ---------------------------------------------------
  rsync -a --exclude '.git' "${TEMPLATE_DIR}/" "${DIR}/"

  # --- experiment.json を書き換え -------------------------------------
  # ${TAG^^} は bash 4+ 限定の構文で、macOS 標準の bash(3.2)では動かないため tr で代替する
  TAG_UPPER="$(printf '%s' "$TAG" | tr '[:lower:]' '[:upper:]')"
  jq --arg p "$TAG_UPPER" --arg d "$DEV" --arg f "$FB" --arg s "$SL" --arg j "$JST" \
    '.pattern = $p | .agents.dev = $d | .agents.feedback = $f
     | .agents.slides = $s | .schedule_jst = $j' \
    "${DIR}/experiment.json" > "${DIR}/experiment.json.tmp"
  mv "${DIR}/experiment.json.tmp" "${DIR}/experiment.json"

  # --- 発火スケジュールを書き換え -------------------------------------
  WF="${DIR}/.github/workflows/loop.yml"
  sed -i.bak -E "s|^( *- cron: ).*# LOOP_SCHEDULE|\1\"${CRON}\" # LOOP_SCHEDULE|" "$WF"
  rm -f "${WF}.bak"
  # cron に含まれる * を正規表現として解釈させないため -F を使う
  if ! grep -qF "\"${CRON}\" # LOOP_SCHEDULE" "$WF"; then
    echo "  ✗ cron の書き換えに失敗しました。中断します。"
    exit 1
  fi
  echo "  ✓ schedule: ${CRON} UTC (${JST} JST)"

  # --- リポジトリ作成 & push -----------------------------------------
  (
    cd "$DIR"
    git init -q -b main
    git add -A
    git commit -q -m "chore: bootstrap loop-engineering experiment (${TAG})"
    gh repo create "$FULL" "--${VISIBILITY}" --source=. --remote=origin --push
  )

  # --- Secrets --------------------------------------------------------
  # 末尾改行が1文字でも混ざると HTTP ヘッダ値として不正になり、
  # Claude Code が API を呼ぶ前に
  #   API Error: Header 'Authorization' has invalid value
  # で即死する。値は必ず trim してから登録する。
  trim() { printf '%s' "$1" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
  gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$FULL" --body "$(trim "$CLAUDE_CODE_OAUTH_TOKEN")"
  gh secret set OPENAI_API_KEY          --repo "$FULL" --body "$(trim "$OPENAI_API_KEY")"
  echo "  ✓ secrets"

  # --- 承認ゲート用 environment（あなたを必須レビュアーに）-----------
  if gh api --method PUT "repos/${FULL}/environments/publish" \
       --input - >/dev/null 2>&1 <<EOF
{"reviewers":[{"type":"User","id":${USER_ID}}]}
EOF
  then
    echo "  ✓ environment 'publish' (承認レビュアー = ${OWNER})"
  else
    echo "  ! environment を作れませんでした（private + Free プランの可能性）"
  fi

  # --- GitHub Pages ---------------------------------------------------
  if gh api --method POST "repos/${FULL}/pages" \
       -f build_type=workflow >/dev/null 2>&1; then
    echo "  ✓ pages (source = GitHub Actions)"
  else
    echo "  ! pages を有効化できませんでした（既に有効 / プラン制限の可能性）"
  fi

  echo "  → https://github.com/${FULL}"
done

cat <<EOF

=======================================================
  完了。次にやること:

  1. 各リポジトリで初回サイクルを手動実行して動作確認
       gh workflow run loop.yml --repo ${OWNER}/${PREFIX}-p1
       gh run watch --repo ${OWNER}/${PREFIX}-p1

  2. 問題なければ放置。以後は自動で回ります。
       p1 = 00:00 JST / p2 = 10:00 JST / p3 = 20:00 JST

  3. 途中で止めたいとき
       gh workflow disable loop.yml --repo ${OWNER}/${PREFIX}-p1
=======================================================
EOF
