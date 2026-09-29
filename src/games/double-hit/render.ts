/**
 * ダブルヒットの刺激領域の描画（仕様書 6.1）。描画の中では乱数を使わない（マスクの模様は試行データの種から決まる）。
 * 刺激提示中は静止画（動く演出なし）。長さは刺激領域の半径 R（= 一辺の半分）に対する比で決める。
 *
 * 表層バリエーション（surface）で変わるのは、敵シルエットの形（髪・体格・道着）と背景色だけ。
 * 背景色は相対輝度をそろえてあり、刺激の大きさ・色・コントラスト・提示時間は変わらない。
 * 構えの区別（拳の高さ）は、どのバリエーションでも同じ形。
 *
 * 認定戦（view.untrained）では、火花と妨害の形・色を訓練と別のセットにする（輝度はそろえてある）。
 */
import { mulberry32 } from '../../engine/rng';
import type { PhaseName, RenderView, Response } from '../../engine/types';
import { DIR_GROUP, DIRS, dirVector, type StanceId } from './layout';
import { sparkPosition, type DhTrial, type Distractor } from './trials';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// 色と大きさ
// ---------------------------------------------------------------------------

export type FigureVariant = 'plain' | 'topknot' | 'broad' | 'robe';

export interface SurfaceSpec {
  /** 刺激領域の背景色（相対輝度 約 0.0084 にそろえる） */
  bg: string;
  /** 敵シルエットの形のバリエーション */
  figure: FigureVariant;
}

/** 表層バリエーション（0 は最初の2試合。以降2試合ごとに入れ替わる） */
export const SURFACES: readonly SurfaceSpec[] = [
  { bg: '#121626', figure: 'plain' },
  { bg: '#0e1915', figure: 'topknot' },
  { bg: '#221218', figure: 'broad' },
  { bg: '#1b1326', figure: 'robe' },
];

/** 敵シルエットの色（どのバリエーションでも同じ） */
export const FIGURE_COLOR = '#e4e8f6';
export const FIXATION_COLOR = '#c9cfe8';

export type SparkShape = 'star' | 'ring';
export type DistractorShape = 'triangle' | 'square' | 'diamond' | 'circle' | 'cross' | 'hexagon';

export interface StimulusSet {
  spark: { shape: SparkShape; color: string; core: string };
  /** 妨害: 小さく暗い図形。形は試行データの shape 番号で選ぶ */
  distractor: { shapes: readonly DistractorShape[]; color: string };
}

/** 訓練の刺激セット（火花 = 黄色い8本の光、妨害 = 三角・四角・ひし形） */
export const TRAINED_SET: StimulusSet = {
  spark: { shape: 'star', color: '#ffd966', core: '#fffbe6' },
  distractor: { shapes: ['triangle', 'square', 'diamond'], color: '#3d4563' },
};

/** 認定戦の未訓練セット（火花 = 水色の輪、妨害 = 丸・十字・六角形） */
export const UNTRAINED_SET: StimulusSet = {
  spark: { shape: 'ring', color: '#86efff', core: '#effdff' },
  distractor: { shapes: ['circle', 'cross', 'hexagon'], color: '#4a4538' },
};

/** 火花の半径 */
export const SPARK_R = 0.065;
/** 妨害の大きさの単位（図形の外接円の半径 ≒ 1〜1.2 倍） */
export const DISTRACTOR_R = 0.034;
/** 応答画面の丸（8方向）の半径 */
export const SOCKET_R = 0.085;
/** シルエット全体の高さ（上段の拳の上端〜足元）。刺激領域の中心に置き、上下 ±0.22 に収まる */
export const FIGURE_HEIGHT = 0.44;

const SOCKET_FILL = 'rgba(255, 255, 255, 0.06)';
const SOCKET_STROKE = 'rgba(201, 207, 232, 0.55)';
const SOCKET_FILL_SELECTED = 'rgba(124, 196, 255, 0.35)';
const SOCKET_STROKE_SELECTED = '#7cc4ff';
const CENTER_DOT = 'rgba(201, 207, 232, 0.5)';

