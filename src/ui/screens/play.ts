/**
 * ゲーム画面: 上帯（HP バー・敵レベル・ラウンド数）／中央の正方形 Canvas（刺激領域）／下帯の応答ボタン。
 *
 * - 入力は pointerdown（click は遅延があるので使わない）。PC はキーボード（各ゲームの割当）。
 * - ゲーム中はダブルタップズーム・選択・スクロールを無効化（html.playing）。
 * - 演出（Hud・ラウンド間表示）はラウンド実行のイベントを購読するだけ。試行の進行には関わらない。
 * - ラウンドは途中で打ち切らない。KO でも最後まで。ラウンド間は 10 秒（スキップ可）。
 * - 試合が終わったら結果画面へ。次の試合へは自動で進まない（ユーザーがボタンで進む）。
 */
import { localDate } from '../../engine/dates';
import { makeId } from '../../engine/ids';
import { runMatch, surfaceIndex, type RoundDone } from '../../engine/match';
import { toRoundRecord, toTrialLogs } from '../../engine/records';
import { roundSeed } from '../../engine/rng';
import { RoundAborted, RoundRunner, type StimulusSurface } from '../../engine/round';
import { createRafScheduler } from '../../engine/timing';
import { restoreParams, type AnyGameModule, type Params, type ResponseLayout, type RoundKind } from '../../engine/types';
import { getGame } from '../../games';
import { gameText, ja } from '../../i18n/ja';
import { fightersCanvas, outcomeBanner, specialTelop } from '../../skin/banner';
import { stageColor } from '../../skin/fighter';
import { enemyHp, roundOutcome } from '../../skin/hp';
import { Hud } from '../../skin/hud';
import { enemyName } from '../../skin/names';
import { SKIN_FEATURES } from '../../skin/presets';
import type { GameId } from '../../storage/schema';
import { bestPower, latestPower, matchCount, recentAccuracies } from '../../storage/selectors';
import type { App, MatchView, RoundView } from '../app';
import { h } from '../dom';
import { fmtInt, fmtPct } from '../format';
import { completeGameInSession } from '../session-flow';

/** ラウンド間の演出の長さ（仕様書 第10節: 10 秒・スキップ可） */
export const INTERMISSION_MS = 10_000;

type AnyRunner = RoundRunner<Params, unknown>;

/** キーの表示名 */
function keyLabel(keys: readonly string[]): string | null {
  const names: Record<string, string> = {
    ' ': 'Space',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };
  for (const k of keys) {
    if (names[k]) return names[k] as string;
    if (k.length === 1) return k.toUpperCase();
  }
  return null;
}

