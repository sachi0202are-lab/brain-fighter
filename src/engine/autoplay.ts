/**
 * テスト用の疑似プレイヤー（ヘッドレスのユニットテストと、?test=1 の自動プレイで共用）。
 * 正解の応答は GameModule.expectedResponse から取る。
 */
import { layoutGroups, type Response, type ResponseLayout } from './types';

/** 押すボタンの id の並び（[] なら押さない） */
export type AnswerPlan = string[];

/** 正解どおりに押す */
export function correctPlan(expected: Response | null): AnswerPlan {
  return expected ? Object.values(expected) : [];
}

/** わざと間違える */
export function wrongPlan(layout: ResponseLayout, expected: Response | null): AnswerPlan {
  const groups = layoutGroups(layout);
  const firstOf = (g: string): string | undefined => layout.buttons.find((b) => (b.group ?? 'main') === g)?.id;
  if (!expected || Object.keys(expected).length === 0) {
    // 押さないのが正解 → 全グループ押して応答を完成させる
    return groups.map(firstOf).filter((x): x is string => x !== undefined);
  }
  const g0 = groups.find((g) => expected[g] !== undefined) ?? (groups[0] as string);
  const alt = layout.buttons.find((b) => (b.group ?? 'main') === g0 && b.id !== expected[g0]);
  if (!alt) return []; // 別の選択肢が無い（1ボタンのゲーム）→ 押さない
  return groups
    .map((g) => (g === g0 ? alt.id : (expected[g] ?? firstOf(g))))
    .filter((x): x is string => x !== undefined);
}

/** 5 試行に1回だけ誤る（正答率 80%） */
export const every5thWrong = (i: number): boolean => i % 5 !== 4;

export function botPlan(
  i: number,
  layout: ResponseLayout,
  expected: Response | null,
  shouldBeCorrect: (i: number) => boolean = every5thWrong,
): AnswerPlan {
  return shouldBeCorrect(i) ? correctPlan(expected) : wrongPlan(layout, expected);
}
