import { describe, expect, it, vi } from 'vitest';
import { every5thWrong, wrongPlan, correctPlan } from '../../engine/autoplay';
import { runMatchHeadless, runRoundHeadless } from '../../engine/headless';
import { mulberry32 } from '../../engine/rng';
import { RoundRunner } from '../../engine/round';
import { VirtualScheduler } from '../../engine/timing';
import type { PhaseName, RoundOptions, RoundSummary, TrialResult } from '../../engine/types';
import { stanceChangeText as text } from '../../i18n/ja/stance-change';
import { mockContext2D } from '../../test/mock-canvas';
import { describeStance, FEEDBACK_MS, game, introText, ITI_MS, judgeStance, responseLabels } from './index';
import { ladderParams } from './ladder';
import { genericTipIndex, stanceMetrics, tipKey } from './metrics';
import type { ScParams, ScTrial, Transition } from './model';
import { iconPlacement, iconShape, lookFor, paletteFor, SURFACES, UNTRAINED_LOOK } from './render';
import { makeWarmupTrials } from './sequence';

const OPTS: RoundOptions = { untrained: false, surface: 0, roundNo: 1, kind: 'round' };

function trial(p: Partial<ScTrial> = {}): ScTrial {
  return { rule: 'height', transition: 'repeat', height: 'left', color: 'right', shape: null, congruent: false, untrained: false, ...p };
}

describe('判定（judge）', () => {
  it('構えの属性で正誤が決まる（二価刺激・共通応答）', () => {
    const t = trial({ height: 'left', color: 'right' }); // 上段・青
    expect(judgeStance({ ...t, rule: 'height' }, { main: 'left' })).toEqual({ correct: true });
    expect(judgeStance({ ...t, rule: 'color' }, { main: 'right' })).toEqual({ correct: true });
    expect(judgeStance({ ...t, rule: 'color' }, { main: 'left' }).correct).toBe(false);
    const t3 = trial({ rule: 'shape', shape: 'right', height: 'left', color: 'left' });
    expect(judgeStance(t3, { main: 'right' })).toEqual({ correct: true });
    expect(game.expectedResponse(t3)).toEqual({ main: 'right' });
  });

  it('無応答（期限切れ）は timeout、押し間違いはその試行の移り変わりで内訳を分ける', () => {
    expect(judgeStance(trial(), null)).toEqual({ correct: false, kind: 'timeout' });
    expect(judgeStance(trial(), {})).toEqual({ correct: false, kind: 'timeout' });
    for (const tr of ['switch', 'repeat', 'first', 'single'] as Transition[]) {
      expect(judgeStance(trial({ transition: tr }), { main: 'right' })).toEqual({ correct: false, kind: tr });
    }
  });

  it('期限を過ぎたら timeout として数え、次の試行へ進む（ヘッドレス）', async () => {
    const p = ladderParams(1);
    const trials = game.createRound(p, mulberry32(4), OPTS);
    // 偶数試行は答えない、奇数試行は正解
    const s = await runRoundHeadless(game, trials, p, OPTS, true, {
      plan: ({ i, expected }) => (i % 2 === 0 ? [] : correctPlan(expected)),
    });
    expect(s.errors).toEqual({ timeout: 15 });
    expect(s.correct).toBe(15);
    for (const r of s.results.filter((x) => x.i % 2 === 0)) {
      expect(r.rtMs).toBeUndefined();
      const stim = r.phases.find((ph) => ph.name === 'stimulus')!;
      expect(stim.endMs - stim.startMs).toBeCloseTo(stim.plannedMs, 6); // 期限いっぱいで閉じる
    }
  });

  it('誤答の内訳は timeout / switch / repeat / first に分かれる（ヘッドレス）', async () => {
    const p = ladderParams(3);
    const trials = game.createRound(p, mulberry32(21), OPTS);
    const s = await runRoundHeadless(game, trials, p, OPTS, true, {
      plan: ({ i, expected, layout }) => (i < 3 ? [] : i % 3 === 0 ? wrongPlan(layout, expected) : correctPlan(expected)),
    });
    const wrongIdx = s.results.filter((r) => r.i >= 3 && r.i % 3 === 0);
    const expected: Record<string, number> = { timeout: 3 };
    for (const r of wrongIdx) expected[r.trial.transition] = (expected[r.trial.transition] ?? 0) + 1;
    expect(s.errors).toEqual(expected);
  });
});

