/**
 * 結果画面: KO / PERFECT / 判定、正答率、最大コンボ、戦闘力の増減、自己ベスト差、一言。「次のゲームへ」「ホームへ」
 * 1 ラウンドだけの試合（スタンスチェンジ）は、ラウンドを「一本勝負」、見出しを「ラウンドの結果」「KO」（× 1 を付けない）で出す。
 */
import { gameText, ja } from '../../i18n/ja';
import { fightersCanvas, outcomeHeadline, outcomeText } from '../../skin/banner';
import { SKIN_FEATURES } from '../../skin/presets';
import '../../skin/skin.css';
import type { App } from '../app';
import { h } from '../dom';
import { fmtInt, fmtPct, fmtSigned } from '../format';
import { topBar } from './home';

export function mountResult(app: App, root: HTMLElement): () => void {
  const v = app.lastMatch;
  if (!v) {
    root.append(
      h('main', { class: 'screen' }, topBar(ja.result.title, true), h('p', null, ja.result.none), h('a', { class: 'btn', href: '#/' }, ja.result.home)),
    );
    return () => {};
  }
  const features = SKIN_FEATURES[v.fx];
  const name = gameText(v.gameId).name;
  const trials = v.rounds.reduce((a, r) => a + r.trials, 0);
  const correct = v.rounds.reduce((a, r) => a + r.correct, 0);
  const maxCombo = Math.max(0, ...v.rounds.map((r) => r.maxCombo));
  const last = v.rounds[v.rounds.length - 1];
  const delta = v.powerAfter - v.powerBefore;
  const bestDiff = v.powerAfter - v.bestBefore;

  const rounds = h(
    'ol',
    { class: 'round-list' },
    ...v.rounds.map((r) =>
      h(
        'li',
        { class: 'round-item' },
        h('span', { class: 'round-no' }, ja.play.round(r.roundNo, v.rounds.length)),
        features.outcomeLogo && r.outcome ? h('span', { class: `round-outcome outcome-${r.outcome}` }, outcomeText(r.outcome)) : null,
        h('span', { class: 'round-acc' }, fmtPct(r.trials > 0 ? r.correct / r.trials : 0)),
      ),
    ),
  );

  const actions = h(
    'div',
    { class: 'actions' },
    v.nextGame
      ? h('a', { class: 'btn primary block', href: `#/play/${v.nextGame}`, 'data-testid': 'next-game' }, ja.result.nextGame(gameText(v.nextGame).name))
      : null,
    v.sessionDone ? h('p', { class: 'notice', 'data-testid': 'session-done' }, ja.result.sessionDone) : null,
    h('a', { class: 'btn block', href: '#/records', 'data-testid': 'to-records' }, ja.result.records),
    h('a', { class: 'btn ghost block', href: '#/', 'data-testid': 'to-home' }, ja.result.home),
  );

  root.append(
    h(
      'main',
      { class: 'screen result', 'data-testid': 'result' },
      topBar(`${name} ${ja.result.title}`, true),
      features.outcomeLogo ? outcomeHeadline(v.rounds.map((r) => r.outcome)) : null,
      features.fighters && last?.outcome ? h('div', { class: 'scene' }, fightersCanvas({ outcome: last.outcome, level: v.level })) : null,
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, v.rounds.length === 1 ? ja.result.singleRoundHeading : ja.result.roundsHeading),
        rounds,
      ),
      h(
        'section',
        { class: 'card stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, ja.result.accuracy), h('span', { class: 'stat-value' }, fmtPct(trials > 0 ? correct / trials : 0))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, ja.result.maxCombo), h('span', { class: 'stat-value' }, fmtInt(maxCombo))),
        h(
          'div',
          { class: 'stat' },
          h('span', { class: 'stat-label' }, ja.result.power),
          h('span', { class: 'stat-value' }, `${ja.result.powerChange(v.powerBefore, v.powerAfter)}（${fmtSigned(delta)}）`),
        ),
        h(
          'div',
          { class: 'stat' },
          h('span', { class: 'stat-label' }, ja.result.bestDiff),
          h('span', { class: 'stat-value' }, bestDiff > 0 ? `${ja.result.newBest}（${fmtSigned(bestDiff)}）` : fmtSigned(bestDiff)),
        ),
      ),
      v.tip ? h('p', { class: 'tip card' }, v.tip) : null,
      actions,
    ),
  );
  return () => {};
}
