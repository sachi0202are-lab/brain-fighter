/**
 * 画面の文言（src/i18n/）の点検。
 * - 受け入れ基準 2: 難度の選択・簡単モード・補助・スロー・ヒント・スキップを示す文言が1つも無い（仕様書 4.2 MUST）。
 *   画面の DOM は E2E（robustness / smoke）で調べ、ここでは出うる文言をすべて調べる（関数の文言は引数を入れて展開する）。
 * - 仕様書 7: ベルト名は 白帯〜黒帯二段 の 10 段。
 * （第12節の「使わない語」は scripts/lint-words.mjs が src/ 全体を調べる）
 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../engine/rng';
import { GAMES } from '../games';
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

  it('ラウンドの表示: 「ラウンド 2/3」。1 ラウンドだけの試合（v1.2 からは 3 ゲームとも）は「ラウンド 1/1」ではなく「一本勝負」', () => {
    expect(ja.play.round(2, 3)).toBe('ラウンド 2/3');
    expect(ja.play.round(1, 1)).toBe('一本勝負');
    expect(ja.result.singleRoundHeading).toBe('ラウンドの結果');
  });

  it('判定負けは煽らず情報だけ（仕様書 9.3）: 「判定負け」と「次は ◯ 問正解で KO」（ラウンド間の画面と結果画面で共用）', () => {
    expect(ja.outcome.decision).toBe('判定負け');
    expect(ja.outcome.koNext(16)).toBe('次は 16 問正解で KO');
  });

  it('所要時間の案内は、3 ゲームとも 1 試合 1 ラウンドの実態（合計 約4分・1 試合 1 分前後の一本勝負）に合わせる', () => {
    // 案内の前提（ラウンド数・試行数を変えたら、この文言と README の所要時間も見直す）
    const firstTrials: Record<string, number> = { 'double-hit': 24, 'combo-recall': 21, 'stance-change': 16 };
    for (const id of GAME_IDS) {
      expect(GAMES[id].roundsPerMatch, id).toBe(1);
      expect(GAMES[id].extraRounds ?? 0, id).toBe(0);
      const trials = GAMES[id].createRound(GAMES[id].initialParams, mulberry32(1), { untrained: false, surface: 0, roundNo: 1, kind: 'round' });
      expect(trials.length, id).toBe(firstTrials[id]);
    }
    expect(ja.home.sessionNote).toContain('約4分');
    expect(ja.welcome.lead).toBe('毎日 4 分ほど、3 つのミニゲームで戦闘力を上げよう');
    expect(ja.welcome.items2[0]).toContain('1 試合は 1 分前後の一本勝負');
    // 以前の所要時間・ラウンド数の文言が残っていない（v1.1 の 10 分・v1.2 の 5 分と 1〜2 分）
    const texts = [ja.home.sessionNote, ja.welcome.lead, ...ja.welcome.items2];
    expect(texts.filter((t) => /10 ?分|12〜15|5 ?分|1〜2 分|1〜3 ラウンド|3 ラウンド/.test(t))).toEqual([]);
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