describe('フェーズ（手がかり → 刺激 → フィードバック → 試行間隔）', () => {
  it('cue = CSI、stimulus = D（応答窓・応答で打ち切り）、feedback 300、iti 500', () => {
    for (const step of [1, 7, 10, 11, 20]) {
      const p = ladderParams(step);
      expect(game.phases(trial(), p)).toEqual([
        { name: 'cue', ms: p.CSI },
        { name: 'stimulus', ms: p.D, input: true, untilResponse: true },
        { name: 'feedback', ms: FEEDBACK_MS },
        { name: 'iti', ms: ITI_MS },
      ]);
    }
  });

  it('手がかり（cue）の間の入力は受け付けない。刺激が出たら受け付ける', () => {
    const p = ladderParams(1);
    const sched = new VirtualScheduler();
    const runner = new RoundRunner({ game, trials: game.createRound(p, mulberry32(2), OPTS), params: p, options: OPTS, adaptive: true, scheduler: sched });
    const done = runner.start();
    done.catch(() => {});
    sched.step();
    expect(runner.snapshot()!.phase).toBe('cue');
    expect(runner.snapshot()!.accepting).toBe(false);
    expect(runner.input('left')).toBe(false);
    while (runner.snapshot()!.phase === 'cue') sched.step();
    expect(runner.snapshot()!.phase).toBe('stimulus');
    expect(runner.snapshot()!.accepting).toBe(true);
    expect(runner.input('left')).toBe(true);
    runner.abort();
  });

  it('ヘッドレス: 刺激の開始から RT を測る', async () => {
    const p = ladderParams(5);
    const trials = game.createRound(p, mulberry32(5), OPTS).slice(0, 4);
    const s = await runRoundHeadless(game, trials, p, OPTS, true, { delayMs: 250 });
    for (const r of s.results) {
      const cue = r.phases.find((ph) => ph.name === 'cue')!;
      const stim = r.phases.find((ph) => ph.name === 'stimulus')!;
      expect(cue.input).toBe(false);
      expect(cue.endMs - cue.startMs).toBeCloseTo(cue.plannedMs, 6);
      expect(Math.abs(cue.plannedMs - p.CSI)).toBeLessThanOrEqual(1000 / 120 + 1e-9);
      expect(stim.plannedMs).toBeCloseTo(Math.round(p.D / (1000 / 60)) * (1000 / 60), 6);
      expect(r.onsetMs).toBeCloseTo(stim.startMs, 9);
      expect(r.rtMs).toBeGreaterThanOrEqual(250 - 1e-6);
      expect(r.rtMs).toBeLessThan(250 + 1000 / 60 + 1e-6);
    }
  });
});

describe('応答レイアウト', () => {
  it('左右2ボタン共通。PC キーは ← / →（F / J も可）', () => {
    const l = game.responseLayout(ladderParams(1), OPTS);
    expect(l.columns).toBe(2);
    expect(l.buttons.map((b) => b.id)).toEqual(['left', 'right']);
    expect(l.buttons[0]!.keys).toContain('ArrowLeft');
    expect(l.buttons[1]!.keys).toContain('ArrowRight');
    expect(l.buttons.every((b) => (b.group ?? 'main') === 'main')).toBe(true);
  });

  it('ボタンの文言はルール数と刺激セットで変わる（左 = 上段・橙・丸、右 = 下段・青・角）', () => {
    expect(responseLabels(2, false)).toEqual({ left: '上段・橙', right: '下段・青' });
    expect(responseLabels(3, false)).toEqual({ left: '上段・橙・丸', right: '下段・青・角' });
    expect(responseLabels(3, true)).toEqual({ left: '大・黄・三角', right: '小・紫・十字' });
    const l3 = game.responseLayout(ladderParams(11), { ...OPTS, untrained: true });
    expect(l3.buttons.map((b) => b.label)).toEqual(['大・黄・三角', '小・紫・十字']);
    expect(l3.buttons[0]!.ariaLabel).toBe('左: 大・黄・三角');
  });
});

