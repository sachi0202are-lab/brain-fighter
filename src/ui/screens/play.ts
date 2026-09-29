/**
 * ゲーム画面: 上帯（HP バー・敵レベル・ラウンド数）／中央の正方形 Canvas（刺激領域）／下帯の応答ボタン。
 *
 * - 刺激領域・応答ボタン・キー・オーバーレイは共通の舞台（../stage.ts）。
 * - 演出（Hud・ラウンド間表示）はラウンド実行のイベントを購読するだけ。試行の進行には関わらない。
 * - ラウンドは途中で打ち切らない。KO でも最後まで。ラウンド間は 10 秒（スキップ可）。
 * - 試合が終わったら結果画面へ。次の試合へは自動で進まない（ユーザーがボタンで進む）。
 */
import { localDate } from '../../engine/dates';
import { makeId } from '../../engine/ids';
import { runMatch, surfaceIndex, type RoundDone } from '../../engine/match';
import { toRoundRecord, toTrialLogs } from '../../engine/records';
import { roundSeed } from '../../engine/rng';
import { RoundAborted } from '../../engine/round';
import { restoreParams, type AnyGameModule, type Params, type RoundKind } from '../../engine/types';
import { getGame } from '../../games';
import { gameText, ja } from '../../i18n/ja';
import { backdropUrl } from '../../skin/backdrop';
import { fightersCanvas, outcomeBanner, specialTelop } from '../../skin/banner';
import { stageColor } from '../../skin/fighter';
import { enemyHp, roundOutcome } from '../../skin/hp';
import { Hud } from '../../skin/hud';
import { enemyName } from '../../skin/names';
import { SKIN_FEATURES } from '../../skin/presets';
import { prefersReducedMotion, specialScene, type SpecialScene } from '../../skin/special';
import '../../skin/skin.css';
import type { GameId } from '../../storage/schema';
import { bestPower, latestPower, matchCount, recentAccuracies } from '../../storage/selectors';
import type { App, MatchView, RoundView } from '../app';
import { h } from '../dom';
import { fmtInt, fmtPct } from '../format';
import { completeGameInSession } from '../session-flow';
import { GameStage } from '../stage';

/** ラウンド間の演出の長さ（仕様書 第10節: 10 秒・スキップ可） */
export const INTERMISSION_MS = 10_000;

