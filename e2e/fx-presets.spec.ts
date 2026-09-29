/**
 * 演出プリセットの見え方と安全性（仕様書 9.1・9.3・9.5、受け入れ基準 8）。
 * - Off: 課題と正誤の色だけ（HP バー・KO 表示・ファイター・コンボ・背景なし）
 * - Light: 静的な HP バー・ラウンド間の簡単な演出（静止画のファイター＋KO / PERFECT）・結果画面の KO / PERFECT
 * - Full: Light ＋ コンボ表示・ラウンド間の必殺演出（技名テロップ）・静的なカスタム背景
 * どのプリセットでも、刺激の提示中に刺激領域の中・周りで動く演出や重なる要素が無く、正誤表示は 3 回/秒以下。
 * KO してもラウンドは最後まで続く。
 * ラウンド間の演出はコンボ・リコール（3 ラウンド）で見る。スタンスチェンジは 1 ラウンドだけ（仕様書 v1.1）なので
 * ラウンド間の画面が無く、結果画面の出し方（「一本勝負」、見出しに × 1 を付けない）を別に確かめる。
 * （試行数・提示時間などがプリセットで変わらないことは fx-equivalence.spec.ts と Vitest で照合している）
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors } from './helpers';

type Fx = 'off' | 'light' | 'full';
const ROUND_END = '[data-testid="intermission"][data-outcome="perfect"], [data-testid="intermission"][data-outcome="ko"]';
/** ラウンド間の演出を見るゲーム（3 ラウンド。n = 1 の 1 ラウンドは 21 試行・52.5 秒） */
const INTERMISSION_GAME = 'combo-recall';

async function start(page: Page, fx: Fx, gameId: string = INTERMISSION_GAME): Promise<void> {
  await page.goto(`./?test=1&seed=21&fx=${fx}#/play/${gameId}`);
  await expect(page.locator(`.play.fx-${fx}`)).toBeVisible();
  await page.evaluate(() => {
    window.__bfTest.startFxAudit();
    window.__bfTest.autoplay({ delayMs: 60, correct: () => true });
  });
  await page.getByTestId('start').click();
}

/** 最初の本ラウンドを終えたラウンド間の画面まで進める（KO / PERFECT でない画面が出たら「次のラウンドへ」で閉じる） */
async function toFirstRoundEnd(page: Page): Promise<void> {
  const target = page.locator(ROUND_END);
  const any = page.getByTestId('intermission');
  for (let guard = 0; guard < 5; guard++) {
    await any.waitFor({ state: 'visible', timeout: 240_000 });
    if (await target.isVisible()) return;
    await page.getByTestId('next-round').click().catch(() => {});
    await any.waitFor({ state: 'hidden' }).catch(() => {});
  }
  await expect(target).toBeVisible();
}

async function expectSafeAudit(page: Page): Promise<void> {
  const r = await page.evaluate(() => window.__bfTest.fxAuditReport());
  const description = `刺激提示 ${r.stimulusPhases} 回で違反 ${r.violations.length} 件、正誤表示 ${r.feedbackShown} 回（1 秒あたり最大 ${r.maxFeedbackPerSecond} 回）`;
  test.info().annotations.push({ type: 'fx-audit', description });
  console.log(`[fx-audit] ${test.info().title}: ${description}`);
  expect(r.stimulusPhases).toBeGreaterThan(0);
  expect(r.violations).toEqual([]);
  expect(r.feedbackShown).toBeGreaterThan(0);
  expect(r.maxFeedbackPerSecond).toBeLessThanOrEqual(3);
}