describe('試行の記録（describeTrial）', () => {
  it('構え・移り変わり・属性・一致・正解が読める', () => {
    expect(describeStance(trial({ rule: 'height', transition: 'switch', height: 'left', color: 'right' }))).toBe('As:Ub-:i>L');
    expect(describeStance(trial({ rule: 'color', transition: 'repeat', height: 'right', color: 'right', congruent: true }))).toBe('Br:Db-:c>R');
    expect(describeStance(trial({ rule: 'shape', transition: 'first', height: 'left', color: 'left', shape: 'right' }))).toBe('Cf:Uoq:i>R');
    expect(describeStance(trial({ transition: 'single', untrained: true, shape: 'left' }))).toBe('Aw:Lpt:i>L');
  });
});

// ---- 記録（metrics） ----

function result(i: number, t: Partial<ScTrial>, correct: boolean, rtMs?: number): TrialResult<ScParams, ScTrial> {
  return {
    i,
    trial: trial(t),
    params: ladderParams(1),
    stim: '',
    response: rtMs === undefined ? null : { main: 'left' },
    judgement: correct ? { correct } : { correct, kind: rtMs === undefined ? 'timeout' : (t.transition ?? 'repeat') },
    correct,
    ...(rtMs !== undefined ? { rtMs } : {}),
    onsetMs: i * 2000,
    phases: [],
  };
}

function summary(kind: 'round' | 'warmup', results: TrialResult<ScParams, ScTrial>[], params = ladderParams(4)): RoundSummary<ScParams, ScTrial> {
  const correct = results.filter((r) => r.correct).length;
  return {
    kind,
    roundNo: kind === 'warmup' ? 0 : 1,
    trials: results.length,
    correct,
    accuracy: correct / results.length,
    errors: {},
    paramsStart: params,
    paramsPlayed: params,
    maxCombo: 0,
    frameMs: 1000 / 60,
    results,
  };
}

describe('記録（metrics）: 切替コスト・混合コスト', () => {
  const warm = summary('warmup', [
    result(0, { transition: 'single' }, true, 2000), // 最初の試行は除く
    result(1, { transition: 'single' }, true, 500),
    result(2, { transition: 'single' }, true, 520),
    result(3, { transition: 'single' }, true, 480),
    result(4, { transition: 'single' }, false, 300), // 誤答は除く
  ]);
  const round = summary('round', [
    result(0, { transition: 'first' }, true, 1500), // 最初の試行は除く
    result(1, { transition: 'switch' }, true, 800),
    result(2, { transition: 'repeat' }, true, 600),
    result(3, { transition: 'switch' }, true, 840),
    result(4, { transition: 'repeat' }, true, 640),
    result(5, { transition: 'switch' }, false, 400), // 誤答は除く
    result(6, { transition: 'repeat' }, true, 620),
    result(7, { transition: 'switch' }, false), // 期限切れ
  ]);

  it('反復・切替の RT 中央値（正答のみ）、切替コスト = 切替 − 反復、混合コスト = 反復 − ウォームアップ', () => {
    const m = stanceMetrics(round, warm);
    expect(m).toEqual({
      step: 4,
      rules: 2,
      accuracy: 0.75,
      accRepeat: 1,
      accSwitch: 0.5,
      rtRepeat: 620,
      rtSwitch: 820,
      switchCost: 200,
      rtSingle: 500,
      mixingCost: 120,
    });
    // GameModule 経由（ctx.warmup）でも同じ
    expect(game.metrics!(round, { warmup: warm })).toEqual(m);
  });

  it('ウォームアップが無ければ混合コストは入れない。計算できない値は入れない（有限の数値だけ）', () => {
    const m = stanceMetrics(round, null);
    expect(m.mixingCost).toBeUndefined();
    expect(m.rtSingle).toBeUndefined();
    const allWrong = summary('round', [result(0, { transition: 'first' }, false), result(1, { transition: 'switch' }, false, 300)]);
    const m2 = stanceMetrics(allWrong, warm);
    // 正答が無いので RT・切替コスト・混合コストは無し（反復試行も無いので accRepeat も無し）
    expect(Object.keys(m2).sort()).toEqual(['accSwitch', 'accuracy', 'rtSingle', 'rules', 'step']);
    for (const v of Object.values(m2)) expect(Number.isFinite(v)).toBe(true);
  });

  it('ウォームアップ自身の記録は単一課題の RT', () => {
    expect(stanceMetrics(warm, null)).toEqual({ step: 4, rules: 2, accuracy: 0.8, rtSingle: 500 });
  });
});