/** イベントのタイムスタンプ（performance.now と同じ時間軸でなければ performance.now） */
function eventTime(ts: number | undefined): number {
  const now = performance.now();
  return ts !== undefined && ts > 0 && ts <= now + 1 && now - ts < 1000 ? ts : now;
}

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

  let disposed = false;
  let runner: AnyRunner | null = null;
  const disposers: Array<() => void> = [];
  const pendingOverlays = new Set<(err: unknown) => void>();

  // ---- DOM ----
  const hud = new Hud({ preset: fx, sound: settings.sound ? app.sound : null });
  const quitBtn = h('button', { class: 'quit', type: 'button', 'aria-label': ja.play.quit, title: ja.play.quit }, '✕');
  const top = h('header', { class: 'play-top' }, quitBtn, hud.el);
  const canvas = h('canvas', { class: 'stim', 'data-testid': 'stimulus', 'aria-hidden': 'true' });
  const stimWrap = h('div', { class: 'stim-wrap' }, canvas);
  const band = h('div', { class: 'resp-band', 'data-testid': 'response-band' });
  const overlay = h('div', { class: 'overlay', hidden: true });
  const screen = h(
    'div',
    { class: `screen play fx-${fx}`, 'data-game': gid, 'data-fx': fx },
    top,
    stimWrap,
    band,
    overlay,
  );
  root.append(screen);
  document.documentElement.classList.add('playing');
  disposers.push(() => document.documentElement.classList.remove('playing'));

  // 長押しメニュー・ダブルタップ・ピンチを抑止（html.playing の CSS と併用）
  const prevent = (e: Event): void => e.preventDefault();
  for (const type of ['contextmenu', 'dblclick', 'gesturestart', 'selectstart']) {
    screen.addEventListener(type, prevent);
    disposers.push(() => screen.removeEventListener(type, prevent));
  }

  // ---- 刺激領域（正方形）の大きさ ----
  let size = 300;
  let dpr = 1;
  const ctx = canvas.getContext('2d');
  const stimBg = getComputedStyle(document.documentElement).getPropertyValue('--stim-bg').trim() || '#10131d';
  const paintBackground = (): void => {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = stimBg;
    ctx.fillRect(0, 0, size, size);
  };
  const resize = (): void => {
    const W = screen.clientWidth;
    const H = screen.clientHeight;
    const minBand = Math.max(150, Math.round(H * 0.22));
    size = Math.max(120, Math.floor(Math.min(W - 24, H - top.offsetHeight - minBand - 24)));
    dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    paintBackground();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(screen);
  disposers.push(() => ro.disconnect());
  resize();
  const surface: StimulusSurface = {
    begin() {
      if (!ctx) return null;
      paintBackground();
      return { ctx, size };
    },
  };

  // ---- 応答ボタンとキー ----
  const buttonEls = new Map<string, HTMLButtonElement>();
  let keyMap = new Map<string, string>();

  const flash = (id: string): void => {
    const el = buttonEls.get(id);
    if (!el) return;
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 110);
  };

  const press = (id: string, ts?: number): void => {
    flash(id);
    runner?.input(id, eventTime(ts));
  };

  const buildButtons = (layout: ResponseLayout): void => {
    band.replaceChildren();
    buttonEls.clear();
    keyMap = new Map();
    band.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
    band.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
    for (const b of layout.buttons) {
      const hint = keyLabel(b.keys);
      const el = h(
        'button',
        {
          type: 'button',
          class: 'resp-btn',
          'data-id': b.id,
          'data-group': b.group ?? 'main',
          'aria-label': b.ariaLabel ?? b.label,
          style: `grid-column: ${b.col} / span ${b.colSpan ?? 1}; grid-row: ${b.row} / span ${b.rowSpan ?? 1};`,
        },
        h('span', { class: 'resp-label' }, b.label),
        hint ? h('span', { class: 'key-hint' }, hint) : null,
      );
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        press(b.id, e.timeStamp);
      });
      // キーボードでボタンを押したとき（Enter/Space。pointerdown が来ない）
      el.addEventListener('click', (e) => {
        if (e.detail === 0) press(b.id);
      });
      band.append(el);
      buttonEls.set(b.id, el);
      for (const k of b.keys) keyMap.set(k.length === 1 ? k.toLowerCase() : k, b.id);
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !overlay.hidden) return;
    const id = keyMap.get(e.key.length === 1 ? e.key.toLowerCase() : e.key) ?? keyMap.get(e.code);
    if (!id) return;
    e.preventDefault();
    press(id, e.timeStamp);
  };
  window.addEventListener('keydown', onKey);
  disposers.push(() => window.removeEventListener('keydown', onKey));

  // 刺激領域のタップ（ゲームが hitTest を持つときだけ）
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = runner;
    if (!r || !game.hitTest) return;
    const snap = r.snapshot();
    const trial = r.currentTrial();
    if (!snap || !snap.accepting || trial === null) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * size) / rect.width;
    const y = ((e.clientY - rect.top) * size) / rect.height;
    const id = game.hitTest(trial, snap.phase, x, y, {
      size,
      colorSafe: settings.colorSafe,
      untrained: false,
      surface: surfaceNo,
      selection: snap.selection,
    });
    if (id) press(id, e.timeStamp);
  });

  // ---- オーバーレイ（開始前・ラウンド間・もう1ラウンド） ----
  const showOverlay = <V>(
    panel: HTMLElement,
    choices: { el: HTMLButtonElement; value: V }[],
    auto?: { ms: number; value: V },
  ): Promise<V> =>
    new Promise<V>((resolve, reject) => {
      overlay.replaceChildren(panel);
      overlay.hidden = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (v: V): void => {
        if (timer) clearTimeout(timer);
        pendingOverlays.delete(reject);
        overlay.hidden = true;
        overlay.replaceChildren();
        resolve(v);
      };
      for (const c of choices) c.el.addEventListener('click', () => done(c.value));
      if (auto) timer = setTimeout(() => done(auto.value), auto.ms);
      pendingOverlays.add((err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      choices[0]?.el.focus();
    });

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
    return showOverlay(panel, [{ el: start, value: undefined }]);
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

  const showIntermission = (done: RoundDone, nextRoundNo: number): Promise<void> => {
    const s = done.summary;
    const warm = s.kind === 'warmup';
    const enemy = warm ? null : currentEnemyHp;
    const outcome = enemy === null ? null : roundOutcome(s.trials, s.correct, enemy);
    const nextKo = enemy === null ? null : enemyHp(s.trials, recentAccuracies(app.store.data, gid));
    const next = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'next-round' }, ja.play.nextRound);
    const bar = h('div', { class: 'countdown' }, h('div', { class: 'countdown-fill', style: `animation-duration: ${INTERMISSION_MS}ms` }));
    const panel = h(
      'div',
      { class: 'panel intermission', 'data-testid': 'intermission' },
      features.fighters && outcome ? fightersCanvas({ outcome, level: currentLevel }) : null,
      features.outcomeLogo && outcome ? outcomeBanner(outcome, outcome === 'decision' ? nextKo : null) : null,
      features.special && outcome && outcome !== 'decision' ? specialTelop(done.seed) : null,
      h('h2', null, warm ? ja.play.warmupEnd : ja.play.roundEnd(s.roundNo)),
      ...(warm ? [h('p', null, ja.play.warmupNote)] : roundSummaryBlock(done)),
      introLine(done.paramsEnd, { kind: 'round', roundNo: nextRoundNo }),
      bar,
      next,
    );
    return showOverlay(panel, [{ el: next, value: undefined }], { ms: INTERMISSION_MS, value: undefined });
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
    return showOverlay(panel, [
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

  if (features.background) screen.style.setProperty('--stage', stageColor(currentLevel));

  quitBtn.addEventListener('click', () => {
    if (window.confirm(ja.play.quitConfirm)) app.navigate('/');
  });

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
          runRound: async (req) => {
            const warm = req.kind === 'warmup';
            const r: AnyRunner = new RoundRunner({
              game,
              trials: req.trials,
              params: req.params,
              options: req.options,
              adaptive: req.adaptive,
              scheduler: createRafScheduler(app.frameMs),
              surface,
              colorSafe: settings.colorSafe,
            });
            buildButtons(r.layout);
            const n = req.trials.length;
            currentEnemyHp = warm ? null : enemyHp(n, recentAccuracies(app.store.data, gid));
            currentLevel = game.enemyLevel(req.params);
            if (features.background) screen.style.setProperty('--stage', stageColor(currentLevel));
            hud.setInfo({
              label: warm ? ja.play.warmup : req.roundNo > totalRounds ? ja.play.extraRound : ja.play.round(req.roundNo, totalRounds),
              level: currentLevel,
              enemyName: enemyName(gid, currentLevel),
              warmup: warm,
            });
            const offs = [
              hud.attach(r.events, { trials: n, enemyHp: currentEnemyHp }),
              r.events.on('selection', (e) => {
                for (const [id, el] of buttonEls) {
                  if (el.dataset.group === e.group) el.setAttribute('aria-pressed', String(id === e.id));
                }
              }),
              r.events.on('trialStart', () => {
                for (const el of buttonEls.values()) el.removeAttribute('aria-pressed');
              }),
            ];
            runner = r;
            app.runners.set(r);
            roundStartedAt = new Date().toISOString();
            (document.activeElement as HTMLElement | null)?.blur?.();
            try {
              return await r.start();
            } finally {
              for (const off of offs) off();
              runner = null;
              app.runners.set(null);
              paintBackground();
            }
          },
          onRoundDone: persist,
          between: (done, next) => showIntermission(done, next.roundNo),
          askExtra: (done) => showExtraPrompt(done),
        },
      );
      if (!disposed) finish(result.rounds[result.rounds.length - 1] ?? null);
    } catch (err) {
      if (disposed || err instanceof RoundAborted) return;
      console.error('[brain-fighter] match error', err);
      overlay.hidden = false;
      overlay.replaceChildren(
        h('div', { class: 'panel' }, h('p', null, String(err)), h('a', { class: 'btn', href: '#/' }, ja.nav.home)),
      );
    }
  })();

  return () => {
    disposed = true;
    runner?.abort();
    for (const rej of [...pendingOverlays]) rej(new RoundAborted());
    pendingOverlays.clear();
    for (const d of disposers) d();
    hud.destroy();
    app.runners.set(null);
  };
}
