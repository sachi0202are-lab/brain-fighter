/**
 * ゲームモジュールの共通インターフェース。
 *
 * フェーズ2の各ゲーム（src/games/<id>/index.ts）は `export const game: GameModule<P, T>` を1つ公開する。
 * エンジン（round.ts / match.ts）はこのインターフェースだけを通してゲームを動かす。
 *
 * 守ること（仕様書の MUST / MUST NOT に由来）
 * - 難度はアルゴリズム（adapt / adaptTrial）だけが決める。ユーザーが選ぶ口を作らない。
 * - ゲームは演出プリセット（off/light/full）を知らない。どの関数にも fx は渡らない。
 *   試行数・提示時間・刺激間隔・応答期限・標的比率は params と rng だけで決まるようにする。
 * - 乱数は createRound / createWarmup に渡る rng だけを使う（Math.random を使わない）。
 *   renderStimulus の中で乱数を使わない（要るなら試行データに入れておく）。
 * - 戦闘力（power）は正確さと到達難度だけで決める。反応時間を使わない（RoundStats に RT は無い）。
 * - 刺激は抽象記号で作る。実在の格闘ゲームのコマンド列やキャラ名を使わない。
 */
import type { FxPreset, GameId } from '../storage/schema';
import type { Rng } from './rng';

export type { FxPreset, GameId };

/**
 * 難度パラメータ。保存時は `Record<string, number>` になるので値は数値だけ。
 * ゲーム側では `type DhParams = { T: number; stage: number }` のように **type で**定義する
 * （interface にすると Record<string, number> に代入できない）。
 */
export type Params = Record<string, number>;

/** 試行のフェーズ名 */
export type PhaseName =
  | 'cue' // 手がかり（スタンスチェンジの構え表示など）
  | 'fixation' // 注視点
  | 'stimulus' // 刺激（反応時間はこのフェーズの開始から測る）
  | 'mask' // マスク
  | 'response' // 応答画面／消灯
  | 'feedback' // 正誤フィードバック用の間（演出側が刺激領域の外に 1 ビットを出す）
  | 'iti'; // 試行間隔

/** 試行を構成するフェーズ1つ。1試行のフェーズ名は重複させない */
export interface PhaseSpec {
  name: PhaseName;
  /**
   * 予定時間 (ms)。エンジンがフレーム数に量子化する（0 以下ならこのフェーズは飛ばす）。
   * untilResponse のフェーズでは応答期限。
   */
  ms: number;
  /** このフェーズ中は応答を受け付ける（連続する input フェーズは1つの応答窓になる） */
  input?: boolean;
  /** 応答が完成したら、期限を待たずに次のフェーズへ進む */
  untilResponse?: boolean;
}

/**
 * 応答。グループ名 → 押したボタンの id。
 * 1グループのゲームは `{ main: 'left' }`、ダブルヒットのような複合応答は `{ stance: 'high', dir: 'd3' }`。
 * 1回も押さなかったら null。
 */
export type Response = Readonly<Record<string, string>>;

/** 下帯の応答ボタン1つ */
export interface ResponseButton {
  /** 応答 id（judge に渡る値。レイアウト内で一意） */
  id: string;
  /** 応答グループ（複合応答用）。省略時 'main' */
  group?: string;
  /** ボタンの表示文言（i18n から） */
  label: string;
  /** 読み上げ用の名前（省略時は label） */
  ariaLabel?: string;
  /**
   * PC のキー。KeyboardEvent.key（' ', 'ArrowLeft', 'q' など）か KeyboardEvent.code（'Numpad7', 'KeyQ' など）。
   * 英字の key は大文字小文字を区別しない。
   */
  keys: readonly string[];
  /** 下帯グリッドでの位置（1 始まり） */
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}

/** 下帯の応答ボタン定義と PC キー割当 */
export interface ResponseLayout {
  /** グリッドの列数・行数 */
  columns: number;
  rows: number;
  buttons: readonly ResponseButton[];
}

export type RoundKind = 'round' | 'warmup';

/** createRound / createWarmup / responseLayout に渡るオプション */
export interface RoundOptions {
  /** 認定戦の未訓練刺激セットを使う */
  untrained: boolean;
  /** 表層（見た目）のバリエーション番号 0..surfaceCount-1（仕様書 4.4。最初の2試合は 0） */
  surface: number;
  /** 試合内のラウンド番号（1 始まり。ウォームアップは 0） */
  roundNo: number;
  kind: RoundKind;
}

/** renderStimulus / hitTest に渡る描画情報 */
export interface RenderView {
  /** 刺激領域（正方形）の一辺 (CSS px)。描画座標は 0..size（devicePixelRatio はエンジンが処理済み） */
  size: number;
  /** 色覚配慮モード（設定） */
  colorSafe: boolean;
  /** 認定戦の未訓練刺激セット */
  untrained: boolean;
  /** 表層バリエーション番号 */
  surface: number;
  /** この試行でここまでに選ばれた応答（複合応答の途中経過） */
  selection: Response;
}

