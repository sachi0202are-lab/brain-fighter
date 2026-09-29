/**
 * 認定戦（昇段審査）: 説明 → ゲームを選ぶ（解放済みのものだけ）→ 実施（cert-run.ts）→ 合否。
 * 1ゲームずつでも、挑めるゲームをまとめて続けて受けてもよい（仕様書 第7節）。
 * 難度は選べない（ベルト + 1 のティアで固定）。選べるのは「どのゲームの審査を受けるか」だけ。
 */
import { availableCertGames, certStatus } from '../../cert/cert';
import { CERT_MIN_TRAINING_DAYS } from '../../engine/session';
import { beltName, gameText, ja } from '../../i18n/ja';
import { GAME_IDS, type GameId } from '../../storage/schema';
import type { App } from '../app';
import { h } from '../dom';
import { fmtMonthDay } from '../format';
import { beltChip, topBar } from './home';
import './cert.css';

export function mountCert(app: App, root: HTMLElement): () => void {
  const d = app.store.data;
  const now = new Date();
  const ready = availableCertGames(d, now);
  const go = (ids: readonly GameId[]): void => app.navigate(`/cert/run/${ids.join(',')}`);

  const items = GAME_IDS.map((g) => {
    const s = certStatus(d.games[g], now);
    const state = s.maxed
      ? ja.cert.maxed
      : s.available && s.tier !== null
        ? `${ja.cert.ready}（${ja.cert.tierLabel(beltName(s.tier))}）`
        : !s.daysOk
          ? ja.cert.needDays(s.trainingDays, CERT_MIN_TRAINING_DAYS)
          : ja.cert.nextDate(fmtMonthDay(s.nextDate ?? ''));
    return h(
      'li',
      { class: 'card cert-item', 'data-game': g, 'data-available': String(s.available) },
      h('strong', null, gameText(g).name),
      beltChip(d.games[g].belt),
      h('span', { class: `cert-state ${s.available ? 'ok-text' : 'muted'}` }, state),
      s.available
        ? h(
            'button',
            { type: 'button', class: 'btn block', 'data-testid': `cert-start-${g}`, onclick: () => go([g]) },
            ja.cert.startOne(gameText(g).name),
          )
        : null,
    );
  });

  root.append(
    h(
      'main',
      { class: 'screen cert', 'data-testid': 'cert' },
      topBar(ja.cert.title, true),
      h('p', { class: 'card explain' }, ja.cert.explain),
      h('p', { class: 'muted small' }, ja.cert.conditions),
      h('ul', { class: 'cert-list' }, ...items),
      ready.length >= 2
        ? h(
            'button',
            { type: 'button', class: 'btn primary block', 'data-testid': 'cert-start-all', onclick: () => go(ready) },
            ja.cert.startAll(ready.length),
          )
        : null,
      ready.length === 0 ? h('p', { class: 'notice', 'data-testid': 'cert-none' }, ja.cert.noneReady) : null,
      h('p', { class: 'muted small' }, ja.cert.minimalNote),
      h('p', { class: 'muted small' }, ja.cert.attemptNote),
    ),
  );
  return () => {};
}
