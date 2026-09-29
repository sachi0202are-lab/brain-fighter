/**
 * 刺激領域（正方形 Canvas）の描画。乱数を使わず、試行データとフェーズだけで決まる静止画を描く
 * （経過時間 t は使わない = 提示中に動くものは無い。仕様書 13-8）。
 *
 * 配置（一辺 s に対する割合）
 * - 上部 y 0.035〜0.225: 構えのプレート（手がかり）。cue と stimulus の間だけ「構えA 高低」のように大きく出し、
 *   正誤フィードバックと試行間隔の間は空のプレートにする（毎試行、構えの出だしが分かるように）。
 * - その下: 敵のシルエット（薄い色の静止画）。攻撃アイコンは上段なら胸の高さ (y 0.47)、下段なら膝の高さ (y 0.83)。
 * - 未訓練セット（認定戦）: シルエットなし。アイコンは中央 (y 0.60) に大（半径 0.12）／小（0.06）で出す。
 *
 * 表層バリエーション（surface）は背景色・敵シルエット・アイコンの仕上げだけを変える。
 * 判断軸・色の組・形の組・位置・タイミングはどの表層でも同じ。
 */
import type { PhaseName, RenderView } from '../../engine/types';
import { stanceChangeText as text } from '../../i18n/ja/stance-change';
import { RULE_LETTER, type Rule, type ScTrial, type Side } from './model';

const FONT = "system-ui, -apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic UI', Meiryo, sans-serif";

export type IconStyle = 'solid' | 'ring' | 'gloss';
export type Figure = 'orthodox' | 'heavy' | 'slim';
export type IconShape = 'burst' | 'circle' | 'square' | 'hexagon' | 'triangle' | 'cross';

export interface Look {
  background: string;
  /** 敵シルエットの色（null なら描かない） */
  enemy: string | null;
  figure: Figure;
  iconStyle: IconStyle;
}

/** 表層バリエーション（0 は最初の2試合の固定セット） */
export const SURFACES: readonly Look[] = [
  { background: '#121626', enemy: '#262d4b', figure: 'orthodox', iconStyle: 'solid' },
  { background: '#1a1427', enemy: '#322845', figure: 'heavy', iconStyle: 'ring' },
  { background: '#0f1c1e', enemy: '#233a3c', figure: 'slim', iconStyle: 'gloss' },
];

/** 未訓練セット（認定戦）の見た目。表層番号によらず固定 */
export const UNTRAINED_LOOK: Look = { background: '#16171c', enemy: null, figure: 'orthodox', iconStyle: 'solid' };

export interface Palette {
  /** 左の値（橙／黄）の色 */
  left: string;
  /** 右の値（青／紫）の色 */
  right: string;
  /** 色覚配慮モード: 右の値の色に重ねる斜線の色（null なら斜線なし） */
  hatch: string | null;
}

/**
 * 色の組。橙／青・黄／紫はどちらも赤緑の色覚特性で混ざりにくい組で、明るさにも差をつけてある
 * （色覚シミュレーション［1型・2型・3型］でも2色の差 ΔE*ab は約 40 以上、背景とのコントラスト比は 3.6 以上）。
 * 色覚配慮モードでは明るさの差を約2倍に広げ、右の値に斜線を重ねて色以外でも見分けられるようにする。
 */
export const PALETTES: Readonly<Record<'train' | 'untrained', Readonly<Record<'normal' | 'safe', Palette>>>> = {
  train: {
    normal: { left: '#ff9f1c', right: '#3a86ff', hatch: null },
    safe: { left: '#ffc02e', right: '#2f72ea', hatch: '#c4d8ff' },
  },
  untrained: {
    normal: { left: '#f2e14c', right: '#a86bf0', hatch: null },
    safe: { left: '#f6e85e', right: '#8452e0', hatch: '#e2d4ff' },
  },
};

const INK = '#f3f5ff';

