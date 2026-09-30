/**
 * 演出プリセットの見え方と安全性（仕様書 9.1・9.3・9.5、受け入れ基準 8）。
 * - Off: 課題と正誤の色だけ（HP バー・KO 表示・ファイター・コンボ・背景なし）
 * - Light: 静的な HP バー・短い正誤音・結果画面の KO / PERFECT と静止画のファイター
 * - Full: Light ＋ コンボ表示・静的なカスタム背景
 * どのプリセットでも、刺激の提示中に刺激領域の中・周りで動く演出や重なる要素が無く、正誤表示は 3 回/秒以下。
 * KO してもラウンドは最後まで続く。
 *
 * 仕様書 v1.2 から 3 ゲームとも 1 試合 1 ラウンドなので、日次の試合ではラウンド間の画面が出ない（Light のラウンド間の
 * ファイターと KO ロゴ、Full の必殺演出と技名テロップは、日次の試合では出番が無い）。ここでは 3 ゲームを 1 つずつ
 * 別のプリセットで最後まで遊び、「ラウンド間の画面なしで結果へ」「上帯と結果画面は『一本勝負』、見出しは × 1 を付けない」を確かめる。
 * - ラウンド間の演出の安全性（必殺演出は一度だけ動いて止まり点滅しない・背景は静的・CSS の点滅の上限）は Vitest の
 *   src/skin/effects.test.ts、1 ラウンドの試合でラウンド間を呼ばないことは src/engine/match.test.ts と各ゲームの match.test.ts で確かめる。
 * - 残っている唯一のラウンド間の画面（認定戦の 2 ラウンドの間。演出は最小）は cert.spec.ts で確かめる。
 * （試行数・提示時間などがプリセットで変わらないことは fx-equivalence.spec.ts と Vitest で照合している）
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors } from './helpers';

type Fx = 'off' | 'light' | 'full';
type GameId = 'double-hit' | 'combo-recall' | 'stance-change';

/** 開始して、自動プレイで最後まで答えさせる（wrongAt の試行だけ誤る。null なら全問正解） */
async function start(page: Page, fx: Fx, gameId: GameId, wrongAt: number | null = null): Promise<void> {
  await page.goto(`./?test=1&seed=21&fx=${fx}#/play/${gameId}`);
  await expect(page.locator(`.play.fx-${fx}`)).toBeVisible();
  await page.evaluate((w) => {
    window.__bfTest.startFxAudit();
    window.__bfTest.autoplay({ delayMs: 60, correct: (i) => i !== w });
  }, wrongAt ?? -1);
  await page.getByTestId('start').click();
  // 上帯のラウンドは「ラウンド 1/1」ではなく「一本勝負」
  await expect(page.locator('.hud-round')).toHaveText('一本勝負');
}

/** 1 ラウンドを終えて最初に出るのが結果画面であること（ラウンド間の画面・「もう1ラウンド」の確認は無い） */
async function expectResultWithoutIntermission(page: Page, gameId: GameId, trials: number): Promise<void> {
  await page
    .locator('[data-testid="next-round"], [data-testid="to-result"], [data-testid="result"]')
    .first()
    .waitFor({ state: 'visible', timeout: 240_000 });
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('next-round')).toHaveCount(0);
  await expect(page.getByTestId('to-result')).toHaveCount(0);
  const logs = await page.evaluate(() => window.__bfTest.logs());
  expect(logs.map((r) => `${r.gameId}:${r.kind}:${r.roundNo}:${r.trials.length}`)).toEqual([`${gameId}:round:1:${trials}`]);
  // 全試行を終えてからラウンドが終わっている（KO で打ち切らない）
  expect(logs[0]!.trials.map((t) => t.i)).toEqual(Array.from({ length: trials }, (_, k) => k));
  // 結果画面: ラウンドの行は 1 つで「一本勝負」、カードの見出しは「ラウンドの結果」
  const result = page.getByTestId('result');
  await expect(result.locator('.card-title').first()).toHaveText('ラウンドの結果');
  await expect(result.locator('.round-item')).toHaveCount(1);
  await expect(result.locator('.round-item .round-no')).toHaveText('一本勝負');
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

const powerText = (page: Page) => page.getByTestId('result').locator('.stat', { hasText: '戦闘力' }).locator('.stat-value');

