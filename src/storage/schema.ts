/**
 * 保存スキーマ（localStorage キー `brain-fighter.v1` の JSON 1 本）。
 *
 * 仕様書 第8節の型をそのまま写している。仕様書の他の節が要求する情報のうち、
 * 第8節の型に置き場所が無いものだけを「拡張」として optional で追加した
 * （どれも省略可能なので version 1 のまま読み書きできる。理由は DESIGN_NOTES.md）。
 */

export type GameId = 'double-hit' | 'combo-recall' | 'stance-change';
export type FxPreset = 'off' | 'light' | 'full';

export const GAME_IDS: readonly GameId[] = ['double-hit', 'combo-recall', 'stance-change'];
export const FX_PRESETS: readonly FxPreset[] = ['off', 'light', 'full'];

export interface Settings {
  fx: FxPreset;
  sound: boolean;
  colorSafe: boolean;
}

export interface GameSave {
  state: Record<string, number>; // 例 { T: 120, stage: 1 } / { n: 3 } / { step: 7 }
  belt: number; // 0..9
  lastCertAt?: string;
  trainingDays: string[]; // 'YYYY-MM-DD'（端末のローカル日付）
}

export interface SaveData {
  version: 1;
  createdAt: string; // ISO
  settings: Settings;
  games: Record<GameId, GameSave>;
  rounds: RoundRecord[]; // 訓練ラウンド
  certs: CertRecord[]; // 認定戦
  trials?: TrialLog[]; // 生ログ（直近30日）
  // ---- 拡張 ----
  /** 「今日のセッション」の記録（1日2回まで・4時間あける の判定用） */
  sessions?: SessionRecord[];
}

export interface RoundRecord {
  id: string;
  gameId: GameId;
  startedAt: string;
  fx: FxPreset;
  paramsStart: Record<string, number>;
  paramsEnd: Record<string, number>;
  trials: number;
  correct: number;
  errors: Record<string, number>;
  rtMedianMs?: number;
  power: number; // ラウンド末の戦闘力
  // ---- 拡張 ----
  /** 同じ試合のラウンドに共通の ID */
  matchId?: string;
  /** 'warmup' = 試合冒頭のウォームアップ（戦闘力・HP・統計には数えない）。省略時は訓練ラウンド */
  kind?: 'warmup';
  /** 試合内のラウンド番号（1 始まり。ウォームアップは 0） */
  roundNo?: number;
  /** 最大コンボ（連続正答数） */
  maxCombo?: number;
  /** このラウンドの試行列を作った乱数シード（再現用） */
  seed?: number;
  /** 推定フレーム間隔 (ms)。提示時間の実測誤差（±1 フレーム）の確認用 */
  frameMs?: number;
  /** ゲーム固有の記録（d′、切替コスト、T の中央値など。仕様書 第6節の「記録」） */
  metrics?: Record<string, number>;
}

export interface CertRecord {
  id: string;
  gameId: GameId;
  at: string;
  tier: number;
  rounds: { trials: number; correct: number }[];
  passed: boolean;
}

export interface TrialLog {
  roundId: string;
  i: number;
  onsetMs: number; // 刺激の提示開始（ラウンド開始からの ms）
  stim: string;
  resp?: string;
  rtMs?: number;
  correct: boolean;
  // ---- 拡張 ----
  /** フェーズ名 → 予定時間（フレーム量子化後の ms。応答期限つきのフェーズは期限） */
  plan?: Record<string, number>;
  /** 刺激フェーズの実測提示時間 (ms) */
  stimMs?: number;
}

export interface SessionRecord {
  id: string;
  startedAt: string; // ISO
  /** 最後に試合を終えた時刻（ISO）。まだ1試合も終えていなければ無し */
  endedAt?: string;
  order: GameId[];
  done: GameId[];
}
