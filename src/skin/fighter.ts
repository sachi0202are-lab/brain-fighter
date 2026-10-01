/**
 * ファイター（自キャラ・敵キャラ）の描画。ラウンド間・結果画面だけで描く。刺激領域（ゲーム中の Canvas）には描かない。
 *
 * - 画像のシルエット（public/art/fighters/。生成画像から作った黒＋アルファの静止画）が読み込み済みなら、使う場所の色に染めて描く。
 * - 無ければ単純な図形の組合せ（棒人間）で描く。どちらも影絵風のシルエットで、ポーズの意味は同じ。
 * - 2 人が向き合う場面（drawScene）は、ステージ背景の画像があればその上に明るいシルエット、無ければ単色の背景に暗いシルエット。
 */
import { drawSprite, drawStageBackdrop, type SpriteKey } from './art';

export type Pose = 'guard' | 'victory' | 'down' | 'strike';
export type Who = 'player' | 'enemy';

/** 単色の背景に描くときのシルエットの色 */
export const INK = '#0b0d17';
/** ステージ背景の画像の上に描くときのシルエットの色 */
export const LIGHT_INK = '#eef1ff';

/** 画像のスプライトがあるポーズ */
const SPRITE_FOR: Readonly<Record<Who, Partial<Record<Pose, SpriteKey>>>> = {
  player: { guard: 'player-guard', strike: 'player-strike', victory: 'player-victory' },
  enemy: { guard: 'enemy-guard', down: 'enemy-down' },
};

interface Pt {
  x: number;
  y: number;
}

/** 右向き・身長 1 の座標系での関節位置（y は上がマイナス） */
function joints(pose: Pose): { head: Pt; neck: Pt; hip: Pt; limbs: Pt[][]; fists: Pt[] } {
  if (pose === 'down') {
    return {
      head: { x: -0.46, y: -0.08 },
      neck: { x: -0.36, y: -0.08 },
      hip: { x: 0.02, y: -0.07 },
      limbs: [
        [{ x: 0.02, y: -0.07 }, { x: 0.2, y: -0.12 }, { x: 0.4, y: -0.05 }],
        [{ x: 0.02, y: -0.07 }, { x: 0.22, y: -0.05 }, { x: 0.42, y: -0.04 }],
        [{ x: -0.32, y: -0.09 }, { x: -0.2, y: -0.2 }, { x: -0.08, y: -0.16 }],
        [{ x: -0.32, y: -0.07 }, { x: -0.22, y: -0.03 }, { x: -0.1, y: -0.04 }],
      ],
      fists: [{ x: -0.08, y: -0.16 }, { x: -0.1, y: -0.04 }],
    };
  }
  if (pose === 'strike') {
    // 踏み込んで前の手を伸ばした形（必殺演出の一瞬だけ。ラウンド間のみ）
    const sh = { x: 0.06, y: -0.72 };
    const hp = { x: -0.04, y: -0.44 };
    const arms: Pt[][] = [
      [sh, { x: 0.28, y: -0.72 }, { x: 0.5, y: -0.73 }],
      [sh, { x: 0.12, y: -0.6 }, { x: 0.16, y: -0.74 }],
    ];
    return {
      head: { x: 0.1, y: -0.86 },
      neck: { x: 0.07, y: -0.77 },
      hip: hp,
      limbs: [
        [hp, { x: 0.2, y: -0.26 }, { x: 0.3, y: 0 }],
        [hp, { x: -0.18, y: -0.22 }, { x: -0.34, y: 0 }],
        ...arms,
      ],
      fists: arms.map((a) => a[2] as Pt),
    };
  }
  const shoulder = { x: 0.01, y: -0.75 };
  const hip = { x: -0.02, y: -0.47 };
  const legs: Pt[][] =
    pose === 'victory'
      ? [
          [hip, { x: 0.07, y: -0.24 }, { x: 0.12, y: 0 }],
          [hip, { x: -0.08, y: -0.24 }, { x: -0.13, y: 0 }],
        ]
      : [
          [hip, { x: 0.13, y: -0.25 }, { x: 0.21, y: 0 }],
          [hip, { x: -0.1, y: -0.24 }, { x: -0.21, y: 0 }],
        ];
  const arms: Pt[][] =
    pose === 'victory'
      ? [
          [shoulder, { x: 0.1, y: -0.93 }, { x: 0.12, y: -1.1 }],
          [shoulder, { x: -0.1, y: -0.62 }, { x: -0.05, y: -0.52 }],
        ]
      : [
          [shoulder, { x: 0.17, y: -0.63 }, { x: 0.21, y: -0.8 }],
          [shoulder, { x: 0.07, y: -0.6 }, { x: 0.11, y: -0.76 }],
        ];
  return {
    head: { x: 0.03, y: -0.9 },
    neck: { x: 0.01, y: -0.8 },
    hip,
    limbs: [...legs, ...arms],
    fists: arms.map((a) => a[2] as Pt),
  };
}

