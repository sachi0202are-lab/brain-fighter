# Brain Fighter（brain-fighter）

反応・記憶・切り替えを試す3分ミニゲーム集。格闘ゲーム風の演出で、ゲーム内の成績（戦闘力）と自己ベストを記録できます。心理学の実験で使われる課題形式（n-back、タスクスイッチ等）を採用しています。

- 仕様書: `../brain-fighter-spec/SPEC.md`（MUST / MUST NOT は変えない。仕様書に無い判断は `DESIGN_NOTES.md` に1行ずつ）
- 公開先（予定）: https://sachi0202are-lab.github.io/brain-fighter/ （リポジトリ `sachi0202are-lab/brain-fighter`）
- いまの状態: **フェーズ1（土台）＋フェーズ3（認定戦・演出の仕上げ・ブログ埋め込み・初回の案内）**。3本のゲームはフェーズ2で本実装に置き換え中（それまでは仮実装＝スタブ）。

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
| `npm run test:e2e` | E2E（Playwright。モバイル 390×844 と PC 1280×800）。ビルドして `vite preview` で配信してから走る（本体と `/embed/` の両方） |
| `npm run lint:words` | 文言チェック（仕様書 第12節の使わない語を `src/` `public/` `README.md` などから探す） |
| `npm run typecheck` | 型チェックだけ |
| `npm run icons` | プレースホルダーのアイコン（`public/icons/`）を作り直す |

E2E のポートを変えるとき: `PORT=4174 npm run test:e2e`（ビルド出力は `.e2e-dist/<PORT>/`、結果は `test-results/<PORT>/` に分かれるので、並行して走らせてもぶつからない）。
ほかの E2E と同時に回すと、負荷で提示時間の照合（±1 フレーム）が落ちることがある。そのときは `PORT=4177 npm run test:e2e -- --workers=1`（または 2）で。
Playwright 同梱のブラウザが無い環境では `/opt/pw-browsers/chromium`（または環境変数 `PW_CHROMIUM_PATH`）を使う。

### URL パラメータ

| パラメータ | 内容 |
|---|---|
| `?seed=123` | 乱数シードを固定（ラウンドごとのシードは「シード・ゲーム・ラウンド番号」から決まる） |
| `?test=1` | テスト用フック `window.__bfTest` を出す（正解の取得・入力・自動プレイ・ログ） |
| `?test=1&fx=off` | 演出プリセットを一時的に上書き（`off` / `light` / `full`。テスト用） |
| `?test=1&onboarding=1` | `?test=1` のときも初回の案内を出す（`?test=1` だけなら出さない。既存のテストの流れを変えないため） |

例: `http://localhost:5173/brain-fighter/?test=1&seed=1#/play/double-hit`
埋め込み版: `http://localhost:5173/brain-fighter/embed/`（`?test=1` なども同じように使える）

## 画面（ハッシュルーティング）

`#/` ホーム（初回は案内）／ `#/play/:gameId` ゲーム ／ `#/result` 結果 ／ `#/records` 記録 ／ `#/cert` 認定戦（昇段審査）を選ぶ ／ `#/cert/run/:gameId[,:gameId…]` 認定戦の実施 ／ `#/settings` 設定 ／ `#/welcome` 初回の案内

別ページ: `/brain-fighter/embed/`（ブログ埋め込み用のコンパクト版。同じアプリを埋め込み表示で起動する）

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
  cert/              認定戦（昇段審査）: 解放条件・ティア・合否・記録（cert.ts）、固定難度で 2 ラウンド行う実行（runner.ts）
  storage/           localStorage（キー brain-fighter.v1）、スキーマと移行、エクスポート／インポート、集計
  skin/              演出（off / light / full）: HP バー、1 ビットフィードバック、KO / PERFECT / 判定、シルエット、
                     必殺演出（special.ts）、Full の静的な背景（backdrop.ts）、効果音（sound.ts）
  ui/                画面（DOM）。screens/ に各画面、stage.ts は訓練と認定戦で共用する「舞台」（刺激領域・応答ボタン・キー）、
                     charts.ts は記録画面のグラフ（SVG 自前描画）、embed-main.ts / embed-code.ts はブログ埋め込み
  games/             index.ts（登録簿）と double-hit/ combo-recall/ stance-change/（各ゲーム）
  i18n/              ja.ts（入口）、ja/common.ts（共通の文言）、ja/<game-id>.ts（ゲームごとの文言）
  test/              テスト用の小道具（Canvas・ストレージ・DOM の代用品、テスト用ゲーム）