/** 位置と大きさ（一辺に対する割合） */
export const GEOMETRY = {
  plate: { x: 0.06, y: 0.035, w: 0.88, h: 0.19, r: 0.035 },
  icon: { x: 0.5, yHigh: 0.47, yLow: 0.83, r: 0.085 },
  untrainedIcon: { x: 0.5, y: 0.6, rLarge: 0.12, rSmall: 0.06 },
} as const;

export function lookFor(view: Pick<RenderView, 'untrained' | 'surface'>): Look {
  if (view.untrained) return UNTRAINED_LOOK;
  const n = SURFACES.length;
  const i = Number.isFinite(view.surface) ? ((Math.round(view.surface) % n) + n) % n : 0;
  return SURFACES[i] as Look;
}

export function paletteFor(view: Pick<RenderView, 'untrained' | 'colorSafe'>): Palette {
  return PALETTES[view.untrained ? 'untrained' : 'train'][view.colorSafe ? 'safe' : 'normal'];
}

/** アイコンの形（2 ルールでは形が変わらない中立の形） */
export function iconShape(shape: Side | null, untrained: boolean): IconShape {
  if (shape === null) return untrained ? 'hexagon' : 'burst';
  if (untrained) return shape === 'left' ? 'triangle' : 'cross';
  return shape === 'left' ? 'circle' : 'square';
}

/** アイコンの中心と半径 */
export function iconPlacement(trial: Pick<ScTrial, 'height'>, size: number, untrained: boolean): { x: number; y: number; r: number } {
  if (untrained) {
    const g = GEOMETRY.untrainedIcon;
    return { x: g.x * size, y: g.y * size, r: (trial.height === 'left' ? g.rLarge : g.rSmall) * size };
  }
  const g = GEOMETRY.icon;
  return { x: g.x * size, y: (trial.height === 'left' ? g.yHigh : g.yLow) * size, r: g.r * size };
}

/** 構えの名前（プレートに大きく出す） */
export function stanceName(rule: Rule, untrained: boolean): string {
  return (untrained ? text.stance.namesUntrained : text.stance.names)[rule];
}

// ---------------------------------------------------------------------------

