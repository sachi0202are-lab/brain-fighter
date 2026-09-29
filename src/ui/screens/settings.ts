/**
 * 設定: 演出プリセット（Off/Light/Full）・音・色覚配慮・データのエクスポート／インポート／全消去・このアプリについて。
 * 難度に関わる設定は置かない（仕様書 4.2 MUST: 難度はアルゴリズムだけが決める）。
 */
import { ja } from '../../i18n/ja';
import { downloadText, exportFileName, parseImport, serializeSaveData } from '../../storage/io';
import { FX_PRESETS, type FxPreset } from '../../storage/schema';
import type { App } from '../app';
import { h } from '../dom';
import { fmtDate } from '../format';
import { topBar } from './home';

export function mountSettings(app: App, root: HTMLElement): () => void {
  const render = (message = ''): void => {
    root.replaceChildren(build(message));
  };

  const build = (message: string): HTMLElement => {
    const s = app.store.data.settings;
    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'data-testid': 'settings-status' }, message);

    // ---- 演出 ----
    const fxGroup = h(
      'fieldset',
      { class: 'card fieldset' },
      h('legend', null, ja.settings.fxHeading),
      ...FX_PRESETS.map((fx: FxPreset) =>
        h(
          'label',
          { class: 'radio' },
          h('input', {
            type: 'radio',
            name: 'fx',
            value: fx,
            checked: s.fx === fx,
            'data-testid': `fx-${fx}`,
            onchange: () => {
              app.store.update((d) => {
                d.settings.fx = fx;
              });
            },
          }),
          h('span', null, ja.settings.fx[fx]),
        ),
      ),
      h('p', { class: 'muted small' }, ja.settings.fxNote),
    );

    const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void, testid: string): HTMLElement =>
      h(
        'label',
        { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked,
          'data-testid': testid,
          onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
        }),
        h('span', null, label),
      );

    const display = h(
      'fieldset',
      { class: 'card fieldset' },
      h('legend', null, ja.settings.displayHeading),
      toggle(ja.settings.sound, s.sound, (v) => app.store.update((d) => void (d.settings.sound = v)), 'sound'),
      toggle(ja.settings.colorSafe, s.colorSafe, (v) => app.store.update((d) => void (d.settings.colorSafe = v)), 'color-safe'),
    );

    // ---- データ ----
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', 'data-testid': 'import-file' });
    const preview = h('div', { class: 'import-preview', hidden: true, 'data-testid': 'import-preview' });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        const r = parseImport(text);
        preview.hidden = false;
        if (!r.ok) {
          preview.replaceChildren(h('p', { class: 'notice' }, ja.settings.importError(r.error)));
          return;
        }
        const replaceBtn = h('button', { type: 'button', class: 'btn primary', 'data-testid': 'import-replace' }, ja.settings.importReplace);
        const cancelBtn = h('button', { type: 'button', class: 'btn ghost' }, ja.settings.importCancel);
        replaceBtn.addEventListener('click', () => {
          if (!window.confirm(ja.settings.importConfirm)) return;
          app.store.replace(r.data);
          render(ja.settings.imported);
        });
        cancelBtn.addEventListener('click', () => {
          preview.hidden = true;
          preview.replaceChildren();
          fileInput.value = '';
        });
        preview.replaceChildren(
          h('p', null, ja.settings.importPreview(fmtDate(r.preview.createdAt), r.preview.rounds, r.preview.totalPower)),
          h('div', { class: 'row' }, replaceBtn, cancelBtn),
        );
      });
    });

    const notices: HTMLElement[] = [];
    if (!app.store.available) notices.push(h('p', { class: 'notice', 'data-testid': 'storage-unavailable' }, ja.settings.storageUnavailable));
    else if (!app.store.lastSave.ok) notices.push(h('p', { class: 'notice' }, ja.settings.storageFailed));
    else if (app.store.lastSave.pruned) notices.push(h('p', { class: 'notice' }, ja.settings.storagePruned));
    if (app.store.backupKey) notices.push(h('p', { class: 'muted small' }, ja.settings.backupNote));

    const data = h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, ja.settings.dataHeading),
      ...notices,
      h(
        'div',
        { class: 'stack' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn block',
            'data-testid': 'export',
            onclick: () => downloadText(exportFileName(new Date()), serializeSaveData(app.store.data)),
          },
          ja.settings.exportButton,
        ),
        h('button', { type: 'button', class: 'btn block', onclick: () => fileInput.click() }, ja.settings.importButton),
        fileInput,
        preview,
        h(
          'button',
          {
            type: 'button',
            class: 'btn danger block',
            'data-testid': 'clear',
            onclick: () => {
              if (!window.confirm(ja.settings.clearConfirm)) return;
              app.store.clearAll();
              render(ja.settings.cleared);
            },
          },
          ja.settings.clearButton,
        ),
      ),
    );

    // ---- このアプリについて（仕様書 第12節の免責文をそのまま） ----
    const about = h(
      'section',
      { class: 'card about', 'data-testid': 'about' },
      h('h2', { class: 'card-title' }, ja.settings.aboutHeading),
      h('p', null, ja.settings.description),
      h('p', { class: 'disclaimer', 'data-testid': 'disclaimer' }, ja.settings.disclaimer),
      h('p', { class: 'muted small' }, ja.settings.privacy),
      h('p', { class: 'muted small' }, ja.settings.version(__APP_VERSION__)),
    );

    return h('main', { class: 'screen settings', 'data-testid': 'settings' }, topBar(ja.settings.title, true), status, fxGroup, display, data, about);
  };

  render();
  return () => {};
}