embed/index.html     ブログ埋め込み用ページ（Vite の2つ目の入口 → /brain-fighter/embed/）
e2e/                 Playwright（スモーク、演出プリセット同値性・見え方、認定戦、埋め込み、初回の案内、保存など）。
                     embed-parent.html はブログ記事の代わりの親ページ（第11節のコードそのまま）
scripts/             lint-words.mjs（文言チェック）、gen-icons.mjs（アイコン生成）
public/              favicon とアプリアイコン
.github/workflows/   deploy.yml（GitHub Pages へのデプロイ）
```

大事な決まり（仕様書の MUST / MUST NOT から）

- 難度はアルゴリズムだけが決める。難度の選択・補助・スキップの操作は作らない。
- 演出プリセット（off / light / full）で試行数・提示時間・刺激間隔・応答期限・標的比率は変わらない。ゲームモジュールには演出の情報が渡らず、演出はラウンド実行のイベントを購読するだけ（`src/engine/fx-equivalence.test.ts` と `e2e/fx-equivalence.spec.ts` で照合）。
- 戦闘力に速さは入らない（`power()` には反応時間を含まない成績だけが渡る）。
- 文言は「ゲーム内の成績・記録」を主語にする（`npm run lint:words`）。
- 刺激の提示中に刺激領域の中・周りで動く演出は置かない。点滅は 3 回/秒以下（`src/skin/effects.test.ts` と `e2e/fx-presets.spec.ts`）。

## 認定戦（昇段審査）

仕様書 第7節。訓練（毎日の戦闘力）とは別の「公式記録」で、段位（ベルト）を決める。

- **挑める条件**: そのゲームの訓練が 3 日以上、かつ前回の認定戦から 7 日以上。ホームに「昇段審査に挑めます（ゲーム名）」と出る。
- **選ぶ**: `#/cert` で挑めるゲームを1つずつ、または「まとめて受ける」で続けて受けられる（難度は選べない）。
- **内容**: 「現在のベルト + 1」のティア（各ゲームの `certParams`）の**固定難度**で、**未訓練の刺激セット**（`untrained: true`）を 2 ラウンド。試行数は訓練と同じ。ウォームアップ・「もう1ラウンド」は無い。
  固定難度は `src/cert/runner.ts`: 試行列は `createRound`、ラウンドは `RoundRunner` を `adaptive: false` で動かすだけで、`adapt` / `adaptTrial` / `power` を呼ばない。
- **合格**: 2 ラウンドとも正答率 79% 以上（ゲームごとの `certRoundPassed`。コンボ・リコールは誤り 4 以下）。合格でベルト +1、不合格でもベルトは下がらない。
- **演出は最小**: HP バー・KO・コンボ・効果音・ファイター・背景なし（正誤の 1 ビットだけ）。結果は「合格／不合格」と正答率だけ。
- **記録**: `SaveData.certs`（訓練とは別のテーブル）。訓練のラウンド・訓練日・戦闘力には数えない。1ラウンド目を始めた時点で記録を作るので、途中でやめると「不合格（中断）」として残り、次は 7 日後（開始前の「やめる」なら記録しない）。
- **ベルト**: 0 白帯・1 黄帯・2 橙帯・3 緑帯・4 青帯・5 紫帯・6 茶帯・7 赤帯・8 黒帯・9 黒帯二段。総合ベルト＝3本の最低値。ホームと記録画面に表示し、記録画面では戦闘力とは別のグラフと「認定戦の記録」に出す。

## 演出プリセット（Off / Light / Full）

仕様書 第9節。設定画面（と初回の案内）で選ぶ。既定は Light。**どのプリセットでも試行数・提示時間・刺激間隔・応答期限・標的比率は同じ**で、演出はラウンド実行のイベントを購読するか、ラウンドの外（ラウンド間の画面・結果画面）に出るだけ。

