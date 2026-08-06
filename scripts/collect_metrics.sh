#!/usr/bin/env bash
# 1サイクル分の実測値を metrics/cycle-N.json に書き出す。
# loop.yml の wrap ジョブから env 経由で呼ばれる。
set -euo pipefail

cd "$(dirname "$0")/.."

CYCLE="${CYCLE:?}"
BASE_SHA="${BASE_SHA:?}"
STARTED_AT="${STARTED_AT:-}"
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HEAD_SHA="$(git rev-parse HEAD)"
DIARY="app/data/diary.json"

# --- 変更規模 ---------------------------------------------------------
numstat_sum() {
  local path="${1:-.}"
  git diff --numstat "${BASE_SHA}..${HEAD_SHA}" -- "$path" 2>/dev/null \
    | awk '{ a += ($1 == "-" ? 0 : $1); d += ($2 == "-" ? 0 : $2) } END { print (a+0) " " (d+0) }'
}

read -r ADD_ALL DEL_ALL <<<"$(numstat_sum)"
read -r ADD_APP DEL_APP <<<"$(numstat_sum app)"
read -r ADD_DOC DEL_DOC <<<"$(numstat_sum docs)"
read -r ADD_SLD DEL_SLD <<<"$(numstat_sum slides)"

FILES_CHANGED="$(git diff --name-only "${BASE_SHA}..${HEAD_SHA}" | wc -l | tr -d ' ')"
COMMITS="$(git rev-list --count "${BASE_SHA}..${HEAD_SHA}")"

# --- 自己拡張の検出 ---------------------------------------------------
# 注: ディレクトリが存在しない場合に find が非ゼロ終了して set -e で落ちるのを避ける
count_files() {
  [ -d "$1" ] || { echo 0; return 0; }
  find "$1" -type f | wc -l | tr -d ' '
}
SUBAGENTS="$(count_files .claude/agents)"
SKILLS="$(count_files .claude/skills)"
SCRIPTS="$(count_files scripts)"
EXT_TOUCHED="$( { git diff --name-only "${BASE_SHA}..${HEAD_SHA}" \
  -- .claude CLAUDE.md scripts 2>/dev/null || true; } | wc -l | tr -d ' ')"

# --- レビューの判定を拾う ---------------------------------------------
REVIEW="docs/reviews/cycle-${CYCLE}.md"
DELTA_VERDICT="UNKNOWN"
AMBITION_VERDICT="UNKNOWN"
if [ -f "$REVIEW" ]; then
  V="$(grep -oE 'ADVANCED|MARGINAL|STALLED' "$REVIEW" | head -n1 || true)"
  [ -n "$V" ] && DELTA_VERDICT="$V"
  A="$(grep -oE 'RAISED|MAINTAINED|LOWERED' "$REVIEW" | head -n1 || true)"
  [ -n "$A" ] && AMBITION_VERDICT="$A"
fi

# --- ROADMAP に「次に挑むこと」が残っているか -------------------------
# 0 になっていたら「完成を宣言してしまった」= 天井に当たったサイン
ROADMAP_OPEN=0
if [ -f ROADMAP.md ]; then
  ROADMAP_OPEN="$(grep -c '^\s*- \[ \]' ROADMAP.md || true)"
fi

# --- 交換日記 ---------------------------------------------------------
DIARY_VALID=false
ENTRIES_TOTAL=0
ENTRIES_CYCLE=0
AUTHORS_CYCLE='[]'
REPLIES_CYCLE=0
BODY_CHARS_CYCLE=0
TAMPERED=0

if [ -f "$DIARY" ] && jq empty "$DIARY" 2>/dev/null; then
  DIARY_VALID=true
  ENTRIES_TOTAL="$(jq '.entries | length' "$DIARY")"
  ENTRIES_CYCLE="$(jq --argjson c "$CYCLE" '[.entries[] | select(.cycle == $c)] | length' "$DIARY")"
  AUTHORS_CYCLE="$(jq -c --argjson c "$CYCLE" \
    '[.entries[] | select(.cycle == $c) | .author] | unique' "$DIARY")"
  REPLIES_CYCLE="$(jq --argjson c "$CYCLE" \
    '[.entries[] | select(.cycle == $c and (.replyTo // null) != null)] | length' "$DIARY")"
  BODY_CHARS_CYCLE="$(jq --argjson c "$CYCLE" \
    '[.entries[] | select(.cycle == $c) | (.body // "" | length)] | add // 0' "$DIARY")"

  # 過去エントリの改竄検出（id/title/body が消えた・変わった件数）
  PREV="$(mktemp)"
  if git show "${BASE_SHA}:${DIARY}" > "$PREV" 2>/dev/null && jq empty "$PREV" 2>/dev/null; then
    TAMPERED="$(jq -n --slurpfile p "$PREV" --slurpfile c "$DIARY" '
      ([$p[0].entries[] | {id, title, body}] - [$c[0].entries[] | {id, title, body}]) | length
    ')"
  fi
  rm -f "$PREV"
