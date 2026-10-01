/**
 * ダブルヒットの試行列（系列の制約・妨害の配置）、判定の内訳、応答レイアウト・キー、刺激領域のタップ、描画。
 */
import { describe, expect, it } from 'vitest';
import { ART_SPRITES, SPRITE_STANDING_HEIGHT } from '../../skin/art';
import { mulberry32 } from '../../engine/rng';
import { maxRunLength } from '../../engine/sequence';
import { layoutGroups, type RenderView, type RoundOptions } from '../../engine/types';
import { mockContext2D } from '../../test/mock-canvas';
import { game } from './index';
import { DIR_IDS, HIT_DEAD_ZONE, dirAt, dirVector, layoutFor, type DirId } from './layout';
import { paramsAt, certDhParams } from './params';
import {
  DISTRACTOR_R,
  FIGURE_COLOR,
  FIGURE_HEIGHT,
  MASK_RES,
  SPARK_R,
  SURFACES,
  TRAINED_SET,
  UNTRAINED_SET,
  figureExtent,
  STANCE_SPRITES,
  maskPixels,
  renderTrial,
} from './render';
import { TRIALS_PER_ROUND, describeTrial, judgeTrial, slotsFor, sparkPosition, type DhTrial } from './trials';

const OPTS: RoundOptions = { untrained: false, surface: 0, roundNo: 1, kind: 'round' };
const round = (stage: number, seed: number): DhTrial[] => game.createRound(paramsAt(stage, 100), mulberry32(seed), OPTS);
const count = <T>(xs: readonly T[], v: T): number => xs.filter((x) => x === v).length;

describe('系列の制約（仕様書 6.1・4.2）', () => {
  it('1 ラウンド 24 試行', () => {
    for (let s = 0; s <= 4; s++) expect(round(s, 1)).toHaveLength(TRIALS_PER_ROUND);
    expect(TRIALS_PER_ROUND).toBe(24);
  });

  it('火花の方向: 8 方向を均等（24 試行で各 3 回）、同じ方向の連続は 2 回まで', () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const dirs = round(seed % 5, seed).map((t) => t.dir);
      if (DIR_IDS.some((d) => count(dirs, d) !== 3)) problems.push(`seed ${seed}: 方向の回数が不均等`);
      if (maxRunLength(dirs) > 2) problems.push(`seed ${seed}: 同じ方向が 3 回以上続く`);
    }
    expect(problems).toEqual([]);
  }, 30_000);

  it('構え: 2 種は 12 回ずつ（50%）で連続は 4 回まで。3 種（ステージ 4）は 8 回ずつ', () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const two = round(seed % 4, seed).map((t) => t.stance);
      if (count(two, 'high') !== 12 || count(two, 'low') !== 12) problems.push(`seed ${seed}: 2 種が 12 回ずつでない`);
      if (maxRunLength(two) > 4) problems.push(`seed ${seed}: 2 種で同じ構えが 5 回以上続く`);
      const three = round(4, seed).map((t) => t.stance);
      if ([count(three, 'high'), count(three, 'low'), count(three, 'mid')].some((c) => c !== 8)) problems.push(`seed ${seed}: 3 種が 8 回ずつでない`);
      if (maxRunLength(three) > 4) problems.push(`seed ${seed}: 3 種で同じ構えが 5 回以上続く`);
    }
    expect(problems).toEqual([]);
  }, 30_000);

  it('固定パターンにならない: 試行の番号ごとに見ても構えは約 50%、方向は約 1/8', () => {
    const N = 2000;
    const highAt = new Array<number>(TRIALS_PER_ROUND).fill(0);
    const dirAtIdx = new Array<number>(TRIALS_PER_ROUND).fill(0);
    for (let seed = 1; seed <= N; seed++) {
      round(0, seed * 7919).forEach((t, i) => {
        if (t.stance === 'high') highAt[i] = (highAt[i] as number) + 1;
        if (t.dir === 'd8') dirAtIdx[i] = (dirAtIdx[i] as number) + 1;
      });
    }
    const hi = highAt.map((c) => c / N);
    const d8 = dirAtIdx.map((c) => c / N);
    expect(Math.min(...hi)).toBeGreaterThan(0.44);
    expect(Math.max(...hi)).toBeLessThan(0.56);
    expect(Math.min(...d8)).toBeGreaterThan(0.09);
    expect(Math.max(...d8)).toBeLessThan(0.16);
  }, 30_000);

  it('同じシードなら同じ系列、シードが違えば違う系列', () => {
    expect(round(2, 5)).toEqual(round(2, 5));
    expect(JSON.stringify(round(2, 5))).not.toBe(JSON.stringify(round(2, 6)));
  });
});

