/**
 * 演出プリセット同値性（ブラウザ）: 同じシード・同じ入力の規則で off / light / full を実行し、
 * 試行数・各フェーズの予定時間（提示時間・刺激間隔・応答期限）・刺激（標的比率）・正誤が一致することを確かめる。
 * 実測時間はブラウザの負荷で揺れるので、ここでは予定（フレーム量子化後）を照合する。
 * 実測まで含めた完全一致は Vitest の src/engine/fx-equivalence.test.ts（仮想時計）で確かめている。
 */
import { expect, test } from '@playwright/test';
import { MATCH_ROUNDS, playMatch, type BfTestLogRound } from './helpers';

const FX = ['off', 'light', 'full'] as const;
/** 1 ラウンドの試行数（初回なのでコンボ・リコールは n = 1 の 20 + 1） */
const TRIALS = { 'double-hit': 24, 'combo-recall': 21, 'stance-change': 30 } as const;

function normalize(logs: BfTestLogRound[]): unknown {
  return logs.map((r) => ({
    kind: r.kind,
    roundNo: r.roundNo,
    trials: r.trials.length,
    paramsEnd: r.paramsEnd,
    power: r.power,
    items: r.trials.map((t) => ({ i: t.i, stim: t.stim, correct: t.correct, plan: t.plan })),
  }));
}

for (const gameId of ['double-hit', 'combo-recall', 'stance-change'] as const) {
  test(`off / light / full で試行ログが一致する（${gameId}）`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
    test.setTimeout(8 * 60_000);
    const baseURL = testInfo.project.use.baseURL;
    const runs = await Promise.all(
      FX.map(async (fx) => {
        const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        await page.goto(`./?test=1&seed=42&fx=${fx}#/play/${gameId}`);
        await expect(page.locator(`.play.fx-${fx}`)).toBeVisible();
        await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60 }));
        const between = await playMatch(page);
        const out = await page.evaluate(() => ({ logs: window.__bfTest.logs(), frameMs: window.__bfTest.frameMs() }));
        await ctx.close();
        return { fx, between, ...out };
      }),
    );
    const [off, ...others] = runs;
    // 1 試合のラウンド: 3 ゲームとも 1 本だけ（仕様書 v1.2。ウォームアップも「もう1ラウンド」も無く、ラウンド間の画面を通らない）
    // （v1.1 まではダブルヒット・コンボ・リコールが 3 本、その前はスタンスチェンジもウォームアップ＋3 本だった）
    const rounds = Array.from({ length: MATCH_ROUNDS[gameId] }, (_, k) => `round:${k + 1}`);
    for (const r of runs) {
      expect(r.logs.map((x) => `${x.kind}:${x.roundNo}`), `${r.fx} のラウンド`).toEqual(rounds);
      expect(r.between, `${r.fx} のラウンド間の画面の数`).toBe(MATCH_ROUNDS[gameId] - 1);
    }
    expect(off!.logs.map((x) => x.trials.length)).toEqual(rounds.map(() => TRIALS[gameId]));
    for (const r of others) {
      expect(r.frameMs, `${r.fx} のフレーム間隔`).toBeCloseTo(off!.frameMs, 6);
      expect(normalize(r.logs), `${r.fx} と off の試行ログ`).toEqual(normalize(off!.logs));
    }
    // 照合した量（受け入れ基準 1 の根拠として残す）
    const trials = off!.logs.flatMap((r) => r.trials);
    const phases = trials.reduce((a, t) => a + Object.keys(t.plan).length, 0);
    const stimMs = trials.map((t) => t.plan.stimulus ?? 0);
    const description = `${gameId}: off / light / full で ${off!.logs.length} ラウンド・${trials.length} 試行・${phases} フェーズの予定時間（提示時間 ${Math.min(...stimMs).toFixed(1)}〜${Math.max(...stimMs).toFixed(1)} ms を含む）・刺激・正誤・難度・戦闘力が一致（フレーム ${off!.frameMs.toFixed(2)} ms）`;
    testInfo.annotations.push({ type: 'fx-equivalence', description });
    console.log(`[fx-equivalence] ${description}`);
  });
}
