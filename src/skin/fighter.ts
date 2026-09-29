/**
 * シルエットのファイター（単純な図形の組合せ。外部画像素材は使わない）。
 * ラウンド間・結果画面だけで描く。刺激領域（ゲーム中の Canvas）には描かない。
 */
export type Pose = 'guard' | 'victory' | 'down';

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
}

export function drawFighter(ctx: CanvasRenderingContext2D, o: FighterOptions): void {
  const j = joints(o.pose);
  const h = o.height;
  const P = (p: Pt): [number, number] => [o.x + p.x * h * o.facing, o.ground + p.y * h];
  ctx.save();
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
  /** ステージの単色背景 */
  background: string;
  player: Pose;
  enemy: Pose;
}

/** 2人のファイターが向き合う静止画（ラウンド間・結果画面用） */
export function drawScene(ctx: CanvasRenderingContext2D, o: SceneOptions): void {
  ctx.save();
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, o.width, o.height);
  const ground = o.height * 0.86;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, ground, o.width, o.height - ground);
  const fh = o.height * 0.62;
  const ink = '#0b0d17';
  drawFighter(ctx, { x: o.width * 0.3, ground, height: fh, facing: 1, pose: o.player, color: ink });
  drawFighter(ctx, { x: o.width * 0.7, ground, height: fh * 1.05, facing: -1, pose: o.enemy, color: ink });
  ctx.restore();
}

/** ステージごとの単色背景（敵レベルから決める静的な色） */
export function stageColor(level: number): string {
  const hues = [28, 200, 140, 265, 350, 45, 175, 225, 5, 300];
  const hue = hues[Math.abs(Math.round(level)) % hues.length] as number;
  return `hsl(${hue} 42% 58%)`;
}