export interface FighterOptions {
  /** 足元の x（CSS px） */
  x: number;
  /** 地面の y（CSS px） */
  ground: number;
  /** 身長（CSS px） */
  height: number;
  /** 1 = 右向き、−1 = 左向き */
  facing: 1 | -1;
  pose: Pose;
  color: string;
  /** 不透明度（残像用。既定 1） */
  alpha?: number;
  /** 画像のスプライトを使う側（省略すると図形だけで描く） */
  who?: Who;
}

export function drawFighter(ctx: CanvasRenderingContext2D, o: FighterOptions): void {
  const key = o.who ? SPRITE_FOR[o.who][o.pose] : undefined;
  if (key !== undefined && drawSprite(ctx, key, { x: o.x, ground: o.ground, height: o.height, facing: o.facing, color: o.color, alpha: o.alpha })) {
    return;
  }
  const j = joints(o.pose);
  const h = o.height;
  const P = (p: Pt): [number, number] => [o.x + p.x * h * o.facing, o.ground + p.y * h];
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 胴体
  ctx.lineWidth = h * 0.19;
  ctx.beginPath();
  ctx.moveTo(...P(j.neck));
  ctx.lineTo(...P(j.hip));
  ctx.stroke();
  // 手足
  ctx.lineWidth = h * 0.095;
  for (const limb of j.limbs) {
    ctx.beginPath();
    limb.forEach((p, k) => (k === 0 ? ctx.moveTo(...P(p)) : ctx.lineTo(...P(p))));
    ctx.stroke();
  }
  // 拳
  for (const f of j.fists) {
    ctx.beginPath();
    ctx.arc(...P(f), h * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  // 頭
  ctx.beginPath();
  ctx.arc(...P(j.head), h * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export interface SceneOptions {
  width: number;
  height: number;
  /** ステージの単色背景（画像が無いとき） */
  background: string;
  player: Pose;
  enemy: Pose;
  /** 敵レベル（ステージ背景の画像を選ぶ）。省略すると単色の背景 */
  level?: number;
  /** 画像（スプライト・背景）を使うか。読み込み済みのときだけ true にして、途中で見た目が変わらないようにする。既定 true */
  art?: boolean;
}

/**
 * 背景を描き、その上に描くシルエットの色を返す。
 * ステージ背景の画像があれば明るいシルエット、無ければ単色の背景＋足元の帯に暗いシルエット。
 */
export function drawSceneBackground(ctx: CanvasRenderingContext2D, o: SceneOptions): string {
  const useArt = o.art ?? true;
  if (useArt && o.level !== undefined && drawStageBackdrop(ctx, { width: o.width, height: o.height, level: o.level })) return LIGHT_INK;
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, o.width, o.height);
  const ground = o.height * 0.86;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, ground, o.width, o.height - ground);
  return INK;
}

/** 2人のファイターが向き合う静止画（ラウンド間・結果画面用） */
export function drawScene(ctx: CanvasRenderingContext2D, o: SceneOptions): void {
  ctx.save();
  const ink = drawSceneBackground(ctx, o);
  const useArt = o.art ?? true;
  const ground = o.height * 0.86;
  const fh = o.height * 0.62;
  const who = (w: Who): { who?: Who } => (useArt ? { who: w } : {});
  drawFighter(ctx, { x: o.width * 0.3, ground, height: fh, facing: 1, pose: o.player, color: ink, ...who('player') });
  drawFighter(ctx, { x: o.width * 0.7, ground, height: fh * 1.05, facing: -1, pose: o.enemy, color: ink, ...who('enemy') });
  ctx.restore();
}

const STAGE_HUES = [28, 200, 140, 265, 350, 45, 175, 225, 5, 300];

/** ステージの色相（敵レベルから決める） */
export function stageHue(level: number): number {
  return STAGE_HUES[Math.abs(Math.round(level)) % STAGE_HUES.length] as number;
}

/** ステージごとの単色背景（敵レベルから決める静的な色） */
export function stageColor(level: number): string {
  return `hsl(${stageHue(level)} 42% 58%)`;
}