/** マスク（砂嵐）の灰色の段階。暗い〜明るい灰色（白の全面点滅にはしない） */
const MASK_LEVELS: readonly string[] = ['#1b1e29', '#323848', '#4c5366', '#697084', '#8a90a2', '#aeb2c0'];
/** マスクの粗いまだらの数（一辺） */
export const MASK_CELLS = 28;
/** マスクの細かいマスの数（一辺。粗いまだら 1 つ = 3×3 マス） */
export const MASK_RES = MASK_CELLS * 3;

export function surfaceSpec(surface: number): SurfaceSpec {
  const n = SURFACES.length;
  const k = Number.isFinite(surface) ? ((Math.round(surface) % n) + n) % n : 0;
  return SURFACES[k] as SurfaceSpec;
}

export function stimulusSet(untrained: boolean): StimulusSet {
  return untrained ? UNTRAINED_SET : TRAINED_SET;
}

// ---------------------------------------------------------------------------
// 敵シルエット（正面向き。構え = 拳の高さ）
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

/** 右半身の腕（肘・拳）。左は左右対称。座標は足元の中心が原点、身長 ≒ 1、y は上がマイナス */
const ARMS: Record<StanceId, readonly [Pt, Pt]> = {
  /** 上段: 拳を頭より上に */
  high: [
    { x: 0.26, y: -0.84 },
    { x: 0.15, y: -1.015 },
  ],
  /** 中段: 拳を肩の高さで横に */
  mid: [
    { x: 0.28, y: -0.6 },
    { x: 0.335, y: -0.745 },
  ],
  /** 下段: 拳を腰の横に */
  low: [
    { x: 0.28, y: -0.6 },
    { x: 0.275, y: -0.415 },
  ],
};
const SHOULDER: Pt = { x: 0.12, y: -0.73 };
const HIP: Pt = { x: 0.06, y: -0.46 };
const KNEE: Pt = { x: 0.15, y: -0.23 };
const FOOT: Pt = { x: 0.21, y: 0 };
const HEAD_Y = -0.88;
const FIST_R = 0.065;
const ARM_W = 0.085;
/** 図形の上端（上段の拳の上端）と下端（足の線の端） */
const FIG_TOP = -1.08;
const FIG_BOTTOM = 0.055;

interface Body {
  headR: number;
  shoulderW: number;
  waistW: number;
  legW: number;
  topknot: boolean;
  robe: boolean;
}

const BODIES: Record<FigureVariant, Body> = {
  plain: { headR: 0.095, shoulderW: 0.155, waistW: 0.095, legW: 0.11, topknot: false, robe: false },
  topknot: { headR: 0.095, shoulderW: 0.155, waistW: 0.095, legW: 0.11, topknot: true, robe: false },
  broad: { headR: 0.1, shoulderW: 0.185, waistW: 0.115, legW: 0.11, topknot: false, robe: false },
  robe: { headR: 0.095, shoulderW: 0.155, waistW: 0.095, legW: 0.1, topknot: false, robe: true },
};

