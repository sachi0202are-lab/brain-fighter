/**
 * ゲーム画面の上帯（HP バー・敵レベル・ラウンド数・1 ビットフィードバック・コンボ）。
 *
 * ラウンド実行のイベントを購読するだけで、進行には関われない（EventSource は購読専用）。
 * - 1 ビットフィードバックは刺激領域の外（上帯）に、最大 250ms、次の刺激の前に必ず消す。
 * - HP バーは静的（アニメーションしない）。低 HP の点滅・警報音は実装しない（MUST NOT）。
 */
import type { EventSource } from '../engine/events';
import type { RoundEvent } from '../engine/round';
import type { FxPreset } from '../storage/schema';
import { ja } from '../i18n/ja';
import { hpState } from './hp';
import { FEEDBACK_MS, SKIN_FEATURES, type SkinFeatures } from './presets';
import type { SoundPlayer } from './sound';

export interface HudOptions {
  preset: FxPreset;
  /** 効果音（設定でオフ、または Off プリセットなら null） */
  sound: SoundPlayer | null;
}

export interface HudRoundInfo {
  /** 'ラウンド 1/3' など */
  label: string;
  level: number;
  enemyName: string;
  /** ウォームアップ中（HP なし） */
  warmup: boolean;
  /** 敵レベルの代わりに出す一言（認定戦の「黄帯の審査」など） */
  sub?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly features: SkinFeatures;
  private readonly sound: SoundPlayer | null;
  private readonly playerSide = el('div', 'hud-side hud-player');
  private readonly enemySide = el('div', 'hud-side hud-enemy');
  private readonly playerFill = el('div', 'hp-fill');
  private readonly enemyFill = el('div', 'hp-fill');
  private readonly enemyNameEl = el('div', 'hud-name');
  private readonly downEl = el('div', 'hud-down', ja.play.down);
  private readonly roundEl = el('div', 'hud-round');
  private readonly levelEl = el('div', 'hud-level');
  private readonly fbEl = el('span', 'fb');
  private readonly comboEl = el('span', 'hud-combo');
  private fbTimer: ReturnType<typeof setTimeout> | null = null;
  private comboTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: HudOptions) {
    this.features = SKIN_FEATURES[opts.preset];
    this.sound = this.features.sound ? opts.sound : null;
    this.el = el('div', 'hud');
    const playerHp = el('div', 'hp');
    playerHp.append(this.playerFill);
    this.playerSide.append(el('div', 'hud-name', ja.play.you), playerHp, this.downEl);
    const enemyHp = el('div', 'hp hp-enemy');
    enemyHp.append(this.enemyFill);
    this.enemySide.append(this.enemyNameEl, enemyHp);
    const meta = el('div', 'hud-meta');
    this.fbEl.setAttribute('aria-hidden', 'true');
    this.fbEl.dataset.testid = 'feedback';
    meta.append(this.fbEl, this.comboEl);
    const center = el('div', 'hud-center');
    center.append(this.roundEl, this.levelEl, meta);
    this.el.append(this.playerSide, center, this.enemySide);
    this.downEl.hidden = true;
    this.comboEl.hidden = true;
    this.setSidesVisible(false);
  }

  setInfo(info: HudRoundInfo): void {
    this.roundEl.textContent = info.label;
    this.levelEl.textContent = info.sub ?? (info.warmup ? '' : ja.play.enemyLevel(info.level));
    this.enemyNameEl.textContent = info.enemyName;
    this.setSidesVisible(this.features.hpBars && !info.warmup);
    this.comboEl.hidden = !(this.features.combo && !info.warmup);
    this.comboEl.textContent = ja.play.combo(0);
  }

  /** ラウンドのイベントを購読する。戻り値で購読をやめる */
  attach(events: EventSource<RoundEvent>, round: { trials: number; enemyHp: number | null }): () => void {
    let correct = 0;
    let errors = 0;
    const renderHp = (): void => {
      if (round.enemyHp === null) return;
      const s = hpState(round.trials, round.enemyHp, correct, errors);
      this.enemyFill.style.width = `${(100 * s.enemy) / s.enemyMax}%`;
      this.playerFill.style.width = `${(100 * s.player) / s.playerMax}%`;
      this.downEl.hidden = !s.down;
    };
    const offs = [
      events.on('roundStart', () => {
        correct = 0;
        errors = 0;
        renderHp();
        this.clearFeedback();
      }),
      // 次の試行が始まる時点で必ず消す（刺激が出る前）
      events.on('trialStart', () => this.clearFeedback()),
      events.on('judged', (e) => {
        if (e.correct) correct += 1;
        else errors += 1;
        renderHp();
        this.showFeedback(e.correct, Math.min(FEEDBACK_MS, e.feedbackMaxMs - 20));
        this.sound?.play(e.correct);
        this.updateCombo(e.correct, e.combo);
      }),
    ];
    return () => {
      for (const off of offs) off();
      this.clearFeedback();
    };
  }

  destroy(): void {
    this.clearFeedback();
    if (this.comboTimer) clearTimeout(this.comboTimer);
  }

  private setSidesVisible(v: boolean): void {
    this.playerSide.hidden = !v;
    this.enemySide.hidden = !v;
  }

  private showFeedback(correct: boolean, ms: number): void {
    this.clearFeedback();
    if (ms <= 0) return;
    this.fbEl.dataset.state = correct ? 'ok' : 'ng';
    this.fbEl.textContent = correct ? '○' : '×';
    this.fbTimer = setTimeout(() => this.clearFeedback(), ms);
  }

  private clearFeedback(): void {
    if (this.fbTimer) clearTimeout(this.fbTimer);
    this.fbTimer = null;
    this.fbEl.dataset.state = '';
    this.fbEl.textContent = '';
  }

  /** コンボ = 連続正答数。途切れたら無音で 0.3 秒だけ表示を消す（仕様書 9.3） */
  private updateCombo(correct: boolean, combo: number): void {
    if (!this.features.combo) return;
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.comboEl.textContent = ja.play.combo(combo);
    if (correct) {
      this.comboEl.style.visibility = 'visible';
    } else {
      this.comboEl.style.visibility = 'hidden';
      this.comboTimer = setTimeout(() => {
        this.comboEl.style.visibility = 'visible';
      }, 300);
    }
  }
}
