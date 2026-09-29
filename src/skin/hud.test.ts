/**
 * 上帯（HUD）: 正誤の 1 ビットと正誤音は、次の刺激までに収まるときだけ出す（仕様書 4.5）。
 * HUD はラウンド実行のイベントを購読するだけ（ここではイベントを直接流して確かめる）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../engine/events';
import type { RoundEvent } from '../engine/round';
import { installFakeDocument, type FakeElement } from '../test/fake-dom';
import { Hud } from './hud';
import { FEEDBACK_SOUND_MIN_MS } from './presets';
import type { SoundPlayer } from './sound';

let restore: () => void;
beforeAll(() => {
  restore = installFakeDocument();
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
  restore();
});

function setup(preset: 'off' | 'light' | 'full') {
  const played: boolean[] = [];
  const sound = { play: (c: boolean) => played.push(c), unlock: () => {} } as unknown as SoundPlayer;
  const hud = new Hud({ preset, sound });
  const events = new Emitter<RoundEvent>();
  hud.setInfo({ label: 'R1', level: 1, enemyName: 'X', warmup: false });
  const off = hud.attach(events, { trials: 10, enemyHp: 8 });
  const fb = (hud.el as unknown as FakeElement).children[1]!.children[2]!.children[0]!;
  const judged = (i: number, correct: boolean, feedbackMaxMs: number): void =>
    events.emit({ type: 'judged', i, correct, combo: correct ? 1 : 0, feedbackMaxMs, atMs: i * 1000 });
  return { hud, played, judged, fb, off };
}

describe('正誤音は次の刺激までに鳴り終わるときだけ', () => {
  it(`残り ${FEEDBACK_SOUND_MIN_MS} ms 未満なら鳴らさない（コンボ・リコールの押さなかった試行など）`, () => {
    const { played, judged, hud, off } = setup('light');
    judged(0, true, 0);
    judged(1, false, 60);
    judged(2, true, FEEDBACK_SOUND_MIN_MS - 1);
    expect(played).toEqual([]);
    judged(3, true, FEEDBACK_SOUND_MIN_MS);
    judged(4, false, 800);
    expect(played).toEqual([true, false]);
    off();
    hud.destroy();
  });

  it('1 ビットの表示は残り時間より 20 ms 短く、残りが無ければ出さない', () => {
    const { judged, fb, hud, off } = setup('light');
    judged(0, true, 0);
    expect(fb.dataset.state).toBe('');
    judged(1, true, 100);
    expect(fb.dataset.state).toBe('ok');
    vi.advanceTimersByTime(81);
    expect(fb.dataset.state).toBe('');
    off();
    hud.destroy();
  });

  it('Off では音を鳴らさない', () => {
    const { played, judged, hud, off } = setup('off');
    judged(0, true, 800);
    expect(played).toEqual([]);
    off();
    hud.destroy();
  });
});