describe('妨害の配置', () => {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

  it('妨害の数はステージどおり。位置はすべて別で、火花の位置には置かない', () => {
    const expected = [0, 6, 12, 24, 48];
    const problems: string[] = [];
    for (let s = 0; s <= 4; s++) {
      for (let seed = 1; seed <= 30; seed++) {
        round(s, seed).forEach((t, i) => {
          const where = `stage ${s} seed ${seed} trial ${i}`;
          if (t.distractors.length !== expected[s]) problems.push(`${where}: ${t.distractors.length} 個`);
          const keys = new Set(t.distractors.map((d) => `${d.x},${d.y}`));
          if (keys.size !== t.distractors.length) problems.push(`${where}: 位置の重複`);
          const sp = sparkPosition(t);
          if (t.distractors.some((d) => dist(d, sp) <= 0.15)) problems.push(`${where}: 火花に近すぎる`);
        });
      }
    }
    expect(problems).toEqual([]);
  }, 30_000);

  it('構えの生成シルエット（4 体 × 3 構え）は図形と同じ外接矩形に収まる（高さ 0.44R・横 ±0.16R。仕様書 v1.7）', () => {
    const scale = FIGURE_HEIGHT / SPRITE_STANDING_HEIGHT; // R = 1 のときの px → 比
    for (const variant of SURFACES.map((s) => s.figure)) {
      const keys = STANCE_SPRITES[variant];
      for (const stance of ['high', 'mid', 'low'] as const) {
        const e = ART_SPRITES[keys[stance]];
        const height = e.h * scale;
        const halfWidth = (e.w * scale) / 2;
        expect(height, keys[stance]).toBeLessThanOrEqual(0.45);
        expect(halfWidth, keys[stance]).toBeLessThan(0.16);
        // 上段は拳の上端〜足元が外接矩形いっぱい（高さの基準）。中段・下段は頭が上端なので低い
        if (stance === 'high') expect(height, keys[stance]).toBeGreaterThan(0.43);
        else expect(height, keys[stance]).toBeLessThan(ART_SPRITES[keys.high].h * scale);
      }
    }
  });

  it('置き場所どうし・火花・中央のシルエットと重ならず、刺激領域の内側に収まる', () => {
    const fig = figureExtent();
    // シルエットは中心から上下 ±0.22、左右 ±0.16 に収まる
    expect(fig.top).toBeCloseTo(-0.22, 6);
    expect(fig.bottom).toBeCloseTo(0.22, 6);
    expect(fig.halfWidth).toBeLessThan(0.16);
    for (const ecc of [35, 45]) {
      const slots = slotsFor(ecc);
      expect(slots.length - 1).toBeGreaterThanOrEqual(48);
      for (let a = 0; a < slots.length; a++) {
        const s = slots[a]!;
        // 刺激領域（半径 1 の正方形）の内側
        expect(Math.abs(s.x) + DISTRACTOR_R * 1.2).toBeLessThan(1);
        expect(Math.abs(s.y) + DISTRACTOR_R * 1.2).toBeLessThan(1);
        // シルエットの外接矩形から離れている
        const dx = Math.max(0, Math.abs(s.x) - fig.halfWidth);
        const dy = Math.max(0, s.y < 0 ? fig.top - s.y : s.y - fig.bottom);
        const r = a < 8 ? SPARK_R : DISTRACTOR_R * 1.2;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(r);
        for (let b = a + 1; b < slots.length; b++) {
          const d = dist(s, slots[b]!);
          expect(d).toBeGreaterThan(0.149);
          // 火花の円周（先頭 8 つ）と、ほかの同心円との距離は火花の大きさぶん広い
          if (a < 8 && b >= 8) expect(d).toBeGreaterThan(SPARK_R + DISTRACTOR_R * 1.2 + 0.05);
        }
      }
    }
  });

  it('火花は半径の 35%（ステージ 0〜2）・45%（ステージ 3〜4）の円周上、8 方向', () => {
    for (const [stage, e] of [
      [0, 0.35],
      [2, 0.35],
      [3, 0.45],
      [4, 0.45],
    ] as const) {
      for (const t of round(stage, 3)) {
        const p = sparkPosition(t);
        expect(Math.hypot(p.x, p.y)).toBeCloseTo(e, 3);
        const v = dirVector(t.dir);
        expect(p.x).toBeCloseTo(v.x * e, 3);
        expect(p.y).toBeCloseTo(v.y * e, 3);
      }
    }
  });

  it('妨害の位置・形・向きは毎試行ランダム', () => {
    const trials = round(3, 99);
    const layouts = new Set(trials.map((t) => JSON.stringify(t.distractors.map((d) => [d.x, d.y]))));
    expect(layouts.size).toBe(trials.length);
    const shapes = new Set(trials.flatMap((t) => t.distractors.map((d) => d.shape)));
    expect([...shapes].sort()).toEqual([0, 1, 2]);
    const rots = new Set(trials.flatMap((t) => t.distractors.map((d) => d.rot)));
    expect(rots.size).toBe(4);
    // マスクの模様も試行ごとに違う
    expect(new Set(trials.map((t) => t.maskSeed)).size).toBe(trials.length);
  });

  it('認定戦のパラメータ（ラダーに無い組合せ）でも試行列が作れる', () => {
    const t6 = game.createRound(certDhParams(6), mulberry32(6), { ...OPTS, untrained: true });
    expect(t6.every((t) => t.distractors.length === 12 && t.eccPct === 45 && t.stances === 2)).toBe(true);
    const t9 = game.createRound(certDhParams(9), mulberry32(9), { ...OPTS, untrained: true });
    expect(t9.every((t) => t.distractors.length === 48 && t.stance !== 'mid')).toBe(true);
  });
});

