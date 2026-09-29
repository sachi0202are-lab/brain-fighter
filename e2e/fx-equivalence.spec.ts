/**
 * 演出プリセット同値性（ブラウザ）: 同じシード・同じ入力の規則で off / light / full を実行し、
 * 試行数・各フェーズの予定時間（提示時間・刺激間隔・応答期限）・刺激（標的比率）・正誤が一致することを確かめる。
 * 実測時間はブラウザの負荷で揺れるので、ここでは予定（フレーム量子化後）を照合する。
 * 実測まで含めた完全一致は Vitest の src/engine/fx-equivalence.test.ts（仮想時計）で確かめている。
 */
import { expect, test } from '@playwright/test';
import { playMatch, type BfTestLogRound } from './helpers';

const FX = ['off', 'light', 'full'] as const;

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

for (const gameId of ['double-hit', 'combo-recall', 'stance-change']) {
  test(`off / light / full で試行ログが一致する（${gameId}）`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
    test.setTimeout(15 * 60_000);
    const baseURL = testInfo.project.use.baseURL;
    const runs = await Promise.all(
      FX.map(async (fx) => {
        const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
        const page = await ctx.newPage();
        await page.goto(`./?test=1&seed=42&fx=${fx}#/play/${gameId}`);
        await expect(page.locator(`.play.fx-${fx}`)).toBeVisible();
        await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60 }));
        await playMatch(page);
        const out = await page.evaluate(() => ({ logs: window.__bfTest.logs(), frameMs: window.__bfTest.frameMs() }));
        await ctx.close();
        return { fx, ...out };
      }),
    );
    const [off, ...others] = runs;
    expect(off!.logs.length).toBeGreaterThanOrEqual(3);
    for (const r of others) {
      expect(r.frameMs, `${r.fx} のフレーム間隔`).toBeCloseTo(off!.frameMs, 6);
      expect(normalize(r.logs), `${r.fx} と off の試行ログ`).toEqual(normalize(off!.logs));
    }
  });
}
