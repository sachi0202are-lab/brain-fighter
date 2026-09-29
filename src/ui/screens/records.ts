/**
 * 記録: 総合戦闘力の日別推移・ゲーム別の推移・ベルトの推移・ラウンドの正答率を、それぞれ別のグラフに。
 * 訓練内スコア（戦闘力）と認定戦（ベルト）の違いの説明を置く。
 */
import { accuracyOf, isIncomplete } from '../../cert/cert';
import { dayNumber, fromDayNumber } from '../../engine/dates';
import { allTrainingDays, WEEK_GOAL_DAYS, weekTrainingDays } from '../../engine/session';
import { beltName, gameText, ja } from '../../i18n/ja';
import { GAME_COLORS, TOTAL_COLOR } from '../../skin/palette';
import { GAME_IDS } from '../../storage/schema';
import { beltHistory, dailyGameSeries, dailyTotalSeries, roundAccuracySeries, totalBelt, trainingRounds } from '../../storage/selectors';
import type { App } from '../app';
import { chart, niceTicks, type ChartSeries } from '../charts';
import { h } from '../dom';
import { fmtDate, fmtInt, fmtMonthDay, fmtPct } from '../format';
import { beltChip, topBar } from './home';
import './cert.css';

const dateX = (x: number): string => fmtMonthDay(fromDayNumber(x));

export function mountRecords(app: App, root: HTMLElement): () => void {
  const d = app.store.data;
  const disposers: Array<() => void> = [];
  const add = (c: { el: HTMLElement; dispose: () => void }): HTMLElement => {
    disposers.push(c.dispose);
    return c.el;
  };

  const rounds = trainingRounds(d);
  const week = weekTrainingDays(allTrainingDays(d.games), new Date());
  const main = h(
    'main',
    { class: 'screen records', 'data-testid': 'records' },
    topBar(ja.records.title, true),
    h('p', { class: 'week', 'data-testid': 'records-week' }, ja.records.weekDays(week, WEEK_GOAL_DAYS), '　', h('span', { class: 'muted small' }, ja.records.rounds(rounds.length))),
    h('p', { class: 'card explain' }, ja.records.explain),
  );
  root.append(main);

  if (rounds.length === 0) main.append(h('p', { class: 'notice', 'data-testid': 'records-empty' }, ja.records.empty));

  // 1. 総合戦闘力（1系列: 凡例なし・見出しが名前）
  const total = dailyTotalSeries(d);
  const totalMax = Math.max(0, ...total.map((p) => p.value));
  const totalTicks = niceTicks(Math.max(totalMax, 300));
  main.append(
    add(
      chart({
        title: ja.records.totalChart,
        series: [{ id: 'total', name: ja.home.totalPower, color: TOTAL_COLOR, points: total.map((p) => ({ x: dayNumber(p.date), y: p.value })) }],
        mode: 'line',
        yMin: 0,
        yMax: totalTicks[totalTicks.length - 1] as number,
        yTicks: totalTicks,
        yFormat: fmtInt,
        xFormat: dateX,
        xHeading: ja.records.date,
        emptyText: ja.records.empty,
      }),
    ),
  );

  // 2. ゲーム別の戦闘力（3系列: 凡例あり・ゲームの色は固定）
  const gameSeries: ChartSeries[] = GAME_IDS.map((g) => ({
    id: g,
    name: gameText(g).name,
    color: GAME_COLORS[g],
    points: dailyGameSeries(d, g).map((p) => ({ x: dayNumber(p.date), y: p.value })),
  }));
  const gameMax = Math.max(0, ...gameSeries.flatMap((s) => s.points.map((p) => p.y)));
  const gameTicks = niceTicks(Math.max(gameMax, 100));
  main.append(
    add(
      chart({
        title: ja.records.gameChart,
        series: gameSeries,
        mode: 'line',
        yMin: 0,
        yMax: gameTicks[gameTicks.length - 1] as number,
        yTicks: gameTicks,
        yFormat: fmtInt,
        xFormat: dateX,
        xHeading: ja.records.date,
        emptyText: ja.records.empty,
      }),
    ),
  );

  // 3. ベルト（認定戦の結果。戦闘力とは別のグラフ）。いまのベルト（総合 = 3本の最低値）を先に
  main.append(
    h(
      'section',
      { class: 'card belts-now', 'data-testid': 'belts-now' },
      h('h2', { class: 'card-title' }, ja.records.beltsNow),
      h('div', { class: 'belts-row belts-total' }, h('span', null, ja.home.totalBelt), beltChip(totalBelt(d))),
      ...GAME_IDS.map((g) => h('div', { class: 'belts-row', 'data-game': g }, h('span', null, gameText(g).name), beltChip(d.games[g].belt))),
    ),
  );
  main.append(
    add(
      chart({
        title: ja.records.beltChart,
        series: GAME_IDS.map((g) => ({
          id: g,
          name: gameText(g).name,
          color: GAME_COLORS[g],
          points: beltHistory(d, g).map((p) => ({ x: dayNumber(p.date), y: p.belt })),
        })),
        mode: 'step',
        yMin: 0,
        yMax: 9,
        yTicks: [0, 3, 6, 9],
        yFormat: (y) => beltName(y),
        yLabelWidth: 64,
        xFormat: dateX,
        xHeading: ja.records.date,
        emptyText: ja.records.beltEmpty,
      }),
    ),
  );

  main.append(h('p', { class: 'muted small' }, ja.records.beltNote));

  // 3b. 認定戦の記録（新しい順。合否と正答率だけ）
  const certs = [...d.certs].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  main.append(
    h(
      'section',
      { class: 'card', 'data-testid': 'cert-history' },
      h('h2', { class: 'card-title' }, ja.records.certHistory),
      certs.length === 0
        ? h('p', { class: 'muted small' }, ja.records.certHistoryEmpty)
        : h(
            'ul',
            { class: 'cert-history' },
            ...certs.map((c) =>
              h(
                'li',
                { 'data-game': c.gameId, 'data-passed': String(c.passed) },
                h('span', { class: 'cert-history-date' }, fmtDate(c.at)),
                h('strong', null, gameText(c.gameId).name),
                h(
                  'span',
                  { class: c.passed ? 'is-passed' : 'muted' },
                  c.passed ? ja.cert.passed : isIncomplete(c) ? ja.cert.incomplete : ja.cert.failed,
                ),
                h(
                  'span',
                  { class: 'cert-history-accs' },
                  `${ja.cert.tierLabel(beltName(c.tier))}　${ja.cert.accuracies(c.rounds.map((r) => fmtPct(accuracyOf(r))))}`,
                ),
              ),
            ),
          ),
    ),
  );

  // 4. ラウンドの正答率（目安 75〜85% に収まっているかの確認用）
  const acc = roundAccuracySeries(d);
  main.append(
    add(
      chart({
        title: ja.records.accuracyChart,
        series: GAME_IDS.map((g) => ({
          id: g,
          name: gameText(g).name,
          color: GAME_COLORS[g],
          points: acc.flatMap((p, k) => (p.gameId === g ? [{ x: k + 1, y: p.accuracy }] : [])),
        })),
        mode: 'dots',
        yMin: 0,
        yMax: 1,
        yTicks: [0, 0.25, 0.5, 0.75, 1],
        yFormat: fmtPct,
        xFormat: (x) => ja.records.roundNo(x),
        xHeading: ja.records.round,
        band: { from: 0.75, to: 0.85, label: ja.records.targetBand },
        emptyText: ja.records.empty,
      }),
    ),
  );

  return () => {
    for (const fn of disposers) fn();
  };
}
