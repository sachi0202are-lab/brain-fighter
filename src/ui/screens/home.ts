/** ホーム: ロゴ・キービジュアル・総合戦闘力・3ゲームの戦闘力とベルト・今日のセッション・今週 x / 5 日・昇段審査 */
import { availableCertGames } from '../../cert/cert';
import { allTrainingDays, sessionAvailability, WEEK_GOAL_DAYS, weekTrainingDays } from '../../engine/session';
import { beltName, gameText, ja } from '../../i18n/ja';
import { ART_UI, artUrl, beltUrl } from '../../skin/art';
import { BELT_COLORS, GAME_COLORS } from '../../skin/palette';
import { GAME_IDS, type GameId } from '../../storage/schema';
import { latestPower, totalBelt, totalPowerNow, trainingRounds } from '../../storage/selectors';
import type { App } from '../app';
import { h } from '../dom';
import { fullAppUrl } from '../embed-code';
import { fmtInt, fmtTime } from '../format';
import { startOrResumeSession } from '../session-flow';

/** ベルトの表示（アイコンの画像＋名前。画像が無ければ色見本） */
export function beltChip(belt: number): HTMLElement {
  const icon = beltUrl(belt);
  return h(
    'span',
    { class: `belt-chip${belt >= 8 ? ' belt-black' : ''}`, 'data-belt': belt },
    icon
      ? h('img', { class: 'belt-icon', src: icon, alt: '', width: 24, height: 24, loading: 'lazy', decoding: 'async' })
      : h('span', { class: 'belt-swatch', style: `background:${BELT_COLORS[belt] ?? BELT_COLORS[0]}` }),
    beltName(belt),
  );
}

/** ロゴ（画像。読めなければ alt のアプリ名が同じ場所に出る） */
export function brandLogo(): HTMLElement {
  const logo = ART_UI.logo;
  return h('span', { class: 'brand' }, h('img', { class: 'brand-logo', src: artUrl(logo.file), alt: ja.appName, width: logo.w, height: logo.h, decoding: 'async' }));
}

/** 「全画面で開く」（埋め込みページから本体を新しいタブで開く） */
export function fullscreenLink(): HTMLElement {
  return h(
    'a',
    { class: 'btn small fullscreen-link', href: fullAppUrl(), target: '_blank', rel: 'noopener', 'data-testid': 'fullscreen' },
    ja.nav.fullscreen,
  );
}

/**
 * 画面上部のバー。ホームでは記録・設定へのナビ、ほかの画面では「もどる」。
 * 埋め込み（embed）のホームではナビを省き、「全画面で開く」だけを置く。
 */
export function topBar(title: string, back: boolean, embed = false): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    back ? h('a', { class: 'btn ghost small', href: '#/' }, `← ${ja.nav.back}`) : brandLogo(),
    back ? h('h1', { class: 'topbar-title' }, title) : null,
    back
      ? h('span', { class: 'topbar-spacer' })
      : embed
        ? fullscreenLink()
        : h(
            'nav',
            { class: 'topnav' },
            h('a', { class: 'btn ghost small', href: '#/records' }, ja.nav.records),
            h('a', { class: 'btn ghost small', href: '#/settings' }, ja.nav.settings),
          ),
  );
}

/** ゲームカードのサムネイル（生成画像。飾りなので alt は空） */
function gameThumb(g: GameId): HTMLElement {
  const t = ART_UI[`thumb-${g}`];
  return h('img', { class: 'game-thumb', src: artUrl(t.file), alt: '', width: t.w, height: t.h, loading: 'lazy', decoding: 'async' });
}

export function mountHome(app: App, root: HTMLElement): () => void {
  const d = app.store.data;
  const now = new Date();
  const hasRecords = trainingRounds(d).length > 0;

  // 総合戦闘力はキービジュアル（2人のシルエットが向き合う絵）の上に大きく出す
  const hero = h(
    'section',
    { class: 'card hero hero-art', 'aria-label': ja.home.totalPower, style: `--hero-image: url("${artUrl(ART_UI.hero.file)}")` },
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

  // 昇段審査（訓練 3 日以上・前回から 7 日以上のゲームがあるときだけ）
  const certGames = availableCertGames(d, now);
  const cert =
    certGames.length > 0
      ? h(
          'section',
          { class: 'card cert-ready', 'data-testid': 'cert-ready' },
          h('p', null, ja.home.certReadyGames(certGames.map((g) => gameText(g).name).join('、'))),
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
        gameThumb(g),
        h(
          'div',
          { class: 'game-card-body' },
          h('div', { class: 'game-card-head' }, h('span', { class: 'line-key', style: `background:${GAME_COLORS[g]}` }), h('h2', null, t.name)),
          h('p', { class: 'muted small' }, t.tagline),
          h(
            'div',
            { class: 'game-card-foot' },
            h('span', { class: 'game-power' }, h('span', { class: 'muted small' }, ja.home.power), ' ', h('strong', { 'data-testid': `power-${g}` }, fmtInt(latestPower(d, g)))),
            beltChip(d.games[g].belt),
          ),
        ),
      );
    }),
  );
  const embedNote = app.embed ? h('p', { class: 'embed-note', 'data-testid': 'embed-note' }, ja.embed.note) : null;
  root.append(h('main', { class: 'screen home' }, topBar(ja.appName, false, app.embed), embedNote, hero, session, cert, cards));
  return () => {};
}