describe('記録（metrics）: ヘッドレスで反応時間を作り分ける', () => {
  it('切替試行だけ 150 ms 遅いと切替コスト ≒ 150、混合コスト ≒ 100（単一課題ブロックを渡したとき）', async () => {
    const p = ladderParams(2);
    // 毎日の試合はウォームアップ無し。混合コストの計算は、単一課題ブロック（測定用に残した makeWarmupTrials）を渡したときだけ
    const warmTrials = makeWarmupTrials(mulberry32(31), p.rules, false);
    const roundTrials = game.createRound(p, mulberry32(32), OPTS);
    const plan = ({ expected }: { expected: Record<string, string> | null }) => correctPlan(expected);
    const warm = await runRoundHeadless(game, warmTrials, p, { ...OPTS, kind: 'warmup', roundNo: 0 }, false, {
      plan,
      delayMs: 400,
    });
    const round = await runRoundHeadless(game, roundTrials, p, OPTS, true, {
      plan,
      delayMs: (i) => (roundTrials[i]!.transition === 'switch' ? 650 : 500),
    });
    const m = game.metrics!(round, { warmup: warm });
    const F = 1000 / 60;
    expect(Math.abs(m.switchCost! - 150)).toBeLessThanOrEqual(F);
    expect(Math.abs(m.mixingCost! - 100)).toBeLessThanOrEqual(F);
    expect(m.accuracy).toBe(1);
    // 毎日の試合と同じくウォームアップが無ければ、切替コストだけ（混合コスト・単一課題の RT は入れない）
    const daily = game.metrics!(round, { warmup: null });
    expect(daily.switchCost).toBe(m.switchCost);
    expect(daily.mixingCost).toBeUndefined();
    expect(daily.rtSingle).toBeUndefined();
    // 戦闘力は速さに関係しない（同じ正誤で全部 400 ms にしても同じ）
    const flat = await runRoundHeadless(game, roundTrials, p, OPTS, true, { plan, delayMs: 400 });
    expect(game.power(flat.paramsPlayed, flat)).toBe(game.power(round.paramsPlayed, round));
    expect(game.adapt!(flat.paramsPlayed, flat)).toEqual(game.adapt!(round.paramsPlayed, round));
  });
});

