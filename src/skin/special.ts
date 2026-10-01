/**
 * 必殺演出（Full のみ・ラウンド間だけ。仕様書 9.1・9.5）。
 *
 * ラウンドを KO / PERFECT で終えたとき、ラウンド間の画面で一度だけ再生する短い動き（約 1.6 秒）:
 * 構え → 踏み込み（薄い残像）→ 突き（衝撃の輪が一度だけ広がって消える）→ 敵がダウン → 勝ちポーズで静止。
 *
 * - 課題の外（ラウンド間のオーバーレイ）でだけ動く。ラウンド中・刺激提示中には何も動かさない。
 * - 点滅・フラッシュ・画面揺れ・スローは使わない。明るさが上下に振れる要素は無い
 *   （残像と衝撃の輪の不透明度は、現れたあと単調に下がるだけ。背景は一色、または静止画で変わらない）。
 * - 視差を減らす設定（prefers-reduced-motion）では最後の静止画だけを出す。
 * - 動きは specialFrame(t) の純粋関数で決まる（テストで点滅が無いことを確かめる）。
 * - ファイターとステージの画像（skin/art.ts）は、再生を始める時点で読み込み済みのときだけ使う（途中で絵が変わらない）。
 */
import { spritesReady, stageReady } from './art';
import { drawFighter, drawSceneBackground, stageColor, type Pose } from './fighter';

/** 動きの長さ（これ以降は最後の形で静止） */
export const SPECIAL_MS = 1600;
/** 突きが当たる時刻（衝撃音を鳴らす時刻） */
export const SPECIAL_IMPACT_MS = 750;

