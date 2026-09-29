/**
 * マスクの下書き（ブラウザの経路）。OffscreenCanvas の代用品を置いて、
 * 注視点の間に模様を書いておき、マスクのフレームでは 1 回の drawImage で貼るだけになっていることを確かめる。
 * （このファイルの中で最初に描く前に代用品を置く必要があるので、他の描画テストとファイルを分けている）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../../engine/rng';
import type { RenderView } from '../../engine/types';
import { mockContext2D } from '../../test/mock-canvas';
import { game } from './index';
import { paramsAt } from './params';
import { MASK_RES, maskPixels, renderTrial } from './render';

const puts: Uint8ClampedArray[] = [];
const sameBytes = (a: Uint8ClampedArray, b: Uint8ClampedArray): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext(): unknown {
    return {
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => puts.push(img.data.slice()),
    };
  }
}

const g = globalThis as { OffscreenCanvas?: unknown };
let saved: unknown;
beforeAll(() => {
  saved = g.OffscreenCanvas;
  g.OffscreenCanvas = FakeOffscreenCanvas;
});
afterAll(() => {
  g.OffscreenCanvas = saved;
});

describe('マスクの下書き', () => {
  it('注視点の最初のフレームで模様を書き、マスクのフレームでは拡大して貼るだけ（毎フレーム同じ下書き）', () => {
    const trials = game.createRound(paramsAt(2, 100), mulberry32(4), { untrained: false, surface: 0, roundNo: 1, kind: 'round' });
    const view: RenderView = { size: 336, colorSafe: false, untrained: false, surface: 0, selection: {} };
    for (const t of trials.slice(0, 3)) {
      const before = puts.length;
      const fix = mockContext2D();
      renderTrial(fix.ctx, t, 'fixation', view);
      renderTrial(fix.ctx, t, 'fixation', view);
      expect(puts.length).toBe(before + 1);
      expect(sameBytes(puts[puts.length - 1]!, maskPixels(t.maskSeed))).toBe(true);
      const images: unknown[] = [];
      for (let frame = 0; frame < 9; frame++) {
        const m = mockContext2D();
        const proxy = new Proxy(m.ctx as unknown as Record<string, unknown>, {
          get(target, prop) {
            if (prop === 'drawImage') return (img: unknown, x: number, y: number, w: number, h: number) => images.push([img, x, y, w, h]);
            return target[prop as string];
          },
        }) as unknown as CanvasRenderingContext2D;
        renderTrial(proxy, t, 'mask', view);
        expect(m.calls.get('rect') ?? 0).toBe(0);
        expect((proxy as unknown as { imageSmoothingEnabled: boolean }).imageSmoothingEnabled).toBe(false);
      }
      // マスクの間に書き直さない。9 フレームとも同じ下書きを刺激領域いっぱいに貼る
      expect(puts.length).toBe(before + 1);
      expect(images).toHaveLength(9);
      const first = images[0] as unknown[];
      expect(first[0]).toBeInstanceOf(FakeOffscreenCanvas);
      expect((first[0] as FakeOffscreenCanvas).width).toBe(MASK_RES);
      expect(first.slice(1)).toEqual([0, 0, 336, 336]);
      for (const im of images) expect(im).toEqual(first);
    }
  }, 30_000);
});
