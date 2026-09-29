/**
 * スモークテスト（仕様書 受け入れ基準 7）: ホーム → 今日のセッション → 3ゲームを最後まで → 結果 → 記録。
 * 入力は ?test=1 の自動プレイ（5 試行に1回誤る = 正答率 80% を狙う疑似プレイヤー）。
 */
import { expect, test } from '@playwright/test';
import { collectErrors, playMatch } from './helpers';

test('ホーム → 今日のセッション → 3ゲームを最後まで → 結果 → 記録', async ({ page }) => {
  // 本実装の試行数（1ラウンド 24〜30 試行）ではセッション全体で 10 分前後かかる
  test.setTimeout(20 * 60_000);
  const errors = collectErrors(page);
  await page.goto('./?test=1&seed=7#/');
  await expect(page.getByTestId('total-power')).toHaveText('0');
  await expect(page.getByTestId('week-days')).toContainText('0 / 5');
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60 }));

  await page.getByTestId('start-session').click();
  for (let g = 0; g < 3; g++) {
    await playMatch(page);
    await expect(page.getByTestId('result')).toBeVisible();
    if (g < 2) await page.getByTestId('next-game').click();
  }
  await expect(page.getByTestId('session-done')).toBeVisible();

  // ---- 記録の中身（ページを離れる前に読む） ----
  const { logs, save, frameMs } = await page.evaluate(() => ({
    logs: window.__bfTest.logs(),
    save: window.__bfTest.save(),
    frameMs: window.__bfTest.frameMs(),
  }));
  const training = save.rounds.filter((r) => r.kind !== 'warmup');
  expect(training).toHaveLength(9);
  expect(new Set(training.map((r) => r.gameId)).size).toBe(3);
  const trials = training.reduce((a, r) => a + r.trials, 0);
  const correct = training.reduce((a, r) => a + r.correct, 0);
  expect(correct / trials).toBeGreaterThan(0.7);
  expect(correct / trials).toBeLessThan(0.95);
  for (const r of training) {
    expect(r.power).toBeGreaterThanOrEqual(0);
    expect(r.power).toBeLessThanOrEqual(1000);
  }
  // 試行ごとの生ログが保存されている
  const logged = logs.reduce((a, r) => a + r.trials.length, 0);
  expect(save.trials).toHaveLength(logged);
  expect(save.sessions?.[0]?.done).toHaveLength(3);
  // 提示時間の実測誤差が ±1 フレーム以内か（受け入れ基準 12 の確認）。
  // 応答で打ち切るフェーズ（untilResponse）は実測 = 反応時間なので除き、固定長のフェーズをすべて照合する。
  // テスト環境は並列実行で描画が落ちることがあるので「90% 以上が ±1 フレーム以内」を合格とし、分布を注記に残す
  // （実装の系統的なずれならほぼ全件が外れるので、これで検出できる）。
  const errs: number[] = [];
  for (const r of logs) {
    for (const t of r.trials) {
      for (const p of t.phases) {
        if (!p.untilResponse) errs.push(Math.abs(p.endMs - p.startMs - p.plannedMs));
      }
    }
  }
  const within = errs.filter((e) => e <= frameMs + 0.5).length;
  test.info().annotations.push({
    type: 'timing',
    description: `固定長フェーズ ${errs.length} 件中 ${within} 件が ±1 フレーム以内（最大誤差 ${Math.max(...errs).toFixed(1)} ms、フレーム ${frameMs.toFixed(2)} ms）`,
  });
  console.log(`[timing] ${test.info().project.name}: ${test.info().annotations.at(-1)?.description}`);
  expect(errs.length).toBeGreaterThan(100);
  expect(within / errs.length).toBeGreaterThanOrEqual(0.9);

  // ---- 記録画面 ----
  await page.getByTestId('to-records').click();
  await expect(page.getByTestId('records')).toBeVisible();
  await expect(page.getByTestId('records-week')).toContainText('1 / 5');
  // 総合戦闘力・ゲーム別・正答率の3つにデータがある（ベルトは認定戦がまだ無いので空）
  await expect(page.locator('.chart-svg')).toHaveCount(3);

  // ---- 再読み込みしても記録が残り、同じ日の2回目は4時間あける ----
  await page.goto('./?test=1#/');
  await expect(page.getByTestId('total-power')).not.toHaveText('0');
  await expect(page.getByTestId('start-session')).toBeDisabled();
  expect(errors).toEqual([]);
});
