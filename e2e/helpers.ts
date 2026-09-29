import { expect, type Page } from '@playwright/test';

/** ?test=1 のときだけ出るテスト用フック（src/ui/test-hooks.ts） */
export interface BfTestLogTrial {
  i: number;
  stim: string;
  correct: boolean;
  rtMs?: number;
  onsetMs: number;
  plan: Record<string, number>;
  phases: { name: string; plannedMs: number; frames: number; input: boolean; untilResponse: boolean; startMs: number; endMs: number }[];
}
export interface BfTestLogRound {
  gameId: string;
  fx: string;
  kind: string;
  roundNo: number;
  roundId: string;
  power: number;
  paramsEnd: Record<string, number>;
  trials: BfTestLogTrial[];
}
export interface BfSave {
  rounds: { id: string; gameId: string; kind?: string; trials: number; correct: number; power: number }[];
  trials?: { roundId: string; plan?: Record<string, number>; stimMs?: number }[];
  sessions?: { done: string[]; order: string[] }[];
  games: Record<string, { state: Record<string, number>; belt: number; lastCertAt?: string; trainingDays: string[] }>;
  certs: { id: string; gameId: string; at: string; tier: number; rounds: { trials: number; correct: number }[]; passed: boolean }[];
  settings: { fx: string; sound: boolean; colorSafe: boolean };
  onboardedAt?: string;
}

/**
 * 1 試合のラウンド数（「もう1ラウンド」を選ばないとき）。スタンスチェンジは 1 ラウンドだけでウォームアップも無い
 * （仕様書 v1.1。ユーザーのフィードバックで短縮）。ダブルヒットとコンボ・リコールは 3 ラウンド。
 */
export const MATCH_ROUNDS: Readonly<Record<'double-hit' | 'combo-recall' | 'stance-change', number>> = {
  'double-hit': 3,
  'combo-recall': 3,
  'stance-change': 1,
};

/** 端末のローカル日付 'YYYY-MM-DD'（今日から days 日前） */
export function localDay(daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type GameSeed = { belt?: number; days?: number; lastCertDaysAgo?: number; state?: Record<string, number> };

/** テスト用の保存データ（第8節の形）。days = 訓練日数（今日より前の日付で作る） */
export function saveData(games: Partial<Record<'double-hit' | 'combo-recall' | 'stance-change', GameSeed>> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ['double-hit', 'combo-recall', 'stance-change'] as const) {
    const g = games[id] ?? {};
    out[id] = {
      state: g.state ?? {},
      belt: g.belt ?? 0,
      trainingDays: Array.from({ length: g.days ?? 0 }, (_, k) => localDay(k + 1)).sort(),
      ...(g.lastCertDaysAgo !== undefined ? { lastCertAt: new Date(Date.now() - g.lastCertDaysAgo * 86_400_000).toISOString() } : {}),
    };
  }
  return {
    version: 1,
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    settings: { fx: 'light', sound: false, colorSafe: false },
    games: out,
    rounds: [],
    certs: [],
    trials: [],
    sessions: [],
    onboardedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    ...extra,
  };
}

/** 保存データを localStorage に入れて読み込み直す（アプリは起動時に読むので reload する） */
export async function seedSave(page: Page, data: Record<string, unknown>, url = './?test=1#/'): Promise<void> {
  await page.goto(url);
  await page.evaluate((json) => localStorage.setItem('brain-fighter.v1', json), JSON.stringify(data));
  await page.reload();
}
export interface FxAuditReport {
  stimulusPhases: number;
  violations: string[];
  feedbackShown: number;
  maxFeedbackPerSecond: number;
}
export interface FrameStats {
  frames: number;
  frameMs: number;
  fps: number;
  p95Ms: number;
  maxMs: number;
  longFrames: number;
}
interface BfTest {
  autoplay(opts?: { delayMs?: number; correct?: (i: number) => boolean }): void;
  stopAutoplay(): void;
  state(): {
    route: string;
    running: boolean;
    snapshot: { i: number; trials: number; phase: string; accepting: boolean; selection: Record<string, string> } | null;
  };
  startFxAudit(): void;
  fxAuditReport(): FxAuditReport;
  startFrameStats(): void;
  frameStats(): FrameStats;
  logs(): BfTestLogRound[];
  save(): BfSave;
  frameMs(): number;
}
declare global {
  interface Window {
    __bfTest: BfTest;
  }
}

/** ブラウザ側のエラーを集める */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** 難度・補助・スキップを選ぶ語（受け入れ基準 2。仕様書 4.2 の「実装しない」もの） */
export const DIFFICULTY_WORDS = /難易度|難度を選|難度選択|かんたん|簡単モード|スキップ|ヒント|補助|スロー/;

/**
 * 受け入れ基準 2: いま表示中の画面に、難度・補助・スキップを選ぶ操作が無い
 * （語が無い・select / 数値入力 / スライダーが無い・ラジオボタンは演出プリセットだけ）。
 */
export async function expectNoDifficultyControls(page: Page, where: string): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text, where).not.toMatch(DIFFICULTY_WORDS);
  expect(await page.locator('select').count(), where).toBe(0);
  expect(await page.locator('input[type="range"], input[type="number"]').count(), where).toBe(0);
  const radios = await page.locator('input[type="radio"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
  expect(radios.every((n) => n === 'fx' || n === 'welcome-fx'), where).toBe(true);
}

/**
 * 開始前の画面で「スタート」を押し、試合が終わって結果画面が出るまで進める。
 * ラウンド間は「次のラウンドへ」で飛ばし、「もう1ラウンド」は選ばない。応答は autoplay が入れる。
 * onIntermission はラウンド間の画面（と「もう1ラウンド」の確認）が出るたびに、閉じる前に呼ばれる
 * （1 ラウンドだけの試合 = スタンスチェンジはラウンド間の画面が無いので、呼ばれずに結果画面まで進む）。
 */
export async function playMatch(page: Page, opts: { onIntermission?: () => Promise<void> } = {}): Promise<void> {
  await page.getByTestId('start').click();
  const next = page.getByTestId('next-round');
  const toResult = page.getByTestId('to-result');
  const result = page.getByTestId('result');
  const any = page.locator('[data-testid="next-round"], [data-testid="to-result"], [data-testid="result"]');
  for (let guard = 0; guard < 50; guard++) {
    await any.first().waitFor({ state: 'visible', timeout: 180_000 });
    if (await result.isVisible()) return;
    if (await toResult.isVisible()) {
      await opts.onIntermission?.();
      await toResult.click();
      continue;
    }
    if (await next.isVisible()) {
      // ラウンド間の画面は 10 秒で閉じるが、調べるのは出た直後（閉じたあとでもゲーム画面を調べるだけで結果は同じ）
      await opts.onIntermission?.();
      await next.click().catch(() => {
        /* 10 秒で自動的に閉じた直後 */
      });
    }
  }
  await expect(result).toBeVisible();
}