test.describe('演出プリセット', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
    test.setTimeout(12 * 60_000);
  });

  test('Off: 課題と正誤の色だけ（HP バー・KO・ファイター・コンボなし）', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'off');
    await toFirstRoundEnd(page);
    await expect(page.locator('.hud-player')).toBeHidden();
    await expect(page.locator('.hud-combo')).toBeHidden();
    const panel = page.locator(ROUND_END);
    await expect(panel.locator('canvas')).toHaveCount(0);
    await expect(panel.locator('.outcome')).toHaveCount(0);
    await expect(panel.locator('.telop')).toHaveCount(0);
    await expectSafeAudit(page);
    expect(errors).toEqual([]);
  });

  test('Light: 静的な HP バー・ラウンド間の簡単な演出。KO してもラウンドは最後まで続く', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'light');
    // 敵の HP が 0 になった（KO）時点でも、ラウンドはまだ続いている
    await page.waitForFunction(
      () => (document.querySelector('.hud-enemy .hp-fill') as HTMLElement | null)?.style.width === '0%',
      undefined,
      { timeout: 240_000, polling: 'raf' },
    );
    const st = await page.evaluate(() => window.__bfTest.state());
    expect(st.running).toBe(true);
    await expect(page.locator('.hud-player')).toBeVisible();
    await expect(page.locator('.hud-combo')).toBeHidden();
    await toFirstRoundEnd(page);
    const panel = page.locator(ROUND_END);
    await expect(panel.locator('canvas.fighters:not(.special)')).toHaveCount(1);
    await expect(panel.getByTestId('special')).toHaveCount(0);
    await expect(panel.locator('.outcome-logo')).toBeVisible();
    await expect(panel.locator('.telop')).toHaveCount(0);
    // 全試行を終えてからラウンドが終わっている
    const logs = await page.evaluate(() => window.__bfTest.logs());
    const r1 = logs.find((r) => r.kind === 'round' && r.roundNo === 1);
    expect(r1?.trials.every((t) => t.correct)).toBe(true);
    expect(r1!.trials.map((t) => t.i)).toEqual(r1!.trials.map((_, k) => k));
    await expectSafeAudit(page);
    expect(errors).toEqual([]);
  });

  test('Full: コンボ表示・ラウンド間の必殺演出・静的な背景。結果画面に KO / PERFECT', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'full');
    await expect(page.locator('.hud-combo')).toBeVisible({ timeout: 240_000 });
    const art = await page.locator('.play.fx-full').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--stage-art'));
    expect(art).toContain('data:image/svg+xml');
    await toFirstRoundEnd(page);
    const panel = page.locator(ROUND_END);
    await expect(panel.getByTestId('special')).toBeVisible();
    await expect(panel.locator('.telop')).toBeVisible();
    await expect(panel.locator('.outcome-logo')).toBeVisible();

    // 最後まで進めて結果画面へ
    for (let guard = 0; guard < 20; guard++) {
      await page.locator('[data-testid="next-round"], [data-testid="to-result"], [data-testid="result"]').first().waitFor({ state: 'visible', timeout: 240_000 });
      if (await page.getByTestId('result').isVisible()) break;
      if (await page.getByTestId('to-result').isVisible()) await page.getByTestId('to-result').click();
      else await page.getByTestId('next-round').click().catch(() => {});
    }
    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('result-headline')).toContainText(/PERFECT|KO/);
    await expectSafeAudit(page);

    // 出荷した CSS: 繰り返すアニメーションは 1 周 1/3 秒以上、刺激領域には動きを付けない
    const cssIssues = await page.evaluate(() => {
      const issues: string[] = [];
      const toMs = (v: string): number => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
      const walk = (rules: CSSRuleList): void => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            const st = rule.style;
            const counts = st.animationIterationCount ? st.animationIterationCount.split(',').map((x) => x.trim()) : [];
            const durs = st.animationDuration ? st.animationDuration.split(',').map((x) => x.trim()) : [];
            counts.forEach((c, k) => {
              const repeats = c === 'infinite' || Number(c) > 1;
              const d = durs[k] ?? durs[0] ?? '0s';
              if (repeats && !(toMs(d) >= 1000 / 3)) issues.push(`${rule.selectorText}: ${c} × ${d}`);
            });
            if (/\.stim(?![-\w])|\.stim-wrap/.test(rule.selectorText)) {
              if ((st.animationName && st.animationName !== 'none') || (st.transitionProperty && st.transitionDuration && toMs(st.transitionDuration) > 0)) {
                issues.push(`${rule.selectorText}: 刺激領域に動き`);
              }
            }
          } else if ('cssRules' in rule) {
            walk((rule as CSSGroupingRule).cssRules);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
      return issues;
    });
    expect(cssIssues).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('1 ラウンドだけの試合（スタンスチェンジ）: ラウンド間の画面を出さずに結果へ。「一本勝負」、見出しは × 1 を付けない', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'light', 'stance-change');
    // 上帯は「ラウンド 1/1」ではなく「一本勝負」
    await expect(page.locator('.hud-round')).toHaveText('一本勝負');
    await expect(page.locator('.hud-enemy')).toBeVisible();
    // 最初に出るのが結果画面（ラウンド間の画面・「もう1ラウンド」の確認は無い）
    await page
      .locator('[data-testid="next-round"], [data-testid="to-result"], [data-testid="result"]')
      .first()
      .waitFor({ state: 'visible', timeout: 240_000 });
    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByTestId('next-round')).toHaveCount(0);
    await expect(page.getByTestId('to-result')).toHaveCount(0);
    const logs = await page.evaluate(() => window.__bfTest.logs());
    expect(logs.map((r) => `${r.kind}:${r.roundNo}:${r.trials.length}`)).toEqual(['round:1:30']);
    expect(logs[0]!.trials.every((t) => t.correct)).toBe(true);
    // 結果画面: 見出しは「PERFECT」（「PERFECT × 1」にしない）、ラウンドの行は 1 つで「一本勝負」
    const result = page.getByTestId('result');
    await expect(page.getByTestId('result-headline')).toHaveText('PERFECT');
    await expect(result.locator('.card-title').first()).toHaveText('ラウンドの結果');
    await expect(result.locator('.round-item')).toHaveCount(1);
    await expect(result.locator('.round-item .round-no')).toHaveText('一本勝負');
    await expect(result.locator('.round-item .round-outcome')).toHaveText('PERFECT');
    await expect(result.locator('canvas.fighters')).toHaveCount(1);
    // 戦闘力: ステップ 1・正答率 100% → round(1000 × ((1 − 1) + 1) / 20) = 50。1 ラウンドでも適応してステップ 2 へ
    await expect(result.locator('.stat', { hasText: '戦闘力' }).locator('.stat-value')).toHaveText('0 → 50（+50）');
    const save = await page.evaluate(() => window.__bfTest.save());
    expect(save.rounds.map((r) => [r.gameId, r.kind ?? 'round', r.trials, r.correct, r.power])).toEqual([['stance-change', 'round', 30, 30, 50]]);
    expect(save.games['stance-change']!.state.step).toBe(2);
    await expectSafeAudit(page);
    expect(errors).toEqual([]);
  });
});
