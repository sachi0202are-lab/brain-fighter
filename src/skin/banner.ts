/** ラウンド末・結果画面の KO / PERFECT / 判定表示と技名テロップ（ラウンド間だけ） */
import { ja } from '../i18n/ja';
import { drawScene, stageColor, type Pose } from './fighter';
import type { RoundOutcome } from './hp';
import { specialMoveName } from './names';

export function outcomeText(o: RoundOutcome): string {
  return o === 'perfect' ? ja.outcome.perfect : o === 'ko' ? ja.outcome.ko : ja.outcome.decision;
}

/** KO / PERFECT / 判定負け のロゴ。判定負けは煽らず「次は◯問で KO」と情報だけ出す */
export function outcomeBanner(o: RoundOutcome, koNext: number | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `outcome outcome-${o}`;
  const logo = document.createElement('div');
  logo.className = 'outcome-logo';
  logo.textContent = outcomeText(o);
  wrap.append(logo);
  if (o === 'decision' && koNext !== null) {
    const info = document.createElement('div');
    info.className = 'outcome-info';
    info.textContent = ja.outcome.koNext(koNext);
    wrap.append(info);
  }
  return wrap;
}

/**
 * 結果画面の見出し: KO と PERFECT の数（Light / Full）。どちらも 0 なら出さない
 * （判定負けは各ラウンドの行に情報として出すだけで、見出しにはしない）。
 * 1 ラウンドだけの試合（スタンスチェンジ）は数を付けず「KO」「PERFECT」だけ（「KO × 1」にしない）。
 */
export function outcomeHeadline(outcomes: readonly (RoundOutcome | null)[]): HTMLElement | null {
  const ko = outcomes.filter((o) => o === 'ko').length;
  const perfect = outcomes.filter((o) => o === 'perfect').length;
  if (ko + perfect === 0) return null;
  const single = outcomes.length === 1;
  const wrap = document.createElement('div');
  wrap.className = 'result-headline';
  wrap.dataset.testid = 'result-headline';
  const add = (cls: string, label: string, n: number): void => {
    if (n === 0) return;
    const e = document.createElement('span');
    e.className = cls;
    e.textContent = single ? label : ja.outcome.count(label, n);
    wrap.append(e);
  };
  add('headline-perfect', ja.outcome.perfect, perfect);
  add('headline-ko', ja.outcome.ko, ko);
  return wrap;
}

/** 技名テロップ（Full のみ・ラウンド間のみ。スライドインするだけで点滅しない） */
export function specialTelop(seed: number): HTMLElement {
  const e = document.createElement('div');
  e.className = 'telop';
  e.textContent = specialMoveName(seed);
  return e;
}

/** 向き合う2人のシルエット（静止画） */
export function fightersCanvas(opts: { outcome: RoundOutcome | null; level: number; width?: number; height?: number }): HTMLCanvasElement {
  const width = opts.width ?? 320;
  const height = opts.height ?? 132;
  const c = document.createElement('canvas');
  c.className = 'fighters';
  c.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  c.width = Math.round(width * dpr);
  c.height = Math.round(height * dpr);
  c.style.width = `${width}px`;
  c.style.height = `${height}px`;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const win = opts.outcome === 'ko' || opts.outcome === 'perfect';
    const player: Pose = win ? 'victory' : 'guard';
    const enemy: Pose = win ? 'down' : 'guard';
    drawScene(ctx, { width, height, background: stageColor(opts.level), player, enemy });
  }
  return c;
}
