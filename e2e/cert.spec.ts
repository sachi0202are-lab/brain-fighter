/**
 * 認定戦（昇段審査）の E2E（仕様書 第7節・受け入れ基準 6）。
 * - 条件（訓練 3 日以上・前回から 7 日以上）を満たすまでホームにも審査画面にも出ない。
 * - 固定難度（試行ごとの提示時間が変わらない）・未訓練セット・2 ラウンド（試行数は訓練と同じ。スタンスチェンジは 2 × 16）・最小の演出。
 * - 合格でベルト +1、不合格で変化なし。訓練のラウンド・訓練日・戦闘力には数えない。
 * - 訓練の試合は 3 ゲームとも 1 ラウンド（仕様書 v1.2）なので、ラウンド間の画面が出るのは認定戦の 2 ラウンドの間だけ。
 *   その表示（最小の演出・次のラウンドのルールの一言・難度の操作が無いこと = 受け入れ基準 2）もここで確かめる。
 * 保存データは localStorage に直接入れて条件を作る（seedSave）。
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, expectNoDifficultyControls, saveData, seedSave, type BfSave } from './helpers';

/**
 * 審査の開始前の画面で「スタート」を押し、ラウンド間は「次のラウンドへ」で進め、合否（またはゲームごとの結果）が出るまで待つ。
 * 戻り値は通ったラウンド間の画面の数（2 ラウンドなので 1）。onIntermission はラウンド間の画面が出るたびに、閉じる前に呼ばれる。
 */
async function playCert(page: Page, opts: { onIntermission?: () => Promise<void> } = {}): Promise<number> {
  await page.getByTestId('cert-ready').waitFor({ state: 'visible' });
  await page.getByTestId('start').click();
  const any = page.locator('[data-testid="next-round"], [data-testid="cert-game-result"], [data-testid="cert-summary"]');
  let between = 0;
  for (let guard = 0; guard < 10; guard++) {
    await any.first().waitFor({ state: 'visible', timeout: 180_000 });
    if (await page.getByTestId('cert-summary').isVisible()) return between;
    if (await page.getByTestId('cert-game-result').isVisible()) return between;
    between += 1;
    await opts.onIntermission?.();
    await page.getByTestId('next-round').click().catch(() => {
      /* 10 秒で自動的に閉じた直後 */
    });
  }
  return between;
}

const save = (page: Page): Promise<BfSave> => page.evaluate(() => window.__bfTest.save());