| | Off | Light | Full |
|---|---|---|---|
| 課題中 | 課題と正誤の 1 ビットだけ | ＋静的な HP バー・短い正誤音 | ＋コンボ表示・静的なカスタム背景（画面下端の遠景シルエット） |
| ラウンド間（10 秒・「次のラウンドへ」で進める） | 文字だけ | 静止画のファイター＋KO / PERFECT / 判定（判定負けは「次は ◯ 問正解で KO」と情報だけ） | ＋必殺演出（KO / PERFECT のとき、約 1.6 秒だけ動いて止まる）と技名テロップ・衝撃音 |
| 結果画面 | 成績だけ | ＋ラウンドごとの KO / PERFECT と見出し | Light と同じ |

- 使わない演出: 低 HP の点滅・警報音、画面揺れ、フラッシュ、ヒットストップ、スロー、KO による途中終了（KO してもラウンドは最後まで続く）。
- 音は WebAudio の発振器で作る。最初のタップ・キー操作まで鳴らさない（埋め込み時の自動再生制限にも合う）。設定で効果音をオフにできる。
- 「視差を減らす」設定（prefers-reduced-motion）では、動く演出を静止画にする。

## ブログ埋め込み（/embed/）

仕様書 第11節。WordPress の記事の「カスタム HTML」ブロックに次のコードを貼る（設定画面の「ブログ用の埋め込みコードをコピー」でコピーできる）。

```html
<div style="max-width:420px;margin:0 auto;aspect-ratio:9/16;">
  <iframe src="https://sachi0202are-lab.github.io/brain-fighter/embed/"
          style="width:100%;height:100%;border:0;border-radius:12px;"
          allow="fullscreen" loading="lazy" title="Brain Fighter"></iframe>
</div>
<p style="text-align:center"><a href="https://sachi0202are-lab.github.io/brain-fighter/" target="_blank" rel="noopener">全画面で開く</a></p>
```

- 埋め込み版（`/brain-fighter/embed/`）はナビ（記録・設定）を省いたコンパクト版で、「全画面で開く」（本体を新しいタブで）と「ブログ内の記録は本体と別になります。本格的に続けるなら全画面で」を出す。iframe の中の保存領域は本体と別になる。
- 埋め込み版には PWA の manifest と Service Worker の登録を入れない（ホーム画面への追加は本体でだけ案内する）。本体の Service Worker は `/embed/` を本体のページに置き換えない（ナビゲーションのフォールバックの対象外。オフラインでも埋め込み版が開く）。
- `X-Frame-Options` や `frame-ancestors` は設定しない（GitHub Pages も付けない）。

## 初回の案内（オンボーディング）

初めて開いたとき（記録が無いとき）だけ、ホームの代わりに 3 画面の案内を出す: ようこそ（アプリの説明と免責）→ あそび方 → 演出の選択（既定 Light）。
設定の「このアプリについて」の「はじめの案内をもう一度見る」でいつでも見られる。免責文は「このアプリについて」に常設。

## フェーズ2（3本のゲームの並行実装）

- 担当者は **`src/games/<id>/` と `src/i18n/ja/<id>.ts` だけ**を編集する。共有ファイルの変更が必要なら親に報告する。詳しくは各フォルダの `README.md`。
- 開発サーバーのポート: ダブルヒット 5174、コンボ・リコール 5175、スタンスチェンジ 5176（`npm run dev -- --port 5174 --strictPort`）。
- E2E のポート: ダブルヒット 4174、コンボ・リコール 4175、スタンスチェンジ 4176（`PORT=4174 npm run test:e2e`）。
- 完了の目安: `npm run build`・`npm test`・`npm run test:e2e`・`npm run lint:words` がすべて緑。

## デプロイ

`.github/workflows/deploy.yml`: `main` への push（または手動実行）で、文言チェック → ユニットテスト → ビルド → GitHub Pages へ公開。
リポジトリの Settings → Pages → Source を「GitHub Actions」にしておく。ベースパスは `/brain-fighter/`（`vite.config.ts`）。