/** 1試行の判定 */
export interface Judgement {
  correct: boolean;
  /**
   * 誤答の種類（RoundRecord.errors の集計キー）。例 'miss' | 'fa' | 'timeout' | 'stance' | 'dir' | 'both'。
   * 正答のときは付けない。誤答で省略すると 'error' として数える。
   */
  kind?: string;
}

/** ラウンドの成績（戦闘力の計算に使ってよい情報だけ。反応時間は含めない） */
export interface RoundStats {
  trials: number;
  correct: number;
  /** correct / trials */
  accuracy: number;
  /** 誤答の内訳（Judgement.kind ごとの件数） */
  errors: Record<string, number>;
}

/** 1フェーズの予定と実測（ms はラウンド開始＝最初のフレームからの相対時刻） */
export interface PhaseTiming {
  name: PhaseName;
  /** 量子化後の予定時間（untilResponse なら期限） */
  plannedMs: number;
  frames: number;
  input: boolean;
  untilResponse: boolean;
  startMs: number;
  endMs: number;
}

/** 1試行の結果（メモリ上の詳しいログ） */
export interface TrialResult<P extends Params = Params, T = unknown> {
  i: number;
  trial: T;
  /** この試行に使った難度（adaptTrial で変わる前の値） */
  params: P;
  /** describeTrial の結果 */
  stim: string;
  response: Response | null;
  judgement: Judgement;
  correct: boolean;
  /** 刺激の提示開始から応答が完成するまで (ms)。応答が完成しなければ無し */
  rtMs?: number;
  /** 刺激の提示開始（ラウンド開始からの ms） */
  onsetMs: number;
  phases: PhaseTiming[];
}

/** ラウンドの結果（adapt / metrics / roundTip に渡る） */
export interface RoundSummary<P extends Params = Params, T = unknown> extends RoundStats {
  kind: RoundKind;
  roundNo: number;
  /** ラウンド開始時の難度 */
  paramsStart: P;
  /** 試行単位の適応を終えた時点の難度（ラウンド単位の適応 adapt の前）= このラウンドを戦った難度 */
  paramsPlayed: P;
  /** 最大コンボ（連続正答数） */
  maxCombo: number;
  /** 正答試行の反応時間の中央値 */
  rtMedianMs?: number;
  /** 量子化に使ったフレーム間隔 */
  frameMs: number;
  results: TrialResult<P, T>[];
}

/**
 * ゲームモジュール。P = 難度パラメータの型、T = 試行データの型。
 */
export interface GameModule<P extends Params = Params, T = unknown> {
  readonly id: GameId;

  /** 初期難度（初回のみ。2試合目以降は保存された state から restoreParams で復元） */
  readonly initialParams: P;

  /** 1試合のラウンド数（既定 3。仕様書 v1.2 からは登録ゲーム 3 本とも 1） */
  readonly roundsPerMatch?: number;

  /** 試合の最後に「もう1ラウンド」で追加できるラウンド数（既定 0。v1.2 で廃止し、いまはどのゲームも使わない） */
  readonly extraRounds?: number;

  /** 表層（刺激の見た目）のバリエーション数（既定 1。仕様書 4.4） */
  readonly surfaceCount?: number;

  /** 保存された state から難度を復元する（既定: initialParams に保存値を上書き） */
  restoreParams?(saved: Readonly<Record<string, number>>): P;

  /** 1ラウンドぶんの試行列を作る（ラウンド開始時に1回だけ呼ばれる） */
  createRound(params: P, rng: Rng, opts: RoundOptions): T[];

  /**
   * 試合冒頭のウォームアップ（任意）。スタンスチェンジの単一課題ブロック（混合コスト算出用）など。
   * 定義すると試合の最初に1回だけ実行される（適応なし・戦闘力なし・HP なし）。
   */
  createWarmup?(params: P, rng: Rng, opts: RoundOptions): T[];

  /**
   * 試行のフェーズ列（注視／刺激／マスク／応答／フィードバック／ITI などの時間）。
   * 各試行の開始時に、その時点の難度で呼ばれる（試行単位の適応で T が変われば次の試行から反映）。
   */
  phases(trial: T, params: P): PhaseSpec[];

  /** 下帯のボタン定義と PC キー割当（ラウンドごとに呼ばれる。ステージで選択肢が増える場合に対応） */
  responseLayout(params: P, opts: RoundOptions): ResponseLayout;