export function renderStance(ctx: CanvasRenderingContext2D, trial: ScTrial, phase: PhaseName, view: RenderView): void {
  const s = view.size;
  const look = lookFor(view);
  ctx.fillStyle = look.background;
  ctx.fillRect(0, 0, s, s);
  if (look.enemy) drawEnemy(ctx, s, look.figure, look.enemy);
  const cueOn = phase === 'cue' || phase === 'stimulus';
  drawPlate(ctx, s, cueOn ? trial.rule : null, view.untrained);
  if (phase === 'stimulus') drawIcon(ctx, s, trial, view, look);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 構えのプレート。rule が null なら空（手がかりなし） */
function drawPlate(ctx: CanvasRenderingContext2D, s: number, rule: Rule | null, untrained: boolean): void {
  const g = GEOMETRY.plate;
  roundRectPath(ctx, g.x * s, g.y * s, g.w * s, g.h * s, g.r * s);
  if (rule === null) {
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(231,234,246,0.16)';
    ctx.lineWidth = Math.max(1, s * 0.005);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = '#262e52';
  ctx.fill();
  ctx.strokeStyle = '#e7eaf6';
  ctx.lineWidth = Math.max(1.5, s * 0.008);
  ctx.stroke();
  const cy = (g.y + g.h / 2) * s;
  // 左: 「構え」＋ A / B / C
  const lx = 0.19 * s;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c9cfe8';
  ctx.font = `600 ${Math.max(8, Math.round(s * 0.042))}px ${FONT}`;
  ctx.fillText(text.stance.prefix, lx, cy - s * 0.045);
  ctx.fillStyle = INK;
  ctx.font = `800 ${Math.max(10, Math.round(s * 0.085))}px ${FONT}`;
  ctx.fillText(RULE_LETTER[rule], lx, cy + s * 0.03);
  // 区切り線
  ctx.strokeStyle = 'rgba(231,234,246,0.35)';
  ctx.lineWidth = Math.max(1, s * 0.004);
  ctx.beginPath();
  ctx.moveTo(0.31 * s, (g.y + 0.035) * s);
  ctx.lineTo(0.31 * s, (g.y + g.h - 0.035) * s);
  ctx.stroke();
  // 右: 構えの名前を大きく
  ctx.fillStyle = INK;
  ctx.font = `800 ${Math.max(12, Math.round(s * 0.11))}px ${FONT}`;
  ctx.fillText(stanceName(rule, untrained), 0.62 * s, cy + s * 0.004);
}

// ---- 敵シルエット（正面向き・静止） ----

type P = readonly [number, number];
/** 手足 = 左右の折れ線（付け根 → 関節 → 先）と太さ */
interface Limbs {
  left: readonly P[];
  right: readonly P[];
  w: number;
}
interface FigureSpec {
  head: { c: P; r: number };
  /** 頭の上のまげ（細身だけ） */
  knot?: { c: P; r: number };
  torso: { from: P; to: P; w: number };
  shoulders: { from: P; to: P; w: number };
  arms: Limbs;
  fists: { c: readonly P[]; r: number };
  legs: Limbs;
}

const FIGURES: Readonly<Record<Figure, FigureSpec>> = {
  orthodox: {
    head: { c: [0.5, 0.345], r: 0.052 },
    torso: { from: [0.5, 0.4], to: [0.5, 0.63], w: 0.12 },
    shoulders: { from: [0.405, 0.435], to: [0.595, 0.435], w: 0.06 },
    arms: { left: [[0.405, 0.44], [0.35, 0.53], [0.43, 0.46]], right: [[0.595, 0.44], [0.65, 0.53], [0.57, 0.46]], w: 0.05 },
    fists: { c: [[0.43, 0.455], [0.57, 0.455]], r: 0.03 },
    legs: { left: [[0.47, 0.63], [0.405, 0.79], [0.37, 0.965]], right: [[0.53, 0.63], [0.595, 0.79], [0.63, 0.965]], w: 0.065 },
  },
  heavy: {
    head: { c: [0.5, 0.35], r: 0.06 },
    torso: { from: [0.5, 0.41], to: [0.5, 0.64], w: 0.17 },
    shoulders: { from: [0.37, 0.44], to: [0.63, 0.44], w: 0.08 },
    arms: { left: [[0.37, 0.45], [0.31, 0.55], [0.41, 0.48]], right: [[0.63, 0.45], [0.69, 0.55], [0.59, 0.48]], w: 0.065 },
    fists: { c: [[0.41, 0.47], [0.59, 0.47]], r: 0.036 },
    legs: { left: [[0.46, 0.64], [0.37, 0.8], [0.32, 0.965]], right: [[0.54, 0.64], [0.63, 0.8], [0.68, 0.965]], w: 0.08 },
  },
  slim: {
    head: { c: [0.5, 0.335], r: 0.048 },
    knot: { c: [0.5, 0.276], r: 0.02 },
    torso: { from: [0.5, 0.39], to: [0.5, 0.635], w: 0.1 },
    shoulders: { from: [0.42, 0.425], to: [0.58, 0.425], w: 0.05 },
    arms: { left: [[0.42, 0.43], [0.36, 0.5], [0.39, 0.4]], right: [[0.58, 0.43], [0.645, 0.52], [0.565, 0.5]], w: 0.042 },
    fists: { c: [[0.39, 0.395], [0.565, 0.5]], r: 0.026 },
    legs: { left: [[0.48, 0.635], [0.4, 0.8], [0.33, 0.97]], right: [[0.52, 0.635], [0.6, 0.79], [0.66, 0.96]], w: 0.055 },
  },
};

function polyline(ctx: CanvasRenderingContext2D, s: number, pts: readonly P[], w: number): void {
  ctx.lineWidth = w * s;
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x * s, y * s) : ctx.lineTo(x * s, y * s)));
  ctx.stroke();
}

