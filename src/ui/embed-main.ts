/**
 * ブログ埋め込み用ページ（/embed/）の入口。本体と同じアプリを「埋め込み版」で起動する:
 * ナビを省いたコンパクト表示・「全画面で開く」・ブログ内の記録は本体と別になる旨の表示。
 * （iframe 内の localStorage はブラウザが本体と別の保存領域に分ける。）
 */
import '../styles.css';
import { App } from './app';
import { SCREENS } from './screens';
import { installTestHooks } from './test-hooks';

const root = document.getElementById('app');
if (root) {
  const app = new App(root, { embed: true });
  installTestHooks(app);
  app.start(SCREENS);
}
