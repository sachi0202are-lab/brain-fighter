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
  /** この画面セッションで実行したラウンドの詳しいログ（認定戦のラウンドは kind = 'cert'） */
  logs(): App['testLog'];
  /**
   * 受け入れ基準 8 の点検を始める: 刺激の提示が始まるたびに、動いているアニメーション・刺激領域に重なる要素・
   * オーバーレイの有無を調べ、正誤表示（1 ビット）の出た時刻を集める。
   */
  startFxAudit(): void;
  fxAuditReport(): FxAuditReport;
  /** 保存データ */
  save(): App['store']['data'];
  frameMs(): number;
}

export interface FxAuditReport {
  /** 調べた刺激提示の回数 */
  stimulusPhases: number;
  /** 刺激の提示中に見つかった問題（動いている演出・刺激領域に重なる要素など） */
  violations: string[];
  /** 正誤表示が出た回数と、任意の 1 秒間に出た回数の最大 */
  feedbackShown: number;
  maxFeedbackPerSecond: number;
}

interface FxAuditState {
  stimulusPhases: number;
  violations: string[];
  feedbackOn: number[];
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom && a.width > 0 && a.height > 0;
}

/** 刺激の提示中の画面を調べる（刺激領域の中で動くもの・重なるものが無いこと） */
function auditStimulus(a: FxAuditState, i: number): void {
  const stim = document.querySelector('canvas.stim');
  if (!stim) return;
  const rect = stim.getBoundingClientRect();
  if (document.querySelector('.overlay:not([hidden])')) a.violations.push(`試行 ${i}: 刺激の提示中にオーバーレイが出ている`);
  for (const anim of document.getAnimations()) {
    if (anim.playState !== 'running') continue;
    const target = (anim.effect as KeyframeEffect | null)?.target;
    if (target instanceof Element && intersects(target.getBoundingClientRect(), rect)) {
      a.violations.push(`試行 ${i}: 刺激領域に重なる要素 ${target.className} が動いている`);
    }
  }
  const inset = 3;
  const points: [number, number][] = [
    [rect.left + inset, rect.top + inset],
    [rect.right - inset, rect.top + inset],
    [rect.left + inset, rect.bottom - inset],
    [rect.right - inset, rect.bottom - inset],
    [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
  ];
  for (const [x, y] of points) {
    const top = document.elementFromPoint(x, y);
    if (top && top !== stim) a.violations.push(`試行 ${i}: 刺激領域の上に ${top.tagName.toLowerCase()}.${top.className} が重なっている`);
  }
}

export function installTestHooks(app: App): void {
  if (!app.flags.test) return;
  let stop: (() => void) | null = null;
  let audit: FxAuditState | null = null;
  let stopAudit: (() => void) | null = null;

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
    startFxAudit: () => {
      stopAudit?.();
      const a: FxAuditState = { stimulusPhases: 0, violations: [], feedbackOn: [] };
      audit = a;
      let detach: (() => void) | null = null;
      const attach = (r: AnyRunner | null): void => {
        detach?.();
        detach = null;
        if (!r) return;
        detach = r.events.on('phase', (e) => {
          if (e.phase !== 'stimulus') return;
          a.stimulusPhases += 1;
          // 刺激を描いたフレームの直後に調べる
          requestAnimationFrame(() => auditStimulus(a, e.i));
        });
      };
      const unsub = app.runners.subscribe(attach);
      attach(app.runners.current);
      // 正誤表示が「出た」回数を数える。1回の表示でも「消す → 出す」の2つの変更が同時に届くので、
      // 各変更の新しい値（= 次の変更の oldValue、最後はいまの値）が ok / ng のものだけ数える
      const mo = new MutationObserver((muts) => {
        const now = performance.now();
        const byTarget = new Map<Element, MutationRecord[]>();
        for (const m of muts) {
          const el = m.target as Element;
          if (el.getAttribute('data-testid') !== 'feedback') continue;
          byTarget.set(el, [...(byTarget.get(el) ?? []), m]);
        }
        for (const [el, recs] of byTarget) {
          recs.forEach((_, k) => {
            const next = k + 1 < recs.length ? (recs[k + 1] as MutationRecord).oldValue : el.getAttribute('data-state');
            if (next === 'ok' || next === 'ng') a.feedbackOn.push(now);
          });
        }
      });
      mo.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-state'] });
      stopAudit = () => {
        unsub();
        detach?.();
        mo.disconnect();
      };
    },
    fxAuditReport: () => {
      const a = audit ?? { stimulusPhases: 0, violations: [], feedbackOn: [] };
      let maxPerSecond = 0;
      for (let k = 0; k < a.feedbackOn.length; k++) {
        let n = 0;
        for (let j = k; j < a.feedbackOn.length && (a.feedbackOn[j] as number) - (a.feedbackOn[k] as number) < 1000; j++) n += 1;
        maxPerSecond = Math.max(maxPerSecond, n);
      }
      return {
        stimulusPhases: a.stimulusPhases,
        violations: [...a.violations],
        feedbackShown: a.feedbackOn.length,
        maxFeedbackPerSecond: maxPerSecond,
      };
    },
    save: () => app.store.data,
    frameMs: () => app.frameMs,
  };
  (window as unknown as { __bfTest: BfTestApi }).__bfTest = api;
}
