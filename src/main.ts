import './styles.css';
import { App } from './ui/app';
import { SCREENS } from './ui/screens';
import { installTestHooks } from './ui/test-hooks';

/**
 * 新しい版の取り込み（vite-plugin-pwa の autoUpdate。sw.js は skipWaiting + clientsClaim）:
 * 新しい Service Worker が画面を引き継いだら（controllerchange）、試合中でなければ一度だけ再読み込みして最新の画面にする。
 * 初回のインストール（まだ controller が無い）では再読み込みしない。
 * タブが前面に戻ったときにも更新を確かめる（開きっぱなしの PWA が古い版のままにならないように）。
 * ?test=1（E2E）では何もしない。
 */
function watchForUpdates(app: App): void {
  if (app.flags.test || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const hadController = sw.controller !== null;
  let reloaded = false;
  sw.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    app.requestReload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    sw.getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {
        /* オフラインなどで確かめられなくてもよい */
      });
  });
}

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  installTestHooks(app);
  app.start(SCREENS);
  watchForUpdates(app);
}