describe('ラウンドの一言・ルールの一言', () => {
  const base = (transitions: Transition[], wrongAt: number[], timeoutAt: number[] = [], congruent = false) =>
    summary(
      'round',
      transitions.map((tr, i) =>
        timeoutAt.includes(i)
          ? result(i, { transition: tr, congruent }, false)
          : result(i, { transition: tr, congruent }, !wrongAt.includes(i), 500),
      ),
    );
  const trs: Transition[] = ['first', ...Array.from({ length: 29 }, (_, i) => (i % 2 === 0 ? 'switch' : 'repeat') as Transition)];

  it('傾向に合わせて選ぶ（正答率 90% 以上 / 時間切れ / 切替 / 反復 / つられ / その他）', () => {
    expect(tipKey(base(trs, [1, 3]))).toBe('kept');
    expect(tipKey(base(trs, [1], [2, 4, 6, 8]))).toBe('timeout');
    expect(tipKey(base(trs, [1, 3, 5, 7, 9]))).toBe('switch');
    expect(tipKey(base(trs, [2, 4, 6, 8, 10]))).toBe('repeat');
    expect(tipKey(base(trs, [1, 2, 3, 4, 5]))).toBe('conflict');
    expect(tipKey(base(trs, [1, 2, 3, 4, 5], [], true))).toBe('generic');
  });

  it('文言は i18n から選ぶ（禁止語の検査は npm run lint:words）', () => {
    expect(game.roundTip!(base(trs, [1, 3, 5, 7, 9]))).toBe(text.tipFor.switch);
    expect(text.tipFor.switch).toContain('0.2 秒');
    for (const t of [...Object.values(text.tipFor), ...text.tips]) expect(t.length).toBeGreaterThan(0);
  });

  it('傾向の無いラウンドの一言は、正答数とラウンド番号で順に替える（1試合 1 ラウンドでも毎回同じにならない）', () => {
    const generic = base(trs, [1, 2, 3, 4, 5], [], true); // 25 / 30 正答
    expect(tipKey(generic)).toBe('generic');
    const n = text.tips.length;
    // 1 ラウンドの試合（roundNo = 1）でも、正答数が違えば別の一言になり、3 つとも出る
    const byCorrect = [24, 25, 26].map((correct) => game.roundTip!({ ...generic, correct }));
    expect(new Set(byCorrect).size).toBe(n);
    expect([...byCorrect].sort()).toEqual([...text.tips].sort());
    // ラウンド番号が 1 つ進めば次の一言（今までの順番どおり）
    const byRound = [1, 2, 3].map((roundNo) => game.roundTip!({ ...generic, roundNo }));
    const start = genericTipIndex(generic, n);
    expect(byRound).toEqual([0, 1, 2].map((k) => text.tips[(start + k) % n]));
    expect(genericTipIndex({ roundNo: 1, correct: 0 }, n)).toBe(0);
    expect(genericTipIndex({ roundNo: 0, correct: -3 }, n)).toBe(0);
  });

  it('roundIntro は構えの意味を毎ラウンド出す（ルール数・ウォームアップ・未訓練セット）', () => {
    const r2 = game.roundIntro!(ladderParams(3), { kind: 'round', roundNo: 2 });
    expect(r2).toBe('構えA「高低」上段 = 左／下段 = 右　構えB「色」橙 = 左／青 = 右');
    const r3 = game.roundIntro!(ladderParams(11), { kind: 'round', roundNo: 1 });
    expect(r3).toContain('構えC「形」丸 = 左／角 = 右');
    const w = game.roundIntro!(ladderParams(11), { kind: 'warmup', roundNo: 0 });
    expect(w).toContain('構えA「高低」上段 = 左／下段 = 右');
    expect(w).toContain('色と形は気にせず');
    expect(introText(3, 'round', true)).toBe('構えA「大小」大 = 左／小 = 右　構えB「色」黄 = 左／紫 = 右　構えC「形」三角 = 左／十字 = 右');
  });
});