test('条件を満たしたゲームだけ挑める。全問正解で合格しベルト +1（訓練の記録には数えない）', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
  test.setTimeout(10 * 60_000);
  const errors = collectErrors(page);
  await seedSave(
    page,
    saveData({
      'double-hit': { days: 3 },
      'combo-recall': { days: 5, belt: 2, lastCertDaysAgo: 3 },
      'stance-change': { days: 2 },
    }),
  );

  // ホーム: 挑めるのはダブルヒットだけ
  await expect(page.getByTestId('cert-ready')).toContainText('ダブルヒット');
  await expect(page.getByTestId('cert-ready')).not.toContainText('コンボ・リコール');
  await page.getByTestId('cert-button').click();
  await expect(page.getByTestId('cert')).toBeVisible();
  await expect(page.getByTestId('cert-start-double-hit')).toBeVisible();
  await expect(page.getByTestId('cert-start-combo-recall')).toHaveCount(0);
  await expect(page.getByTestId('cert-start-stance-change')).toHaveCount(0);
  await expect(page.getByTestId('cert-start-all')).toHaveCount(0);
  await expect(page.locator('.cert-item[data-game="stance-change"]')).toContainText('訓練 2 / 3 日');
  await expect(page.locator('.cert-item[data-game="combo-recall"]')).toContainText('から挑めます');

  // 実施: 全問正解の疑似プレイヤー
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60, correct: () => true }));
  await page.getByTestId('cert-start-double-hit').click();
  await expect(page.getByTestId('cert-run')).toBeVisible();
  // 演出は最小（HP バー・コンボなし）
  await expect(page.locator('.hud-player')).toBeHidden();
  await expect(page.locator('.hud-combo')).toBeHidden();
  // ラウンド間の画面（訓練の試合には無くなり、認定戦にだけ残る）: 文字だけの最小の表示で、難度の操作が無い
  const between = await playCert(page, {
    onIntermission: async () => {
      const panel = page.getByTestId('intermission');
      await expect(panel).toBeVisible();
      await expect(panel.locator('h2')).toHaveText('ラウンド 1 終了');
      await expect(panel).toContainText('次のラウンドも同じ難度です。');
      await expect(panel.getByTestId('round-intro')).toBeVisible();
      await expect(panel.locator('.countdown')).toHaveCount(1);
      await expect(panel.locator('canvas')).toHaveCount(0);
      await expect(panel.locator('.outcome, .telop, [data-testid="special"]')).toHaveCount(0);
      // 合否・正答率はラウンド間では出さない（最後にまとめて）
      await expect(panel).not.toContainText('%');
      await expect(page.locator('.hud-round')).toHaveText('審査 ラウンド 1/2');
      await expectNoDifficultyControls(page, '認定戦のラウンド間');
    },
  });
  expect(between).toBe(1);
  await expect(page.getByTestId('cert-summary')).toBeVisible();
  const verdict = page.getByTestId('cert-verdict');
  await expect(verdict).toHaveAttribute('data-passed', 'true');
  await expect(verdict).toContainText('合格');
  await expect(verdict).toContainText('ラウンド 2');

  const { s, logs } = await page.evaluate(() => ({ s: window.__bfTest.save(), logs: window.__bfTest.logs() }));
  expect(s.certs).toHaveLength(1);
  expect(s.certs[0]).toMatchObject({ gameId: 'double-hit', tier: 1, passed: true });
  expect(s.certs[0]!.rounds).toHaveLength(2);
  expect(s.games['double-hit']!.belt).toBe(1);
  expect(s.games['double-hit']!.lastCertAt).toBeTruthy();
  // 訓練量・戦闘力には数えない
  expect(s.rounds).toHaveLength(0);
  expect(s.games['double-hit']!.trainingDays).toHaveLength(3);
  // 固定難度: 2 ラウンドとも、すべての試行で予定（提示時間を含む）が同じ
  const cert = logs.filter((r) => r.kind === 'cert');
  expect(cert).toHaveLength(2);
  const plans = cert.flatMap((r) => r.trials.map((t) => JSON.stringify(t.plan)));
  expect(new Set(plans).size).toBe(1);

  // ホーム: ベルトが上がり、審査の案内は消える（7 日あける）
  await page.getByTestId('to-home').click();
  await expect(page.locator('.game-card[data-game="double-hit"] .belt-chip')).toHaveAttribute('data-belt', '1');
  await expect(page.getByTestId('cert-ready')).toHaveCount(0);

  // 記録: 認定戦の記録とベルトのグラフ（戦闘力とは別）
  await page.goto('./?test=1#/records');
  await expect(page.locator('[data-testid="cert-history"] li[data-passed="true"]')).toHaveCount(1);
  // いまのベルト: ゲームごとと総合（3本の最低値）
  await expect(page.locator('[data-testid="belts-now"] .belts-row[data-game="double-hit"] .belt-chip')).toHaveAttribute('data-belt', '1');
  await expect(page.locator('[data-testid="belts-now"] .belts-row[data-game="combo-recall"] .belt-chip')).toHaveAttribute('data-belt', '2');
  await expect(page.locator('[data-testid="belts-now"] .belts-total .belt-chip')).toHaveAttribute('data-belt', '0');
  await expect(page.locator('.chart-svg')).toHaveCount(1); // ベルトだけ（訓練の記録は無い）
  expect(errors).toEqual([]);
});

