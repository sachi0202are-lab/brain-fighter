/**
 * ゲームの「舞台」（訓練の試合 play.ts と認定戦 cert-run.ts で共用）:
 * 上帯（中断ボタン＋呼び出し側の表示）／中央の正方形 Canvas（刺激領域）／下帯の応答ボタン／オーバーレイ。
 *
 * - 入力は pointerdown（click は遅延があるので使わない）。PC はキーボード（各ゲームの割当）。
 * - ゲーム中はダブルタップズーム・選択・スクロールを無効化（html.playing）。
 * - 演出（HUD・ラウンド間の表示）はここに入れない。呼び出し側が runRound の setup で
 *   ラウンド実行のイベントを購読するだけ（試行の進行には関われない）。
 * - 刺激領域のタップ（hitTest）と描画には、そのラウンドの RoundOptions（未訓練セット・表層）をそのまま渡す。
 */
import type { RoundRequest } from '../engine/match';
import { RoundAborted, RoundRunner, type StimulusSurface } from '../engine/round';
import { createRafScheduler } from '../engine/timing';
import type { AnyGameModule, Params, ResponseLayout, RoundOptions, RoundSummary } from '../engine/types';
import { freezeArtForRound } from '../skin/art';
import type { App } from './app';
import { h } from './dom';

export type AnyRunner = RoundRunner<Params, unknown>;

export interface StageOptions {
  game: AnyGameModule;
  /** 画面要素のクラス（'screen' の後ろに付く。例 'play fx-light'） */
  className: string;
  /** 画面要素の属性（data-game など） */
  attrs?: Record<string, string>;
  /** 上帯の中身（HUD など。中断ボタンの右に置く） */
  top: HTMLElement;
  quitLabel: string;
  onQuit(): void;
  colorSafe: boolean;
}

/** キーの表示名 */
export function keyLabel(keys: readonly string[]): string | null {
  const names: Record<string, string> = {
    ' ': 'Space',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };
  for (const k of keys) {
    if (names[k]) return names[k] as string;
    if (k.length === 1) return k.toUpperCase();
  }
  return null;
}

/** イベントのタイムスタンプ（performance.now と同じ時間軸でなければ performance.now） */
function eventTime(ts: number | undefined): number {
  const now = performance.now();
  return ts !== undefined && ts > 0 && ts <= now + 1 && now - ts < 1000 ? ts : now;
}

export class GameStage {
  readonly screen: HTMLElement;
  readonly top: HTMLElement;
  readonly overlay: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** 実行中のラウンド（無ければ null） */
  runner: AnyRunner | null = null;

  private readonly app: App;
  private readonly opts: StageOptions;
  private readonly band: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly stimBg: string;
  private readonly disposers: Array<() => void> = [];
  private readonly pendingOverlays = new Set<(err: unknown) => void>();
  private readonly buttonEls = new Map<string, HTMLButtonElement>();
  private keyMap = new Map<string, string>();
  private roundOptions: RoundOptions | null = null;
  private size = 300;
  private dpr = 1;
  private disposed = false;

  constructor(app: App, root: HTMLElement, opts: StageOptions) {
    this.app = app;
    this.opts = opts;
    const quitBtn = h('button', { class: 'quit', type: 'button', 'aria-label': opts.quitLabel, title: opts.quitLabel }, '✕');
    quitBtn.addEventListener('click', () => opts.onQuit());
    this.top = h('header', { class: 'play-top' }, quitBtn, opts.top);
    this.canvas = h('canvas', { class: 'stim', 'data-testid': 'stimulus', 'aria-hidden': 'true' });
    const stimWrap = h('div', { class: 'stim-wrap' }, this.canvas);
    this.band = h('div', { class: 'resp-band', 'data-testid': 'response-band' });
    this.overlay = h('div', { class: 'overlay', hidden: true });
    this.screen = h('div', { class: `screen ${opts.className}`, ...(opts.attrs ?? {}) }, this.top, stimWrap, this.band, this.overlay);
    root.append(this.screen);
    document.documentElement.classList.add('playing');
    this.disposers.push(() => document.documentElement.classList.remove('playing'));

    // 長押しメニュー・ダブルタップ・ピンチを抑止（html.playing の CSS と併用）
    const prevent = (e: Event): void => e.preventDefault();
    for (const type of ['contextmenu', 'dblclick', 'gesturestart', 'selectstart']) {
      this.screen.addEventListener(type, prevent);
      this.disposers.push(() => this.screen.removeEventListener(type, prevent));
    }

    // ---- 刺激領域（正方形）の大きさ ----
    this.ctx = this.canvas.getContext('2d');
    this.stimBg = getComputedStyle(document.documentElement).getPropertyValue('--stim-bg').trim() || '#10131d';
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.screen);
    this.disposers.push(() => ro.disconnect());
    this.resize();

