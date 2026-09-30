/**
 * スモークテスト（仕様書 受け入れ基準 7）: ホーム → 今日のセッション → 3ゲームを最後まで → 結果 → 記録。
 * 入力は ?test=1 の自動プレイ（5 試行に1回誤る = 正答率 80% を狙う疑似プレイヤー）。
 *
 * 3 ゲームとも 1 試合 1 ラウンド（仕様書 v1.2）なので、どの試合もラウンド間の画面を出さずに結果画面へ進む。
 *
 * 同じ流れで、ほかの受け入れ基準もブラウザの実測で確かめる（結果はテストの注記と標準出力に残す）:
 * - 2: 結果画面・記録画面にも難度・補助・スキップの操作が無い（ラウンド間の画面は認定戦だけに残るので cert.spec.ts で調べる）
 * - 8: 3 ゲームとも、刺激の提示中に刺激領域で動く・重なる演出が無く、正誤表示は 3 回/秒以下
 * - 12: 提示時間の実測誤差（±1 フレーム）と、ラウンド中の rAF の間隔（60 fps）
 */
import { expect, test } from '@playwright/test';
import { collectErrors, expectNoDifficultyControls, MATCH_ROUNDS, playMatch, type BfTestLogRound } from './helpers';

function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
  console.log(`[${type}] ${test.info().project.name}: ${description}`);
}

/** 固定長のフェーズ（応答で打ち切らないもの）の実測 − 予定 (ms) */
function phaseErrors(logs: BfTestLogRound[], filter: (name: string) => boolean): number[] {
  const errs: number[] = [];
  for (const r of logs) {
    for (const t of r.trials) {
      for (const p of t.phases) {
        if (!p.untilResponse && filter(p.name)) errs.push(Math.abs(p.endMs - p.startMs - p.plannedMs));
      }
    }
  }
  return errs;
}

