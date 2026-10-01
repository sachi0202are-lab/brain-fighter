/**
 * 音（効果音・BGM）。WebAudio の AudioContext をアプリ全体で 1 つだけ使う。
 *
 * - 最初のタップ（pointerdown）・キー操作で unlock() するまで AudioContext を作らず、音も出さない
 *   （ブラウザの自動再生制限。埋め込み（iframe）のときも同じ。仕様書 9.4）。
 * - 効果音は public/audio/sfx/（生成した音を scripts/audio/process.mjs で加工したもの）。unlock のあとに読み込む。
 *   読み込み前・読めない環境では、正誤音と衝撃音だけ発振器で代用する（それ以外は鳴らさない）。
 * - 課題中に鳴る音は正誤の 1 ビット（hit / miss。90 ms 以内の小さな音）だけ（仕様書 4.5・9.4）。
 *   ラウンドの開始の合図・KO / PERFECT / 判定・必殺の衝撃・結果のファンファーレは、ラウンドの外（ラウンド間・結果画面）か
 *   スタート直後に鳴らす。
 * - BGM は既定オフ（仕様書 9.4）。設定でオンにすると、画面に応じた曲（メニュー／試合）を、末尾と先頭を重ねてループ再生する。
 *   認定戦では鳴らさない（演出最小）。タブが隠れたら止め、戻ったら続ける。歌の無い曲だけを使う。
 */
import { AUDIO_BGM, AUDIO_SFX, type BgmTrack, type SfxName } from './audio-manifest';

export type { BgmTrack, SfxName };

export function audioUrl(file: string): string {
  return `${import.meta.env.BASE_URL}audio/${file}`;
}

/** 音量: 正誤の 1 ビットは小さく、効果音はそれより大きく、BGM は控えめ（試合中はさらに小さく） */
export const GAIN = { feedback: 0.35, sfx: 0.7, bgm: 0.22, bgmInRound: 0.15 } as const;

/** BGM のループ: 末尾と先頭をこの秒数だけ重ねて（等パワーのクロスフェードで）つなぐ */
export const BGM_CROSSFADE_SEC = 1.5;

/** ループ 1 周の長さ（曲の長さ − 重ねる秒数。短すぎる曲でも止まらないよう下限あり） */
export function loopPeriod(durationSec: number, fade = BGM_CROSSFADE_SEC): number {
  return Math.max(0.5, durationSec - fade);
}

/** 等パワーのクロスフェードの曲線（0 → 1 と 1 → 0）。setValueCurveAtTime 用 */
const CURVE_N = 32;
const CURVE_UP = Float32Array.from({ length: CURVE_N }, (_, i) => Math.sin(((i / (CURVE_N - 1)) * Math.PI) / 2));
const CURVE_DOWN = Float32Array.from({ length: CURVE_N }, (_, i) => Math.cos(((i / (CURVE_N - 1)) * Math.PI) / 2));

type AudioCtor = typeof AudioContext;

interface Playing {
  track: BgmTrack;
  master: GainNode;
  sources: Set<AudioBufferSourceNode>;
  timer: ReturnType<typeof setTimeout> | null;
  base: number;
}

