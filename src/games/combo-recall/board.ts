/**
 * コンボ・リコールの刺激領域の描画（Canvas 2D、フラットなベクター描画のみ）。
 *
 * - 訓練: 3×3 のマス。中央は敵のシルエットで、まわりの 8 マスが「攻撃位置」（位置 0..7 は左上から時計回り）。
 * - 認定戦（未訓練セット）: 円周上の 8 点。訓練の方向と重ならないよう 22.5° ずらす。中央は注視用の小さな印だけ。
 * - 表層バリエーション（surface）で変えるのは、マスの形と色・敵のシルエット・背景色だけ（時間は変えない）。
 * - 点灯と消灯は明るさの差で区別し、点灯マスには形の印（打撃マーク）も付ける（色だけに頼らない）。
 * - 時刻 t に依存する描画はしない（刺激提示中に動くものを出さない。仕様書 13-8）。乱数も使わない。
 */
import { artInRound, drawSprite, type SpriteKey } from '../../skin/art';
import { POSITIONS } from './nback';

export type TileShape = 'square' | 'disc' | 'diamond';
export type EnemyPose = 'guard' | 'low' | 'wide';

export interface BoardStyle {
  /** 刺激領域の背景 */
  bg: string;
  /** 消灯中のマス */
  tile: string;
  tileEdge: string;
  /** 点灯中のマス */
  lit: string;
  /** 点灯中のマスの中の打撃マーク */
  litMark: string;
  /** 中央の敵のシルエット（訓練）／注視用の印（認定戦） */
  center: string;
  shape: TileShape;
  /** 訓練の敵の構え（認定戦は null = 敵を描かない） */
  pose: EnemyPose | null;
}

/** 訓練の表層バリエーション（仕様書 4.4。最初の2試合は 0 番） */
export const TRAINING_STYLES: readonly BoardStyle[] = [
  // 0: 夜の道場
  { bg: '#121626', tile: '#222a45', tileEdge: '#3b456d', lit: '#ffd166', litMark: '#5c3d00', center: '#343d62', shape: 'square', pose: 'guard' },
  // 1: 夕暮れ
  { bg: '#1b1325', tile: '#33243f', tileEdge: '#56426c', lit: '#ffb28a', litMark: '#5a2410', center: '#443253', shape: 'disc', pose: 'low' },
  // 2: 竹林
  { bg: '#0e1b19', tile: '#1b322d', tileEdge: '#335d53', lit: '#a6efcd', litMark: '#0d4430', center: '#2a4841', shape: 'diamond', pose: 'wide' },
];

/** 認定戦の未訓練セット（円周上の 8 点） */
export const RING_STYLE: BoardStyle = {
  bg: '#17191f',
  tile: '#272b35',
  tileEdge: '#4b5263',
  lit: '#eaf4ff',
  litMark: '#1d3b63',
  center: '#4b5263',
  shape: 'disc',
  pose: null,
};

/** 表層バリエーションの数（GameModule.surfaceCount） */
export const SURFACE_COUNT = TRAINING_STYLES.length;

export function boardStyle(surface: number, untrained: boolean): BoardStyle {
  if (untrained) return RING_STYLE;
  const k = Number.isFinite(surface) ? Math.trunc(surface) : 0;
  return TRAINING_STYLES[((k % SURFACE_COUNT) + SURFACE_COUNT) % SURFACE_COUNT] as BoardStyle;
}

/** マス（攻撃位置）1つの中心と大きさ（r = 中心から辺・円周までの距離） */
export interface Slot {
  x: number;
  y: number;
  r: number;
}

/** 3×3 の外周 8 マス（左上から時計回り）の [行, 列] */
const GRID_CELLS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [2, 1],
  [2, 0],
  [1, 0],
];

function gridGeometry(size: number): { margin: number; gap: number; cell: number } {
  const margin = size * 0.07;
  const gap = size * 0.035;
  return { margin, gap, cell: (size - 2 * margin - 2 * gap) / 3 };
}

/** 訓練の 8 マスの位置 */
export function gridSlots(size: number): Slot[] {
  const { margin, gap, cell } = gridGeometry(size);
  return GRID_CELLS.map(([row, col]) => ({
    x: margin + col * (cell + gap) + cell / 2,
    y: margin + row * (cell + gap) + cell / 2,
    r: (cell / 2) * 0.92,
  }));
}

/** 3×3 の中央のマス（敵の立ち位置） */
export function gridCenter(size: number): Slot {
  const { cell } = gridGeometry(size);
  return { x: size / 2, y: size / 2, r: cell / 2 };
}

/** 認定戦の円周上の 8 点（真上から 22.5° ずらして時計回り） */
export function ringSlots(size: number): Slot[] {
  const R = size * 0.36;
  const r = size * 0.085;
  return Array.from({ length: POSITIONS }, (_, k) => {
    const a = -Math.PI / 2 + Math.PI / 8 + (k * 2 * Math.PI) / POSITIONS;
    return { x: size / 2 + R * Math.cos(a), y: size / 2 + R * Math.sin(a), r };
  });
}

export function boardSlots(size: number, untrained: boolean): Slot[] {
  return untrained ? ringSlots(size) : gridSlots(size);
}

