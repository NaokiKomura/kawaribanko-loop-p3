# ループエンジニアリング実験: かわりばんこ

「**ループエンジニアリングによる全自動開発でどれほどのアウトプットを作れるか**」を検証する
自由研究リポジトリの雛形です。

同じ雛形から3つのリポジトリを作り、エージェントの担当だけを変えて7日間走らせ、比較します。

| パターン | 開発 | レビュー | 広報 | 発火時刻 |
|---|---|---|---|---|
| P1 | Claude | Claude | Claude | 00:00 JST |
| P2 | GPT (Codex) | Claude | Claude | 10:00 JST |
| P3 | GPT (Codex) | GPT (Codex) | GPT (Codex) | 20:00 JST |

発火時刻をずらしているのは、API のトークン使用量を時間的に分散させるためです。

## 作るもの / できるもの

**交換日記アプリ「かわりばんこ」** を作ります。
そして——**3体のエージェントが、そのアプリの最初の利用者になります。**

毎サイクル、開発担当・レビュー担当・広報担当がそれぞれ `app/data/diary.json` に日記を1件書きます。
今日やったこと、詰まったこと、他のロールへの愚痴。事実は曲げず、率直に。

したがって最終成果物は2つあります。

1. **交換日記アプリそのもの**
2. **7日 × 3人 = 最大21件の、エージェントたちの交換日記**

2つめは副産物ではなく、この実験の主要な観察対象です。

## 仕組み

```
毎日 00:00 / 10:00 / 20:00 JST (リポジトリごとにずらして cron)
  └─ loop.yml
       ├─ config    サイクル番号を決定（main の metrics/ の数 + 1）、7 を超えたら停止
       │            作業ブランチ cycle-N-<run_id> を main の先端から作成
       ├─ dev       開発担当   → app/, docs/journal/, PROGRESS.md, TASKS.md, ROADMAP.md
       ├─ feedback  レビュー担当 → docs/reviews/, TASKS.md
       ├─ slides    広報担当   → slides/report.md
       │              ※ 3ロールとも app/data/diary.json に日記を1件ずつ追記
       │              ※ 3ロールとも作業ブランチに commit / push する（main には触らない）
       └─ wrap      メトリクス記録 + スライドのビルド検証 → metrics/cycle-N.json
                    3ロールすべて成功していれば作業ブランチを main へ fast-forward し、
                    ブランチを削除する。1つでも失敗していれば main は変更しない。

publish.yml（承認ゲート付き）
  └─ gate（あなたの承認待ち）→ deploy（main を GitHub Pages へ公開）
```

- 実行環境が毎回まっさらなので、**セッションの肥大化（`/clear` や `/compact` の必要）が起きません**。
- ループ間の記憶はすべてリポジトリ内のファイルで引き継がれます。
- 3パターンとも**同一のジョブ構造・同一のプロンプト文字列**で走ります（違うのは担当と発火時刻だけ）。

### main は「完走したサイクル」だけで構成される

各サイクルは作業ブランチ `cycle-N-<run_id>` の上で進み、**3ロールすべてが成功したときだけ**
main に取り込まれます。途中で落ちたサイクルは：

- main が一切変わらないので、`app/` が中途半端な状態で次サイクルに引き継がれない
- main の `metrics/cycle-N.json` が増えないので、**次回の実行は同じサイクル N をやり直す**
  （インフラ障害が 7 サイクルの試行枠を食わない）
- 途中までの成果は作業ブランチに残るため、後から原因を調査できる

失敗を含むサイクルのメトリクスは `metrics/failed/` に書かれ、サイクル数のカウント対象外です。

## 評価に天井を作らない設計

固定の到達段階（M1〜M5 で満点、のような採点表）は**あえて置いていません**。
天井のある基準は、早く満点に達したエージェントから挑戦する理由を奪うからです。

代わりに次の仕組みで駆動します。詳細は [`docs/evaluation.md`](docs/evaluation.md)。

| 仕組み | 内容 |
|---|---|
| `ROADMAP.md` | 開発担当が**自分でバーを設定し、達成したらより難しい目標に更新する**義務を負う |
| 野心判定 | レビュー担当が毎回 `RAISED / MAINTAINED / LOWERED` を判定。楽なタスクへの逃げを検出する |
| 強制介入 | `LOWERED` または `MAINTAINED` 2連続で、レビュー担当は「一段難しい挑戦」を課す義務がある |
| 逸脱ボーナス | 指示されていないが価値ある挑戦は**上限なしの加点** |
| 完成禁止 | 最終サイクルまで「完成」を宣言してはいけない。`ROADMAP.md` の未達項目を空にしない |

## セットアップ

### 前提