test('ホーム → 今日のセッション → 3ゲームを最後まで → 結果 → 記録', async ({ page }) => {
  // 本実装の試行数（ダブルヒット 24、コンボ・リコール 21、スタンスチェンジ 16。3 ゲームとも 1 ラウンド）でセッション全体 約 2 分
  test.setTimeout(12 * 60_000);
  const errors = collectErrors(page);
  await page.goto('./?test=1&seed=7#/');
  await expect(page.getByTestId('total-power')).toHaveText('0');
  await expect(page.getByTestId('week-days')).toContainText('0 / 5');
  await page.evaluate(() => {
    window.__bfTest.autoplay({ delayMs: 60 });
    window.__bfTest.startFxAudit();
    window.__bfTest.startFrameStats();
  });

  await page.getByTestId('start-session').click();
  const played: string[] = [];
  for (let g = 0; g < 3; g++) {
    const gameId = ((await page.locator('.play[data-game]').getAttribute('data-game')) ?? '') as keyof typeof MATCH_ROUNDS;
    played.push(gameId);
    // 1 ラウンドだけの試合: ラウンド間の画面・「もう1ラウンド」の確認を出さずに結果画面へ
    const between = await playMatch(page);
    expect(between, `${gameId} のラウンド間の画面の数`).toBe(MATCH_ROUNDS[gameId] - 1);
    const result = page.getByTestId('result');
    await expect(result).toBeVisible();
    // 結果画面のラウンドは「ラウンド 1/1」ではなく「一本勝負」の 1 行
    await expect(result.locator('.round-item')).toHaveCount(1);
    await expect(result.locator('.round-item .round-no')).toHaveText('一本勝負');
    await expectNoDifficultyControls(page, `${gameId} の結果画面`);
    if (g < 2) await page.getByTestId('next-game').click();
  }
  expect([...played].sort()).toEqual(['combo-recall', 'double-hit', 'stance-change']);
  await expect(page.getByTestId('session-done')).toBeVisible();

  // ---- 記録の中身（ページを離れる前に読む） ----
  const { logs, save, frameMs, audit, frames } = await page.evaluate(() => ({
    logs: window.__bfTest.logs(),
    save: window.__bfTest.save(),
    frameMs: window.__bfTest.frameMs(),
    audit: window.__bfTest.fxAuditReport(),
    frames: window.__bfTest.frameStats(),
  }));
  const training = save.rounds.filter((r) => r.kind !== 'warmup');
  // 1 試合のラウンド数: 3 ゲームとも 1（ウォームアップも「もう1ラウンド」も無い）= 3
  expect(save.rounds.filter((r) => r.kind === 'warmup')).toHaveLength(0);
  expect(training).toHaveLength(3);
  for (const [gameId, n] of Object.entries(MATCH_ROUNDS)) {
    expect(training.filter((r) => r.gameId === gameId), gameId).toHaveLength(n);
  }
  expect(logs.map((r) => `${r.gameId}:${r.kind}:${r.roundNo}`).sort()).toEqual(
    ['combo-recall:round:1', 'double-hit:round:1', 'stance-change:round:1'],
  );
  const trials = training.reduce((a, r) => a + r.trials, 0);
  const correct = training.reduce((a, r) => a + r.correct, 0);
  expect(correct / trials).toBeGreaterThan(0.7);
  expect(correct / trials).toBeLessThan(0.95);
  for (const r of training) {
    expect(r.power).toBeGreaterThanOrEqual(0);
    expect(r.power).toBeLessThanOrEqual(1000);
  }
  // 試行ごとの生ログが保存されている（24 + 21 + 16 = 61 試行。初回なのでコンボ・リコールは n = 1 の 21 試行）
  const logged = logs.reduce((a, r) => a + r.trials.length, 0);
  expect(logged).toBe(61);
  expect(logs.map((r) => `${r.gameId}:${r.trials.length}`).sort()).toEqual(['combo-recall:21', 'double-hit:24', 'stance-change:16']);
  expect(save.trials).toHaveLength(logged);
  expect(save.sessions?.[0]?.done).toHaveLength(3);

  // ---- 受け入れ基準 12: 提示時間の実測誤差が ±1 フレーム以内か ----
  // 応答で打ち切るフェーズ（untilResponse）は実測 = 反応時間なので除き、固定長のフェーズをすべて照合する。
  // テスト環境は描画が落ちることがあるので「90% 以上が ±1 フレーム以内」を合格とし、分布を注記に残す
  // （実装の系統的なずれならほぼ全件が外れるので、これで検出できる）。
  const tol = frameMs + 0.5;
  const describe = (errs: number[]): string => {
    const within = errs.filter((e) => e <= tol).length;
    const exact = errs.filter((e) => e <= 0.5).length;
    return `${errs.length} 件中 ${within} 件（${((100 * within) / Math.max(1, errs.length)).toFixed(1)}%）が ±1 フレーム以内、うち ${exact} 件は誤差 0.5 ms 以下、最大誤差 ${Math.max(0, ...errs).toFixed(1)} ms`;
  };
  const all = phaseErrors(logs, () => true);
  const stim = phaseErrors(logs, (n) => n === 'stimulus');
  note('timing', `固定長フェーズ ${describe(all)}（フレーム ${frameMs.toFixed(2)} ms）`);
  note('timing-stimulus', `刺激の提示（stimulus）${describe(stim)}`);
  // 分母: 固定長フェーズ = ダブルヒット 5 × 24 試行（注視・刺激・マスク・フィードバック・試行間隔）
  //   + コンボ・リコール 2 × 21 試行（点灯・消灯）+ スタンスチェンジ 3 × 16 試行（構え・フィードバック・試行間隔）= 210。
  // 刺激フェーズ = ダブルヒット 24 + コンボ・リコール 21 = 45（スタンスチェンジの刺激は応答で打ち切るので含まない）
  expect(all.length).toBe(210);
  expect(stim.length).toBe(45);
  expect(all.filter((e) => e <= tol).length / all.length).toBeGreaterThanOrEqual(0.9);
  expect(stim.filter((e) => e <= tol).length / stim.length).toBeGreaterThanOrEqual(0.9);

  // ---- 受け入れ基準 12: ラウンド中の描画が 60 fps を保っているか（rAF の間隔） ----
  note(
    'fps',
    `ラウンド中の rAF ${frames.frames} 回: 平均 ${frames.fps.toFixed(1)} fps、95% 点 ${frames.p95Ms.toFixed(1)} ms、最大 ${frames.maxMs.toFixed(1)} ms、1.5 フレーム超の間隔 ${frames.longFrames} 回（${((100 * frames.longFrames) / Math.max(1, frames.frames)).toFixed(2)}%）`,
  );
  // ラウンドの合計は約 2 分（ダブルヒット 約 42 秒・コンボ・リコール 52.5 秒・スタンスチェンジ 約 30 秒）≒ 7.5 千フレーム
  expect(frames.frames).toBeGreaterThan(6_200);
  expect(frames.fps).toBeGreaterThanOrEqual(55);
  expect(frames.longFrames / frames.frames).toBeLessThanOrEqual(0.05);

  // ---- 受け入れ基準 8: 刺激の提示中に動く・重なる演出が無い、正誤表示は 3 回/秒以下（3 ゲームとも） ----
  note('fx-audit', `刺激提示 ${audit.stimulusPhases} 回で違反 ${audit.violations.length} 件、正誤表示 ${audit.feedbackShown} 回（1 秒あたり最大 ${audit.maxFeedbackPerSecond} 回）`);
  // 刺激の提示は 1 試行に 1 回なので、調べた回数 = 試行数（61）
  expect(audit.stimulusPhases).toBe(logged);
  expect(audit.violations).toEqual([]);
  expect(audit.maxFeedbackPerSecond).toBeLessThanOrEqual(3);

  // ---- 記録画面 ----
  await page.getByTestId('to-records').click();
  await expect(page.getByTestId('records')).toBeVisible();
  await expect(page.getByTestId('records-week')).toContainText('1 / 5');
  // 総合戦闘力・ゲーム別・正答率の3つにデータがある（ベルトは認定戦がまだ無いので空）
  await expect(page.locator('.chart-svg')).toHaveCount(3);
  await expectNoDifficultyControls(page, '記録画面');

  // ---- 再読み込みしても記録が残り、同じ日の2回目は4時間あける ----
  await page.goto('./?test=1#/');
  await expect(page.getByTestId('total-power')).not.toHaveText('0');
  await expect(page.getByTestId('start-session')).toBeDisabled();
  expect(errors).toEqual([]);
});
