/** ホーム: 総合戦闘力・3ゲームの戦闘力とベルト・今日のセッション・今週 x / 5 日・昇段審査 */
import { allTrainingDays, certAvailability, sessionAvailability, WEEK_GOAL_DAYS, weekTrainingDays } from '../../engine/session';
import { beltName, gameText, ja } from '../../i18n/ja';
import { BELT_COLORS, GAME_COLORS } from '../../skin/palette';
import { GAME_IDS } from '../../storage/schema';
import { latestPower, totalBelt, totalPowerNow, trainingRounds } from '../../storage/selectors';
import type { App } from '../app';
import { h } from '../dom';
import { fmtInt, fmtTime } from '../format';
import { startOrResumeSession } from '../session-flow';

export function beltChip(belt: number): HTMLElement {
  return h(
    'span',
    { class: `belt-chip${belt >= 8 ? ' belt-black' : ''}`, 'data-belt': belt },
    h('span', { class: 'belt-swatch', style: `background:${BELT_COLORS[belt] ?? BELT_COLORS[0]}` }),
    beltName(belt),
  );
}

export function topBar(title: string, back: boolean): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    back ? h('a', { class: 'btn ghost small', href: '#/' }, `← ${ja.nav.back}`) : h('span', { class: 'brand' }, ja.appName),
    back ? h('h1', { class: 'topbar-title' }, title) : null,
    back
      ? h('span', { class: 'topbar-spacer' })
      : h(
          'nav',
          { class: 'topnav' },
          h('a', { class: 'btn ghost small', href: '#/records' }, ja.nav.records),
          h('a', { class: 'btn ghost small', href: '#/settings' }, ja.nav.settings),
        ),
  );
}

export function mountHome(app: App, root: HTMLElement): () => void {
  const d = app.store.data;
  const now = new Date();
  const hasRecords = trainingRounds(d).length > 0;

  const hero = h(
    'section',
    { class: 'card hero', 'aria-label': ja.home.totalPower },
    h('div', { class: 'hero-label' }, ja.home.totalPower),
    h('div', { class: 'hero-num', 'data-testid': 'total-power' }, fmtInt(totalPowerNow(d))),
    h('div', { class: 'hero-sub' }, h('span', { class: 'muted' }, ja.home.totalBelt), beltChip(totalBelt(d))),
    hasRecords ? null : h('p', { class: 'muted small' }, ja.home.notPlayed),
  );

  const av = sessionAvailability(d.sessions ?? [], now);
  let sessionBtn: HTMLElement;
  let sessionNote: HTMLElement | null = null;
  if (av.status === 'available' || av.status === 'resume') {
    const label = av.status === 'resume' ? ja.home.resumeSession(gameText(av.next).name) : ja.home.startSession;
    sessionBtn = h(
      'button',
      { type: 'button', class: 'btn primary block big', 'data-testid': 'start-session', onclick: () => startOrResumeSession(app) },
      label,
    );
  } else {
    sessionBtn = h('button', { type: 'button', class: 'btn primary block big', disabled: true, 'data-testid': 'start-session' }, ja.home.startSession);
    sessionNote = h('p', { class: 'notice' }, av.status === 'wait' ? ja.home.sessionWait(fmtTime(av.availableAt)) : ja.home.sessionLimit);
  }
  const week = weekTrainingDays(allTrainingDays(d.games), now);
  const session = h(
    'section',
    { class: 'session' },
    sessionBtn,
    sessionNote,
    h('p', { class: 'muted small' }, ja.home.sessionNote),
    h('p', { class: 'week', 'data-testid': 'week-days' }, ja.home.weekDays(week, WEEK_GOAL_DAYS)),
  );

  const certReady = GAME_IDS.some((g) => certAvailability(d.games[g], now).available);
  const cert = certReady
    ? h(
        'section',
        { class: 'card cert-ready' },
        h('p', null, ja.home.certReady),
        h('a', { class: 'btn block', href: '#/cert', 'data-testid': 'cert-button' }, ja.home.certButton),
      )
    : null;

  const cards = h(
    'section',
    { class: 'game-cards' },
    ...GAME_IDS.map((g) => {
      const t = gameText(g);
      return h(
        'article',
        { class: 'card game-card', 'data-game': g },
        h('div', { class: 'game-card-head' }, h('span', { class: 'line-key', style: `background:${GAME_COLORS[g]}` }), h('h2', null, t.name)),
        h('p', { class: 'muted small' }, t.tagline),
        h(
          'div',
          { class: 'game-card-foot' },
          h('span', { class: 'game-power' }, h('span', { class: 'muted small' }, ja.home.power), ' ', h('strong', { 'data-testid': `power-${g}` }, fmtInt(latestPower(d, g)))),
          beltChip(d.games[g].belt),
        ),
      );
    }),
  );
  root.append(h('main', { class: 'screen home' }, topBar(ja.appName, false), hero, session, cert, cards));
  return () => {};
}