describe('描画（renderStimulus）', () => {
  const PHASES: PhaseName[] = ['cue', 'stimulus', 'feedback', 'iti'];

  it('どの表層・色覚配慮・刺激セット・ルール数でも例外を出さない。乱数を使わず、時間で変わらない', () => {
    const rnd = vi.spyOn(Math, 'random');
    try {
      for (const rules of [2, 3]) {
        const trials = game.createRound(ladderParams(rules === 2 ? 1 : 11), mulberry32(3), OPTS);
        for (const t of trials.slice(0, 6)) {
          for (const phase of PHASES) {
            for (const surface of [0, 1, 2, 5, -1]) {
              for (const colorSafe of [false, true]) {
                for (const untrained of [false, true]) {
                  const view = { size: 320, colorSafe, untrained, surface, selection: {} };
                  const a = mockContext2D();
                  const b = mockContext2D();
                  game.renderStimulus(a.ctx, t, phase, 0, view);
                  game.renderStimulus(b.ctx, t, phase, 777, view);
                  expect([...b.calls]).toEqual([...a.calls]);
                }
              }
            }
          }
        }
      }
      expect(rnd).not.toHaveBeenCalled();
    } finally {
      rnd.mockRestore();
    }
  });

  it('構えは cue と stimulus の間だけ文字で出し、アイコンは stimulus の間だけ描く', () => {
    const t = trial({ rule: 'color' });
    const view = { size: 300, colorSafe: false, untrained: false, surface: 0, selection: {} };
    const count = (phase: PhaseName, name: string): number => {
      const m = mockContext2D();
      game.renderStimulus(m.ctx, t, phase, 0, view);
      return m.calls.get(name) ?? 0;
    };
    expect(count('cue', 'fillText')).toBeGreaterThan(0);
    expect(count('stimulus', 'fillText')).toBe(count('cue', 'fillText'));
    expect(count('feedback', 'fillText')).toBe(0);
    expect(count('iti', 'fillText')).toBe(0);
    expect(count('stimulus', 'fill')).toBeGreaterThan(count('cue', 'fill'));
    expect(count('feedback', 'fill')).toBe(count('iti', 'fill'));
  });

  it('高さは位置（訓練）／大きさ（未訓練）、形は 2 ルールで中立・3 ルールで丸／角（未訓練は三角／十字）', () => {
    const hi = iconPlacement({ height: 'left' }, 300, false);
    const lo = iconPlacement({ height: 'right' }, 300, false);
    expect(hi.y).toBeLessThan(lo.y);
    expect(hi.r).toBe(lo.r);
    const big = iconPlacement({ height: 'left' }, 300, true);
    const small = iconPlacement({ height: 'right' }, 300, true);
    expect(big.y).toBe(small.y);
    expect(big.r).toBeCloseTo(small.r * 2, 9);
    expect([iconShape(null, false), iconShape('left', false), iconShape('right', false)]).toEqual(['burst', 'circle', 'square']);
    expect([iconShape(null, true), iconShape('left', true), iconShape('right', true)]).toEqual(['hexagon', 'triangle', 'cross']);
  });

  it('表層は背景・シルエット・仕上げだけを変え、未訓練セットは表層によらず別の色の組', () => {
    expect(game.surfaceCount).toBe(3);
    const looks = [0, 1, 2].map((surface) => lookFor({ untrained: false, surface }));
    expect(new Set(looks.map((l) => l.background)).size).toBe(3);
    expect(new Set(looks.map((l) => l.figure)).size).toBe(3);
    expect(new Set(looks.map((l) => l.iconStyle)).size).toBe(3);
    expect(lookFor({ untrained: false, surface: 4 })).toBe(SURFACES[1]);
    expect(lookFor({ untrained: true, surface: 2 })).toBe(UNTRAINED_LOOK);
    const train = paletteFor({ untrained: false, colorSafe: false });
    const other = paletteFor({ untrained: true, colorSafe: false });
    expect([train.left, train.right]).not.toContain(other.left);
    expect([train.left, train.right]).not.toContain(other.right);
    expect(paletteFor({ untrained: false, colorSafe: true }).hatch).not.toBeNull();
  });

  it('表層を変えても試行列・タイミングは同じ（見た目だけ）', () => {
    const p = ladderParams(6);
    const a = game.createRound(p, mulberry32(12), { ...OPTS, surface: 0 });
    const b = game.createRound(p, mulberry32(12), { ...OPTS, surface: 2 });
    expect(b).toEqual(a);
    expect(game.responseLayout(p, { ...OPTS, surface: 2 })).toEqual(game.responseLayout(p, OPTS));
  });
});

