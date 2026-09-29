/**
 * 認定戦（昇段審査）の実施: 開始前の説明 → 2 ラウンド（固定難度・未訓練の刺激セット）→ 合否。
 * 複数のゲームを選んだときは順に続けて行い、最後にまとめて合否を出す。
 *
 * - 演出は最小（仕様書 第7節）: HP バー・KO・コンボ・効果音・ファイター・背景なし。正誤の 1 ビットだけ（Off と同じ）。
 * - 難度は certParams(ベルト + 1) で固定（src/cert/runner.ts。adapt / adaptTrial を呼ばない）。
 * - 記録は CertRecord だけ（訓練のラウンド・訓練日・戦闘力には数えない）。
 *   1ラウンド目を始めた時点で記録を作り、途中でやめても不合格として残す（やり直しで結果を選べないように）。
 * - 結果は「合格／不合格」と正答率だけ。
 */
import { accuracyOf, addCertRound, beginCert, CERT_ROUNDS, certStatus, finishCert } from '../../cert/cert';
import { runCert } from '../../cert/runner';
import { makeId } from '../../engine/ids';
import { statsOf } from '../../engine/match';
import { roundSeed } from '../../engine/rng';
import { RoundAborted } from '../../engine/round';
import type { AnyGameModule, RoundStats, RoundSummary } from '../../engine/types';
import { getGame } from '../../games';
import { beltName, gameText, ja } from '../../i18n/ja';
import { Hud } from '../../skin/hud';
import { GAME_IDS, type GameId } from '../../storage/schema';
import type { App } from '../app';
import { h } from '../dom';
import { fmtPct } from '../format';
import { GameStage } from '../stage';
import { beltChip, topBar } from './home';
import { INTERMISSION_MS } from './play';
import './cert.css';

interface CertOutcome {
  gameId: GameId;
  tier: number;
  passed: boolean;
  rounds: RoundStats[];
}

/** URL の並び（'double-hit,combo-recall'）から、いま受けられるゲームだけを GAME_IDS の順で取り出す */
export function certQueue(app: App, ids: readonly string[], now: Date): GameId[] {
  const wanted = new Set(ids);
  return GAME_IDS.filter((g) => wanted.has(g) && getGame(g) !== undefined && certStatus(app.store.data.games[g], now).available);
}

function verdictText(o: { passed: boolean; rounds: readonly unknown[] }): string {
  if (o.passed) return ja.cert.passed;
  return o.rounds.length < CERT_ROUNDS ? ja.cert.incomplete : ja.cert.failed;
}

/** 合否と正答率（結果に出すのはこれだけ） */
function verdictBlock(o: CertOutcome): HTMLElement {
  return h(
    'div',
    { class: `cert-verdict ${o.passed ? 'is-passed' : 'is-failed'}`, 'data-testid': 'cert-verdict', 'data-game': o.gameId, 'data-passed': String(o.passed) },
    h('div', { class: 'cert-verdict-head' }, h('strong', null, gameText(o.gameId).name), h('span', { class: 'muted small' }, ja.cert.tierLabel(beltName(o.tier)))),
    h('div', { class: 'cert-verdict-word' }, verdictText(o)),
    h(
      'ul',
      { class: 'cert-accs' },
      ...o.rounds.map((r, k) => h('li', null, ja.cert.roundAccuracy(k + 1, fmtPct(accuracyOf(r))))),
    ),
  );
}