/** シルエットを描く（cx, cy = 刺激領域の中心、R = 刺激領域の半径） */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  stance: StanceId,
  variant: FigureVariant,
): void {
  const h = (FIGURE_HEIGHT * R) / (FIG_BOTTOM - FIG_TOP);
  const feetY = cy - ((FIG_TOP + FIG_BOTTOM) / 2) * h;
  const X = (p: Pt, side: number): number => cx + side * p.x * h;
  const Y = (p: Pt): number => feetY + p.y * h;
  const b = BODIES[variant];
  ctx.fillStyle = FIGURE_COLOR;
  ctx.strokeStyle = FIGURE_COLOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 脚
  ctx.lineWidth = b.legW * h;
  ctx.beginPath();
  for (const side of [1, -1]) {
    ctx.moveTo(X(HIP, side), Y(HIP));
    ctx.lineTo(X(KNEE, side), Y(KNEE));
    ctx.lineTo(X(FOOT, side), Y(FOOT));
  }
  ctx.stroke();

  // 道着の裾（robe のときだけ）
  if (b.robe) {
    ctx.beginPath();
    ctx.moveTo(cx - 0.1 * h, feetY - 0.5 * h);
    ctx.lineTo(cx + 0.1 * h, feetY - 0.5 * h);
    ctx.lineTo(cx + 0.21 * h, feetY - 0.2 * h);
    ctx.lineTo(cx - 0.21 * h, feetY - 0.2 * h);
    ctx.closePath();
    ctx.fill();
  }

  // 胴（逆台形）
  ctx.beginPath();
  ctx.moveTo(cx - b.shoulderW * h, feetY - 0.77 * h);
  ctx.lineTo(cx + b.shoulderW * h, feetY - 0.77 * h);
  ctx.lineTo(cx + b.waistW * h, feetY - 0.45 * h);
  ctx.lineTo(cx - b.waistW * h, feetY - 0.45 * h);
  ctx.closePath();
  ctx.fill();

  // 首と頭
  ctx.lineWidth = 0.08 * h;
  ctx.beginPath();
  ctx.moveTo(cx, feetY - 0.76 * h);
  ctx.lineTo(cx, feetY + HEAD_Y * h);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, feetY + HEAD_Y * h, b.headR * h, 0, TAU);
  ctx.fill();
  if (b.topknot) {
    ctx.beginPath();
    ctx.arc(cx, feetY + (HEAD_Y - b.headR - 0.02) * h, 0.035 * h, 0, TAU);
    ctx.fill();
  }

  // 腕と拳（構え）
  const [elbow, fist] = ARMS[stance];
  ctx.lineWidth = ARM_W * h;
  ctx.beginPath();
  for (const side of [1, -1]) {
    ctx.moveTo(X(SHOULDER, side), Y(SHOULDER));
    ctx.lineTo(X(elbow, side), Y(elbow));
    ctx.lineTo(X(fist, side), Y(fist));
  }
  ctx.stroke();
  ctx.beginPath();
  for (const side of [1, -1]) {
    ctx.moveTo(X(fist, side) + FIST_R * h, Y(fist));
    ctx.arc(X(fist, side), Y(fist), FIST_R * h, 0, TAU);
  }
  ctx.fill();
}

/** シルエットの外接矩形（刺激領域の中心からの比。テスト用） */
export function figureExtent(): { halfWidth: number; top: number; bottom: number } {
  const h = FIGURE_HEIGHT / (FIG_BOTTOM - FIG_TOP);
  const feet = -((FIG_TOP + FIG_BOTTOM) / 2) * h;
  const halfWidth = Math.max(...Object.values(ARMS).map(([, f]) => f.x + FIST_R), FOOT.x + 0.06) * h;
  return { halfWidth, top: feet + FIG_TOP * h, bottom: feet + FIG_BOTTOM * h };
}

// ---------------------------------------------------------------------------
// 火花・妨害
// ---------------------------------------------------------------------------

function polygonPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, start: number): void {
  for (let k = 0; k < n; k++) {
    const a = start + (k * TAU) / n;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, set: StimulusSet): void {
  const s = set.spark;
  if (s.shape === 'star') {
    // 8本の光（16 頂点の星形）
    ctx.fillStyle = s.color;
    ctx.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k * TAU) / 16;
      const rr = k % 2 === 0 ? r : r * 0.45;
      const px = x + rr * Math.cos(a);
      const py = y + rr * Math.sin(a);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = s.core;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, TAU);
    ctx.fill();
  } else {
    // 輪＋中心の点
    ctx.strokeStyle = s.color;
    ctx.lineWidth = r * 0.42;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.79, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = s.core;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.26, 0, TAU);
    ctx.fill();
  }
}

export function drawDistractor(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, shape: DistractorShape, rot: number): void {
  const turn = (rot * Math.PI) / 2;
  ctx.beginPath();
  switch (shape) {
    case 'triangle':
      polygonPath(ctx, x, y, d * 1.2, 3, turn - Math.PI / 2);
      break;
    case 'square':
      ctx.rect(x - d * 0.8, y - d * 0.8, d * 1.6, d * 1.6);
      break;
    case 'diamond':
      polygonPath(ctx, x, y, d * 1.1, 4, -Math.PI / 2);
      break;
    case 'circle':
      ctx.arc(x, y, d * 0.9, 0, TAU);
      break;
    case 'cross': {
      const w = d * 0.55;
      ctx.rect(x - d, y - w / 2, d * 2, w);
      ctx.rect(x - w / 2, y - d, w, d * 2);
      break;
    }
    case 'hexagon':
      polygonPath(ctx, x, y, d, 6, turn / 3);
      break;
  }
  ctx.fill();
}

// ---------------------------------------------------------------------------
// フェーズごとの画面
// ---------------------------------------------------------------------------