test('全問誤りでは不合格でベルトは変わらない。まとめて受けると順に続けて行う', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'モバイルのプロジェクトだけで実行する');
  test.setTimeout(12 * 60_000);
  const errors = collectErrors(page);
  await seedSave(page, saveData({ 'double-hit': { days: 4, belt: 3 }, 'stance-change': { days: 3, belt: 1 } }));
  await page.goto('./?test=1#/cert');
  await expect(page.getByTestId('cert-start-all')).toContainText('2 ゲーム');
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60, correct: () => false }));
  await page.getByTestId('cert-start-all').click();

  await playCert(page);
  await expect(page.getByTestId('cert-game-result')).toBeVisible();
  await expect(page.getByTestId('cert-verdict')).toHaveAttribute('data-passed', 'false');
  await page.getByTestId('cert-next').click();
  await playCert(page);
  await expect(page.getByTestId('cert-summary')).toBeVisible();
  await expect(page.locator('[data-testid="cert-verdict"][data-passed="false"]')).toHaveCount(2);

  const s = await save(page);
  expect(s.certs.map((c) => [c.gameId, c.tier, c.passed, c.rounds.length])).toEqual([
    ['double-hit', 4, false, 2],
    ['stance-change', 2, false, 2],
  ]);
  // 試行数は訓練と同じ（ダブルヒット 24、スタンスチェンジ 16）。全問誤りなので正答 0
  expect(s.certs.map((c) => c.rounds.map((r) => `${r.correct}/${r.trials}`))).toEqual([
    ['0/24', '0/24'],
    ['0/16', '0/16'],
  ]);
  expect(s.games['double-hit']!.belt).toBe(3);
  expect(s.games['stance-change']!.belt).toBe(1);
  expect(s.rounds).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('1ラウンド目を始めたあとで中断すると「不合格（中断）」として残り、7 日は挑めない', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
  await seedSave(page, saveData({ 'combo-recall': { days: 3 } }));
  await page.goto('./?test=1#/cert/run/combo-recall');
  await expect(page.getByTestId('cert-ready')).toBeVisible();
  // ルールの一言（固定難度・未訓練セットで。コンボ・リコールは「何個前か」）
  await expect(page.getByTestId('cert-ready').getByTestId('round-intro')).toBeVisible();
  // 開始前にやめるだけなら記録は残らない
  await page.getByTestId('cert-cancel').click();
  await expect(page.getByTestId('cert')).toBeVisible();
  expect((await save(page)).certs).toHaveLength(0);

  await page.getByTestId('cert-start-combo-recall').click();
  await page.getByTestId('start').click();
  await expect.poll(async () => (await save(page)).certs.length).toBe(1);
  page.once('dialog', (d) => void d.accept());
  await page.locator('.quit').click();
  await expect(page.getByTestId('cert')).toBeVisible();
  const s = await save(page);
  expect(s.certs[0]).toMatchObject({ gameId: 'combo-recall', passed: false });
  expect(s.certs[0]!.rounds.length).toBeLessThan(2);
  await expect(page.locator('.cert-item[data-game="combo-recall"]')).toContainText('から挑めます');
  await page.goto('./?test=1#/records');
  await expect(page.getByTestId('cert-history')).toContainText('不合格（中断）');
});

test('認定戦でも刺激領域のタップで答えられる（ダブルヒットの 8 方向。タップの判定にも審査のラウンドの情報が渡る）', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
  const errors = collectErrors(page);
  await seedSave(page, saveData({ 'double-hit': { days: 3 } }));
  await page.goto('./?test=1#/cert/run/double-hit');
  await page.getByTestId('start').click();
  // 最初の試行の応答画面まで待ち、刺激領域の上の方（中心から半径の 6 割）をタップする
  await page.waitForFunction(
    () => {
      const s = window.__bfTest.state().snapshot;
      return s !== null && s.accepting && s.phase === 'response';
    },
    undefined,
    { timeout: 60_000, polling: 'raf' },
  );
  const box = await page.getByTestId('stimulus').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * 0.2);
  const snap = await page.evaluate(() => window.__bfTest.state().snapshot);
  expect(snap?.i).toBe(0);
  expect(Object.keys(snap?.selection ?? {})).toHaveLength(1);
  expect(errors).toEqual([]);
});
