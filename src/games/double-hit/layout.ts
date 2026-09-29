/**
 * ダブルヒットの応答: 構え（2〜3択）と火花の方向（8方向）。
 *
 * - 下帯のボタン: 左に構え（上から 上段・中段・下段）、右にテンキーと同じ並びの 3×3 の方向パッド（中央は空き）。
 * - PC キー（1キー = 1ボタン。同時押しは使わない）:
 *   構え = Q 上段 / A 下段 / Z 中段（中段は構えが3種類のときだけ）
 *   方向 = テンキー 7 8 9 / 4 6 / 1 2 3（KeyboardEvent.code の Numpad*。NumLock が切れていても効く）
 *          ＋ 数字キー、矢印キー（上下左右）、Home / PageUp / End / PageDown（斜め）、U I O / J L / M , .
 * - 刺激領域のタップ（hitTest）: 中心から見た角度で 8 方向に振り分ける（中心付近は無効）。
 */
import type { ResponseButton, ResponseLayout } from '../../engine/types';
import { doubleHitText as text } from '../../i18n/ja/double-hit';

export type StanceId = 'high' | 'low' | 'mid';
export type DirId = 'd7' | 'd8' | 'd9' | 'd4' | 'd6' | 'd1' | 'd2' | 'd3';

/** 応答グループ名（Response のキー） */
export const STANCE_GROUP = 'stance';
export const DIR_GROUP = 'dir';

/** 構えの種類数 → 使う構え（2種 = 上段・下段、3種で中段を足す） */
export function stanceSet(count: number): StanceId[] {
  return count >= 3 ? ['high', 'low', 'mid'] : ['high', 'low'];
}

export interface DirSpec {
  id: DirId;
  /** 角度（右 = 0°、反時計回り。画面の上が 90°） */
  angleDeg: number;
  /** 下帯グリッドでの位置 */
  col: number;
  row: number;
  keys: readonly string[];
}

/** 8方向（角度の順。index = 角度 / 45°） */
export const DIRS: readonly DirSpec[] = [
  { id: 'd6', angleDeg: 0, col: 5, row: 3, keys: ['6', 'Numpad6', 'ArrowRight', 'l'] },
  { id: 'd9', angleDeg: 45, col: 5, row: 1, keys: ['9', 'Numpad9', 'PageUp', 'o'] },
  { id: 'd8', angleDeg: 90, col: 4, row: 1, keys: ['8', 'Numpad8', 'ArrowUp', 'i'] },
  { id: 'd7', angleDeg: 135, col: 3, row: 1, keys: ['7', 'Numpad7', 'Home', 'u'] },
  { id: 'd4', angleDeg: 180, col: 3, row: 3, keys: ['4', 'Numpad4', 'ArrowLeft', 'j'] },
  { id: 'd1', angleDeg: 225, col: 3, row: 5, keys: ['1', 'Numpad1', 'End', 'm'] },
  { id: 'd2', angleDeg: 270, col: 4, row: 5, keys: ['2', 'Numpad2', 'ArrowDown', ','] },
  { id: 'd3', angleDeg: 315, col: 5, row: 5, keys: ['3', 'Numpad3', 'PageDown', '.'] },
];

export const DIR_IDS: readonly DirId[] = DIRS.map((d) => d.id);

const DIR_INDEX = new Map<DirId, number>(DIRS.map((d, i) => [d.id, i]));

/** 方向の index（0..7、角度 / 45°） */
export function dirIndex(id: DirId): number {
  return DIR_INDEX.get(id) ?? 0;
}

/** 方向の単位ベクトル（画面座標: x 右、y 下） */
export function dirVector(id: DirId): { x: number; y: number } {
  const a = (dirIndex(id) * Math.PI) / 4;
  return { x: Math.cos(a), y: -Math.sin(a) };
}

const STANCE_KEYS: Record<StanceId, readonly string[]> = {
  high: ['q', 'KeyQ'],
  low: ['a', 'KeyA'],
  mid: ['z', 'KeyZ'],
};

/** 下帯のグリッド: 5 列 × 6 行（構え = 1〜2 列、方向パッド = 3〜5 列で各ボタン 2 行ぶん） */
const COLUMNS = 5;
const ROWS = 6;

function stanceButton(id: StanceId, row: number, rowSpan: number): ResponseButton {
  const label = text.stances[id];
  return {
    id,
    group: STANCE_GROUP,
    label,
    ariaLabel: text.stanceAria(label),
    keys: STANCE_KEYS[id],
    col: 1,
    row,
    colSpan: 2,
    rowSpan,
  };
}

/** 方向ボタンを読む順（テンキーの並び: 7 8 9 / 4 6 / 1 2 3） */
const DIR_READING_ORDER: readonly DirId[] = ['d7', 'd8', 'd9', 'd4', 'd6', 'd1', 'd2', 'd3'];

const DIR_BUTTONS: readonly ResponseButton[] = DIR_READING_ORDER.map((id) => {
  const d = DIRS[dirIndex(id)] as DirSpec;
  return {
    id,
    group: DIR_GROUP,
    label: text.dirLabels[id],
    ariaLabel: text.dirAria(text.dirNames[id]),
    keys: d.keys,
    col: d.col,
    row: d.row,
    rowSpan: 2,
  };
});

const LAYOUT_2: ResponseLayout = {
  columns: COLUMNS,
  rows: ROWS,
  buttons: [stanceButton('high', 1, 3), stanceButton('low', 4, 3), ...DIR_BUTTONS],
};

const LAYOUT_3: ResponseLayout = {
  columns: COLUMNS,
  rows: ROWS,
  buttons: [stanceButton('high', 1, 2), stanceButton('mid', 3, 2), stanceButton('low', 5, 2), ...DIR_BUTTONS],
};

/** 構えの種類数に合わせた下帯のレイアウト */
export function layoutFor(stances: number): ResponseLayout {
  return stances >= 3 ? LAYOUT_3 : LAYOUT_2;
}

/** 刺激領域のタップを無視する中心付近の半径（刺激領域の半径に対する比） */
export const HIT_DEAD_ZONE = 0.15;

/**
 * 刺激領域の座標 (0..size) → 方向。中心から見た角度で 8 つの扇形（各 45°）に振り分ける。
 * 中心付近（HIT_DEAD_ZONE 未満）は null。
 */
export function dirAt(x: number, y: number, size: number): DirId | null {
  const R = size / 2;
  if (!(R > 0)) return null;
  const dx = (x - R) / R;
  const dy = (y - R) / R;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < HIT_DEAD_ZONE) return null;
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const k = ((Math.round(deg / 45) % 8) + 8) % 8;
  return (DIRS[k] as DirSpec).id;
}
