import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

/**
 * E2E（Playwright）。本番と同じビルドを vite preview で配信してテストする。
 * 並行作業でぶつからないように、ポートごとに出力先を分ける: PORT=4174 npm run test:e2e
 */
const PORT = Number(process.env.PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}/brain-fighter/`;

/** Playwright 同梱のブラウザが無ければ、環境に入っている Chromium を使う */
function chromiumExecutable(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* 同梱ブラウザの場所が分からない */
  }
  return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}
const executablePath = chromiumExecutable();
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // 長い試合を通すテストが多く、提示時間の照合（±1 フレーム）は負荷に弱いので同時に 2 本まで。
  // 一番正確に測るときは --workers=1。ほかの E2E（別ポート）と同時に走らせない。
  workers: 2,
  retries: 0,
  reporter: [['list']],
  outputDir: `test-results/${PORT}`,
  use: {
    baseURL: BASE_URL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions,
  },
  webServer: {
    command: `npx vite build --outDir .e2e-dist/${PORT} --emptyOutDir && npx vite preview --outDir .e2e-dist/${PORT} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions },
    },
  ],
});