test.describe('演出プリセット', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
    test.setTimeout(8 * 60_000);
  });

  test('Off（ダブルヒット）: 課題と正誤の色だけ（HP バー・コンボ・KO・ファイターなし）。ラウンド間の画面なしで結果へ', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'off', 'double-hit');
    await expect(page.locator('.hud-player')).toBeHidden();
    await expect(page.locator('.hud-enemy')).toBeHidden();
    await expect(page.locator('.hud-combo')).toBeHidden();
    await expectResultWithoutIntermission(page, 'double-hit', 24);
    const result = page.getByTestId('result');
    // 結果画面にも KO / PERFECT の見出し・ロゴ・ファイターを出さない
    await expect(page.getByTestId('result-headline')).toHaveCount(0);
    await expect(result.locator('.round-outcome')).toHaveCount(0);
    await expect(result.locator('canvas')).toHaveCount(0);
    // 戦闘力: 全問正解で T = 300 × 0.93^24 ≒ 52.6 ms（ステージ 0）→ round(200 × ln(500 / 52.6) / ln(500 / 33)) = 166
    await expect(powerText(page)).toHaveText('0 → 166（+166）');
    await expectSafeAudit(page);
    expect(errors).toEqual([]);
  });

  test('Light（コンボ・リコール）: 静的な HP バー。KO してもラウンドは最後まで続き、結果画面は「KO」（× 1 なし）', async ({ page }) => {
    const errors = collectErrors(page);
    // 6 試行目（i = 5）だけ誤る → 21 試行中 20 正答（KO。初回の敵 HP は ceil(21 × 0.75) = 16）
    await start(page, 'light', 'combo-recall', 5);
    await expect(page.locator('.hud-player')).toBeVisible();
    await expect(page.locator('.hud-enemy')).toBeVisible();
    await expect(page.locator('.hud-combo')).toBeHidden();
    // 敵の HP が 0 になった（KO）時点でも、ラウンドはまだ続いている
    await page.waitForFunction(
      () => (document.querySelector('.hud-enemy .hp-fill') as HTMLElement | null)?.style.width === '0%',
      undefined,
      { timeout: 240_000, polling: 'raf' },
    );
    const st = await page.evaluate(() => window.__bfTest.state());
    expect(st.running).toBe(true);
    expect(st.snapshot!.i).toBeLessThan(20);
    await expectResultWithoutIntermission(page, 'combo-recall', 21);
    const result = page.getByTestId('result');
    await expect(page.getByTestId('result-headline')).toHaveText('KO');
    await expect(result.locator('.round-item .round-outcome')).toHaveText('KO');
    // 静止画のファイター（必殺演出と技名テロップはラウンド間だけのもので、結果画面には出ない）
    await expect(result.locator('canvas.fighters')).toHaveCount(1);
    await expect(result.getByTestId('special')).toHaveCount(0);
    await expect(result.locator('.telop')).toHaveCount(0);
    // 戦闘力: n = 1・誤り 1（≤ 2 で sub = 1）→ round(1000 × 1 / 9) = 111。1 ラウンドでも適応して次の試合は n = 2
    await expect(powerText(page)).toHaveText('0 → 111（+111）');
    const save = await page.evaluate(() => window.__bfTest.save());
    expect(save.rounds.map((r) => [r.gameId, r.kind ?? 'round', r.trials, r.correct, r.power])).toEqual([['combo-recall', 'round', 21, 20, 111]]);
    expect(save.games['combo-recall']!.state.n).toBe(2);
    await expectSafeAudit(page);
    expect(errors).toEqual([]);
  });

  test('Full（スタンスチェンジ）: コンボ表示・静的な背景。結果画面は「PERFECT」（× 1 なし）と静止画のファイター', async ({ page }) => {
    const errors = collectErrors(page);
    await start(page, 'full', 'stance-change');
    await expect(page.locator('.hud-enemy')).toBeVisible();
    await expect(page.locator('.hud-combo')).toBeVisible({ timeout: 60_000 });
    const art = await page.locator('.play.fx-full').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--stage-art'));
    expect(art).toContain('data:image/svg+xml');
    await expectResultWithoutIntermission(page, 'stance-change', 30);
    const result = page.getByTestId('result');
    await expect(page.getByTestId('result-headline')).toHaveText('PERFECT');
    await expect(result.locator('.round-item .round-outcome')).toHaveText('PERFECT');
    await expect(result.locator('canvas.fighters')).toHaveCount(1);
    await expect(result.getByTestId('special')).toHaveCount(0);
    await expect(result.locator('.telop')).toHaveCount(0);
    // 戦闘力: ステップ 1・正答率 100% → round(1000 × ((1 − 1) + 1) / 20) = 50。1 ラウンドでも適応してステップ 2 へ
    await expect(powerText(page)).toHaveText('0 → 50（+50）');
    const save = await page.evaluate(() => window.__bfTest.save());
    expect(save.rounds.map((r) => [r.gameId, r.kind ?? 'round', r.trials, r.correct, r.power])).toEqual([['stance-change', 'round', 30, 30, 50]]);
    expect(save.games['stance-change']!.state.step).toBe(2);
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
