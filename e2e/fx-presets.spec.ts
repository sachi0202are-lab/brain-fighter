/**
 * 演出プリセットの見え方と安全性（仕様書 9.1・9.3・9.5、受け入れ基準 8）。
 * - Off: 課題と正誤の色だけ（HP バー・KO 表示・ファイター・コンボ・背景なし）
 * - Light: 静的な HP バー・結果画面の簡単な演出（静止画のファイター＋KO / PERFECT の見出し）
 * - Full: Light ＋ コンボ表示・結果画面の必殺演出（技名テロップ）・静的なカスタム背景
 * 訓練は 1 試合 1 ラウンド（仕様書 v1.2）なのでラウンド間の画面は無く、KO / PERFECT の演出は結果画面で調べる。
 * どのプリセットでも、刺激の提示中に刺激領域の中・周りで動く演出や重なる要素が無く、正誤表示は 3 回/秒以下。
 * KO してもラウンドは最後まで続く。
 * （試行数・提示時間などがプリセットで変わらないことは fx-equivalence.spec.ts と Vitest で照合している）
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors } from './helpers';

type Fx = 'off' | 'light' | 'full';
/** KO / PERFECT で終えた試合の結果画面 */
const WON = '[data-testid="result"][data-outcome="perfect"], [data-testid="result"][data-outcome="ko"]';

async function start(page: Page, fx: Fx): Promise<void> {
  await page.goto(`./?test=1&seed=21&fx=${fx}#/play/stance-change`);
  await expect(page.locator(`.play.fx-${fx}`)).toBeVisible();
  await page.evaluate(() => {
    window.__bfTest.startFxAudit();
    window.__bfTest.autoplay({ delayMs: 60, correct: () => true });
  });
  await page.getByTestId('start').click();
}

/** 全問正解で 1 ラウンド（16 試行）を終え、PERFECT の結果画面まで進める（ラウンド間の画面は無い） */
async function toResult(page: Page): Promise<void> {
  await page.getByTestId('result').waitFor({ state: 'visible', timeout: 240_000 });
  await expect(page.locator(WON)).toBeVisible();
}

async function expectSafeAudit(page: Page): Promise<void> {
  const r = await page.evaluate(() => window.__bfTest.fxAuditReport());
  const description = `刺激提示 ${r.stimulusPhases} 回で違反 ${r.violations.length} 件、正誤表示 ${r.feedbackShown} 回（1 秒あたり最大 ${r.maxFeedbackPerSecond} 回）`;
  test.info().annotations.push({ type: 'fx-audit', description });
  console.log(`[fx-audit] ${test.info().title}: ${description}`);
  expect(r.stimulusPhases).toBe(16);
  expect(r.violations).toEqual([]);
  expect(r.feedbackShown).toBeGreaterThan(0);
  expect(r.maxFeedbackPerSecond).toBeLessThanOrEqual(3);
}

test.describe('演出プリセット', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
    test.setTimeout(6 * 60_000);
  });

  test('Off: 課題と正誤の色だけ（HP バー・KO・ファイター・コンボなし）', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'off');
    await expect(page.locator('.hud-player')).toBeHidden();
    await expect(page.locator('.hud-combo')).toBeHidden();
    await toResult(page);
    const result = page.getByTestId('result');
    await expect(result.locator('canvas')).toHaveCount(0);
    await expect(result.getByTestId('result-headline')).toHaveCount(0);
    await expect(result.locator('.outcome, .round-outcome')).toHaveCount(0);
    await expect(result.locator('.telop')).toHaveCount(0);
    await expectSafeAudit(page);
    expect(errors).toEqual([]);
  });

  test('Light: 静的な HP バー・結果画面の簡単な演出。KO してもラウンドは最後まで続く', async ({ page }) => {
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
    // 上帯のラウンドは「ラウンド 1/1」ではなく「一本勝負」
    await expect(page.locator('.hud-round')).toHaveText('一本勝負');
    await expect(page.locator('.hud-player')).toBeVisible();
    await expect(page.locator('.hud-combo')).toBeHidden();
    await toResult(page);
    const result = page.getByTestId('result');
    await expect(result.locator('canvas.fighters:not(.special)')).toHaveCount(1);
    await expect(result.getByTestId('special')).toHaveCount(0);
    // 1 試合 1 ラウンドなので見出しは数を付けない（「PERFECT × 1」ではなく「PERFECT」）
    await expect(result.getByTestId('result-headline')).toHaveText('PERFECT');
    await expect(result.locator('.telop')).toHaveCount(0);
    // 結果画面: ラウンドの行は 1 つで「一本勝負」、見出しは「ラウンドの結果」。PERFECT なので「次は ◯ 問正解で KO」は出ない
    await expect(result.locator('.round-item')).toHaveCount(1);
    await expect(result.locator('.round-item .round-no')).toHaveText('一本勝負');
    await expect(result.locator('.round-item .round-outcome')).toHaveText('PERFECT');
    await expect(result.getByTestId('ko-next')).toHaveCount(0);
    // 全試行（16）を終えてからラウンドが終わっている
    const logs = await page.evaluate(() => window.__bfTest.logs());
    expect(logs.map((r) => `${r.kind}:${r.roundNo}`)).toEqual(['round:1']);
    const r1 = logs[0]!;
    expect(r1.trials).toHaveLength(16);
    expect(r1.trials.every((t) => t.correct)).toBe(true);
    expect(r1.trials.map((t) => t.i)).toEqual(r1.trials.map((_, k) => k));
    await expectSafeAudit(page);
    expect(errors).toEqual([]);
  });

  test('Full: コンボ表示・静的な背景。結果画面に必殺演出・技名テロップ・KO / PERFECT', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'full');
    await expect(page.locator('.hud-combo')).toBeVisible({ timeout: 240_000 });
    const art = await page.locator('.play.fx-full').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--stage-art'));
    expect(art).toContain('data:image/svg+xml');
    await toResult(page);
    const result = page.getByTestId('result');
    await expect(result.getByTestId('special')).toBeVisible();
    await expect(result.locator('canvas')).toHaveCount(1);
    await expect(result.locator('.telop')).toBeVisible();
    await expect(result.getByTestId('result-headline')).toContainText(/PERFECT|KO/);
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
});
