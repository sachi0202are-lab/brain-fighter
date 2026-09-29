/** ブログ埋め込みのコード（仕様書 第11節）: URL・コードの中身・README と E2E の親ページとの一致 */
import { describe, expect, it } from 'vitest';
import { APP_URL, EMBED_SNIPPET, EMBED_URL, fullAppUrl } from './embed-code';

/** README などを読む（tsconfig に Node の型が無いので、使う関数だけ型を書いて動的に読み込む） */
interface MiniFs {
  readFileSync(p: URL, enc: 'utf8'): string;
}
const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as MiniFs;
const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('ブログ埋め込みコード', () => {
  it('公開 URL の /embed/ を iframe で開き、下に「全画面で開く」リンクを置く', () => {
    expect(APP_URL).toBe('https://sachi0202are-lab.github.io/brain-fighter/');
    expect(EMBED_URL).toBe('https://sachi0202are-lab.github.io/brain-fighter/embed/');
    expect(EMBED_SNIPPET).toContain(`<iframe src="${EMBED_URL}"`);
    expect(EMBED_SNIPPET).toContain('aspect-ratio:9/16');
    expect(EMBED_SNIPPET).toContain('allow="fullscreen" loading="lazy" title="Brain Fighter"');
    expect(EMBED_SNIPPET).toContain(`<a href="${APP_URL}" target="_blank" rel="noopener">全画面で開く</a>`);
  });

  it('README と E2E の親ページ（ブログ記事の代わり）に同じコードが載っている', () => {
    expect(read('../../README.md')).toContain(EMBED_SNIPPET);
    expect(read('../../e2e/embed-parent.html')).toContain(EMBED_SNIPPET);
  });

  it('「全画面で開く」の行き先は、公開先では公開 URL、開発中はそのオリジンの本体', () => {
    expect(fullAppUrl('https://sachi0202are-lab.github.io', '/brain-fighter/')).toBe(APP_URL);
    expect(fullAppUrl('http://localhost:5177', '/brain-fighter/')).toBe('http://localhost:5177/brain-fighter/');
  });
});