describe('判定（両方正解で正答。片方だけは誤答で内訳を分ける）', () => {
  const t: DhTrial = { stance: 'high', dir: 'd9', eccPct: 35, stances: 2, distractors: [], maskSeed: 1 };

  it('内訳: 構えのみ誤り = stance、火花のみ誤り = dir、両方 = both、未完成 = timeout', () => {
    expect(judgeTrial(t, { stance: 'high', dir: 'd9' })).toEqual({ correct: true });
    expect(judgeTrial(t, { stance: 'low', dir: 'd9' })).toEqual({ correct: false, kind: 'stance' });
    expect(judgeTrial(t, { stance: 'high', dir: 'd3' })).toEqual({ correct: false, kind: 'dir' });
    expect(judgeTrial(t, { stance: 'low', dir: 'd1' })).toEqual({ correct: false, kind: 'both' });
    expect(judgeTrial(t, null)).toEqual({ correct: false, kind: 'timeout' });
    expect(judgeTrial(t, { stance: 'high' })).toEqual({ correct: false, kind: 'timeout' });
    expect(judgeTrial(t, { dir: 'd9' })).toEqual({ correct: false, kind: 'timeout' });
  });

  it('正解の応答・試行の説明', () => {
    expect(game.expectedResponse(t)).toEqual({ stance: 'high', dir: 'd9' });
    expect(game.judge(t, game.expectedResponse(t))).toEqual({ correct: true });
    expect(describeTrial(t)).toBe('high/d9/x0/e35');
    expect(game.describeTrial(round(4, 1)[0]!)).toMatch(/^(high|low|mid)\/d[1-9]\/x48\/e45$/);
  });
});

