/**
 * 画面の文言（src/i18n/）の点検。
 * - 受け入れ基準 2: 難度の選択・簡単モード・補助・スロー・ヒント・スキップを示す文言が1つも無い（仕様書 4.2 MUST）。
 *   画面の DOM は E2E（robustness / smoke）で調べ、ここでは出うる文言をすべて調べる（関数の文言は引数を入れて展開する）。
 * - 仕様書 7: ベルト名は 白帯〜黒帯二段 の 10 段。
 * （第12節の「使わない語」は scripts/lint-words.mjs が src/ 全体を調べる）
 */
import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../storage/schema';
import { beltName, gameText, ja } from './ja';

const DIFFICULTY_WORDS = /難易度|難度を選|難度選択|かんたん|簡単モード|スキップ|ヒント|補助|スロー/;

/** 文言をすべて集める（関数は数値・文字列・配列の引数で呼んで展開する） */
function collect(v: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof v === 'string') {
    out.push({ path, text: v });
  } else if (typeof v === 'function') {
    for (const args of [[1, 2, 3], ['ゲーム名', 'x', 'y'], [['80%', '75%']]]) {
      try {
        const r = (v as (...a: unknown[]) => unknown)(...args);
        if (typeof r === 'string') out.push({ path: `${path}()`, text: r });
      } catch {
        /* 引数の形が合わないものは飛ばす */
      }
    }
  } else if (Array.isArray(v)) {
    v.forEach((x, k) => collect(x, `${path}[${k}]`, out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) collect(x, path ? `${path}.${k}` : k, out);
  }
}

describe('画面の文言', () => {
  const all: { path: string; text: string }[] = [];
  collect(ja, '', all);

  it('たくさんの文言を調べている（共通 + 3 ゲーム）', () => {
    expect(all.length).toBeGreaterThan(200);
    for (const g of GAME_IDS) expect(all.some((s) => s.path.startsWith(`games.${g}.`))).toBe(true);
  });

  it('難度・補助・スキップを選ばせる文言が無い（受け入れ基準 2）', () => {
    const hits = all.filter((s) => DIFFICULTY_WORDS.test(s.text)).map((s) => `${s.path}: ${s.text}`);
    expect(hits).toEqual([]);
  });

  it('ラウンドの表示: 「ラウンド 2/3」。1 ラウンドだけの試合（スタンスチェンジ）は「ラウンド 1/1」ではなく「一本勝負」', () => {
    expect(ja.play.round(2, 3)).toBe('ラウンド 2/3');
    expect(ja.play.round(1, 1)).toBe('一本勝負');
    expect(ja.result.singleRoundHeading).toBe('ラウンドの結果');
  });

  it('所要時間の案内は、ゲームごとのラウンド数の違いを入れた実態（合計 約10分）に合わせる', () => {
    expect(ja.home.sessionNote).toContain('約10分');
    expect(ja.welcome.lead).toContain('10 分');
    expect(ja.welcome.items2[0]).toContain('1〜3 ラウンド');
  });

  it('ベルトは 白帯〜黒帯二段 の 10 段（仕様書 第7節）', () => {
    expect(Array.from({ length: 10 }, (_, k) => beltName(k))).toEqual(['白帯', '黄帯', '橙帯', '緑帯', '青帯', '紫帯', '茶帯', '赤帯', '黒帯', '黒帯二段']);
    expect(beltName(-1)).toBe('白帯');
    expect(beltName(12)).toBe('黒帯二段');
  });

  it('免責文は仕様書 第12節の文そのまま', () => {
    expect(ja.settings.disclaimer).toBe(
      '本アプリは娯楽・自己記録を目的とするゲームです。日常生活の能力向上や疾病の予防・治療を目的・保証するものではありません。医療機器ではありません。',
    );
  });

  it('各ゲームに名前・遊び方・キーの説明がある', () => {
    for (const g of GAME_IDS) {
      const t = gameText(g);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.howTo.length).toBeGreaterThan(0);
      expect(t.keys.length).toBeGreaterThan(0);
    }
  });
});