export function mountPlay(app: App, root: HTMLElement, gameId: string): () => void {
  const found = getGame(gameId);
  if (!found) {
    root.append(
      h('main', { class: 'screen' }, h('p', null, ja.play.gameNotFound), h('a', { class: 'btn', href: '#/' }, ja.nav.home)),
    );
    return () => {};
  }
  const game: AnyGameModule = found;
  const gid = game.id as GameId;
  const text = gameText(gid);
  const fx = app.fx();
  const features = SKIN_FEATURES[fx];
  const settings = app.store.data.settings;
  /** ラウンド間の効果音（Light / Full で、設定の効果音がオンのとき。最初のタップまでは鳴らない） */
  const sound = features.sound && settings.sound ? app.sound : null;

  let disposed = false;

  // ---- DOM ----
  const hud = new Hud({ preset: fx, sound: settings.sound ? app.sound : null });
  const stage = new GameStage(app, root, {
    game,
    className: `play fx-${fx}`,
    attrs: { 'data-game': gid, 'data-fx': fx },
    top: hud.el,
    quitLabel: ja.play.quit,
    onQuit: () => {
      if (window.confirm(ja.play.quitConfirm)) app.navigate('/');
    },
    colorSafe: settings.colorSafe,
  });
  const screen = stage.screen;

  /** 次のラウンドのルールの一言（ゲームが roundIntro を持つときだけ） */
  const introLine = (params: Params, info: { kind: RoundKind; roundNo: number }): HTMLElement | null => {
    const t = game.roundIntro?.(params, info);
    return t ? h('p', { class: 'intro', 'data-testid': 'round-intro' }, t) : null;
  };

  const statRow = (label: string, value: string): HTMLElement =>
    h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value));

  const showReady = (): Promise<void> => {
    const start = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'start' }, ja.play.start);
    const panel = h(
      'div',
      { class: 'panel', 'data-testid': 'ready' },
      h('h1', { class: 'panel-title' }, ja.play.readyTitle(text.name)),
      h('p', { class: 'muted' }, text.tagline),
      ...text.howTo.map((line) => h('p', null, line)),
      introLine(params0, game.createWarmup ? { kind: 'warmup', roundNo: 0 } : { kind: 'round', roundNo: 1 }),
      h('p', { class: 'key-line' }, text.keys),
      start,
    );
    return stage.showOverlay(panel, [{ el: start, value: undefined }]);
  };

  const roundSummaryBlock = (done: RoundDone): HTMLElement[] => {
    const s = done.summary;
    const best = Math.max(bestBefore, ...roundViews.map((r) => r.power));
    return [
      h(
        'div',
        { class: 'stats' },
        statRow(ja.play.accuracy, fmtPct(s.accuracy)),
        statRow(ja.play.maxCombo, fmtInt(s.maxCombo)),
        statRow(ja.play.power, `${fmtInt(done.power)}（${ja.play.best} ${fmtInt(best)}）`),
      ),
      h('p', { class: 'tip' }, game.roundTip?.(s) ?? ''),
    ];
  };

  /**
   * ラウンド間の絵: Full で KO / PERFECT なら必殺演出（一度だけ動いて止まる）、それ以外は静止画のファイター。
   * どちらもラウンドの外（オーバーレイの中）だけで、ラウンド間の長さ（10 秒）はどのプリセットでも同じ。
   */
  const intermissionArt = (outcome: ReturnType<typeof roundOutcome> | null): { el: HTMLElement | null; scene: SpecialScene | null } => {
    if (!outcome) return { el: null, scene: null };
    if (features.special && outcome !== 'decision') {
      const scene = specialScene({ level: currentLevel, reducedMotion: prefersReducedMotion(), onImpact: () => sound?.impact() });
      return { el: scene.el, scene };
    }
    return { el: features.fighters ? fightersCanvas({ outcome, level: currentLevel }) : null, scene: null };
  };

  const showIntermission = (done: RoundDone, nextRoundNo: number): Promise<void> => {
    const s = done.summary;
    const warm = s.kind === 'warmup';
    const enemy = warm ? null : currentEnemyHp;
    const outcome = enemy === null ? null : roundOutcome(s.trials, s.correct, enemy);
    // 判定負けは煽らず「次は◯問正解で KO」と情報だけ（次のラウンドの敵 HP の見込み）
    const nextKo = enemy === null ? null : enemyHp(s.trials, recentAccuracies(app.store.data, gid));
    const next = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'next-round' }, ja.play.nextRound);
    const bar = h('div', { class: 'countdown' }, h('div', { class: 'countdown-fill', style: `animation-duration: ${INTERMISSION_MS}ms` }));
    const art = intermissionArt(outcome);
    const panel = h(
      'div',
      { class: 'panel intermission', 'data-testid': 'intermission', 'data-outcome': outcome ?? '' },
      art.el,
      features.outcomeLogo && outcome ? outcomeBanner(outcome, outcome === 'decision' ? nextKo : null) : null,
      features.special && outcome && outcome !== 'decision' ? specialTelop(done.seed) : null,
      h('h2', null, warm ? ja.play.warmupEnd : ja.play.roundEnd(s.roundNo)),
      ...(warm ? [h('p', null, ja.play.warmupNote)] : roundSummaryBlock(done)),
      introLine(done.paramsEnd, { kind: 'round', roundNo: nextRoundNo }),
      bar,
      next,
    );
    return stage.showOverlay(panel, [{ el: next, value: undefined }], { ms: INTERMISSION_MS, value: undefined }).finally(() => art.scene?.stop());
  };

  const showExtraPrompt = (done: RoundDone): Promise<boolean> => {
    const s = done.summary;
    const enemy = currentEnemyHp;
    const outcome = enemy === null ? null : roundOutcome(s.trials, s.correct, enemy);
    const more = h('button', { type: 'button', class: 'btn block', 'data-testid': 'extra-round' }, ja.play.extraRound);
    const finish = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'to-result' }, ja.play.toResult);
    const panel = h(
      'div',
      { class: 'panel intermission', 'data-testid': 'extra-prompt' },
      features.outcomeLogo && outcome ? outcomeBanner(outcome, null) : null,
      h('h2', null, ja.play.roundEnd(s.roundNo)),
      ...roundSummaryBlock(done),
      h('p', { class: 'muted' }, ja.play.extraAsk),
      introLine(done.paramsEnd, { kind: 'round', roundNo: s.roundNo + 1 }),
      h('div', { class: 'row' }, finish, more),
    );
    return stage.showOverlay(panel, [
      { el: finish, value: false },
      { el: more, value: true },
    ]);
  };

  // ---- 試合 ----
  const data = app.store.data;
  const params0 = restoreParams(game, data.games[gid].state);
  const matchId = makeId('m');
  const surfaceNo = surfaceIndex(matchCount(data, gid), game.surfaceCount ?? 1);
  const powerBefore = latestPower(data, gid);
  const bestBefore = bestPower(data, gid);
  const totalRounds = game.roundsPerMatch ?? 3;
  const roundViews: RoundView[] = [];
  let currentEnemyHp: number | null = null;
  let currentLevel = game.enemyLevel(params0);
  let roundStartedAt = new Date().toISOString();

  /** Full の静的な背景（ラウンドの開始時にだけ決める。ラウンド中は変えない） */
  const setBackground = (level: number): void => {
    if (!features.background) return;
    screen.style.setProperty('--stage', stageColor(level));
    screen.style.setProperty('--stage-art', backdropUrl(level));
  };
  setBackground(currentLevel);

  const persist = (done: RoundDone): void => {
    const s = done.summary;
    const roundId = makeId(s.kind === 'warmup' ? 'w' : 'r');
    const rec = toRoundRecord({ id: roundId, gameId: gid, matchId, startedAt: roundStartedAt, fx, done });
    const logs = toTrialLogs(roundId, s.results);
    const today = localDate(new Date());
    app.store.update((d) => {
      d.rounds.push(rec);
      d.trials = [...(d.trials ?? []), ...logs];
      if (s.kind === 'round') {
        const g = d.games[gid];
        g.state = { ...done.paramsEnd };
        if (!g.trainingDays.includes(today)) g.trainingDays = [...g.trainingDays, today].sort();
      }
    });
    if (s.kind === 'round') {
      roundViews.push({
        roundNo: s.roundNo,
        trials: s.trials,
        correct: s.correct,
        maxCombo: s.maxCombo,
        power: done.power,
        enemyHp: currentEnemyHp,
        outcome: currentEnemyHp === null ? null : roundOutcome(s.trials, s.correct, currentEnemyHp),
      });
    }
    if (app.flags.test) {
      app.testLog.push({
        gameId: gid,
        fx,
        kind: s.kind,
        roundNo: s.roundNo,
        roundId,
        power: done.power,
        paramsEnd: { ...done.paramsEnd },
        trials: s.results.map((r) => ({
          i: r.i,
          stim: r.stim,
          correct: r.correct,
          ...(r.rtMs !== undefined ? { rtMs: r.rtMs } : {}),
          onsetMs: r.onsetMs,
          plan: Object.fromEntries(r.phases.map((p) => [p.name, Math.round(p.plannedMs * 1000) / 1000])),
          phases: r.phases,
        })),
      });
    }
  };

  const finish = (last: RoundDone | null): void => {
    const session = completeGameInSession(app, gid);
    const view: MatchView = {
      gameId: gid,
      fx,
      finishedAt: new Date().toISOString(),
      rounds: roundViews,
      powerBefore,
      powerAfter: last ? last.power : powerBefore,
      bestBefore,
      level: currentLevel,
      tip: last ? (game.roundTip?.(last.summary) ?? '') : '',
      nextGame: session ? (session.order.find((g) => !session.done.includes(g)) ?? null) : null,
      sessionDone: session ? session.order.every((g) => session.done.includes(g)) : false,
    };
    app.lastMatch = view;
    app.navigate('/result');
  };

  void (async () => {
    try {
      await showReady();
      await app.frameReady;
      if (disposed) return;
      const result = await runMatch(
        {
          game,
          params: params0,
          surface: surfaceNo,
          previousPower: powerBefore,
          seedFor: (kind, n) => roundSeed(app.flags.seed, gid, kind, n),
        },
        {
          runRound: (req) =>
            stage.runRound(req, (r) => {
              const warm = req.kind === 'warmup';
              const n = req.trials.length;
              currentEnemyHp = warm ? null : enemyHp(n, recentAccuracies(app.store.data, gid));
              currentLevel = game.enemyLevel(req.params);
              setBackground(currentLevel);
              hud.setInfo({
                label: warm ? ja.play.warmup : req.roundNo > totalRounds ? ja.play.extraRound : ja.play.round(req.roundNo, totalRounds),
                level: currentLevel,
                enemyName: enemyName(gid, currentLevel),
                warmup: warm,
              });
              roundStartedAt = new Date().toISOString();
              return [hud.attach(r.events, { trials: n, enemyHp: currentEnemyHp })];
            }),
          onRoundDone: persist,
          between: (done, next) => showIntermission(done, next.roundNo),
          askExtra: (done) => showExtraPrompt(done),
        },
      );
      if (!disposed) finish(result.rounds[result.rounds.length - 1] ?? null);
    } catch (err) {
      if (disposed || err instanceof RoundAborted) return;
      console.error('[brain-fighter] match error', err);
      stage.showMessage(h('div', { class: 'panel' }, h('p', null, String(err)), h('a', { class: 'btn', href: '#/' }, ja.nav.home)));
    }
  })();

  return () => {
    disposed = true;
    stage.dispose();
    hud.destroy();
  };
}
