# Brain Fighter（brain-fighter）

反応・記憶・切り替えを試す3分ミニゲーム集。格闘ゲーム風の演出で、ゲーム内の成績（戦闘力）と自己ベストを記録できます。心理学の実験で使われる課題形式（n-back、タスクスイッチ等）を採用しています。

- 仕様書: `../brain-fighter-spec/SPEC.md`（MUST / MUST NOT は変えない。仕様書に無い判断は `DESIGN_NOTES.md` に1行ずつ）
- 公開先（予定）: https://sachi0202are-lab.github.io/brain-fighter/ （リポジトリ `sachi0202are-lab/brain-fighter`）
- いまの状態: **フェーズ1（土台）**。共通エンジン・保存・画面・演出・テスト基盤ができていて、3本のゲームは仮実装（スタブ）。

## 開発コマンド

Node 22 / npm。

| コマンド | 内容 |
|---|---|
| `npm install` | 依存を入れる |
| `npm run dev` | 開発サーバー → http://localhost:5173/brain-fighter/ （ポート指定: `npm run dev -- --port 5174 --strictPort`） |
| `npm run build` | 型チェック（`tsc`）＋本番ビルド → `dist/` |
| `npm run preview` | ビルド結果を配信 → http://localhost:4173/brain-fighter/ |
| `npm test` | ユニットテスト（Vitest。`src/**/*.test.ts`） |
| `npm run test:watch` | ユニットテストの監視実行 |
| `npm run test:e2e` | E2E（Playwright。モバイル 390×844 と PC 1280×800）。ビルドして `vite preview` で配信してから走る |
| `npm run lint:words` | 文言チェック（仕様書 第12節の使わない語を `src/` `public/` `README.md` などから探す） |
| `npm run typecheck` | 型チェックだけ |
| `npm run icons` | プレースホルダーのアイコン（`public/icons/`）を作り直す |

E2E のポートを変えるとき: `PORT=4174 npm run test:e2e`（ビルド出力は `.e2e-dist/<PORT>/`、結果は `test-results/<PORT>/` に分かれるので、並行して走らせてもぶつからない）。
Playwright 同梱のブラウザが無い環境では `/opt/pw-browsers/chromium`（または環境変数 `PW_CHROMIUM_PATH`）を使う。

### URL パラメータ

| パラメータ | 内容 |
|---|---|
| `?seed=123` | 乱数シードを固定（ラウンドごとのシードは「シード・ゲーム・ラウンド番号」から決まる） |
| `?test=1` | テスト用フック `window.__bfTest` を出す（正解の取得・入力・自動プレイ・ログ） |
| `?test=1&fx=off` | 演出プリセットを一時的に上書き（`off` / `light` / `full`。テスト用） |

例: `http://localhost:5173/brain-fighter/?test=1&seed=1#/play/double-hit`

## 画面（ハッシュルーティング）

`#/` ホーム ／ `#/play/:gameId` ゲーム ／ `#/result` 結果 ／ `#/records` 記録 ／ `#/cert` 認定戦（フェーズ1は案内だけ）／ `#/settings` 設定

## 構成

```
src/
  engine/            共通エンジン（ゲームに依存しない。純粋関数＋テスト）
    types.ts         GameModule インターフェース（各ゲームが実装する）
    round.ts         ラウンド実行のステートマシン（試行の提示・入力・判定・記録。演出はイベントを購読するだけ）
    match.ts         1試合の進行（ウォームアップ → ラウンド × 3 → 任意の追加ラウンド）
    timing.ts        rAF スケジューラ、フレームへの量子化、テスト用の仮想時計
    staircase.ts     階段法（重み付き・ブロックしきい値・n-back・N-down/1-up）
    power.ts         戦闘力（一般式・ダブルヒットの式・合計）
    session.ts       1日のセッション（日替わり順・4時間・1日2回・今週 x/5 日・認定戦の解放条件）
    rng.ts           シード付き乱数（mulberry32）と ?seed=
    sequence.ts      系列づくり（均等化・同じ刺激の連続の上限）
    records.ts       結果 → 保存用の RoundRecord / TrialLog
    headless.ts      ブラウザ無しで試合を動かす道具（テスト用）
    autoplay.ts      疑似プレイヤー（80% 正答）
    stats.ts / dates.ts / events.ts / ids.ts
  storage/           localStorage（キー brain-fighter.v1）、スキーマと移行、エクスポート／インポート、集計
  skin/              演出（off / light / full）: HP バー、1 ビットフィードバック、KO / PERFECT / 判定、シルエット
  ui/                画面（DOM）。screens/ に各画面、charts.ts は記録画面のグラフ（SVG 自前描画）
  games/             index.ts（登録簿）と double-hit/ combo-recall/ stance-change/（各ゲーム）
  i18n/              ja.ts（入口）、ja/common.ts（共通の文言）、ja/<game-id>.ts（ゲームごとの文言）
  test/              テスト用の小道具（Canvas・ストレージ・DOM の代用品、テスト用ゲーム）
e2e/                 Playwright（スモーク、演出プリセット同値性、保存できない環境など）
scripts/             lint-words.mjs（文言チェック）、gen-icons.mjs（アイコン生成）
public/              favicon とアプリアイコン
.github/workflows/   deploy.yml（GitHub Pages へのデプロイ）
```

大事な決まり（仕様書の MUST / MUST NOT から）

- 難度はアルゴリズムだけが決める。難度の選択・補助・スキップの操作は作らない。
- 演出プリセット（off / light / full）で試行数・提示時間・刺激間隔・応答期限・標的比率は変わらない。ゲームモジュールには演出の情報が渡らず、演出はラウンド実行のイベントを購読するだけ（`src/engine/fx-equivalence.test.ts` と `e2e/fx-equivalence.spec.ts` で照合）。
- 戦闘力に速さは入らない（`power()` には反応時間を含まない成績だけが渡る）。
- 文言は「ゲーム内の成績・記録」を主語にする（`npm run lint:words`）。

## フェーズ2（3本のゲームの並行実装）

- 担当者は **`src/games/<id>/` と `src/i18n/ja/<id>.ts` だけ**を編集する。共有ファイルの変更が必要なら親に報告する。詳しくは各フォルダの `README.md`。
- 開発サーバーのポート: ダブルヒット 5174、コンボ・リコール 5175、スタンスチェンジ 5176（`npm run dev -- --port 5174 --strictPort`）。
- E2E のポート: ダブルヒット 4174、コンボ・リコール 4175、スタンスチェンジ 4176（`PORT=4174 npm run test:e2e`）。
- 完了の目安: `npm run build`・`npm test`・`npm run test:e2e`・`npm run lint:words` がすべて緑。

## デプロイ

`.github/workflows/deploy.yml`: `main` への push（または手動実行）で、文言チェック → ユニットテスト → ビルド → GitHub Pages へ公開。
リポジトリの Settings → Pages → Source を「GitHub Actions」にしておく。ベースパスは `/brain-fighter/`（`vite.config.ts`）。
