import { expect, test } from '@playwright/test';
import { collectErrors, expectNoDifficultyControls, saveData, seedSave } from './helpers';

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
    // 語が無い・select / 数値入力 / スライダーが無い・選べるラジオボタンは演出プリセットだけ
    await expectNoDifficultyControls(page, url);
  }
  // 初回の案内の 3 画面（演出の選択を含む）
  await page.goto('./?test=1&onboarding=1#/welcome');
  for (let step = 1; step <= 3; step++) {
    await expect(page.getByTestId('welcome')).toHaveAttribute('data-step', String(step));
    await expectNoDifficultyControls(page, `初回の案内 ${step} / 3`);
    if (step < 3) await page.getByTestId('welcome-next').click();
  }
  // ゲームの画面（ラウンド中）: 応答ボタンと中断だけ（結果画面はスモークテスト、ラウンド間の画面は認定戦にだけ残るので cert.spec.ts で調べる）
  await page.goto('./?test=1#/play/stance-change');
  await page.getByTestId('start').click();
  await expect.poll(() => page.evaluate(() => window.__bfTest.state().running)).toBe(true);
  await expectNoDifficultyControls(page, 'ゲーム画面（ラウンド中）');
  const buttons = await page.locator('button:visible').evaluateAll((els) => els.map((e) => e.className));
  expect(buttons.every((c) => /resp-btn|quit/.test(c)), buttons.join(' ')).toBe(true);
});

test('設定の「このアプリについて」に免責文がそのまま出る', async ({ page }) => {
  await page.goto('./?test=1#/settings');
  await expect(page.getByTestId('disclaimer')).toHaveText(
    '本アプリは娯楽・自己記録を目的とするゲームです。日常生活の能力向上や疾病の予防・治療を目的・保証するものではありません。医療機器ではありません。',
  );
});