export interface SpecialFrame {
  /** 自分の足元の x（幅に対する比） */
  playerX: number;
  playerPose: Pose;
  enemyX: number;
  enemyPose: Pose;
  /** 踏み込みの残像（x と不透明度） */
  trail: { x: number; alpha: number }[];
  /** 衝撃の輪（半径は高さに対する比）。出ていなければ null */
  ring: { r: number; alpha: number } | null;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const easeOut = (p: number): number => 1 - (1 - clamp01(p)) ** 3;

const DASH_START = 350;
const DASH_END = SPECIAL_IMPACT_MS;
const RING_END = 1150;
const ENEMY_FALL = 850;
const VICTORY = 1250;

/** 時刻 t (ms) の形（t は 0 未満・SPECIAL_MS 超でもよい） */
export function specialFrame(t: number): SpecialFrame {
  const time = Math.max(0, Math.min(SPECIAL_MS, t));
  const dash = easeOut((time - DASH_START) / (DASH_END - DASH_START));
  const playerX = 0.3 + 0.24 * dash;
  const playerPose: Pose = time < DASH_END ? 'guard' : time < VICTORY ? 'strike' : 'victory';
  // 残像: 踏み込み中だけ一定の薄さで付き、当たったあと 200 ms で消える（単調に下がる）
  const trailAlpha = time < DASH_START ? 0 : time < DASH_END ? 0.22 : 0.22 * (1 - clamp01((time - DASH_END) / 200));
  const trail =
    trailAlpha > 0 && dash > 0
      ? [1, 2, 3].map((k) => ({ x: playerX - 0.045 * k * dash, alpha: trailAlpha / k }))
      : [];
  // 衝撃の輪: 当たった瞬間に現れ、広がりながら薄くなって消える（一度だけ）
  const ringP = (time - SPECIAL_IMPACT_MS) / (RING_END - SPECIAL_IMPACT_MS);
  const ring = ringP >= 0 && ringP < 1 ? { r: 0.08 + 0.34 * easeOut(ringP), alpha: 0.55 * (1 - ringP) } : null;
  const fall = easeOut((time - ENEMY_FALL) / 300);
  return {
    playerX,
    playerPose,
    enemyX: 0.7 + 0.08 * fall,
    enemyPose: time < ENEMY_FALL ? 'guard' : 'down',
    trail,
    ring,
  };
}

export interface SpecialDrawOptions {
  width: number;
  height: number;
  /** 単色の背景（画像を使わないとき） */
  background: string;
  /** 敵レベル（ステージ背景の画像を選ぶ）。省略すると単色 */
  level?: number;
  /** 画像を使うか（再生の開始時に決めて、途中で変えない）。既定 true */
  art?: boolean;
}

/** 必殺演出で使う画像（すべて読み込み済みのときだけ使う） */
export const SPECIAL_SPRITES = ['player-guard', 'player-strike', 'player-victory', 'enemy-guard', 'enemy-down'] as const;

/** 1コマを描く */
export function drawSpecialFrame(ctx: CanvasRenderingContext2D, f: SpecialFrame, o: SpecialDrawOptions): void {
  const { width: W, height: H } = o;
  ctx.save();
  const ink = drawSceneBackground(ctx, { width: W, height: H, background: o.background, player: f.playerPose, enemy: f.enemyPose, level: o.level, art: o.art });
  const useArt = o.art ?? true;
  const who = (w: 'player' | 'enemy'): { who?: 'player' | 'enemy' } => (useArt ? { who: w } : {});
  const ground = H * 0.86;
  const fh = H * 0.62;
  for (const t of f.trail) {
    drawFighter(ctx, { x: W * t.x, ground, height: fh, facing: 1, pose: 'guard', color: ink, alpha: t.alpha, ...who('player') });
  }
  drawFighter(ctx, { x: W * f.enemyX, ground, height: fh * 1.05, facing: -1, pose: f.enemyPose, color: ink, ...who('enemy') });
  drawFighter(ctx, { x: W * f.playerX, ground, height: fh, facing: 1, pose: f.playerPose, color: ink, ...who('player') });
  if (f.ring) {
    ctx.globalAlpha = f.ring.alpha;
    ctx.strokeStyle = '#fff7e0';
    ctx.lineWidth = Math.max(2, H * 0.025);
    ctx.beginPath();
    ctx.arc(W * (f.playerX + 0.13), ground - fh * 0.73, H * f.ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export interface SpecialScene {
  el: HTMLCanvasElement;
  /** 動きを止める（オーバーレイを閉じたとき）。何度呼んでもよい */
  stop(): void;
}

/**
 * 必殺演出のキャンバス。DOM に入った次のフレームから再生し、SPECIAL_MS で止まる。
 * onImpact は突きが当たった時刻に1回だけ呼ばれる（衝撃音。reducedMotion でも呼ぶ）。
 */
export function specialScene(opts: {
  level: number;
  reducedMotion: boolean;
  onImpact?: () => void;
  width?: number;
  height?: number;
}): SpecialScene {
  const width = opts.width ?? 320;
  const height = opts.height ?? 132;
  const c = document.createElement('canvas');
  c.className = 'fighters special';
  c.setAttribute('aria-hidden', 'true');
  c.dataset.testid = 'special';
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  c.width = Math.round(width * dpr);
  c.height = Math.round(height * dpr);
  c.style.width = `${width}px`;
  c.style.height = `${height}px`;
  const ctx = c.getContext('2d');
  const background = stageColor(opts.level);
  // 画像は再生を始める時点でそろっているときだけ使う（途中で絵が変わらないように）
  const art = spritesReady(SPECIAL_SPRITES) && stageReady(opts.level);
  const draw = (t: number): void => {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSpecialFrame(ctx, specialFrame(t), { width, height, background, level: opts.level, art });
  };
  let handle: number | null = null;
  let impacted = false;
  let stopped = false;
  const impact = (): void => {
    if (impacted) return;
    impacted = true;
    opts.onImpact?.();
  };
  const stop = (): void => {
    stopped = true;
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null;
  };
  if (opts.reducedMotion || typeof requestAnimationFrame !== 'function') {
    draw(SPECIAL_MS);
    impact();
    return { el: c, stop };
  }
  draw(0);
  let start: number | null = null;
  const step = (now: number): void => {
    handle = null;
    if (stopped) return;
    if (start === null) start = now;
    const t = now - start;
    draw(t);
    if (t >= SPECIAL_IMPACT_MS) impact();
    if (t < SPECIAL_MS) handle = requestAnimationFrame(step);
  };
  handle = requestAnimationFrame(step);
  return { el: c, stop };
}

/** 端末の「視差を減らす」設定 */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}
