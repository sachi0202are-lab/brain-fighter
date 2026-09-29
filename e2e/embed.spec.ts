/**
 * ブログ埋め込み（仕様書 第11節・受け入れ基準 11 の /embed/）。
 *
 * WordPress の記事の代わりに e2e/embed-parent.html（第11節のコードをそのまま貼った親ページ）を別オリジン
 * （https://blog.example.test）として配信し、iframe の中でアプリが起動して遊べることを確かめる。
 * 公開 URL（https://sachi0202are-lab.github.io/brain-fighter/）へのリクエストは、テスト中だけ
 * 手元のビルド（vite preview）へ振り向ける（外部には出ない）。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { collectErrors } from './helpers';

const PARENT_HTML = readFileSync(new URL('./embed-parent.html', import.meta.url), 'utf8');
/** 親ページに貼った第11節のコード（BEGIN と END の間） */
const SNIPPET = (/<!-- BEGIN EMBED SNIPPET -->\n([\s\S]*?)\n\s*<!-- END EMBED SNIPPET -->/.exec(PARENT_HTML) ?? [])[1] ?? '';
const BLOG = 'https://blog.example.test/2026/09/brain-fighter/';
const APP = 'https://sachi0202are-lab.github.io/brain-fighter/';
const EMBED = `${APP}embed/`;
const NOTE = 'ブログ内の記録は本体と別になります。本格的に続けるなら全画面で';

/** ブログの URL を親ページへ、公開 URL を手元のビルドへ（コンテキスト全体: 新しいタブにも効く） */
async function routeHosts(context: BrowserContext, baseURL: string, iframeSuffix = ''): Promise<void> {
  const parent = PARENT_HTML.replace(`src="${EMBED}"`, `src="${EMBED}${iframeSuffix}"`);
  await context.route(
    (url) => url.hostname === 'blog.example.test',
    (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: parent }),
  );
  await context.route(
    (url) => url.hostname === 'sachi0202are-lab.github.io',
    async (route) => {
      const u = new URL(route.request().url());
      const response = await route.fetch({ url: new URL(u.pathname + u.search, baseURL).href });
      await route.fulfill({ response });
    },
  );
}

async function embedFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(EMBED))).toBe(true);
  return page.frames().find((f) => f.url().startsWith(EMBED)) as Frame;
}

test('親ページのコードは第11節のもの（iframe・全画面で開くリンク）', () => {
  expect(SNIPPET).toContain(`<iframe src="${EMBED}"`);
  expect(SNIPPET).toContain('allow="fullscreen" loading="lazy" title="Brain Fighter"');
  expect(SNIPPET).toContain(`<a href="${APP}" target="_blank" rel="noopener">全画面で開く</a>`);
});

