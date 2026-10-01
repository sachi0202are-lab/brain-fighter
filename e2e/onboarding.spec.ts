/**
 * 初回オンボーディング（仕様書 第10節 8・第12節）と、保存の受け入れ基準 5（画面からのエクスポート → 全消去 → インポート）。
 * オンボーディングは ?test=1 では出さない設計（既存のテストの流れを変えない）なので、ここでは ?test=1 を付けずに開く。
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { collectErrors, saveData, seedSave } from './helpers';

const DISCLAIMER =
  '本アプリは娯楽・自己記録を目的とするゲームです。日常生活の能力向上や疾病の予防・治療を目的・保証するものではありません。医療機器ではありません。';

test('初回は 3 画面の案内 → 演出を選んでホームへ。2 回目からは出ない', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./#/');
  const w = page.getByTestId('welcome');
  await expect(w).toHaveAttribute('data-step', '1');
  await expect(w).toContainText('1 / 3');
  await expect(w).toContainText('毎日 4 分ほど、3 つのミニゲームで戦闘力を上げよう');
  await expect(w).toContainText(DISCLAIMER);
  await page.getByTestId('welcome-next').click();
  await expect(w).toHaveAttribute('data-step', '2');
  // 3 ゲームとも 1 試合 1 ラウンド（仕様書 v1.2。上帯の「一本勝負」と同じ言い方）
  await expect(w).toContainText('1 試合ずつ遊びます（1 試合は 1 分前後の一本勝負）');
  await page.getByTestId('welcome-next').click();
  await expect(w).toHaveAttribute('data-step', '3');
  // 演出の選択（既定 Light）。もどっても選び直せる
  await expect(page.getByTestId('welcome-fx-light')).toBeChecked();
  await page.getByTestId('welcome-back').click();
  await expect(w).toHaveAttribute('data-step', '2');
  await page.getByTestId('welcome-next').click();
  await page.getByTestId('welcome-fx-full').check();
  // 難度・補助・スキップの操作や語が無い（受け入れ基準 2）
  expect(await page.locator('body').innerText()).not.toMatch(/難易度|難度を選|難度選択|かんたん|簡単モード|スキップ|ヒント|補助|スロー/);
  await page.getByTestId('welcome-start').click();

  await expect(page.getByTestId('total-power')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('brain-fighter.v1') ?? '{}'));
  expect(saved.settings.fx).toBe('full');
  expect(typeof saved.onboardedAt).toBe('string');

  await page.reload();
  await expect(page.getByTestId('total-power')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);

  // 設定の「このアプリについて」からもう一度見られる（免責文は常設）
  await page.goto('./#/settings');
  await expect(page.getByTestId('disclaimer')).toHaveText(DISCLAIMER);
  await page.getByTestId('welcome-again').click();
  await expect(page.getByTestId('welcome')).toBeVisible();
  expect(errors).toEqual([]);
});

test('記録のある人（案内より前から使っている人）には案内を出さない', async ({ page }) => {
  const data = saveData();
  delete (data as { onboardedAt?: string }).onboardedAt;
  (data as { certs: unknown[] }).certs = [
    { id: 'c0', gameId: 'double-hit', at: new Date(Date.now() - 10 * 86_400_000).toISOString(), tier: 1, rounds: [], passed: false },
  ];
  await seedSave(page, data, './#/settings');
  await page.goto('./#/');
  await expect(page.getByTestId('total-power')).toBeVisible();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});

test('画面から エクスポート → 全消去 → インポート で記録が完全に戻る（受け入れ基準 5）', async ({ page }) => {
  const now = Date.now();
  const at = (minAgo: number): string => new Date(now - minAgo * 60_000).toISOString();
  const data = saveData(
    { 'double-hit': { days: 3, belt: 2, state: { T: 150.5, stage: 1 }, lastCertDaysAgo: 8 }, 'combo-recall': { days: 1, state: { n: 3 } } },
    {
      rounds: [
        {
          id: 'r1',
          gameId: 'double-hit',
          startedAt: at(90),
          fx: 'full',
          paramsStart: { T: 160, stage: 1 },
          paramsEnd: { T: 150.5, stage: 1 },
          trials: 24,
          correct: 19,
          errors: { dir: 3, stance: 2 },
          rtMedianMs: 612.4,
          power: 321,
          matchId: 'm1',
          roundNo: 1,
          maxCombo: 7,
          seed: 42,
          frameMs: 16.667,
          metrics: { tMedian: 155 },
        },
      ],
      certs: [
        { id: 'c1', gameId: 'double-hit', at: at(8 * 24 * 60), tier: 2, rounds: [{ trials: 24, correct: 20 }, { trials: 24, correct: 21 }], passed: true },
      ],
      trials: [{ roundId: 'r1', i: 0, onsetMs: 812.3, stim: 'x', resp: 'a', rtMs: 431.2, correct: true, plan: { stimulus: 150 }, stimMs: 150.1 }],
      sessions: [{ id: 's1', startedAt: at(95), endedAt: at(80), order: ['double-hit', 'combo-recall', 'stance-change'], done: ['double-hit'] }],
    },
  );
  (data as { settings: object }).settings = { fx: 'off', sound: false, colorSafe: true, bgm: false };
  await seedSave(page, data, './?test=1#/settings');
  const original = JSON.parse((await page.evaluate(() => localStorage.getItem('brain-fighter.v1'))) as string);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  expect(download.suggestedFilename()).toMatch(/^brain-fighter-\d{8}\.json$/);
  const text = readFileSync((await download.path()) as string, 'utf8');
  expect(JSON.parse(text)).toEqual(original);

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('clear').click();
  await expect(page.getByTestId('settings-status')).toHaveText('消去しました。');
  expect(await page.evaluate(() => localStorage.getItem('brain-fighter.v1'))).toBeNull();

  await page.getByTestId('import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByTestId('import-preview')).toContainText('訓練ラウンド 1 本');
  await expect(page.getByTestId('import-preview')).toContainText('総合戦闘力 321');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('import-replace').click();
  await expect(page.getByTestId('settings-status')).toHaveText('置き換えました。');
  const restored = JSON.parse((await page.evaluate(() => localStorage.getItem('brain-fighter.v1'))) as string);
  expect(restored).toEqual(original);

  // 再読み込みしても戻ったまま（ベルト・戦闘力）
  await page.goto('./?test=1#/');
  await page.reload();
  await expect(page.getByTestId('total-power')).toHaveText('321');
  await expect(page.locator('.game-card[data-game="double-hit"] .belt-chip')).toHaveAttribute('data-belt', '2');
});
