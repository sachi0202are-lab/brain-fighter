import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const DESCRIPTION =
  '反応・記憶・切り替えを試す3分ミニゲーム集。格闘ゲーム風の演出で、ゲーム内の成績（戦闘力）と自己ベストを記録できます。';

/**
 * ブログ埋め込み用ページ（/embed/）には PWA の manifest と Service Worker の登録を入れない
 * （仕様書 第11節: ホーム画面への追加は本体 URL でだけ案内する。iframe の中で SW を登録しない）。
 * vite-plugin-pwa はすべての HTML に差し込むので、その後で embed/index.html からだけ取り除く。
 */
function embedWithoutPwa(): Plugin {
  return {
    name: 'brain-fighter:embed-without-pwa',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!/\/embed\/index\.html$/.test(ctx.path)) return html;
        return html
          .replace(/<link rel="manifest"[^>]*>/g, '')
          .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, '');
      },
    },
  };
}

export default defineConfig({
  // GitHub Pages: https://sachi0202are-lab.github.io/brain-fighter/
  base: '/brain-fighter/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    // 本体（index.html）とブログ埋め込み用ページ（embed/index.html → /brain-fighter/embed/）
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        embed: fileURLToPath(new URL('./embed/index.html', import.meta.url)),
      },
      // 2つの入口で共有するアプリ本体のチャンク名（既定だと中の1モジュール名になって紛らわしい）
      output: {
        chunkFileNames: 'assets/app-[hash].js',
        assetFileNames: (info) => (info.names.some((n) => n.endsWith('.css')) ? 'assets/app-[hash][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  // E2E 用のビルド出力（.e2e-dist/）を依存の走査・監視の対象から外す
  optimizeDeps: {
    entries: ['index.html', 'embed/index.html'],
  },
  server: {
    watch: { ignored: ['**/.e2e-dist/**', '**/test-results/**'] },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/brain-fighter/',
        name: 'Brain Fighter',
        short_name: 'Brain Fighter',
        description: DESCRIPTION,
        lang: 'ja',
        dir: 'ltr',
        start_url: '/brain-fighter/',
        scope: '/brain-fighter/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e1120',
        theme_color: '#0e1120',
        categories: ['games', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // ?seed= や ?test= が付いていてもオフラインで開けるように、プリキャッシュの照合ではクエリを無視する
        ignoreURLParametersMatching: [/.*/],
        navigateFallback: 'index.html',
        // 埋め込みページ（フェーズ3以降の /embed/）は index.html に差し替えない
        navigateFallbackDenylist: [/\/embed\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
    embedWithoutPwa(),
  ],
});
