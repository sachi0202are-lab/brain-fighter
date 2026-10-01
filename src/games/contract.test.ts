/**
 * すべての登録ゲームが GameModule の約束を守っているかの共通テスト。
 * フェーズ2で各ゲームを本実装に置き換えても、このテストがそのまま効く（このファイルは編集しない）。
 */
import { describe, expect, it } from 'vitest';
import { runMatchHeadless, runRoundHeadless } from '../engine/headless';
import { mulberry32 } from '../engine/rng';
import { layoutGroups, restoreParams, type AnyGameModule, type PhaseName, type RoundOptions } from '../engine/types';
import { GAME_IDS } from '../storage/schema';
import { mockContext2D } from '../test/mock-canvas';
import { GAMES } from './index';

const OPTS: RoundOptions = { untrained: false, surface: 0, roundNo: 1, kind: 'round' };
const PHASES: PhaseName[] = ['cue', 'fixation', 'stimulus', 'mask', 'response', 'feedback', 'iti'];

describe('ゲームの登録', () => {
  it('3本とも登録され、id が一致する', () => {
    for (const id of GAME_IDS) expect(GAMES[id].id).toBe(id);
  });
});

describe.each(GAME_IDS.map((id) => [id, GAMES[id]] as [string, AnyGameModule]))('%s は GameModule の約束を守る', (_id, game) => {
  const params = game.initialParams;

  it('initialParams は有限の数値だけ、restoreParams で保存値から戻せる', () => {
    for (const v of Object.values(params)) expect(Number.isFinite(v)).toBe(true);
    expect(restoreParams(game, params)).toEqual(params);
    expect(restoreParams(game, {})).toEqual(params);
    expect(restoreParams(game, undefined)).toEqual(params);
  });

  it('createRound は同じシードで同じ試行列、違うシードで違う試行列', () => {
    const a = game.createRound(params, mulberry32(1), OPTS);
    const b = game.createRound(params, mulberry32(1), OPTS);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    const differs = [2, 3, 4, 5].some((s) => {
      const c = game.createRound(params, mulberry32(s), OPTS);
      return JSON.stringify(c) !== JSON.stringify(a);
    });
    expect(differs).toBe(true);
  });

  it('フェーズ: 名前は既知で重複なし、時間は有限で 0 以上、応答を受け付けるフェーズがある', () => {
    for (const t of game.createRound(params, mulberry32(7), OPTS)) {
      const ph = game.phases(t, params);
      const names = ph.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
      for (const p of ph) {
        expect(PHASES).toContain(p.name);
        expect(Number.isFinite(p.ms)).toBe(true);
        expect(p.ms).toBeGreaterThanOrEqual(0);
      }
      expect(ph.some((p) => p.input && p.ms > 0)).toBe(true);
      expect(names).toContain('stimulus');
    }
  });

  it('応答レイアウト: id は一意、グリッドの内側、キー割当あり、キーの重複なし', () => {
    const layout = game.responseLayout(params, OPTS);
    const ids = layout.buttons.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = layout.buttons.flatMap((b) => b.keys.map((k) => (k.length === 1 ? k.toLowerCase() : k)));
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of layout.buttons) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.keys.length).toBeGreaterThan(0);
      expect(b.col).toBeGreaterThanOrEqual(1);
      expect(b.row).toBeGreaterThanOrEqual(1);
      expect(b.col + (b.colSpan ?? 1) - 1).toBeLessThanOrEqual(layout.columns);
      expect(b.row + (b.rowSpan ?? 1) - 1).toBeLessThanOrEqual(layout.rows);
    }
    expect(layoutGroups(layout).length).toBeGreaterThan(0);
  });

  it('正解の応答で判定すると正答、試行の説明は空でない', () => {
    const layout = game.responseLayout(params, OPTS);
    const ids = new Set(layout.buttons.map((b) => b.id));
    for (const t of game.createRound(params, mulberry32(8), OPTS)) {
      const exp = game.expectedResponse(t);
      if (exp) for (const v of Object.values(exp)) expect(ids.has(v)).toBe(true);
      expect(game.judge(t, exp).correct).toBe(true);
      expect(game.describeTrial(t).length).toBeGreaterThan(0);
    }
  });

  it('renderStimulus はどのフェーズでも例外を出さない', () => {
    const { ctx } = mockContext2D();
    for (const t of game.createRound(params, mulberry32(9), OPTS).slice(0, 3)) {
      for (const p of game.phases(t, params)) {
        for (const untrained of [false, true]) {
          expect(() =>
            game.renderStimulus(ctx, t, p.name, 0, { size: 300, colorSafe: false, untrained, surface: 0, selection: {} }),
          ).not.toThrow();
        }
      }
    }
  });

  it('1試合がヘッドレスで最後まで動き、戦闘力は 0〜1000 の整数', async () => {
    const res = await runMatchHeadless(game, params, { seed: 123 });
    expect(res.rounds.length).toBe(game.roundsPerMatch ?? 1);
    expect(res.warmup).toBeNull();
    for (const r of res.rounds) {
      expect(Number.isInteger(r.power)).toBe(true);
      expect(r.power).toBeGreaterThanOrEqual(0);
      expect(r.power).toBeLessThanOrEqual(1000);
      for (const v of Object.values(r.paramsEnd)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(r.metrics)) expect(Number.isFinite(v)).toBe(true);
    }
    expect(game.enemyLevel(res.paramsEnd)).toBeGreaterThanOrEqual(0);
  });

  it('速さは戦闘力に影響しない（同じ正誤で反応時間だけ変える）', async () => {
    const trials = game.createRound(params, mulberry32(77), OPTS);
    const run = (delayMs: number) => runRoundHeadless(game, trials, params, OPTS, true, { delayMs });
    const fast = await run(80);
    const slow = await run(420);
    expect(fast.results.map((r) => r.correct)).toEqual(slow.results.map((r) => r.correct));
    expect(fast.rtMedianMs).not.toBe(slow.rtMedianMs);
    expect(game.power(fast.paramsPlayed, fast)).toBe(game.power(slow.paramsPlayed, slow));
    const adaptFast = game.adapt ? game.adapt(fast.paramsPlayed, fast) : fast.paramsPlayed;
    const adaptSlow = game.adapt ? game.adapt(slow.paramsPlayed, slow) : slow.paramsPlayed;
    expect(adaptFast).toEqual(adaptSlow);
  });

  it('認定戦のティア 1〜9 の難度で、未訓練セットの試行列が作れる', () => {
    for (let tier = 1; tier <= 9; tier++) {
      const p = game.certParams(tier);
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      const trials = game.createRound(p, mulberry32(tier), { ...OPTS, untrained: true });
      expect(trials.length).toBeGreaterThan(0);
    }
  });
});
