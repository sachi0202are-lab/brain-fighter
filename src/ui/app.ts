/**
 * アプリ本体: 保存データ・URL フラグ・ルーティング・画面の付け替え。
 * 画面（screens/*）は mount 関数で DOM を作り、後片付け関数を返す。
 */
import { measureFrameMs, DEFAULT_FRAME_MS } from '../engine/timing';
import { parseSeed } from '../engine/rng';
import type { RoundRunner } from '../engine/round';
import type { PhaseTiming } from '../engine/types';
import { preloadArt } from '../skin/art';
import { SKIN_FEATURES } from '../skin/presets';
import { SoundPlayer, type BgmTrack } from '../skin/sound';
import { FX_PRESETS, type FxPreset, type GameId } from '../storage/schema';
import { browserStorage, type StorageLike } from '../storage/storage';
import { Store } from '../storage/store';
import type { RoundOutcome } from '../skin/hp';
import { parseRoute, type Route } from './router';
import './app.css';
import './embed.css';

export interface AppFlags {
  /** ?test=1: テスト用フック window.__bfTest を出す */
  test: boolean;
  /** ?seed=: 乱数シードの固定 */
  seed: number | null;
  /** ?test=1&fx=off|light|full: 演出プリセットの一時上書き（テスト用） */
  fx: FxPreset | null;
  /**
   * 初回オンボーディングを出すか。通常は常に true（初回だけ出る）。
   * ?test=1 のときは既存のテストの流れを変えないため false（?test=1&onboarding=1 で出す）。
   */
  onboarding: boolean;
}

export function parseFlags(search: string): AppFlags {
  const q = new URLSearchParams(search);
  const test = q.get('test') === '1';
  const fx = q.get('fx');
  return {
    test,
    seed: parseSeed(search),
    fx: test && (FX_PRESETS as readonly (string | null)[]).includes(fx) ? (fx as FxPreset) : null,
    onboarding: !test || q.get('onboarding') === '1',
  };
}

/** 結果画面に渡す1ラウンドぶん */
export interface RoundView {
  roundNo: number;
  trials: number;
  correct: number;
  maxCombo: number;
  power: number;
  enemyHp: number | null;
  outcome: RoundOutcome | null;
  /** 試行列の乱数シード（技名テロップの選択に使う） */
  seed: number;
}

/** 結果画面に渡す1試合ぶん */
export interface MatchView {
  gameId: GameId;
  fx: FxPreset;
  finishedAt: string;
  rounds: RoundView[];
  powerBefore: number;
  powerAfter: number;
  bestBefore: number;
  level: number;
  tip: string;
  /**
   * 次の試合の敵 HP の見込み（この試合の記録まで入れた直近の正答率で計算し直した値）。
   * 判定負けの「次は ◯ 問正解で KO」に使う。古い版で保存された結果（sessionStorage）には無い
   */
  nextEnemyHp?: number | null;
  /** セッションの次のゲーム（無ければ null） */
  nextGame: GameId | null;
  /** 今日のセッションを終えたか */
  sessionDone: boolean;
}

/** テスト用: 1ラウンドぶんの詳しいログ */
export interface TestRoundLog {
  gameId: GameId;
  fx: FxPreset;
  kind: string;
  roundNo: number;
  roundId: string;
  power: number;
  paramsEnd: Record<string, number>;
  trials: {
    i: number;
    stim: string;
    correct: boolean;
    rtMs?: number;
    onsetMs: number;
    plan: Record<string, number>;
    phases: PhaseTiming[];
  }[];
}

/** 実行中の RoundRunner の受け渡し（テスト用フックが購読する） */
export class RunnerHub {
  current: RoundRunner<Record<string, number>, unknown> | null = null;
  private readonly listeners = new Set<(r: RoundRunner<Record<string, number>, unknown> | null) => void>();

  set(r: RoundRunner<Record<string, number>, unknown> | null): void {
    this.current = r;
    for (const fn of [...this.listeners]) fn(r);
  }

