/**
 * テストからの自動プレイ用フック。URL に ?test=1 があるときだけ window.__bfTest を出す。
 * 入力は画面のボタンと同じ経路（RoundRunner.input）で入る。
 */
import { botPlan, correctPlan, every5thWrong, wrongPlan } from '../engine/autoplay';
import type { RoundRunner } from '../engine/round';
import type { Response } from '../engine/types';
import type { App } from './app';

type AnyRunner = RoundRunner<Record<string, number>, unknown>;

export interface BfTestApi {
  version: 1;
  /** いまの状態（実行中の試行・フェーズ・正解など） */
  state(): { route: string; running: boolean; snapshot: ReturnType<AnyRunner['snapshot']> };
  /** 現在の試行の正解（押さないのが正解なら null） */
  expected(): Response | null;
  /** ボタン id で入力を送る */
  press(id: string): boolean;
  /** 現在の試行に正解（または不正解）を送る */
  answer(correct?: boolean): boolean;
  /** 自動プレイ（既定: 5 試行に1回誤る = 正答率 80%）。応答窓が開いてから delayMs 後に答える */
  autoplay(opts?: { delayMs?: number; correct?: (i: number) => boolean }): void;
  stopAutoplay(): void;
  /** この画面セッションで実行したラウンドの詳しいログ */
  logs(): App['testLog'];
  /** 保存データ */
  save(): App['store']['data'];
  frameMs(): number;
}

export function installTestHooks(app: App): void {
  if (!app.flags.test) return;
  let stop: (() => void) | null = null;

  const api: BfTestApi = {
    version: 1,
    state: () => ({
      route: location.hash,
      running: app.runners.current !== null,
      snapshot: app.runners.current?.snapshot() ?? null,
    }),
    expected: () => app.runners.current?.snapshot()?.expected ?? null,
    press: (id) => app.runners.current?.input(id) ?? false,
    answer: (correct = true) => {
      const r = app.runners.current;
      const snap = r?.snapshot();
      if (!r || !snap || !snap.accepting) return false;
      const ids = correct ? correctPlan(snap.expected) : wrongPlan(r.layout, snap.expected);
      for (const id of ids) r.input(id);
      return true;
    },
    autoplay: (opts = {}) => {
      stop?.();
      const delayMs = opts.delayMs ?? 60;
      const pattern = opts.correct ?? every5thWrong;
      let detach: (() => void) | null = null;
      const attach = (r: AnyRunner | null): void => {
        detach?.();
        detach = null;
        if (!r) return;
        const handled = new Set<number>();
        detach = r.events.on('phase', (e) => {
          if (!e.input || handled.has(e.i)) return;
          handled.add(e.i);
          setTimeout(() => {
            const snap = r.snapshot();
            if (!snap || snap.i !== e.i || !snap.accepting) return;
            for (const id of botPlan(e.i, r.layout, snap.expected, pattern)) r.input(id);
          }, delayMs);
        });
      };
      const unsub = app.runners.subscribe(attach);
      attach(app.runners.current);
      stop = () => {
        unsub();
        detach?.();
      };
    },
    stopAutoplay: () => {
      stop?.();
      stop = null;
    },
    logs: () => app.testLog,
    save: () => app.store.data,
    frameMs: () => app.frameMs,
  };
  (window as unknown as { __bfTest: BfTestApi }).__bfTest = api;
}
