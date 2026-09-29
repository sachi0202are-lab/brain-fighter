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
}
interface BfTest {
  autoplay(opts?: { delayMs?: number }): void;
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

/**
 * 開始前の画面で「スタート」を押し、試合が終わって結果画面が出るまで進める。
 * ラウンド間は「次のラウンドへ」で飛ばし、「もう1ラウンド」は選ばない。応答は autoplay が入れる。
 */
export async function playMatch(page: Page): Promise<void> {
  await page.getByTestId('start').click();
  const next = page.getByTestId('next-round');
  const toResult = page.getByTestId('to-result');
  const result = page.getByTestId('result');
  const any = page.locator('[data-testid="next-round"], [data-testid="to-result"], [data-testid="result"]');
  for (let guard = 0; guard < 50; guard++) {
    await any.first().waitFor({ state: 'visible', timeout: 180_000 });
    if (await result.isVisible()) return;
    if (await toResult.isVisible()) {
      await toResult.click();
      continue;
    }
    if (await next.isVisible()) {
      await next.click().catch(() => {
        /* 10 秒で自動的に閉じた直後 */
      });
    }
  }
  await expect(result).toBeVisible();
}
