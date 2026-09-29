/**
 * PWA（仕様書 第3節・受け入れ基準 10）と公開の形（受け入れ基準 11）。
 *
 * Lighthouse は v12 で PWA のカテゴリを廃止した（この環境には Lighthouse も無い）ので、
 * 「インストールできるか」は Chromium 自身の判定（DevTools プロトコルの Page.getInstallabilityErrors。
 * Lighthouse の installable-manifest 監査が使っていたのと同じ判定）で確かめる。
 * あわせて manifest の項目・アイコンの実寸・Service Worker・オフライン起動・ベースパスを確かめる。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type APIRequestContext } from '@playwright/test';

interface Manifest {
  id?: string;
  name?: string;
  short_name?: string;
  description?: string;
  lang?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  orientation?: string;
  background_color?: string;
  theme_color?: string;
  icons?: { src: string; sizes: string; type: string; purpose?: string }[];
}

async function manifestOf(request: APIRequestContext): Promise<{ href: string; m: Manifest }> {
  const html = await (await request.get('./')).text();
  const href = /<link rel="manifest" href="([^"]+)"/.exec(html)?.[1];
  expect(href, 'index.html に manifest のリンクがある').toBeTruthy();
  const res = await request.get(href as string);
  expect(res.ok()).toBe(true);
  return { href: href as string, m: (await res.json()) as Manifest };
}

/** PNG の実寸（IHDR） */
function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('manifest にインストールに要る項目があり、アイコンは宣言どおりの実寸で配信される', async ({ request }) => {
  const { href, m } = await manifestOf(request);
  expect(href).toBe('/brain-fighter/manifest.webmanifest');
  expect(m).toMatchObject({
    name: 'Brain Fighter',
    short_name: 'Brain Fighter',
    lang: 'ja',
    start_url: '/brain-fighter/',
    scope: '/brain-fighter/',
    display: 'standalone',
    orientation: 'portrait',
  });
  expect(m.description ?? '').not.toBe('');
  expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  const icons = m.icons ?? [];
  const png = icons.filter((i) => i.type === 'image/png');
  // 192 と 512（と maskable 512）
  expect(png.map((i) => `${i.sizes}${i.purpose === 'maskable' ? ' maskable' : ''}`).sort()).toEqual(['192x192', '512x512', '512x512 maskable']);
  for (const icon of icons) {
    const res = await request.get(new URL(icon.src, new URL(href, 'http://x/brain-fighter/')).pathname);
    expect(res.ok(), icon.src).toBe(true);
    expect(res.headers()['content-type'], icon.src).toContain(icon.type);
    if (icon.type === 'image/png') {
      const { w, h } = pngSize(await res.body());
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
  }
  // iOS 用のアイコンとテーマ色・viewport も本体の HTML にある
  const html = await (await request.get('./')).text();
  expect(html).toMatch(/<link rel="apple-touch-icon" href="\/brain-fighter\/icons\/apple-touch-icon\.png"/);
  expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}"/i);
  expect(html).toMatch(/<meta name="viewport" content="width=device-width/);
});

test('Chromium のインストール可能性の判定でエラーが無い（通常のプロファイル）', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'デスクトップのプロジェクトだけで実行する');
  test.setTimeout(90_000);
  // Playwright の通常のコンテキストはシークレットと同じ扱いで「in-incognito」になるので、永続プロファイルで開く。
  // テストの中で作るコンテキストにも設定の既定（serviceWorkers: 'block'）が効くので、明示的に許可する
  const profile = mkdtempSync(join(tmpdir(), 'bf-pwa-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    ...(testInfo.project.use.launchOptions ?? {}),
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: 'allow',
  });
  try {
    const page = await ctx.newPage();
    await page.goto('./?test=1#/');
    await page.evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker が 30 秒で有効にならない')), 30_000)),
      ]).then(() => undefined),
    );
    const cdp = await ctx.newCDPSession(page);
    const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: unknown[] };
    expect(manifest.url).toMatch(/\/brain-fighter\/manifest\.webmanifest$/);
    expect(manifest.errors).toEqual([]);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
    testInfo.annotations.push({ type: 'pwa', description: `installabilityErrors: ${JSON.stringify(installabilityErrors)}` });
    expect(installabilityErrors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test.describe('Service Worker が有効なとき', () => {
  test.use({ serviceWorkers: 'allow' });

  test('Service Worker が登録され、オフラインでも起動して遊べる', async ({ page, context }) => {
    test.setTimeout(3 * 60_000);
    await page.goto('./?test=1#/');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe('/brain-fighter/');
    await context.setOffline(true);
    try {
      // 本体（クエリ付きのままでも）・記録・ゲーム画面がオフラインで開き、ラウンドが動く
      const res = await page.reload();
      expect(res?.fromServiceWorker()).toBe(true);
      await expect(page.getByTestId('total-power')).toBeVisible();
      await page.goto('./?test=1&seed=3#/records');
      await expect(page.getByTestId('records')).toBeVisible();
      await page.goto('./?test=1&seed=3#/play/combo-recall');
      await page.getByTestId('start').click();
      await expect.poll(() => page.evaluate(() => window.__bfTest.state().snapshot?.i ?? -1), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    } finally {
      await context.setOffline(false);
    }
  });
});

test('公開の形: 本体と /embed/ の参照はすべてベースパス /brain-fighter/ の下で、iframe を拒むヘッダが無い', async ({ request }) => {
  for (const path of ['./', './embed/']) {
    const res = await request.get(path);
    expect(res.ok(), path).toBe(true);
    expect(res.headers()['x-frame-options'], path).toBeUndefined();
    expect(res.headers()['content-security-policy'] ?? '', path).not.toMatch(/frame-ancestors/i);
    const html = await res.text();
    const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string);
    expect(refs.length, path).toBeGreaterThan(2);
    for (const ref of refs) {
      expect(ref, `${path} の ${ref}`).toMatch(/^\/brain-fighter\//);
      expect((await request.get(ref)).ok(), ref).toBe(true);
    }
  }
});
