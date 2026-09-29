import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_MS, frameQuantizer, quantizeMs, robustFrameInterval, snapFrameMs, VirtualScheduler } from './timing';

const F60 = 1000 / 60;
const F120 = 1000 / 120;

describe('フレームへの量子化', () => {
  it('60Hz', () => {
    expect(quantizeMs(33, F60)).toEqual({ frames: 2, ms: 2 * F60 });
    expect(quantizeMs(500, F60).frames).toBe(30);
    expect(quantizeMs(150, F60).frames).toBe(9);
    expect(quantizeMs(279, F60).frames).toBe(17);
    expect(quantizeMs(1, F60).frames).toBe(1); // 正の値は最低 1 フレーム
    expect(quantizeMs(0, F60)).toEqual({ frames: 0, ms: 0 });
    expect(quantizeMs(-5, F60)).toEqual({ frames: 0, ms: 0 });
  });

  it('120Hz でも 33 ms は約 33 ms', () => {
    expect(quantizeMs(33, F120).frames).toBe(4);
    expect(quantizeMs(33, F120).ms).toBeCloseTo(33.333, 3);
  });

  it('frameQuantizer は階段法の quantize フックに使える', () => {
    expect(frameQuantizer(F60)(100)).toBeCloseTo(100, 6);
    expect(frameQuantizer(F60)(40)).toBeCloseTo(33.333, 3);
  });
});

describe('リフレッシュレートの丸め', () => {
  it('標準的なレートに丸める', () => {
    expect(snapFrameMs(16.9)).toBeCloseTo(F60, 9);
    expect(snapFrameMs(16.2)).toBeCloseTo(F60, 9);
    expect(snapFrameMs(8.4)).toBeCloseTo(F120, 9);
    expect(snapFrameMs(6.9)).toBeCloseTo(1000 / 144, 9);
    expect(snapFrameMs(20.1)).toBeCloseTo(1000 / 50, 9);
  });

  it('フレーム落ちが混ざっても本来の間隔を拾う（下位 25% 点）', () => {
    const deltas = [16.7, 33.3, 16.6, 50, 16.7, 33.4, 16.6, 16.8, 33.3, 66.7, 16.7, 33.3];
    expect(snapFrameMs(robustFrameInterval(deltas))).toBeCloseTo(F60, 9);
    expect(robustFrameInterval([])).toBe(DEFAULT_FRAME_MS);
  });

  it('測れなかったら 60Hz', () => {
    expect(snapFrameMs(Number.NaN)).toBe(DEFAULT_FRAME_MS);
    expect(snapFrameMs(0)).toBe(DEFAULT_FRAME_MS);
  });
});

describe('VirtualScheduler', () => {
  it('step ごとに1フレーム進み、誤差が積もらない', () => {
    const s = new VirtualScheduler(F60, 0);
    const seen: number[] = [];
    const loop = (t: number): void => {
      seen.push(t);
      if (seen.length < 600) s.requestFrame(loop);
    };
    s.requestFrame(loop);
    for (let k = 0; k < 600; k++) s.step();
    expect(seen).toHaveLength(600);
    expect(seen[599]).toBeCloseTo(10000, 9);
  });

  it('cancelFrame と advanceWithinFrame', () => {
    const s = new VirtualScheduler(F60, 0);
    let called = false;
    const h = s.requestFrame(() => {
      called = true;
    });
    s.cancelFrame(h);
    s.step();
    expect(called).toBe(false);
    s.advanceWithinFrame(5);
    expect(s.now()).toBeCloseTo(F60 + 5, 9);
    s.step();
    expect(s.now()).toBeCloseTo(2 * F60, 9);
  });
});
