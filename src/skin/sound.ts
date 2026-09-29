/**
 * 短い正誤音（WebAudio の発振器。外部の音素材は使わない）。
 * 最初のタップ（pointerdown）・キー操作で unlock() するまで音は出ない（AudioContext も作らない）。
 * 埋め込み（iframe）時の自動再生制限にも合う。
 */
type AudioCtor = typeof AudioContext;

export class SoundPlayer {
  private ctx: AudioContext | null = null;

  /** ユーザー操作の中で呼ぶ */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor: AudioCtor | undefined =
          globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** 音を出せる状態か（最初のユーザー操作のあと） */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** 必殺演出の衝撃音（Full・ラウンド間だけ）。低く短い音（約 0.15 秒・小さめ） */
  impact(): void {
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

  /** 正解 = 高く短い音、不正解 = 低く短い音（どちらも 0.1 秒以内・小さめ） */
  play(correct: boolean): void {
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
}