export function mountCertRun(app: App, root: HTMLElement, ids: readonly string[]): () => void {
  const queue = certQueue(app, ids, new Date());
  if (queue.length === 0) {
    root.append(
      h(
        'main',
        { class: 'screen cert', 'data-testid': 'cert-unavailable' },
        topBar(ja.cert.title, true),
        h('p', { class: 'notice' }, ja.cert.notAvailable),
        h('a', { class: 'btn block', href: '#/cert' }, ja.cert.back),
      ),
    );
    return () => {};
  }

  const colorSafe = app.store.data.settings.colorSafe;
  const outcomes: CertOutcome[] = [];
  let disposed = false;
  let stage: GameStage | null = null;
  let hud: Hud | null = null;
  /** 1ラウンド目を始めたか（中断の確認に使う） */
  let started = false;

  const closeStage = (): void => {
    stage?.dispose();
    hud?.destroy();
    stage = null;
    hud = null;
  };

  const showSummary = (): void => {
    closeStage();
    root.replaceChildren(
      h(
        'main',
        { class: 'screen cert cert-summary', 'data-testid': 'cert-summary' },
        topBar(ja.cert.summaryTitle, true),
        ...outcomes.map((o) =>
          h(
            'section',
            { class: 'card' },
            verdictBlock(o),
            h('div', { class: 'cert-belt' }, h('span', { class: 'muted small' }, ja.cert.beltLabel), beltChip(app.store.data.games[o.gameId].belt)),
          ),
        ),
        h(
          'div',
          { class: 'actions' },
          h('a', { class: 'btn primary block', href: '#/', 'data-testid': 'to-home' }, ja.result.home),
          app.embed ? null : h('a', { class: 'btn block', href: '#/records', 'data-testid': 'to-records' }, ja.result.records),
        ),
      ),
    );
    window.scrollTo(0, 0);
  };

  /** 1ゲームぶんの審査。開始前にやめたら false（残りの審査もしない） */
  const runOne = async (gid: GameId, index: number): Promise<boolean> => {
    const game = getGame(gid) as AnyGameModule;
    const status = certStatus(app.store.data.games[gid], new Date());
    if (!status.available || status.tier === null) return true;
    const tier = status.tier;
    const tierText = ja.cert.tierLabel(beltName(tier));
    const text = gameText(gid);

    closeStage();
    root.replaceChildren();
    hud = new Hud({ preset: 'off', sound: null });
    const localHud = hud;
    stage = new GameStage(app, root, {
      game,
      className: 'play cert-run fx-off',
      attrs: { 'data-game': gid, 'data-fx': 'off', 'data-testid': 'cert-run' },
      top: localHud.el,
      quitLabel: ja.play.quit,
      onQuit: () => {
        if (!started || window.confirm(ja.cert.quitConfirm)) app.navigate('/cert');
      },
      colorSafe,
    });
    const localStage = stage;
    localHud.setInfo({ label: ja.cert.roundLabel(1, CERT_ROUNDS), level: tier, enemyName: '', warmup: false, sub: tierText });

    // ---- 開始前（ここでやめても記録は残らない） ----
    const start = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'start' }, ja.play.start);
    const cancel = h('button', { type: 'button', class: 'btn ghost block', 'data-testid': 'cert-cancel' }, ja.cert.cancel);
    const go = await localStage.showOverlay(
      h(
        'div',
        { class: 'panel', 'data-testid': 'cert-ready' },
        h('p', { class: 'muted small' }, queue.length > 1 ? `${ja.cert.readyLabel}（${index + 1} / ${queue.length}）` : ja.cert.readyLabel),
        h('h1', { class: 'panel-title' }, text.name),
        h('p', { class: 'cert-tier' }, tierText),
        ...text.howTo.map((line) => h('p', null, line)),
        h('p', { class: 'key-line' }, text.keys),
        h('p', { class: 'muted small' }, ja.cert.minimalNote),
        h('p', { class: 'muted small' }, ja.cert.attemptNote),
        start,
        cancel,
      ),
      [
        { el: start, value: true },
        { el: cancel, value: false },
      ],
    );
    if (!go) {
      app.navigate('/cert');
      return false;
    }
    await app.frameReady;
    if (disposed) return false;

    // ---- 1ラウンド目を始める時点で「受けた」と記録する ----
    const certId = makeId('c');
    app.store.update((d) => {
      beginCert(d, { id: certId, gameId: gid, at: new Date().toISOString(), tier });
    });
    started = true;

    const result = await runCert(
      { game, tier, seedFor: (n) => roundSeed(app.flags.seed, gid, 'cert', n) },
      {
        runRound: (req) =>
          localStage.runRound(req, (r) => {
            localHud.setInfo({ label: ja.cert.roundLabel(req.roundNo, CERT_ROUNDS), level: tier, enemyName: '', warmup: false, sub: tierText });
            return [localHud.attach(r.events, { trials: req.trials.length, enemyHp: null })];
          }),
        onRoundDone: (s) => {
          app.store.update((d) => addCertRound(d, certId, statsOf(s)));
          if (app.flags.test) pushTestLog(app, gid, s);
        },
        between: (_s, next) => {
          const nextBtn = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'next-round' }, ja.play.nextRound);
          const bar = h('div', { class: 'countdown' }, h('div', { class: 'countdown-fill', style: `animation-duration: ${INTERMISSION_MS}ms` }));
          return localStage.showOverlay(
            h(
              'div',
              { class: 'panel', 'data-testid': 'intermission' },
              h('h2', null, ja.cert.roundEnd(next.roundNo - 1)),
              h('p', { class: 'muted' }, ja.cert.betweenNote),
              bar,
              nextBtn,
            ),
            [{ el: nextBtn, value: undefined }],
            { ms: INTERMISSION_MS, value: undefined },
          );
        },
      },
    );
    app.store.update((d) => finishCert(d, certId, result.verdict.passed));
    started = false;
    const outcome: CertOutcome = { gameId: gid, tier, passed: result.verdict.passed, rounds: result.rounds.map(statsOf) };
    outcomes.push(outcome);

    // ---- 次のゲームがあれば、このゲームの合否を出してから進む ----
    const nextGid = queue[index + 1];
    if (nextGid !== undefined) {
      const nextBtn = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'cert-next' }, ja.cert.nextCert(gameText(nextGid).name));
      await localStage.showOverlay(
        h('div', { class: 'panel', 'data-testid': 'cert-game-result' }, verdictBlock(outcome), nextBtn),
        [{ el: nextBtn, value: undefined }],
      );
    }
    return true;
  };

  void (async () => {
    try {
      for (let k = 0; k < queue.length; k++) {
        if (disposed || !(await runOne(queue[k] as GameId, k))) return;
      }
      if (!disposed) showSummary();
    } catch (err) {
      if (disposed || err instanceof RoundAborted) return;
      console.error('[brain-fighter] cert error', err);
      const panel = h('div', { class: 'panel' }, h('p', null, String(err)), h('a', { class: 'btn', href: '#/cert' }, ja.cert.back));
      const current = stage as GameStage | null; // runOne の中で入れ替わる
      if (current) current.showMessage(panel);
      else root.replaceChildren(h('main', { class: 'screen' }, panel));
    }
  })();

  return () => {
    disposed = true;
    closeStage();
  };
}

/** テスト用フックのログ（?test=1 のときだけ。認定戦のラウンドは kind = 'cert'） */
function pushTestLog(app: App, gid: GameId, s: RoundSummary): void {
  app.testLog.push({
    gameId: gid,
    fx: 'off',
    kind: 'cert',
    roundNo: s.roundNo,
    roundId: `cert-${s.roundNo}`,
    power: 0,
    paramsEnd: { ...s.paramsPlayed },
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
