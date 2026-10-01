/**
 * 初回オンボーディング（仕様書 第10節 8）: 3 画面。
 *   1. ようこそ（アプリの説明・免責）  2. あそび方（セッション・自動の難度・認定戦）  3. 演出の選択（既定 Light）
 * 文言は第12節に従う: 主語はゲーム内の成績・記録。効果を示唆しない。
 * 初回（記録も案内済みの印も無いとき）にホームの代わりに出る。設定画面から #/welcome でもう一度見られる。
 */
import { ja } from '../../i18n/ja';
import { ART_UI, artUrl } from '../../skin/art';
import { FX_PRESETS, type FxPreset } from '../../storage/schema';
import type { App } from '../app';
import { h } from '../dom';
import { brandLogo } from './home';
import './welcome.css';

/** キービジュアル（2人のシルエットが向き合う絵）にロゴを重ねる（飾り。alt はロゴだけアプリ名） */
function keyArt(): HTMLElement {
  const hero = ART_UI.hero;
  const logo = ART_UI.logo;
  return h(
    'div',
    { class: 'keyart' },
    h('img', { class: 'keyart-bg', src: artUrl(hero.file), alt: '', width: hero.w, height: hero.h, decoding: 'async' }),
    h('img', { class: 'keyart-logo', src: artUrl(logo.file), alt: ja.appName, width: logo.w, height: logo.h, decoding: 'async' }),
  );
}

export const WELCOME_STEPS = 3;

export function mountWelcome(app: App, root: HTMLElement): () => void {
  let step = 0;
  let fx: FxPreset = app.store.data.settings.fx;

  const finish = (): void => {
    app.store.update((d) => {
      d.settings.fx = fx;
      d.onboardedAt = new Date().toISOString();
    });
    app.navigate('/');
  };

  const body = (): HTMLElement[] => {
    if (step === 0) {
      return [
        keyArt(),
        h('h1', { class: 'welcome-title' }, ja.welcome.title1),
        h('p', { class: 'welcome-lead' }, ja.welcome.lead),
        h('p', null, ja.welcome.body1),
        h('p', { class: 'muted small welcome-disclaimer' }, ja.settings.disclaimer),
      ];
    }
    if (step === 1) {
      return [
        h('h1', { class: 'welcome-title' }, ja.welcome.title2),
        h('ul', { class: 'welcome-list' }, ...ja.welcome.items2.map((t) => h('li', null, t))),
      ];
    }
    return [
      h('h1', { class: 'welcome-title' }, ja.welcome.title3),
      h(
        'fieldset',
        { class: 'card fieldset' },
        h('legend', null, ja.settings.fxHeading),
        ...FX_PRESETS.map((p) =>
          h(
            'label',
            { class: 'radio' },
            h('input', {
              type: 'radio',
              name: 'welcome-fx',
              value: p,
              checked: fx === p,
              'data-testid': `welcome-fx-${p}`,
              onchange: () => {
                fx = p;
              },
            }),
            h('span', null, ja.settings.fx[p]),
          ),
        ),
      ),
      h('p', { class: 'muted small' }, ja.welcome.note3),
    ];
  };

  const render = (): void => {
    const last = step === WELCOME_STEPS - 1;
    const next = h(
      'button',
      {
        type: 'button',
        class: 'btn primary block',
        'data-testid': last ? 'welcome-start' : 'welcome-next',
        onclick: () => {
          if (last) finish();
          else {
            step += 1;
            render();
          }
        },
      },
      last ? ja.welcome.start : ja.welcome.next,
    );
    const back =
      step > 0
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn ghost block',
              'data-testid': 'welcome-back',
              onclick: () => {
                step -= 1;
                render();
              },
            },
            ja.welcome.back,
          )
        : null;
    root.replaceChildren(
      h(
        'main',
        { class: 'screen welcome', 'data-testid': 'welcome', 'data-step': String(step + 1) },
        h('header', { class: 'topbar' }, brandLogo(), h('span', { class: 'muted small' }, ja.welcome.stepOf(step + 1, WELCOME_STEPS))),
        h('section', { class: 'card welcome-card' }, ...body()),
        h('div', { class: 'actions' }, next, back),
        app.embed ? h('p', { class: 'embed-note' }, ja.embed.note) : null,
      ),
    );
    next.focus();
  };

  render();
  return () => {};
}