    // ---- キー ----
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !this.overlay.hidden) return;
      const id = this.keyMap.get(e.key.length === 1 ? e.key.toLowerCase() : e.key) ?? this.keyMap.get(e.code);
      if (!id) return;
      e.preventDefault();
      this.press(id, e.timeStamp);
    };
    window.addEventListener('keydown', onKey);
    this.disposers.push(() => window.removeEventListener('keydown', onKey));

    // 刺激領域のタップ（ゲームが hitTest を持つときだけ）
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = this.runner;
      const game = this.opts.game;
      if (!r || !game.hitTest || !this.roundOptions) return;
      const snap = r.snapshot();
      const trial = r.currentTrial();
      if (!snap || !snap.accepting || trial === null) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * this.size) / rect.width;
      const y = ((e.clientY - rect.top) * this.size) / rect.height;
      const id = game.hitTest(trial, snap.phase, x, y, {
        size: this.size,
        colorSafe: this.opts.colorSafe,
        untrained: this.roundOptions.untrained,
        surface: this.roundOptions.surface,
        selection: snap.selection,
      });
      if (id) this.press(id, e.timeStamp);
    });
  }

  /** 刺激領域を背景だけにする */
  paintBackground(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.stimBg;
    ctx.fillRect(0, 0, this.size, this.size);
  }

  /**
   * オーバーレイ（開始前・ラウンド間・結果）を出し、選ばれた値で解決する。
   * auto があれば auto.ms 後に auto.value で閉じる。画面を離れると RoundAborted で失敗する。
   */
  showOverlay<V>(panel: HTMLElement, choices: { el: HTMLButtonElement; value: V }[], auto?: { ms: number; value: V }): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      if (this.disposed) {
        reject(new RoundAborted());
        return;
      }
      this.overlay.replaceChildren(panel);
      this.overlay.hidden = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onAbort = (err: unknown): void => {
        if (timer) clearTimeout(timer);
        reject(err);
      };
      const done = (v: V): void => {
        if (timer) clearTimeout(timer);
        this.pendingOverlays.delete(onAbort);
        this.overlay.hidden = true;
        this.overlay.replaceChildren();
        resolve(v);
      };
      for (const c of choices) c.el.addEventListener('click', () => done(c.value));
      if (auto) timer = setTimeout(() => done(auto.value), auto.ms);
      this.pendingOverlays.add(onAbort);
      choices[0]?.el.focus();
    });
  }

  /** 閉じられない案内（エラーなど）をオーバーレイに出す */
  showMessage(panel: HTMLElement): void {
    this.overlay.hidden = false;
    this.overlay.replaceChildren(panel);
  }

  /**
   * ラウンドを1本実行する。setup はラウンドの開始直前に呼ばれ、演出の購読（HUD など）を行って
   * 購読をやめる関数の配列を返す。ラウンドの進行（試行・時間・適応）には関われない。
   */
  async runRound(
    req: RoundRequest<Params, unknown>,
    setup?: (runner: AnyRunner) => Array<() => void>,
  ): Promise<RoundSummary<Params, unknown>> {
    if (this.disposed) throw new RoundAborted();
    const r: AnyRunner = new RoundRunner({
      game: this.opts.game,
      trials: req.trials,
      params: req.params,
      options: req.options,
      adaptive: req.adaptive,
      scheduler: createRafScheduler(this.app.frameMs),
      surface: this.surface,
      colorSafe: this.opts.colorSafe,
    });
    this.buildButtons(r.layout);
    this.roundOptions = req.options;
    const offs = [
      ...(setup?.(r) ?? []),
      r.events.on('selection', (e) => {
        for (const [id, el] of this.buttonEls) {
          if (el.dataset.group === e.group) el.setAttribute('aria-pressed', String(id === e.id));
        }
      }),
      r.events.on('trialStart', () => {
        for (const el of this.buttonEls.values()) el.removeAttribute('aria-pressed');
      }),
    ];
    this.runner = r;
    this.app.runners.set(r);
    (document.activeElement as HTMLElement | null)?.blur?.();
    // 刺激領域で使う画像は、この時点で読み込み済みのものに固定する（ラウンドの途中で見た目が変わらない）
    freezeArtForRound();
    try {
      return await r.start();
    } finally {
      for (const off of offs) off();
      this.runner = null;
      this.app.runners.set(null);
      this.paintBackground();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runner?.abort();
    for (const rej of [...this.pendingOverlays]) rej(new RoundAborted());
    this.pendingOverlays.clear();
    for (const d of this.disposers) d();
    this.app.runners.set(null);
  }

  // ---------------------------------------------------------------------------

  private readonly surface: StimulusSurface = {
    begin: () => {
      if (!this.ctx) return null;
      this.paintBackground();
      return { ctx: this.ctx, size: this.size };
    },
  };

  private resize(): void {
    const W = this.screen.clientWidth;
    const H = this.screen.clientHeight;
    const minBand = Math.max(150, Math.round(H * 0.22));
    this.size = Math.max(120, Math.floor(Math.min(W - 24, H - this.top.offsetHeight - minBand - 24)));
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.paintBackground();
  }

  private flash(id: string): void {
    const el = this.buttonEls.get(id);
    if (!el) return;
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 110);
  }

  private press(id: string, ts?: number): void {
    this.flash(id);
    this.runner?.input(id, eventTime(ts));
  }

  private buildButtons(layout: ResponseLayout): void {
    this.band.replaceChildren();
    this.buttonEls.clear();
    this.keyMap = new Map();
    this.band.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
    this.band.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
    for (const b of layout.buttons) {
      const hint = keyLabel(b.keys);
      const el = h(
        'button',
        {
          type: 'button',
          class: 'resp-btn',
          'data-id': b.id,
          'data-group': b.group ?? 'main',
          'aria-label': b.ariaLabel ?? b.label,
          style: `grid-column: ${b.col} / span ${b.colSpan ?? 1}; grid-row: ${b.row} / span ${b.rowSpan ?? 1};`,
        },
        h('span', { class: 'resp-label' }, b.label),
        hint ? h('span', { class: 'key-hint' }, hint) : null,
      );
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.press(b.id, e.timeStamp);
      });
      // キーボードでボタンを押したとき（Enter/Space。pointerdown が来ない）
      el.addEventListener('click', (e) => {
        if (e.detail === 0) this.press(b.id);
      });
      this.band.append(el);
      this.buttonEls.set(b.id, el);
      for (const k of b.keys) this.keyMap.set(k.length === 1 ? k.toLowerCase() : k, b.id);
    }
  }
}
