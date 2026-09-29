/**
 * ブログ埋め込み（仕様書 第11節）の URL とコード。設定画面の「ブログ用の埋め込みコードをコピー」と README で使う。
 * EMBED_SNIPPET は第11節のスニペットそのまま（README の同じコードと一致することをテストで確かめる）。
 */

/** 公開 URL（仕様書 第2節 #11） */
export const APP_URL = 'https://sachi0202are-lab.github.io/brain-fighter/';

/** 埋め込み用ページ */
export const EMBED_URL = `${APP_URL}embed/`;

/** WordPress の「カスタム HTML」ブロックに貼るコード（仕様書 第11節そのまま） */
export const EMBED_SNIPPET = `<div style="max-width:420px;margin:0 auto;aspect-ratio:9/16;">
  <iframe src="https://sachi0202are-lab.github.io/brain-fighter/embed/"
          style="width:100%;height:100%;border:0;border-radius:12px;"
          allow="fullscreen" loading="lazy" title="Brain Fighter"></iframe>
</div>
<p style="text-align:center"><a href="https://sachi0202are-lab.github.io/brain-fighter/" target="_blank" rel="noopener">全画面で開く</a></p>`;

/**
 * 埋め込みページの「全画面で開く」の行き先（本体）。
 * 公開先（GitHub Pages）では APP_URL と同じ。開発サーバーやテストでは、そのオリジンの本体を開く。
 */
export function fullAppUrl(origin: string = location.origin, base: string = import.meta.env.BASE_URL): string {
  return new URL(base, origin).href;
}