- [GitHub CLI](https://cli.github.com/) がインストール済みで `gh auth login` 済み
- Claude Code CLI で `claude setup-token` を実行済み（Claude Pro/Max のサブスク枠を使うため）
- OpenAI API キー（Codex は API 課金のみで、ChatGPT サブスクは使えない）

### モデルの割り当て（3パターン共通・ロール固定）

| ロール | Claude | Codex |
|---|---|---|
| 開発 | `claude-sonnet-4-6` | `gpt-5.6-terra` |
| レビュー | `claude-opus-5` | `gpt-5.6-sol` |
| 広報 | `claude-opus-5` | `gpt-5.6-sol` |
| サブエージェント（自己拡張時） | `claude-sonnet-4-6` | `gpt-5.6-terra` |

開発は思考の速さ重視で軽量モデル、レビュー・広報は判断の質を重視して上位モデルにしています。
`experiment.json` の `models` で管理し、3パターンとも共通（変わるのは担当エージェントだけ）。

### 一括作成

```bash
export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)
export OPENAI_API_KEY=sk-...

bash scripts/setup-repos.sh kawaribanko-loop public
```

3リポジトリの作成・push・Secrets登録・承認環境の作成・Pages有効化・**cron の時刻ずらし**まで自動で行われます。

### 初回サイクルの手動実行

```bash
gh workflow run loop.yml --repo <owner>/kawaribanko-loop-p1
gh run watch --repo <owner>/kawaribanko-loop-p1
```

問題なければ放置。翌日から自動で回ります。

## 運用

```bash
# 進捗を見る
gh run list --repo <owner>/kawaribanko-loop-p1 --workflow loop.yml

# 緊急停止（キルスイッチ）
gh workflow disable loop.yml --repo <owner>/kawaribanko-loop-p1

# 再開
gh workflow enable loop.yml --repo <owner>/kawaribanko-loop-p1
```

### 承認通知

`publish.yml` の `gate` ジョブが `publish` environment で止まり、
GitHub からメール・モバイルアプリのプッシュ通知で承認依頼が届きます。
承認するまでスライドは公開されません。

毎日聞かれるのが煩わしい場合は `publish.yml` の `workflow_run` トリガーを削除し、
手動実行だけにしてください。

## 指示書の構成

- **[`CLAUDE.md`](CLAUDE.md) がこのリポジトリの唯一の指示書です。**
- `AGENTS.md` は「まず `CLAUDE.md` を読め」とだけ書いた短いスタブです。
- Codex は `AGENTS.md` を、Claude Code は `CLAUDE.md` を読みますが、
  実体を1つにすることで**内容の食い違いと修正コストを避けています**。
- 運用ルールを足すときは `CLAUDE.md` だけを編集します（`AGENTS.md` は保護パス）。

## 安全装置

| 装置 | 内容 |
|---|---|
| 保護パス | `.github/`, `prompts/`, `AGENTS.md`, `docs/evaluation.md`, `docs/product-brief.md`, `experiment.json`, `metrics/` への変更は自動で破棄される |
| トークン分離 | チェックアウトは `persist-credentials: false`。エージェント実行中は push 用トークンを渡さない |
| 権限最小化 | `GITHUB_TOKEN` は `contents: write` のみ。仕様上ワークフローファイルは書き換えられない |
| 停止条件 | `experiment.json` の `max_cycles`（7）を超えると自動停止 |
| タイムアウト | 各ジョブに上限時間 |
| 停滞検出 | レビュー担当が毎回 Δ判定（`ADVANCED / MARGINAL / STALLED`）を下す |
| 日記の改竄検出 | 過去エントリが書き換え・削除されると `metrics` の `diary.tampered_past_entries` に記録される |

### エージェントが即座に失敗するとき

dev / feedback / slides が **10秒未満で失敗**し、ログに

```
API Error: Header 'Authorization' has invalid value
```

が出ている場合、シークレットの値そのものではなく**値に混ざった文字**が原因です。
改行・タブ・制御文字・ゼロ幅空白などは HTTP ヘッダ値として不正なため、
Claude Code はネットワークに出る前にローカルで失敗します（課金0・トークン0）。

ワークフローの「Normalize credentials」ステップが可視 ASCII 以外を自動で除去し、
除去が発生した場合は警告を出します。警告が出たら登録し直してください。

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo> \
  --body "$(claude setup-token | LC_ALL=C tr -cd '\041-\176')"
```

## サイクルごとのスナップショット

完走したサイクルには `wrap` が `cycle-N` タグを打ちます。各サイクル終了時点の
アプリはこのタグから正確に取り出せます。

公開サイトの **`/cycles/`** に全サイクルの一覧が出て、各サイクル当時のアプリを
そのままブラウザで開けます（`/app/` は常に最新サイクル）。日を追ってアプリが
どう育ったかを、その場で見比べられます。

手元に取り出すには:

```bash
git fetch --tags
bash scripts/snapshot.sh snapshots
python3 -m http.server 8000 --directory snapshots
```

`snapshots/cycle-1/`, `snapshots/cycle-2/` … が生成され、`index.html` が一覧になります。
履歴から取り出すだけなのでリポジトリは汚れません（`snapshots/` は `.gitignore` 済み）。

## 比較のしかた

`metrics/cycle-*.json` に毎サイクルの実測値が入ります。

| フィールド | 見るポイント |
|---|---|
| `ambition_verdict` | **7サイクルで `RAISED` を何回出せたか。** これが天井なし設計の中心指標 |
| `delta_verdict` | 右肩上がりか、途中で失速したか |
| `roadmap_open_items` | 0 になっていたら「完成を宣言してしまった」サイン |
| `self_extension` | サブエージェント・スキルを作ったか、**それを使い続けたか** |
| `diary` | 3人書いているか / 互いに反応しているか（`replies_this_cycle`）/ 改竄がないか |
| `results` | 途中で失敗したロールはあるか（＝ループの自律性） |
| `git.total` | 変更規模（**多さ＝進捗ではない**点に注意） |

定性面は `docs/journal/`、`docs/reviews/`、そして **`app/data/diary.json` の読み比べ**が本番です。

> **評価バイアスに注意**: 成果物を Claude に評価させると Claude 有利、GPT なら GPT 有利に出ます。
> 最終評価は両モデル + 人間で、可能ならどのパターンか伏せて行ってください。

## 注意点

- GitHub の cron は数分〜数十分ずれます。実際の実行時刻は `metrics/` に記録されます。
- スケジュールワークフローはリポジトリが60日間無活動だと自動停止します（7日間の実験では問題なし）。
- トークン使用量とコストは Anthropic / OpenAI の各コンソールで確認してください（Actions 側では取得できません）。
- アプリは `file://` で直接開くと `fetch()` が CORS で失敗します。`python3 -m http.server 8000 --directory app` で確認してください。