  subscribe(fn: (r: RoundRunner<Record<string, number>, unknown> | null) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export type Mount = (app: App, root: HTMLElement, route: Route) => (() => void) | void;

const LAST_MATCH_KEY = 'brain-fighter.lastMatch';

export class App {
  readonly store: Store;
  readonly flags: AppFlags;
  /** ブログ埋め込み用のコンパクト版（/embed/）で動いているか */
  readonly embed: boolean;
  readonly sound = new SoundPlayer();
  readonly runners = new RunnerHub();
  readonly testLog: TestRoundLog[] = [];
  /** 推定フレーム間隔（起動時に測る） */
  frameMs = DEFAULT_FRAME_MS;
  readonly frameReady: Promise<number>;
  private cleanup: (() => void) | null = null;
  private screens: Record<Route['name'], Mount> | null = null;
  private route: Route | null = null;
  /** 新しい版を取り込んだので、試合・審査の画面を離れたら再読み込みする */
  private pendingReload = false;

  constructor(
    readonly root: HTMLElement,
    opts: { storage?: StorageLike | null; search?: string; embed?: boolean } = {},
  ) {
    this.flags = parseFlags(opts.search ?? location.search);
    this.embed = opts.embed ?? false;
    if (this.embed) document.documentElement.classList.add('embed');
    this.store = new Store(opts.storage === undefined ? browserStorage() : opts.storage);
    this.frameReady = measureFrameMs().then((ms) => (this.frameMs = ms));
    // 音は最初のタップ・キー操作まで出さない（自動再生制限・埋め込み時）
    const unlock = (): void => this.sound.unlock();
    document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    document.addEventListener('keydown', unlock, { capture: true, passive: true });
    // BGM はタブが隠れている間は止める
    document.addEventListener('visibilitychange', () => this.sound.setHidden(document.hidden));
    this.store.subscribe(() => this.applySettings());
    this.applySettings();
    // 試合で使う画像（ファイター・ステージ）を先に読んでおく（読めなくても図形で描くので待たない）
    void preloadArt();
  }

  start(screens: Record<Route['name'], Mount>): void {
    this.screens = screens;
    window.addEventListener('hashchange', () => this.render());
    this.render();
  }

  /**
   * 新しい版（Service Worker）が画面を引き継いだあとの再読み込み（src/main.ts から）。
   * 試合・審査の画面では待ち、次の画面に移るときに行う（ラウンドの途中で画面が消えないように）。
   */
  requestReload(): void {
    const r = this.route;
    if (r && (r.name === 'play' || r.name === 'certRun')) {
      this.pendingReload = true;
      return;
    }
    location.reload();
  }

  /** 画面遷移（'/records' など） */
  navigate(path: string): void {
    const hash = `#${path}`;
    if (location.hash === hash) this.render();
    else location.hash = hash;
  }

  /** 初回起動（記録も案内済みの印も無い）なら、ホームの代わりにオンボーディングを出す */
  needsOnboarding(): boolean {
    const d = this.store.data;
    return this.flags.onboarding && !d.onboardedAt && d.rounds.length === 0 && d.certs.length === 0;
  }

  /** いま有効な演出プリセット */
  fx(): FxPreset {
    return this.flags.fx ?? this.store.data.settings.fx;
  }

  get lastMatch(): MatchView | null {
    if (this.lastMatchMem) return this.lastMatchMem;
    try {
      const raw = sessionStorage.getItem(LAST_MATCH_KEY);
      return raw ? (JSON.parse(raw) as MatchView) : null;
    } catch {
      return null;
    }
  }

  set lastMatch(v: MatchView | null) {
    this.lastMatchMem = v;
    try {
      if (v) sessionStorage.setItem(LAST_MATCH_KEY, JSON.stringify(v));
      else sessionStorage.removeItem(LAST_MATCH_KEY);
    } catch {
      /* 保存できなくても続ける */
    }
  }

  private lastMatchMem: MatchView | null = null;

  render(): void {
    if (!this.screens) return;
    this.cleanup?.();
    this.cleanup = null;
    let route = parseRoute(location.hash);
    if (route.name === 'home' && this.needsOnboarding()) route = { name: 'welcome' };
    if (this.pendingReload && route.name !== 'play' && route.name !== 'certRun') {
      location.reload();
      return;
    }
    this.root.replaceChildren();
    document.body.dataset.route = route.name;
    this.route = route;
    const mount = this.screens[route.name];
    this.cleanup = mount(this, this.root, route) ?? null;
    if (route.name !== 'play') window.scrollTo(0, 0);
    this.updateMusic();
  }

  private applySettings(): void {
    document.documentElement.classList.toggle('color-safe', this.store.data.settings.colorSafe);
    this.sound.setMusicEnabled(this.store.data.settings.bgm);
    this.updateMusic();
  }

  /**
   * 画面に応じた BGM（設定でオンのときだけ鳴る。skin/sound.ts）:
   * 試合中は「試合」の曲を小さめに（演出 Off では鳴らさない）、認定戦では鳴らさない、ほかの画面は「メニュー」の曲。
   */
  private updateMusic(): void {
    const r = this.route;
    if (!r) return;
    let track: BgmTrack | null = 'menu';
    let inRound = false;
    if (r.name === 'play') {
      track = SKIN_FEATURES[this.fx()].sound ? 'battle' : null;
      inRound = true;
    } else if (r.name === 'certRun') {
      track = null;
    }
    this.sound.setMusic(track, inRound);
  }
}