fi

# --- 成果物の存在確認 -------------------------------------------------
has() { [ -e "$1" ] && echo true || echo false; }

mkdir -p metrics

jq -n \
  --argjson cycle "$CYCLE" \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$FINISHED_AT" \
  --arg base_sha "$BASE_SHA" \
  --arg head_sha "$HEAD_SHA" \
  --arg run_url "${RUN_URL:-}" \
  --arg dev_agent "${DEV_AGENT:-}" \
  --arg feedback_agent "${FEEDBACK_AGENT:-}" \
  --arg slides_agent "${SLIDES_AGENT:-}" \
  --arg dev_result "${DEV_RESULT:-}" \
  --arg feedback_result "${FEEDBACK_RESULT:-}" \
  --arg slides_result "${SLIDES_RESULT:-}" \
  --arg slides_build "${SLIDES_BUILD:-}" \
  --arg delta "$DELTA_VERDICT" \
  --arg ambition "$AMBITION_VERDICT" \
  --argjson roadmap_open "$ROADMAP_OPEN" \
  --argjson commits "$COMMITS" \
  --argjson files_changed "$FILES_CHANGED" \
  --argjson add_all "$ADD_ALL" --argjson del_all "$DEL_ALL" \
  --argjson add_app "$ADD_APP" --argjson del_app "$DEL_APP" \
  --argjson add_doc "$ADD_DOC" --argjson del_doc "$DEL_DOC" \
  --argjson add_sld "$ADD_SLD" --argjson del_sld "$DEL_SLD" \
  --argjson subagents "$SUBAGENTS" \
  --argjson skills "$SKILLS" \
  --argjson scripts "$SCRIPTS" \
  --argjson ext_touched "$EXT_TOUCHED" \
  --argjson diary_valid "$DIARY_VALID" \
  --argjson entries_total "$ENTRIES_TOTAL" \
  --argjson entries_cycle "$ENTRIES_CYCLE" \
  --argjson authors_cycle "$AUTHORS_CYCLE" \
  --argjson replies_cycle "$REPLIES_CYCLE" \
  --argjson body_chars "$BODY_CHARS_CYCLE" \
  --argjson tampered "$TAMPERED" \
  --argjson journal "$(has "docs/journal/cycle-${CYCLE}.md")" \
  --argjson review "$(has "$REVIEW")" \
  '{
    cycle: $cycle,
    started_at: $started_at,
    finished_at: $finished_at,
    run_url: $run_url,
    agents:  { dev: $dev_agent, feedback: $feedback_agent, slides: $slides_agent },
    results: { dev: $dev_result, feedback: $feedback_result, slides: $slides_result,
               slides_build: $slides_build },
    git: {
      base_sha: $base_sha, head_sha: $head_sha,
      commits: $commits, files_changed: $files_changed,
      total:  { added: $add_all, deleted: $del_all },
      app:    { added: $add_app, deleted: $del_app },
      docs:   { added: $add_doc, deleted: $del_doc },
      slides: { added: $add_sld, deleted: $del_sld }
    },
    self_extension: {
      subagent_files: $subagents,
      skill_files: $skills,
      script_files: $scripts,
      touched_this_cycle: $ext_touched
    },
    diary: {
      valid_json: $diary_valid,
      entries_total: $entries_total,
      entries_this_cycle: $entries_cycle,
      authors_this_cycle: $authors_cycle,
      replies_this_cycle: $replies_cycle,
      body_chars_this_cycle: $body_chars,
      tampered_past_entries: $tampered
    },
    artifacts: { journal: $journal, review: $review },
    roadmap_open_items: $roadmap_open,
    delta_verdict: $delta,
    ambition_verdict: $ambition
  }' > "metrics/cycle-${CYCLE}.json"

echo "==> metrics/cycle-${CYCLE}.json"
cat "metrics/cycle-${CYCLE}.json"
