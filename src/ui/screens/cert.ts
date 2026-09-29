/** 認定戦（昇段審査）: フェーズ1では説明と解放条件の表示だけ。実施画面はフェーズ3 */
import { CERT_MIN_TRAINING_DAYS, certAvailability } from '../../engine/session';
import { gameText, ja } from '../../i18n/ja';
import { GAME_IDS } from '../../storage/schema';
import type { App } from '../app';
import { h } from '../dom';
import { fmtMonthDay } from '../format';
import { beltChip, topBar } from './home';

export function mountCert(app: App, root: HTMLElement): () => void {
  const d = app.store.data;
  const now = new Date();
  root.append(
    h(
      'main',
      { class: 'screen cert', 'data-testid': 'cert' },
      topBar(ja.cert.title, true),
      h('p', { class: 'card explain' }, ja.cert.explain),
      h('p', { class: 'muted small' }, ja.cert.conditions),
      h(
        'ul',
        { class: 'cert-list' },
        ...GAME_IDS.map((g) => {
          const a = certAvailability(d.games[g], now);
          const state = a.available
            ? ja.cert.ready
            : !a.daysOk
              ? ja.cert.needDays(a.trainingDays, CERT_MIN_TRAINING_DAYS)
              : ja.cert.nextDate(fmtMonthDay(a.nextDate ?? ''));
          return h(
            'li',
            { class: 'card cert-item', 'data-game': g },
            h('strong', null, gameText(g).name),
            beltChip(d.games[g].belt),
            h('span', { class: a.available ? 'ok-text' : 'muted' }, state),
          );
        }),
      ),
      h('p', { class: 'notice' }, ja.cert.preparing),
    ),
  );
  return () => {};
}