// ---------------------------------------------------------------------------

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number): void {
  const r = Math.max(0, Math.min(rad, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function tilePath(ctx: CanvasRenderingContext2D, s: Slot, shape: TileShape): void {
  ctx.beginPath();
  if (shape === 'disc') {
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  } else if (shape === 'diamond') {
    const d = s.r * 1.12;
    ctx.moveTo(s.x, s.y - d);
    ctx.lineTo(s.x + d, s.y);
    ctx.lineTo(s.x, s.y + d);
    ctx.lineTo(s.x - d, s.y);
    ctx.closePath();
  } else {
    roundedRectPath(ctx, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2, s.r * 0.22);
  }
}

/** 点灯マスの中の打撃マーク（8 本のとげの星形） */
function drawBurst(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  for (let k = 0; k < 16; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 8;
    const rr = k % 2 === 0 ? r : r * 0.45;
    const px = x + rr * Math.cos(a);
    const py = y + rr * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

type Pt = readonly [number, number];
interface PoseShape {
  head: Pt;
  neck: Pt;
  hip: Pt;
  /** 片側の腕（肩→肘→拳）。反対側は左右対称 */
  arm: readonly [Pt, Pt, Pt];
  /** 片側の脚（股関節→膝→足） */
  leg: readonly [Pt, Pt, Pt];
}

/** 正面向きの敵の構え（身長 1、足もと中央が原点、y は上がマイナス）。実在のキャラを模さない単純な図形 */
const POSES: Readonly<Record<EnemyPose, PoseShape>> = {
  guard: {
    head: [0, -0.87],
    neck: [0, -0.74],
    hip: [0, -0.42],
    arm: [
      [0.12, -0.72],
      [0.24, -0.56],
      [0.1, -0.62],
    ],
    leg: [
      [0.07, -0.42],
      [0.14, -0.2],
      [0.2, 0],
    ],
  },
  low: {
    head: [0, -0.74],
    neck: [0, -0.62],
    hip: [0, -0.32],
    arm: [
      [0.13, -0.6],
      [0.27, -0.47],
      [0.2, -0.6],
    ],
    leg: [
      [0.08, -0.32],
      [0.26, -0.2],
      [0.34, 0],
    ],
  },
  wide: {
    head: [0, -0.87],
    neck: [0, -0.74],
    hip: [0, -0.42],
    arm: [
      [0.12, -0.72],
      [0.27, -0.7],
      [0.38, -0.82],
    ],
    leg: [
      [0.07, -0.42],
      [0.1, -0.2],
      [0.14, 0],
    ],
  },
};

/** 構えごとの画像のシルエット（正面の敵 3 体。ラウンドの開始時に読み込み済みのときだけ使う） */
const SPRITE_FOR_POSE: Readonly<Record<EnemyPose, SpriteKey>> = { guard: 'enemy-front-a', low: 'enemy-front-b', wide: 'enemy-front-c' };

/**
 * 中央のマスに敵のシルエットを描く（静止画）。
 * 画像のシルエット（skin/art.ts）がラウンドの開始時に読み込み済みならマスの色に染めて描き、無ければ単純な図形で描く。
 * どちらも盤の一部の静止画で、点灯の判定・時間には関わらない。
 */
function drawEnemy(ctx: CanvasRenderingContext2D, cell: Slot, pose: EnemyPose, color: string): void {
  const p = POSES[pose];
  const h = cell.r * 2 * 0.86;
  const footY = cell.y + h / 2;
  if (drawSprite(ctx, SPRITE_FOR_POSE[pose], { x: cell.x, ground: footY, height: h, facing: 1, color }, artInRound)) return;
  const P = (pt: Pt, side: 1 | -1 = 1): [number, number] => [cell.x + pt[0] * h * side, footY + pt[1] * h];
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 胴体
  ctx.lineWidth = h * 0.19;
  ctx.beginPath();
  ctx.moveTo(...P(p.neck));
  ctx.lineTo(...P(p.hip));
  ctx.stroke();
  // 手足（左右対称）
  ctx.lineWidth = h * 0.085;
  for (const side of [1, -1] as const) {
    for (const limb of [p.arm, p.leg]) {
      ctx.beginPath();
      ctx.moveTo(...P(limb[0], side));
      ctx.lineTo(...P(limb[1], side));
      ctx.lineTo(...P(limb[2], side));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(...P(p.arm[2], side), h * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  // 頭
  ctx.beginPath();
  ctx.arc(...P(p.head), h * 0.105, 0, Math.PI * 2);
  ctx.fill();
}

/** 認定戦の中央の印（小さな円）と、点の並ぶ円周の案内線 */
function drawRingGuide(ctx: CanvasRenderingContext2D, size: number, style: BoardStyle): void {
  const c = size / 2;
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.strokeStyle = style.tile;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, size * 0.007);
  ctx.strokeStyle = style.center;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.025, 0, Math.PI * 2);
  ctx.stroke();
}

export interface BoardOptions {
  /** 点灯している攻撃位置（消灯中は null） */
  lit: number | null;
  surface: number;
  /** 認定戦の未訓練セット（円周上の 8 点） */
  untrained: boolean;
}

/** 盤面（背景・8 つの攻撃位置・中央の敵または印）を描く */
export function drawBoard(ctx: CanvasRenderingContext2D, size: number, opts: BoardOptions): void {
  const style = boardStyle(opts.surface, opts.untrained);
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, size, size);

  if (opts.untrained) drawRingGuide(ctx, size, style);
  else if (style.pose) drawEnemy(ctx, gridCenter(size), style.pose, style.center);

  const slots = boardSlots(size, opts.untrained);
  const edge = Math.max(1.5, size * 0.006);
  slots.forEach((s, k) => {
    const on = k === opts.lit;
    tilePath(ctx, s, style.shape);
    ctx.fillStyle = on ? style.lit : style.tile;
    ctx.fill();
    ctx.lineWidth = edge;
    ctx.strokeStyle = on ? style.lit : style.tileEdge;
    ctx.stroke();
    if (on) drawBurst(ctx, s.x, s.y, s.r * 0.46, style.litMark);
  });
}
