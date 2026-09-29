import { expect, test } from '@playwright/test';
import { collectErrors } from './helpers';

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

test('難度・補助・スキップを選ぶ操作が無い（受け入れ基準 2 の一部）', async ({ page }) => {
  const screens: [string, string][] = [
    ['#/', 'total-power'],
    ['#/settings', 'settings'],
    ['#/records', 'records'],
    ['#/cert', 'cert'],
    ['#/play/double-hit', 'ready'],
    ['#/play/combo-recall', 'ready'],
    ['#/play/stance-change', 'ready'],
  ];
  for (const [hash, testid] of screens) {
    await page.goto(`./?test=1${hash}`);
    await expect(page.getByTestId(testid)).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text, hash).not.toMatch(/難易度|難度を選|難度選択|かんたん|簡単モード|スキップ|ヒント|補助|スロー/);
    expect(await page.locator('select').count(), hash).toBe(0);
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