interface Geo {
  size: number;
  c: number;
  R: number;
}

function drawFixation(ctx: CanvasRenderingContext2D, g: Geo): void {
  const a = g.R * 0.05;
  ctx.strokeStyle = FIXATION_COLOR;
  ctx.lineWidth = Math.max(2, g.R * 0.016);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(g.c - a, g.c);
  ctx.lineTo(g.c + a, g.c);
  ctx.moveTo(g.c, g.c - a);
  ctx.lineTo(g.c, g.c + a);
  ctx.stroke();
}

function drawStimulus(ctx: CanvasRenderingContext2D, g: Geo, trial: DhTrial, surface: SurfaceSpec, set: StimulusSet): void {
  // 妨害 → 火花 → 中央の構え（互いに重ならない位置に置いてある）
  ctx.fillStyle = set.distractor.color;
  const shapes = set.distractor.shapes;
  for (const d of trial.distractors as readonly Distractor[]) {
    const shape = shapes[((d.shape % shapes.length) + shapes.length) % shapes.length] as DistractorShape;
    drawDistractor(ctx, g.c + d.x * g.R, g.c + d.y * g.R, DISTRACTOR_R * g.R, shape, d.rot);
  }
  const p = sparkPosition(trial);
  drawSpark(ctx, g.c + p.x * g.R, g.c + p.y * g.R, SPARK_R * g.R, set);
  drawFigure(ctx, g.c, g.c, g.R, trial.stance, surface.figure);
}

/** マスクの灰色の段階（RGB） */
const MASK_RGB: readonly (readonly [number, number, number])[] = MASK_LEVELS.map((hex) => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
});

/**
 * マスク（砂嵐）の模様: MASK_RES × MASK_RES マスの灰色のノイズ（RGBA）。
 * 3×3 マスごとの粗いまだら（28×28）に、30% のマスだけ別の灰色の細かい点を混ぜた2段のノイズ。種が同じなら同じ模様。
 */
export function maskPixels(seed: number): Uint8ClampedArray {
  const rnd = mulberry32(seed);
  const n = MASK_RES;
  const cn = MASK_CELLS;
  const levels = MASK_RGB.length;
  const coarse: number[] = [];
  for (let k = 0; k < cn * cn; k++) coarse.push(Math.floor(rnd.next() * levels));
  const out = new Uint8ClampedArray(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let level = coarse[Math.floor(j / 3) * cn + Math.floor(i / 3)] as number;
      if (rnd.next() < 0.3) level = Math.floor(rnd.next() * levels);
      const rgb = MASK_RGB[level] as readonly [number, number, number];
      const o = (j * n + i) * 4;
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 下書きが作れない環境（テストなど）用: マスの模様を矩形で直接描く（横に続く同じ色はまとめる） */
function drawMaskCells(ctx: CanvasRenderingContext2D, g: Geo, pixels: Uint8ClampedArray): void {
  const n = MASK_RES;
  const cell = g.size / n;
  const byLevel: number[][] = MASK_RGB.map(() => []);
  for (let j = 0; j < n; j++) {
    let i = 0;
    while (i < n) {
      const o = (j * n + i) * 4;
      const level = MASK_RGB.findIndex((c) => c[0] === pixels[o] && c[1] === pixels[o + 1] && c[2] === pixels[o + 2]);
      let len = 1;
      while (i + len < n && pixels[o + len * 4] === pixels[o] && pixels[o + len * 4 + 1] === pixels[o + 1] && pixels[o + len * 4 + 2] === pixels[o + 2]) len++;
      (byLevel[Math.max(0, level)] as number[]).push(i, j, len);
      i += len;
    }
  }
  MASK_LEVELS.forEach((color, k) => {
    const runs = byLevel[k] as number[];
    if (runs.length === 0) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let m = 0; m < runs.length; m += 3) {
      ctx.rect((runs[m] as number) * cell, (runs[m + 1] as number) * cell, (runs[m + 2] as number) * cell + 0.5, cell + 0.5);
    }
    ctx.fill();
  });
}

/**
 * マスクの下書き（MASK_RES × MASK_RES の小さな Canvas）。注視点の間に次の試行の模様を書いておき、
 * マスクのフレームでは拡大して貼るだけにする（1 回の drawImage）。
 * マスクの最初のフレームは刺激を消すフレームなので、そこで描画が重くて表示が遅れると、刺激が T より長く見えてしまうため。
 */
interface MaskBuffer {
  image: CanvasImageSource;
  ctx: CanvasRenderingContext2D;
  /** いま書いてある模様の種 */
  seed: number | null;
}

let maskBuffer: MaskBuffer | null | undefined;

function createMaskBuffer(): MaskBuffer | null {
  const n = MASK_RES;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(n, n);
      const x = c.getContext('2d');
      if (x) return { image: c, ctx: x as unknown as CanvasRenderingContext2D, seed: null };
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const c = document.createElement('canvas');
      if (typeof c.getContext !== 'function') return null;
      c.width = n;
      c.height = n;
      const x = c.getContext('2d');
      if (x) return { image: c, ctx: x, seed: null };
    }
  } catch {
    /* 作れない環境では矩形で直接描く */
  }
  return null;
}