describe('ヘッドレスの試合（1試合 = 30 試行 × 1 ラウンド・ウォームアップ無し）', () => {
  /** 1試合（= 1 ラウンド）を続けて遊び、ラウンドごとの結果を集める */
  async function playMatches(
    from: ScParams,
    matches: number,
    seed: number,
    plan: Parameters<typeof runMatchHeadless>[3] = {},
  ): Promise<{ rounds: { step: number; rules: number; accuracy: number; power: number; next: ScParams; shape: boolean }[]; end: ScParams }> {
    let params = from;
    const rounds: { step: number; rules: number; accuracy: number; power: number; next: ScParams; shape: boolean }[] = [];
    for (let m = 0; m < matches; m++) {
      const res = await runMatchHeadless(game, params, { seed: seed + m }, plan);
      expect(res.warmup).toBeNull();
      expect(res.rounds).toHaveLength(1);
      const r = res.rounds[0]!;
      rounds.push({
        step: r.summary.paramsPlayed.step,
        rules: r.summary.paramsPlayed.rules,
        accuracy: r.summary.accuracy,
        power: r.power,
        next: r.paramsEnd,
        shape: r.summary.results.some((x) => x.trial.rule === 'shape'),
      });
      expect(res.paramsEnd).toEqual(r.paramsEnd);
      params = res.paramsEnd;
    }
    return { rounds, end: params };
  }

  it('1 ラウンド 30 試行だけ（ウォームアップ無し）。切替コストは記録し、混合コスト・単一課題の RT は記録しない', async () => {
    expect(game.roundsPerMatch).toBe(1);
    expect(game.createWarmup).toBeUndefined();
    const res = await runMatchHeadless(game, game.initialParams, { seed: 5 });
    expect(res.warmup).toBeNull();
    expect(res.rounds).toHaveLength(1);
    const r = res.rounds[0]!;
    expect(r.summary.kind).toBe('round');
    expect(r.summary.roundNo).toBe(1);
    expect(r.summary.trials).toBe(30);
    expect(r.summary.results[0]!.trial.transition).toBe('first');
    expect(r.summary.results.every((x) => x.trial.transition !== 'single')).toBe(true);
    // 既定の疑似プレイヤーは 5 試行に1回誤る = 80% → 維持
    expect(r.summary.accuracy).toBeCloseTo(0.8, 9);
    expect(r.paramsEnd).toEqual(ladderParams(1));
    expect(res.paramsEnd).toEqual(ladderParams(1));
    expect(r.metrics.switchCost).toBeDefined();
    expect(r.metrics.rtRepeat).toBeDefined();
    expect(r.metrics.rtSwitch).toBeDefined();
    expect(r.metrics.mixingCost).toBeUndefined();
    expect(r.metrics.rtSingle).toBeUndefined();
    // 戦闘力 = round(1000 × ((1 − 1) + (0.80 − 0.75) / (0.90 − 0.75)) / 20) = 17
    expect(r.power).toBe(17);
  });

  it('1 ラウンドでも適応する: 正答率 90%（27/30）で +1、76.7%（23/30）で維持、73.3%（22/30）で −1', async () => {
    const withWrong = (wrong: number): Parameters<typeof runMatchHeadless>[3] => ({
      plan: ({ i, expected, layout }) => (i < wrong ? wrongPlan(layout, expected) : correctPlan(expected)),
    });
    const cases: [number, number, number][] = [
      // [誤答数, 開始ステップ, 次のステップ]
      [3, 5, 6],
      [7, 5, 5],
      [8, 5, 4],
      [0, 20, 20],
      [15, 1, 1],
    ];
    for (const [wrong, from, to] of cases) {
      const { rounds, end } = await playMatches(ladderParams(from), 1, 40 + wrong, withWrong(wrong));
      expect(rounds[0]!.accuracy, `誤答 ${wrong}`).toBeCloseTo((30 - wrong) / 30, 9);
      expect(rounds[0]!.step, `誤答 ${wrong}`).toBe(from);
      expect(end, `誤答 ${wrong}`).toEqual(ladderParams(to));
    }
  });

  it('全問正解なら 1 試合で +1（1日に最大 1 ステップ）。試合を重ねるとステップ 10 → 11 で 3 ルールになる', async () => {
    const { rounds, end } = await playMatches(ladderParams(9), 3, 6, { plan: ({ expected }) => correctPlan(expected) });
    expect(rounds.map((r) => r.step)).toEqual([9, 10, 11]);
    expect(rounds.map((r) => r.rules)).toEqual([2, 2, 3]);
    expect(rounds.map((r) => r.shape)).toEqual([false, false, true]);
    expect(end).toEqual(ladderParams(12));
    // 戦闘力 = round(1000 × ((L − 1) + 1) / 20)
    expect(rounds.map((r) => r.power)).toEqual([450, 500, 550]);
  });

  it('70% なら 1 試合で −1（下端 1 で止まる）', async () => {
    const seventy = (i: number): boolean => i % 10 < 7;
    const { rounds, end } = await playMatches(ladderParams(2), 3, 7, {
      plan: ({ i, expected, layout }) => (seventy(i) ? correctPlan(expected) : wrongPlan(layout, expected)),
    });
    expect(rounds.map((r) => r.accuracy)).toEqual([0.7, 0.7, 0.7]);
    expect(rounds.map((r) => r.step)).toEqual([2, 1, 1]);
    expect(end.step).toBe(1);
    // 正答率 75% 未満の戦闘力は sub = 0 → round(1000 × (L − 1) / 20)
    expect(rounds.map((r) => r.power)).toEqual([50, 0, 0]);
  });

  it('認定戦（適応なし・未訓練セット・2 ラウンド）ではステップも難度も動かない', async () => {
    const p = game.certParams(7);
    const res = await runMatchHeadless(game, p, { seed: 8, adaptive: false, untrained: true, rounds: 2, warmup: false }, {
      plan: ({ expected }) => correctPlan(expected),
    });
    expect(res.warmup).toBeNull();
    expect(res.rounds).toHaveLength(2);
    for (const r of res.rounds) {
      expect(r.paramsEnd).toEqual(p);
      expect(r.summary.results.every((x) => x.trial.untrained)).toBe(true);
      expect(r.summary.results[0]!.phases.find((ph) => ph.name === 'cue')!.plannedMs).toBeCloseTo(400, 0);
    }
  });

  it('正答率 80%（毎試行 p = 0.8）で数試合続けても、ステップは規則どおり ±1 ずつ・1〜20 の中で動く', async () => {
    const rng = mulberry32(2026);
    // 1試合 = 1 ラウンドなので、以前（6 試合 × 3 ラウンド）と同じ 18 ラウンドぶん遊ぶ
    const { rounds } = await playMatches(game.initialParams, 18, 100, {
      plan: ({ expected, layout }) => (rng.next() < 0.8 ? correctPlan(expected) : wrongPlan(layout, expected)),
    });
    const seen: number[] = [];
    for (const r of rounds) {
      const from = r.step;
      const to = r.next.step;
      const acc = r.accuracy;
      const want = acc + 1e-9 >= 0.9 ? Math.min(20, from + 1) : acc + 1e-9 < 0.75 ? Math.max(1, from - 1) : from;
      expect(to).toBe(want);
      expect(r.next).toEqual(ladderParams(to));
      seen.push(from);
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(20);
    expect(new Set(seen).size).toBeGreaterThan(1); // ばらつきで実際に上下する
  });

  it('既定の疑似プレイヤー（every5thWrong）は 80% ちょうど', () => {
    expect(Array.from({ length: 30 }, (_, i) => every5thWrong(i)).filter(Boolean)).toHaveLength(24);
  });
});
