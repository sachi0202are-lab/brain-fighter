import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME_MS,
  frameQuantizer,
  MIN_PRESENTATION_MS,
  quantizeMs,
  robustFrameInterval,
  snapFrameMs,
  STANDARD_REFRESH_HZ,
  VirtualScheduler,
} from './timing';

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

  it('下限側だけ切り上げ: どの標準リフレッシュレートでも 33 ms を下回らない（72/75/100/165Hz を含む）', () => {
    const expected: Record<number, number> = { 48: 2, 50: 2, 60: 2, 72: 3, 75: 3, 90: 3, 100: 4, 120: 4, 144: 5, 165: 6, 240: 8 };
    for (const hz of STANDARD_REFRESH_HZ) {
      const f = 1000 / hz;
      const q = quantizeMs(MIN_PRESENTATION_MS, f);
      expect(q.frames, `${hz}Hz`).toBe(expected[hz]);
      expect(q.ms, `${hz}Hz`).toBeGreaterThanOrEqual(MIN_PRESENTATION_MS);
      expect(q.ms, `${hz}Hz`).toBeLessThan(MIN_PRESENTATION_MS + f);
    }
    // 33 ms 未満を求めたら、その ms を下回らない
    expect(quantizeMs(16, F60).frames).toBe(1);
    expect(quantizeMs(17, F60).frames).toBe(2);
    expect(quantizeMs(20, 1000 / 75).frames).toBe(2);
  });

  it('33 ms より長い要求は今までどおり四捨五入（33 ms は下回らない）', () => {
    expect(quantizeMs(41.25, F60).frames).toBe(2); // 2.475 → 2（33.3 ms）
    expect(quantizeMs(42, F60).frames).toBe(3);
    expect(quantizeMs(37, F120).frames).toBe(4);
    expect(quantizeMs(1620, F60).frames).toBe(97);
    expect(quantizeMs(34, 1000 / 75).frames).toBe(3); // 四捨五入でも 3（40 ms）
    expect(quantizeMs(33.3, 1000 / 75).frames).toBe(3); // 四捨五入なら 2（26.7 ms）だが 33 ms を下回らない
  });

  it('量子化した値をもう一度量子化しても変わらない（すべての標準レート）', () => {
    for (const hz of STANDARD_REFRESH_HZ) {
      const f = 1000 / hz;
      for (const ms of [1, 16, 20, 33, 34, 37.2, 41.25, 100, 120.5, 300, 1458]) {
        const q = quantizeMs(ms, f);
        expect(quantizeMs(q.ms, f).frames, `${hz}Hz ${ms}ms`).toBe(q.frames);
      }
    }
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