interface Wanted {
  track: BgmTrack;
  gain: number;
}

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private readonly sfxBuffers = new Map<SfxName, AudioBuffer>();
  private readonly bgmBuffers = new Map<BgmTrack, AudioBuffer>();
  private sfxLoading = false;
  private readonly bgmLoading = new Map<BgmTrack, Promise<AudioBuffer | null>>();
  // ---- BGM の状態 ----
  private wanted: Wanted | null = null;
  private enabled = false;
  private hidden = false;
  private playing: Playing | null = null;

  /** ユーザー操作の中で呼ぶ（何度呼んでもよい） */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor: AudioCtor | undefined =
          globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.ctx.addEventListener?.('statechange', () => this.syncMusic());
        this.loadSfx();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => this.syncMusic());
      }
    } catch {
      this.ctx = null;
    }
    this.syncMusic();
  }

  /** 音を出せる状態か（最初のユーザー操作のあと） */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  // ---------------------------------------------------------------------------
  // 効果音
  // ---------------------------------------------------------------------------

  /** 正解 = 短く明るい音、不正解 = 短く鈍い音（どちらも 90 ms 以内・小さめ）。読み込み前は発振器で代用 */
  play(correct: boolean): void {
    if (this.playBuffer(correct ? 'hit' : 'miss', GAIN.feedback)) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = correct ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(correct ? 880 : 196, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    } catch {
      /* 音が出せなくても進行には関係ない */
    }
  }

  /** 必殺演出の衝撃音（Full・ラウンド間だけ）。読み込み前は低く短い音で代用 */
  impact(): void {
    if (this.playBuffer('impact', GAIN.sfx)) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.14);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    } catch {
      /* 音が出せなくても進行には関係ない */
    }
  }

  /** 名前付きの効果音（ラウンドの開始・KO / PERFECT / 判定・結果）。読み込めていなければ鳴らさない */
  sfx(name: SfxName, gain: number = GAIN.sfx): void {
    this.playBuffer(name, gain);
  }

  private playBuffer(name: SfxName, gain: number): boolean {
    const ctx = this.ctx;
    const buf = this.sfxBuffers.get(name);
    if (!ctx || ctx.state !== 'running' || !buf) return false;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(ctx.destination);
      src.start();
      return true;
    } catch {
      return false;
    }
  }

  /** 効果音をまとめて読み込む（unlock のあと 1 回だけ。失敗した音は発振器か無音のまま） */
  private loadSfx(): void {
    if (this.sfxLoading) return;
    this.sfxLoading = true;
    for (const [name, entry] of Object.entries(AUDIO_SFX) as [SfxName, { file: string }][]) {
      void this.decode(entry.file).then((buf) => {
        if (buf) this.sfxBuffers.set(name, buf);
      });
    }
  }

  private async decode(file: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx || typeof fetch !== 'function') return null;
    try {
      const res = await fetch(audioUrl(file));
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // BGM
  // ---------------------------------------------------------------------------

  /** 設定の BGM（オン／オフ） */
  setMusicEnabled(on: boolean): void {
    this.enabled = on;
    this.syncMusic();
  }

  /** いまの画面で流す曲（null で止める）。inRound は試合中（小さめの音量） */
  setMusic(track: BgmTrack | null, inRound = false): void {
    this.wanted = track ? { track, gain: inRound ? GAIN.bgmInRound : GAIN.bgm } : null;
    this.syncMusic();
  }

  /** タブが隠れている間は止める */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.syncMusic();
  }

  /** いま流れている曲（テスト・点検用） */
  get currentMusic(): BgmTrack | null {
    return this.playing?.track ?? null;
  }

  /** 読み込み済みの効果音の名前（テスト・点検用） */
  get loadedSfx(): SfxName[] {
    return [...this.sfxBuffers.keys()];
  }

  /** 望みの曲と実際の再生をそろえる（状態が変わるたびに呼ぶ） */
  private syncMusic(): void {
    const ctx = this.ctx;
    const target = this.enabled && !this.hidden && this.wanted && ctx && ctx.state === 'running' ? this.wanted : null;
    if (!target || !ctx) {
      this.stopMusic();
      return;
    }
    if (this.playing && this.playing.track !== target.track) this.stopMusic();
    if (this.playing) {
      const t = ctx.currentTime;
      const g = this.playing.master.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(target.gain, t + 0.5);
      return;
    }
    void this.startMusic(target);
  }

  private loadBgm(track: BgmTrack): Promise<AudioBuffer | null> {
    const hit = this.bgmBuffers.get(track);
    if (hit) return Promise.resolve(hit);
    const inFlight = this.bgmLoading.get(track);
    if (inFlight) return inFlight;
    const p = this.decode(AUDIO_BGM[track].file).then((buf) => {
      this.bgmLoading.delete(track);
      if (buf) this.bgmBuffers.set(track, buf);
      return buf;
    });
    this.bgmLoading.set(track, p);
    return p;
  }

  private async startMusic(target: Wanted): Promise<void> {
    const buf = await this.loadBgm(target.track);
    const ctx = this.ctx;
    // 読み込んでいる間に状況が変わっていたら、改めてそろえる
    if (!buf || !ctx || this.playing || this.wanted?.track !== target.track || !this.enabled || this.hidden || ctx.state !== 'running') {
      if (buf && !this.playing) this.syncMusic();
      return;
    }
    const master = ctx.createGain();
    const t = ctx.currentTime;
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(this.wanted?.gain ?? target.gain, t + 0.6);
    master.connect(ctx.destination);
    const st: Playing = { track: target.track, master, sources: new Set(), timer: null, base: t + 0.05 };
    this.playing = st;
    this.scheduleLoop(st, buf, 0);
  }

  /** k 周目を予約し、次の周の予約を 1 秒前に入れる（末尾と先頭を等パワーで重ねる） */
  private scheduleLoop(st: Playing, buf: AudioBuffer, k: number): void {
    const ctx = this.ctx;
    if (!ctx || this.playing !== st) return;
    const fade = BGM_CROSSFADE_SEC;
    const period = loopPeriod(buf.duration, fade);
    const at = st.base + k * period;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      if (k === 0) g.gain.setValueAtTime(1, at);
      else g.gain.setValueCurveAtTime(CURVE_UP, at, fade);
      g.gain.setValueCurveAtTime(CURVE_DOWN, at + period, fade);
      src.connect(g).connect(st.master);
      src.start(at);
      src.stop(at + buf.duration);
      st.sources.add(src);
      src.onended = () => {
        st.sources.delete(src);
        g.disconnect();
      };
    } catch {
      return;
    }
    const nextAt = st.base + (k + 1) * period;
    const delayMs = Math.max(0, (nextAt - 1 - ctx.currentTime) * 1000);
    st.timer = setTimeout(() => this.scheduleLoop(st, buf, k + 1), delayMs);
  }

  private stopMusic(fadeSec = 0.4): void {
    const st = this.playing;
    if (!st) return;
    this.playing = null;
    if (st.timer) clearTimeout(st.timer);
    const ctx = this.ctx;
    const stopAll = (): void => {
      for (const s of st.sources) {
        try {
          s.stop();
        } catch {
          /* もう止まっている */
        }
      }
      st.sources.clear();
      try {
        st.master.disconnect();
      } catch {
        /* 外れている */
      }
    };
    if (!ctx) {
      stopAll();
      return;
    }
    try {
      const t = ctx.currentTime;
      st.master.gain.cancelScheduledValues(t);
      st.master.gain.setValueAtTime(st.master.gain.value, t);
      st.master.gain.linearRampToValueAtTime(0, t + fadeSec);
    } catch {
      /* 止めるだけ */
    }
    setTimeout(stopAll, fadeSec * 1000 + 50);
  }
}
