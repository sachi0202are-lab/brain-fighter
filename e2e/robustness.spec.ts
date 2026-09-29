import { expect, test } from '@playwright/test';
import { collectErrors, saveData, seedSave } from './helpers';

test('localStorage が使えない環境でも起動し、設定画面で知らせる（受け入れ基準 5）', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await page.goto('./?test=1#/');
  await expect(page.getByTestId('total-power')).toHaveText('0');
  await expect(page.getByTestId('start-session')).toBeEnabled();
  await page.goto('./?test=1#/settings');
  await expect(page.getByTestId('storage-unavailable')).toBeVisible();
  expect(errors).toEqual([]);
});

test('難度・補助・スキップを選ぶ操作が無い（受け入れ基準 2）', async ({ page }) => {
  // 認定戦の画面に「受ける」ボタンが出るよう、1ゲームだけ条件（訓練 3 日）を満たした記録を入れておく
  await seedSave(page, saveData({ 'double-hit': { days: 3 } }));
  const screens: [string, string][] = [
    ['./?test=1#/', 'total-power'],
    ['./?test=1#/settings', 'settings'],
    ['./?test=1#/records', 'records'],
    ['./?test=1#/cert', 'cert'],
    ['./?test=1#/cert/run/double-hit', 'cert-ready'],
    ['./?test=1#/welcome', 'welcome'],
    ['./?test=1#/play/double-hit', 'ready'],
    ['./?test=1#/play/combo-recall', 'ready'],
    ['./?test=1#/play/stance-change', 'ready'],
    ['./embed/?test=1#/', 'total-power'],
  ];
  for (const [url, testid] of screens) {
    await page.goto(url);
    await expect(page.getByTestId(testid)).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text, url).not.toMatch(/難易度|難度を選|難度選択|かんたん|簡単モード|スキップ|ヒント|補助|スロー/);
    expect(await page.locator('select').count(), url).toBe(0);
    expect(await page.locator('input[type="range"], input[type="number"]').count(), url).toBe(0);
    // 選べるのは演出プリセットだけ（難度を選ぶラジオボタンは無い）
    const radios = await page.locator('input[type="radio"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
    expect(radios.every((n) => n === 'fx' || n === 'welcome-fx'), url).toBe(true);
  }
});

test('設定の「このアプリについて」に免責文がそのまま出る', async ({ page }) => {
  await page.goto('./?test=1#/settings');
  await expect(page.getByTestId('disclaimer')).toHaveText(
    '本アプリは娯楽・自己記録を目的とするゲームです。日常生活の能力向上や疾病の予防・治療を目的・保証するものではありません。医療機器ではありません。',
  );
});

test('コンボ・リコールの「もう1ラウンド」で4ラウンド目を遊べる', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
  test.setTimeout(15 * 60_000);
  await page.goto('./?test=1&seed=5#/play/combo-recall');
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60 }));
  await page.getByTestId('start').click();
  const any = page.locator('[data-testid="next-round"], [data-testid="extra-round"]');
  for (let k = 0; k < 10; k++) {
    await any.first().waitFor({ state: 'visible', timeout: 120_000 });
    if (await page.getByTestId('extra-round').isVisible()) break;
    await page.getByTestId('next-round').click().catch(() => {});
  }
  await page.getByTestId('extra-round').click();
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.round-item')).toHaveCount(4);
  const rounds = await page.evaluate(() => window.__bfTest.save().rounds.filter((r) => r.kind !== 'warmup').length);
  expect(rounds).toBe(4);
});