/** 試行のマスクの下書きを用意する（種が違えば書き直す）。用意できない環境では null */
function preparedMask(seed: number): CanvasImageSource | null {
  if (maskBuffer === undefined) maskBuffer = createMaskBuffer();
  const b = maskBuffer;
  if (!b) return null;
  if (b.seed !== seed) {
    try {
      const img = b.ctx.createImageData(MASK_RES, MASK_RES);
      img.data.set(maskPixels(seed));
      b.ctx.putImageData(img, 0, 0);
      b.seed = seed;
    } catch {
      maskBuffer = null;
      return null;
    }
  }
  return b.image;
}

/** マスク（砂嵐）: 刺激領域全体をノイズで覆う。模様は試行ごとに固定（静止画） */
function drawMask(ctx: CanvasRenderingContext2D, g: Geo, seed: number): void {
  const image = preparedMask(seed);
  if (image) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, g.size, g.size);
    return;
  }
  drawMaskCells(ctx, g, maskPixels(seed));
}

/** 応答画面: 火花が出る円周上の 8 つの丸（タップで方向を答えられる）。選んだ方向を強調する */
function drawResponse(ctx: CanvasRenderingContext2D, g: Geo, trial: DhTrial, selection: Response): void {
  const e = trial.eccPct / 100;
  const sr = SOCKET_R * g.R;
  const chosen = selection[DIR_GROUP];
  for (const d of DIRS) {
    const v = dirVector(d.id);
    const x = g.c + v.x * e * g.R;
    const y = g.c + v.y * e * g.R;
    const sel = chosen === d.id;
    ctx.beginPath();
    ctx.arc(x, y, sr, 0, TAU);
    ctx.fillStyle = sel ? SOCKET_FILL_SELECTED : SOCKET_FILL;
    ctx.fill();
    ctx.lineWidth = sel ? Math.max(3, g.R * 0.02) : Math.max(1.5, g.R * 0.01);
    ctx.strokeStyle = sel ? SOCKET_STROKE_SELECTED : SOCKET_STROKE;
    ctx.stroke();
  }
  ctx.fillStyle = CENTER_DOT;
  ctx.beginPath();
  ctx.arc(g.c, g.c, Math.max(2, g.R * 0.02), 0, TAU);
  ctx.fill();
}

/** renderStimulus の本体 */
export function renderTrial(ctx: CanvasRenderingContext2D, trial: DhTrial, phase: PhaseName, view: RenderView): void {
  const size = view.size;
  if (!(size > 0)) return;
  const g: Geo = { size, c: size / 2, R: size / 2 };
  if (phase === 'mask') {
    drawMask(ctx, g, trial.maskSeed);
    return;
  }
  const surface = surfaceSpec(view.surface);
  ctx.fillStyle = surface.bg;
  ctx.fillRect(0, 0, size, size);
  switch (phase) {
    case 'fixation':
      drawFixation(ctx, g);
      // この試行のマスクの模様を先に書いておく（注視点の最初のフレームで1回だけ）
      preparedMask(trial.maskSeed);
      break;
    case 'stimulus':
      drawStimulus(ctx, g, trial, surface, stimulusSet(view.untrained));
      break;
    case 'response':
    case 'feedback':
      drawResponse(ctx, g, trial, view.selection);
      break;
    default:
      // iti（と使わない cue）は背景だけ
      break;
  }
}