describe('応答レイアウトと PC キー', () => {
  const keyOf = (stances: number): Map<string, string> => {
    const m = new Map<string, string>();
    for (const b of layoutFor(stances).buttons) for (const k of b.keys) m.set(k.length === 1 ? k.toLowerCase() : k, b.id);
    return m;
  };

  it('構え 2 択（ステージ 0〜3）と 3 択（ステージ 4）＋8 方向。グループは stance と dir', () => {
    const l2 = game.responseLayout(paramsAt(3, 100), OPTS);
    expect(l2.buttons.filter((b) => b.group === 'stance').map((b) => b.id)).toEqual(['high', 'low']);
    const l4 = game.responseLayout(paramsAt(4, 100), OPTS);
    expect(l4.buttons.filter((b) => b.group === 'stance').map((b) => b.id)).toEqual(['high', 'mid', 'low']);
    for (const l of [l2, l4]) {
      expect(layoutGroups(l)).toEqual(['stance', 'dir']);
      expect(l.buttons.filter((b) => b.group === 'dir').map((b) => b.id).sort()).toEqual([...DIR_IDS].sort());
      // グリッドのセルが重ならない
      const cells = new Set<string>();
      for (const b of l.buttons) {
        for (let c = b.col; c < b.col + (b.colSpan ?? 1); c++) {
          for (let r = b.row; r < b.row + (b.rowSpan ?? 1); r++) {
            const key = `${c},${r}`;
            expect(cells.has(key)).toBe(false);
            cells.add(key);
          }
        }
      }
    }
  });

  it('構え = Q 上段 / A 下段 / Z 中段、方向 = テンキー（NumLock の有無どちらでも）・矢印・斜めの代替キー。1 キー = 1 ボタン', () => {
    const m = keyOf(3);
    expect([m.get('q'), m.get('a'), m.get('z')]).toEqual(['high', 'low', 'mid']);
    expect(keyOf(2).get('z')).toBeUndefined();
    const numpad: Record<string, DirId> = { 7: 'd7', 8: 'd8', 9: 'd9', 4: 'd4', 6: 'd6', 1: 'd1', 2: 'd2', 3: 'd3' };
    for (const [n, id] of Object.entries(numpad)) {
      expect(m.get(`Numpad${n}`)).toBe(id); // KeyboardEvent.code
      expect(m.get(n)).toBe(id); // NumLock オン時の KeyboardEvent.key
    }
    // NumLock オフ時のテンキー（KeyboardEvent.key）と矢印キー
    expect([m.get('Home'), m.get('ArrowUp'), m.get('PageUp')]).toEqual(['d7', 'd8', 'd9']);
    expect([m.get('ArrowLeft'), m.get('ArrowRight')]).toEqual(['d4', 'd6']);
    expect([m.get('End'), m.get('ArrowDown'), m.get('PageDown')]).toEqual(['d1', 'd2', 'd3']);
    // テンキーの無いキーボード用（U I O / J L / M , .）
    expect(['u', 'i', 'o', 'j', 'l', 'm', ',', '.'].map((k) => m.get(k))).toEqual(['d7', 'd8', 'd9', 'd4', 'd6', 'd1', 'd2', 'd3']);
    // 同じキーが2つのボタンに割り当てられていない
    for (const stances of [2, 3]) {
      const all = layoutFor(stances).buttons.flatMap((b) => b.keys.map((k) => (k.length === 1 ? k.toLowerCase() : k)));
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('ボタンの表示は構えの名前と矢印、読み上げ用の名前つき', () => {
    const l = layoutFor(3);
    const label = (id: string): string | undefined => l.buttons.find((b) => b.id === id)?.label;
    expect([label('high'), label('mid'), label('low')]).toEqual(['上段', '中段', '下段']);
    expect(['d7', 'd8', 'd9', 'd4', 'd6', 'd1', 'd2', 'd3'].map(label).join('')).toBe('↖↑↗←→↙↓↘');
    for (const b of l.buttons) expect((b.ariaLabel ?? '').length).toBeGreaterThan(0);
  });
});

describe('刺激領域のタップ（hitTest）', () => {
  const t = round(0, 1)[0]!;
  const view = (size: number): RenderView => ({ size, colorSafe: false, untrained: false, surface: 0, selection: {} });

  it('中心から見た角度で 8 方向に振り分ける（各方向の丸の上・扇形の中）', () => {
    const size = 300;
    for (const id of DIR_IDS) {
      const v = dirVector(id);
      for (const r of [0.35, 0.45, 0.2, 0.95]) {
        for (const skew of [-20, 0, 20]) {
          const a = Math.atan2(-v.y, v.x) + (skew * Math.PI) / 180;
          const x = size / 2 + Math.cos(a) * r * (size / 2);
          const y = size / 2 - Math.sin(a) * r * (size / 2);
          expect(game.hitTest?.(t, 'response', x, y, view(size))).toBe(id);
        }
      }
    }
    // 角（正方形の隅）は斜めの方向
    expect(dirAt(0, 0, size)).toBe('d7');
    expect(dirAt(size, 0, size)).toBe('d9');
    expect(dirAt(0, size, size)).toBe('d1');
    expect(dirAt(size, size, size)).toBe('d3');
  });

  it('中心付近は無効。応答フェーズ以外は無効', () => {
    expect(game.hitTest?.(t, 'response', 150, 150, view(300))).toBeNull();
    expect(game.hitTest?.(t, 'response', 150 + 150 * HIT_DEAD_ZONE * 0.9, 150, view(300))).toBeNull();
    expect(game.hitTest?.(t, 'response', 150 + 150 * HIT_DEAD_ZONE * 1.1, 150, view(300))).toBe('d6');
    for (const phase of ['fixation', 'stimulus', 'mask', 'feedback', 'iti'] as const) {
      expect(game.hitTest?.(t, phase, 280, 150, view(300))).toBeNull();
    }
  });

  it('返す id はレイアウトのボタン（エンジンが受け付ける応答）', () => {
    const ids = new Set(layoutFor(2).buttons.map((b) => b.id));
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const id = dirAt(150 + Math.cos(a) * 100, 150 + Math.sin(a) * 100, 300);
      expect(id !== null && ids.has(id)).toBe(true);
    }
  });
});

describe('描画', () => {
  /** fillStyle / strokeStyle への代入と、fill の回数を記録する Canvas の代用品 */
  function recordingCtx(): { ctx: CanvasRenderingContext2D; styles: string[]; fills: () => number; rects: () => number } {
    const { ctx, calls } = mockContext2D();
    const styles: string[] = [];
    const proxy = new Proxy(ctx as unknown as Record<string, unknown>, {
      set(target, prop, value) {
        if (prop === 'fillStyle' || prop === 'strokeStyle') styles.push(String(value));
        target[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx: proxy, styles, fills: () => calls.get('fill') ?? 0, rects: () => calls.get('rect') ?? 0 };
  }
  const view = (o: Partial<RenderView> = {}): RenderView => ({ size: 336, colorSafe: false, untrained: false, surface: 0, selection: {}, ...o });

  it('訓練と認定戦（未訓練）で火花・妨害の色が別のセット', () => {
    const t = round(3, 4)[0]!;
    const trained = recordingCtx();
    renderTrial(trained.ctx, t, 'stimulus', view());
    expect(trained.styles).toContain(TRAINED_SET.spark.color);
    expect(trained.styles).toContain(TRAINED_SET.distractor.color);
    expect(trained.styles).not.toContain(UNTRAINED_SET.spark.color);
    const untrained = recordingCtx();
    renderTrial(untrained.ctx, t, 'stimulus', view({ untrained: true }));
    expect(untrained.styles).toContain(UNTRAINED_SET.spark.color);
    expect(untrained.styles).toContain(UNTRAINED_SET.distractor.color);
    expect(untrained.styles).not.toContain(TRAINED_SET.spark.color);
    expect(untrained.styles).not.toContain(TRAINED_SET.distractor.color);
    expect(new Set(UNTRAINED_SET.distractor.shapes).size).toBe(3);
    for (const s of UNTRAINED_SET.distractor.shapes) expect(TRAINED_SET.distractor.shapes).not.toContain(s);
    expect(UNTRAINED_SET.spark.shape).not.toBe(TRAINED_SET.spark.shape);
  });

  it('妨害は 1 個ずつ描く（ステージ 4 はステージ 0 より 48 回多く塗る）', () => {
    const t0 = round(0, 4)[0]!;
    const t4 = { ...round(4, 4)[0]!, stance: t0.stance };
    const a = recordingCtx();
    renderTrial(a.ctx, t0, 'stimulus', view());
    const b = recordingCtx();
    renderTrial(b.ctx, t4, 'stimulus', view());
    expect(b.fills() - a.fills()).toBe(48);
  });

  it('表層バリエーションは背景色とシルエットの形だけ（刺激の色は同じ）。背景の相対輝度はそろっている', () => {
    const t = round(2, 8)[0]!;
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      const lin = (c: number): number => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const base = lum(SURFACES[0]!.bg);
    expect(game.surfaceCount).toBe(SURFACES.length);
    expect(new Set(SURFACES.map((s) => s.bg)).size).toBe(SURFACES.length);
    expect(new Set(SURFACES.map((s) => s.figure)).size).toBe(SURFACES.length);
    for (let k = 0; k < SURFACES.length; k++) {
      expect(Math.abs(lum(SURFACES[k]!.bg) / base - 1)).toBeLessThan(0.03);
      const r = recordingCtx();
      renderTrial(r.ctx, t, 'stimulus', view({ surface: k }));
      expect(r.styles[0]).toBe(SURFACES[k]!.bg);
      expect(r.styles).toContain(FIGURE_COLOR);
      expect(r.styles).toContain(TRAINED_SET.spark.color);
      expect(r.styles).toContain(TRAINED_SET.distractor.color);
    }
    // 範囲外の番号でも描ける
    expect(() => renderTrial(recordingCtx().ctx, t, 'stimulus', view({ surface: 7 }))).not.toThrow();
    expect(() => renderTrial(recordingCtx().ctx, t, 'stimulus', view({ surface: -1 }))).not.toThrow();
    // 火花は明るく、妨害は暗い（背景とのコントラスト比）。訓練と未訓練で明るさをそろえる
    const cr = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const set of [TRAINED_SET, UNTRAINED_SET]) {
      expect(cr(set.spark.color, SURFACES[0]!.bg)).toBeGreaterThan(10);
      expect(cr(set.distractor.color, SURFACES[0]!.bg)).toBeLessThan(2.2);
    }
    expect(Math.abs(lum(UNTRAINED_SET.spark.color) / lum(TRAINED_SET.spark.color) - 1)).toBeLessThan(0.05);
    expect(Math.abs(lum(UNTRAINED_SET.distractor.color) / lum(TRAINED_SET.distractor.color) - 1)).toBeLessThan(0.05);
  });

  it('マスクは刺激領域全体を覆い、同じ試行なら毎フレーム同じ模様（静止画）', () => {
    // 下書きの Canvas が無い環境（Node）では、マスの模様を矩形で直接描く
    const t = round(1, 2)[0]!;
    const record = (): { styles: string[]; covered: number } => {
      const { ctx } = mockContext2D();
      const styles: string[] = [];
      let covered = 0;
      const cell = 336 / MASK_RES;
      const proxy = new Proxy(ctx as unknown as Record<string, unknown>, {
        get(target, prop) {
          if (prop === 'rect') return (_x: number, _y: number, w: number) => (covered += Math.round((w - 0.5) / cell));
          return target[prop as string];
        },
        set(target, prop, value) {
          if (prop === 'fillStyle') styles.push(String(value));
          target[prop as string] = value;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      renderTrial(proxy, t, 'mask', view());
      return { styles, covered };
    };
    const a = record();
    const b = record();
    expect(a.covered).toBe(MASK_RES * MASK_RES);
    expect(a.styles).toEqual(b.styles);
  }, 30_000);

  it('マスクの模様: 種が同じなら同じ、違えば違う。灰色の段階だけを使い、2 段（粗いまだら＋細かい点）', () => {
    const a = maskPixels(123);
    const same = (x: Uint8ClampedArray, y: Uint8ClampedArray): boolean => x.length === y.length && x.every((v, i) => v === y[i]);
    expect(a).toHaveLength(MASK_RES * MASK_RES * 4);
    expect(same(maskPixels(123), a)).toBe(true);
    expect(same(maskPixels(124), a)).toBe(false);
    const levels = new Set(
      ['#1b1e29', '#323848', '#4c5366', '#697084', '#8a90a2', '#aeb2c0'].map((hex) => {
        const v = parseInt(hex.slice(1), 16);
        return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},255`;
      }),
    );
    const colors = new Set<string>();
    for (let o = 0; o < a.length; o += 4) colors.add(`${a[o]},${a[o + 1]},${a[o + 2]},${a[o + 3]}`);
    expect([...colors].sort()).toEqual([...levels].sort());
    // 3×3 マスのまだらが見える（隣のマスと同じ色の割合が、完全なランダム 1/6 よりずっと高い）
    let neighbours = 0;
    for (let j = 0; j < MASK_RES; j++) {
      for (let i = 1; i < MASK_RES; i++) if (a[(j * MASK_RES + i) * 4] === a[(j * MASK_RES + i - 1) * 4]) neighbours++;
    }
    expect(neighbours / (MASK_RES * (MASK_RES - 1))).toBeGreaterThan(0.35);
  }, 30_000);

  it('応答画面は選んだ方向を強調し、フィードバック中も同じ（正誤は刺激領域に出さない）', () => {
    const t = round(1, 2)[0]!;
    const none = recordingCtx();
    renderTrial(none.ctx, t, 'response', view());
    const sel = recordingCtx();
    renderTrial(sel.ctx, t, 'response', view({ selection: { dir: 'd9' } }));
    expect(sel.styles).not.toEqual(none.styles);
    const fbWrong = recordingCtx();
    renderTrial(fbWrong.ctx, t, 'feedback', view({ selection: { dir: 'd9', stance: 'low' } }));
    const fbRight = recordingCtx();
    renderTrial(fbRight.ctx, t, 'feedback', view({ selection: { dir: 'd9', stance: 'high' } }));
    expect(fbWrong.styles).toEqual(fbRight.styles);
  });

  it('どのフェーズ・ステージ・表層・刺激セットでも例外を出さない', () => {
    for (let s = 0; s <= 4; s++) {
      for (const t of round(s, 10 + s).slice(0, 2)) {
        for (const ph of game.phases(t, paramsAt(s, 100))) {
          for (let surface = 0; surface < SURFACES.length; surface++) {
            for (const untrained of [false, true]) {
              expect(() => renderTrial(recordingCtx().ctx, t, ph.name, view({ surface, untrained }))).not.toThrow();
            }
          }
        }
      }
    }
    expect(() => renderTrial(recordingCtx().ctx, round(0, 1)[0]!, 'stimulus', view({ size: 0 }))).not.toThrow();
  }, 30_000);
});