function disc(ctx: CanvasRenderingContext2D, s: number, [x, y]: P, r: number): void {
  ctx.beginPath();
  ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemy(ctx: CanvasRenderingContext2D, s: number, figure: Figure, color: string): void {
  const f = FIGURES[figure];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  polyline(ctx, s, [f.torso.from, f.torso.to], f.torso.w);
  polyline(ctx, s, [f.shoulders.from, f.shoulders.to], f.shoulders.w);
  for (const limbs of [f.legs, f.arms]) {
    polyline(ctx, s, limbs.left, limbs.w);
    polyline(ctx, s, limbs.right, limbs.w);
  }
  for (const c of f.fists.c) disc(ctx, s, c, f.fists.r);
  disc(ctx, s, f.head.c, f.head.r);
  if (f.knot) disc(ctx, s, f.knot.c, f.knot.r);
  ctx.restore();
}

// ---- 攻撃アイコン ----

function polygon(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, R: number, rot: number): void {
  for (let k = 0; k < n; k++) {
    const a = rot + (2 * Math.PI * k) / n;
    const px = x + R * Math.cos(a);
    const py = y + R * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, points: number, outer: number, inner: number): void {
  for (let k = 0; k < points * 2; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / points;
    const R = k % 2 === 0 ? outer : inner;
    const px = x + R * Math.cos(a);
    const py = y + R * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
}

function plus(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, w: number): void {
  const pts: P[] = [
    [-w, -a], [w, -a], [w, -w], [a, -w], [a, w], [w, w],
    [w, a], [-w, a], [-w, w], [-a, w], [-a, -w], [-w, -w],
  ];
  pts.forEach(([dx, dy], k) => (k === 0 ? ctx.moveTo(x + dx, y + dy) : ctx.lineTo(x + dx, y + dy)));
}

/**
 * 形のパス。r は「同じ面積の円の半径」（形で大きさの印象が変わらないように面積をそろえる）。
 */
export function shapePath(ctx: CanvasRenderingContext2D, kind: IconShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (kind) {
    case 'circle':
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'square': {
      const h = r * 0.886; // 一辺 1.772r ≒ 円と同じ面積
      ctx.rect(x - h, y - h, 2 * h, 2 * h);
      break;
    }
    case 'burst':
      star(ctx, x, y, 8, r * 1.15, r * 0.8);
      break;
    case 'hexagon':
      polygon(ctx, x, y, 6, r * 1.1, -Math.PI / 2);
      break;
    case 'triangle':
      polygon(ctx, x, y, 3, r * 1.55, -Math.PI / 2);
      break;
    case 'cross':
      plus(ctx, x, y, r * 1.25, r * 0.35);
      break;
  }
  ctx.closePath();
}

function drawIcon(ctx: CanvasRenderingContext2D, s: number, trial: ScTrial, view: RenderView, look: Look): void {
  const pal = paletteFor(view);
  const kind = iconShape(trial.shape, view.untrained);
  const { x, y, r } = iconPlacement(trial, s, view.untrained);
  const fill = trial.color === 'left' ? pal.left : pal.right;
  ctx.save();
  ctx.lineJoin = 'round';
  shapePath(ctx, kind, x, y, r);
  ctx.fillStyle = fill;
  ctx.fill();
  // 色覚配慮モード: 右の値の色に斜線を重ねる（色以外の手がかり）
  if (pal.hatch && trial.color === 'right') {
    ctx.save();
    shapePath(ctx, kind, x, y, r);
    ctx.clip();
    ctx.strokeStyle = pal.hatch;
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    const span = r * 1.8;
    for (let d = -2 * span; d <= 2 * span; d += r * 0.32) {
      ctx.moveTo(x + d - span, y + span);
      ctx.lineTo(x + d + span, y - span);
    }
    ctx.stroke();
    ctx.restore();
  }
  // 表層ごとの仕上げ（色・形・位置は変えない）
  if (look.iconStyle === 'ring') {
    shapePath(ctx, kind, x, y, r * 0.55);
    ctx.strokeStyle = 'rgba(12,14,24,0.55)';
    ctx.lineWidth = Math.max(1, s * 0.01);
    ctx.stroke();
  } else if (look.iconStyle === 'gloss') {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // 白いふち（背景・シルエットから浮かせる）
  shapePath(ctx, kind, x, y, r);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, s * 0.012);
  ctx.stroke();
  ctx.restore();
}