  /**
   * 刺激領域（正方形 Canvas）の描画。毎フレーム、エンジンが背景を塗った後に呼ぶ。
   * t = そのフェーズが始まってからの ms。刺激提示中に動く演出は入れない（仕様書 13-8）。
   */
  renderStimulus(
    ctx: CanvasRenderingContext2D,
    trial: T,
    phase: PhaseName,
    t: number,
    view: RenderView,
  ): void;

  /**
   * 刺激領域のタップを応答に変換する（任意。ダブルヒットの8方向リングなど）。
   * 応答を受け付けるフェーズで pointerdown があったときだけ呼ばれる。x, y は 0..view.size。
   */
  hitTest?(trial: T, phase: PhaseName, x: number, y: number, view: RenderView): string | null;

  /** 判定。応答が完成したとき、または応答窓が閉じたとき（未完成・無応答なら response は途中経過か null）に1回呼ばれる */
  judge(trial: T, response: Response | null): Judgement;

  /** 正解の応答（押さないのが正解なら null）。テストの自動プレイで使う */
  expectedResponse(trial: T): Response | null;

  /** 試行の刺激を1行の文字列に（TrialLog.stim。標的かどうかが読み取れるようにする） */
  describeTrial(trial: T): string;

  /** 試行単位の適応（任意）。判定の直後に呼ばれ、次の試行から反映される */
  adaptTrial?(params: P, correct: boolean, judgement: Judgement): P;

  /** ラウンド単位の適応（任意）。ラウンド末に paramsPlayed を受け取り、次のラウンドの難度を返す */
  adapt?(params: P, round: RoundSummary<P, T>): P;

  /**
   * 戦闘力 0..1000（整数に丸めてクランプするのはエンジン側）。
   * params = そのラウンドを戦った難度（RoundSummary.paramsPlayed）。lastRound = 直近ラウンドの成績（無ければ null）。
   */
  power(params: P, lastRound: RoundStats | null): number;

  /** 認定戦の固定ティア（1..9）の難度 */
  certParams(tier: number): P;

  /** 認定戦で1ラウンドが合格か（既定: 正答率 79% 以上） */
  certRoundPassed?(round: RoundStats, tier: number): boolean;

  /** 「敵レベル」として表示する数値（アルゴリズムの難度そのもの） */
  enemyLevel(params: P): number;

  /** ラウンド記録に残すゲーム固有の指標（任意。d′、切替コスト、T の中央値など） */
  metrics?(round: RoundSummary<P, T>, ctx: { warmup: RoundSummary<P, T> | null }): Record<string, number>;

  /** ラウンド末の一言（任意。方略や努力に向けた文。能力ラベルは使わない。文言は i18n から） */
  roundTip?(round: RoundSummary<P, T>): string;

  /**
   * 次のラウンドのルールの一言（任意。例「2 個前と同じなら攻撃」）。
   * 開始前の画面と、ラウンド間の画面（次のラウンドの難度で）に出る。
   * info.untrained は認定戦（未訓練の刺激セット）のラウンドのとき true（省略時は訓練）。
   */
  roundIntro?(params: P, info: { kind: RoundKind; roundNo: number; untrained?: boolean }): string;
}

/** 型引数を問わないゲームモジュール（登録簿用） */
export type AnyGameModule = GameModule<any, any>;

/** 保存値から難度を復元する既定の方法 */
export function restoreParams<P extends Params>(game: GameModule<P, unknown>, saved: Readonly<Record<string, number>> | undefined): P {
  if (game.restoreParams) return game.restoreParams(saved ?? {});
  const out = { ...game.initialParams } as Record<string, number>;
  if (saved) {
    for (const k of Object.keys(game.initialParams)) {
      const v = saved[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
  }
  return out as P;
}

/** 認定戦の合否（既定ルール込み） */
export function certRoundPassed(game: AnyGameModule, round: RoundStats, tier: number): boolean {
  if (game.certRoundPassed) return game.certRoundPassed(round, tier);
  return round.accuracy + 1e-9 >= 0.79;
}

/** レイアウト内の応答グループ一覧（すべてのグループが選ばれたら応答完成） */
export function layoutGroups(layout: ResponseLayout): string[] {
  const groups: string[] = [];
  for (const b of layout.buttons) {
    const g = b.group ?? 'main';
    if (!groups.includes(g)) groups.push(g);
  }
  return groups;
}

/** 応答を TrialLog.resp 用の文字列に（1グループなら id だけ、複数なら group=id をグループ名順に） */
export function formatResponse(resp: Response | null): string | undefined {
  if (!resp) return undefined;
  const keys = Object.keys(resp).sort();
  if (keys.length === 0) return undefined;
  if (keys.length === 1 && keys[0] === 'main') return resp.main;
  return keys.map((k) => `${k}=${resp[k]}`).join(',');
}
