# コンボ・リコール（`combo-recall`）

仕様書 第6.2節: 位置 n-back（20 + n 試行、標的 6、ルアー）。ラウンド単位の n-back ルール。

**いまの `index.ts` はフェーズ1のスタブ（仮実装）**で、アプリが最初から最後まで通ることと、エンジンの次の経路を確かめるためだけのものです: 応答で打ち切らない固定タイミング（stimulus と response の両方を input にする）、押さないのが正解の試行（expectedResponse = null）、nbackStep、d′（metrics）、もう1ラウンド（extraRounds = 1）。フェーズ2で仕様書どおりの本実装に置き換えてください。

## フェーズ2の担当者へ

- **編集してよいのは、このフォルダ（`src/games/combo-recall/`）と `src/i18n/ja/combo-recall.ts` だけ**です。
- 共有ファイル（`src/engine/`、`src/storage/`、`src/ui/`、`src/skin/`、`src/games/index.ts`、`src/i18n/ja/common.ts`、`src/i18n/ja.ts`、`src/i18n/types.ts`、設定ファイル類）の変更が必要になったら、**自分では変えずに親に報告**してください（何を・なぜ）。
- `index.ts` は `export const game: GameModule<P, T>` を1つ公開する形を保ってください（`src/games/index.ts` がこの名前で読み込みます）。インターフェースは `src/engine/types.ts`。
- 難度パラメータ `P` は `type` で定義し、値は数値だけにします（保存形式が `Record<string, number>`）。
- 試行列は `createRound` に渡る `rng` だけで作ります（`Math.random` を使わない。`renderStimulus` の中で乱数を使わない）。系列づくりには `src/engine/sequence.ts` の `balancedSequence` / `randomSequence` が使えます。
- 時間はフェーズ列（`phases`）で ms 指定します。フレームへの量子化・実測の記録・応答窓の管理はエンジンがやります。
- 演出（off / light / full）はゲームに渡りません。ゲーム側で演出を分岐しないでください（仕様書 9.1 MUST）。
- 戦闘力（`power`）に反応時間を使わないでください（仕様書 5.1 MUST）。式は `src/engine/power.ts` にあります。
- 刺激は抽象記号で作り、実在の格闘ゲームのコマンド列やキャラ名を使わないでください（仕様書 第6節 MUST NOT）。
- 文言は `src/i18n/ja/combo-recall.ts` に置き、仕様書 第12節の文言ルールに従います（`npm run lint:words` で確認）。

## テスト

- このフォルダに `*.test.ts` を置けば Vitest が拾います（例: 適応ルールが仕様書の数値どおりか）。
- `src/games/contract.test.ts`（共通の約束のテスト）と `src/engine/fx-equivalence.test.ts`（演出プリセット同値性）は、登録された本実装にもそのまま効きます。両方が緑であること。
- ブラウザ無しで試合を最後まで動かすには `src/engine/headless.ts` の `runMatchHeadless` / `runRoundHeadless` が使えます。
- 画面で試すには `npm run dev -- --port <担当ポート>` で開き、`/brain-fighter/?test=1&seed=1#/play/combo-recall`。