test('ブログ記事の iframe で埋め込み版が起動し、ナビを省いて「全画面で開く」と注意書きを出す', async ({ page, context }, testInfo) => {
  const errors = collectErrors(page);
  // 音の準備（AudioContext）がいつ作られるかを数える（仕様書 9.4: 埋め込み時は最初のタップまで音を出さない）
  await context.addInitScript(() => {
    const w = window as unknown as { __bfAudioContexts: number };
    w.__bfAudioContexts = 0;
    const Orig = window.AudioContext;
    if (Orig) {
      window.AudioContext = class extends Orig {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          w.__bfAudioContexts += 1;
        }
      };
    }
  });
  await routeHosts(context, testInfo.project.use.baseURL as string);
  await page.goto(BLOG);
  await expect(page.locator('a', { hasText: '全画面で開く' })).toHaveAttribute('href', APP);
  const frame = page.frameLocator('iframe[title="Brain Fighter"]');

  // iframe の中の保存領域は本体と別なので、初回の案内（3 画面）から始まる
  await expect(frame.getByTestId('welcome')).toBeVisible();
  await expect(frame.getByTestId('welcome')).toContainText(NOTE);
  const inner = await embedFrame(page);
  const audioContexts = (): Promise<number> => inner.evaluate(() => (window as unknown as { __bfAudioContexts: number }).__bfAudioContexts);
  await page.waitForTimeout(500);
  expect(await audioContexts(), '最初のタップの前').toBe(0);
  await frame.getByTestId('welcome-next').click();
  expect(await audioContexts(), '最初のタップの後').toBe(1);
  await frame.getByTestId('welcome-next').click();
  await frame.getByTestId('welcome-start').click();

  await expect(frame.getByTestId('total-power')).toBeVisible();
  await expect(frame.getByTestId('embed-note')).toHaveText(NOTE);
  await expect(frame.locator('.topnav')).toHaveCount(0);
  await expect(frame.getByTestId('start-session')).toBeEnabled();
  const full = frame.getByTestId('fullscreen');
  await expect(full).toHaveText('全画面で開く');
  await expect(full).toHaveAttribute('href', APP);
  await expect(full).toHaveAttribute('target', '_blank');

  // 「全画面で開く」で本体（埋め込み版ではない）が新しいタブで開く
  const [popup] = await Promise.all([page.waitForEvent('popup'), full.click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(APP);
  await expect(popup.locator('html')).not.toHaveClass(/embed/);
  await expect(popup.getByTestId('welcome').or(popup.getByTestId('total-power'))).toBeVisible();
  await expect(popup.getByTestId('embed-note')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('埋め込みページに X-Frame-Options / frame-ancestors が無く、PWA の登録も無い', async ({ request }) => {
  const res = await request.get('./embed/');
  expect(res.ok()).toBe(true);
  const headers = res.headers();
  expect(headers['x-frame-options']).toBeUndefined();
  expect(headers['content-security-policy'] ?? '').not.toMatch(/frame-ancestors/i);
  const html = await res.text();
  expect(html).not.toMatch(/frame-ancestors|x-frame-options/i);
  expect(html).not.toMatch(/rel="manifest"|registerSW/);
  // 本体には PWA の登録がある
  const main = await (await request.get('./')).text();
  expect(main).toMatch(/rel="manifest"/);
  expect(main).toMatch(/registerSW/);
});

test('ブログ記事の iframe の中で1ラウンド遊べる（記録は iframe 側に残る）', async ({ page, context }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const errors = collectErrors(page);
  await routeHosts(context, testInfo.project.use.baseURL as string, '?test=1&seed=5#/play/double-hit');
  await page.goto(BLOG);
  const fl = page.frameLocator('iframe[title="Brain Fighter"]');
  await expect(fl.getByTestId('ready')).toBeVisible();
  const frame = await embedFrame(page);
  await frame.evaluate(() => window.__bfTest.autoplay({ delayMs: 60 }));
  await fl.getByTestId('start').click();
  await expect(fl.getByTestId('intermission')).toBeVisible({ timeout: 240_000 });
  const rounds = await frame.evaluate(() => window.__bfTest.save().rounds.filter((r) => r.kind !== 'warmup').length);
  expect(rounds).toBe(1);
  // 刺激領域と応答ボタンが iframe の表示範囲に収まっている
  const box = await frame.evaluate(() => {
    const c = (document.querySelector('canvas.stim') as HTMLCanvasElement).getBoundingClientRect();
    const b = (document.querySelector('.resp-band') as HTMLElement).getBoundingClientRect();
    return { left: c.left, right: c.right, top: c.top, size: c.width, bandBottom: b.bottom, w: innerWidth, h: innerHeight };
  });
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.w);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.size).toBeGreaterThanOrEqual(160);
  expect(box.bandBottom).toBeLessThanOrEqual(box.h + 1);
  expect(errors).toEqual([]);
});

test.describe('Service Worker が有効なとき', () => {
  test.use({ serviceWorkers: 'allow' });

  test('/embed/ は本体（index.html）に置き換わらず、オフラインでも埋め込み版が開く', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
    await page.goto('./?test=1#/');
    // 本体を開くと Service Worker が登録され、プリキャッシュが済むと active になる
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    try {
      const res = await page.goto('./embed/?test=1#/');
      expect(res?.fromServiceWorker()).toBe(true);
      await expect(page.locator('html')).toHaveClass(/embed/);
      await expect(page.getByTestId('embed-note')).toHaveText(NOTE);
      const main = await page.goto('./?test=1#/');
      expect(main?.fromServiceWorker()).toBe(true);
      await expect(page.getByTestId('total-power')).toBeVisible();
      await expect(page.locator('html')).not.toHaveClass(/embed/);
    } finally {
      await context.setOffline(false);
    }
  });
});

test('設定の「ブログ用の埋め込みコードをコピー」で第11節のコードがコピーされる', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./?test=1#/settings');
  await expect(page.getByTestId('embed-code')).toHaveValue(SNIPPET);
  await page.getByTestId('embed-copy').click();
  await expect(page.getByTestId('embed-copy-status')).toHaveText('埋め込みコードをコピーしました。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SNIPPET);
});

test('クリップボードが使えない環境では、コードを選択して手でコピーできるようにする', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => undefined });
  });
  await page.goto('./?test=1#/settings');
  await page.getByTestId('embed-copy').click();
  await expect(page.getByTestId('embed-copy-status')).toContainText('自動でコピーできませんでした');
  const sel = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="embed-code"]') as HTMLTextAreaElement;
    return { focused: document.activeElement === t, start: t.selectionStart, end: t.selectionEnd, len: t.value.length };
  });
  expect(sel.focused).toBe(true);
  expect(sel.start).toBe(0);
  expect(sel.end).toBe(sel.len);
  expect(sel.len).toBe(SNIPPET.length);
});
