/**
 * 音（skin/sound.ts）:
 * - 最初のユーザー操作（unlock）まで AudioContext を作らず、作るのはアプリ全体で 1 つ（仕様書 9.4・埋め込み時の自動再生制限）。
 * - BGM は設定がオンで、画面の曲が指定され、タブが見えているときだけ鳴る。認定戦（曲 null）で止まる。
 * - ループは末尾と先頭を重ねる（1 周 = 曲の長さ − 重ねる秒数）。
 * WebAudio と fetch の代用品で確かめる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BGM_CROSSFADE_SEC, loopPeriod, SoundPlayer } from './sound';

class FakeParam {
  value = 0;
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
  setValueCurveAtTime(): this {
    return this;
  }
}
class FakeNode {
  connect<T>(n: T): T {
    return n;
  }
  disconnect(): void {}
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  start(): void {}
  stop(): void {}
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

let created = 0;
class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  constructor() {
    created += 1;
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  addEventListener(): void {}
  createGain(): FakeGain {
    return new FakeGain();
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator();
  }
  createBufferSource(): FakeSource {
    return new FakeSource();
  }
  decodeAudioData(): Promise<{ duration: number }> {
    return Promise.resolve({ duration: 61.5 });
  }
}

const g = globalThis as unknown as { AudioContext?: unknown; fetch?: unknown };
let prevCtx: unknown;
let prevFetch: unknown;

beforeEach(() => {
  created = 0;
  prevCtx = g.AudioContext;
  prevFetch = g.fetch;
  g.AudioContext = FakeAudioContext;
  g.fetch = () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
});
afterEach(() => {
  g.AudioContext = prevCtx;
  g.fetch = prevFetch;
});

describe('AudioContext は最初のユーザー操作まで作らない・1 つだけ', () => {
  it('unlock の前は、曲や効果音を頼んでも作らない', () => {
    const s = new SoundPlayer();
    s.setMusicEnabled(true);
    s.setMusic('menu');
    s.play(true);
    s.sfx('ko');
    s.impact();
    expect(created).toBe(0);
    expect(s.ready).toBe(false);
    expect(s.currentMusic).toBeNull();
  });

  it('unlock で 1 つ作り、2 回目以降は作らない', () => {
    const s = new SoundPlayer();
    s.unlock();
    s.unlock();
    s.play(false);
    expect(created).toBe(1);
  });
});

describe('BGM', () => {
  it('設定オン・曲あり・タブが見えているときだけ鳴り、認定戦（null）と非表示で止まる', async () => {
    const s = new SoundPlayer();
    s.setMusicEnabled(true);
    s.setMusic('menu');
    s.unlock();
    await vi.waitFor(() => expect(s.currentMusic).toBe('menu'));
    s.setMusic('battle', true);
    await vi.waitFor(() => expect(s.currentMusic).toBe('battle'));
    s.setMusic(null);
    expect(s.currentMusic).toBeNull();
    s.setMusic('menu');
    await vi.waitFor(() => expect(s.currentMusic).toBe('menu'));
    s.setHidden(true);
    expect(s.currentMusic).toBeNull();
    s.setHidden(false);
    await vi.waitFor(() => expect(s.currentMusic).toBe('menu'));
    s.setMusicEnabled(false);
    expect(s.currentMusic).toBeNull();
  });

  it('設定がオフなら、unlock しても鳴らない', async () => {
    const s = new SoundPlayer();
    s.setMusic('menu');
    s.unlock();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.currentMusic).toBeNull();
    expect(created).toBe(1);
  });

  it('ループ 1 周は曲の長さから重ねる秒数を引いた長さ（短すぎる曲でも止まらない）', () => {
    expect(loopPeriod(60)).toBeCloseTo(60 - BGM_CROSSFADE_SEC);
    expect(loopPeriod(90.4, 2)).toBeCloseTo(88.4);
    expect(loopPeriod(1)).toBe(0.5);
  });
});
