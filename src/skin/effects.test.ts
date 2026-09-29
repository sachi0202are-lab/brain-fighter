/**
 * 演出の安全性（仕様書 9.3・9.5・受け入れ基準 8）:
 * - 必殺演出（Full・ラウンド間のみ）は一度だけ動いて止まり、明るさが上下に振れる（点滅する）要素が無い。
 * - Full の背景は静的（アニメーション無し・レベルから決定的）。
 * - CSS: 繰り返すアニメーションは 1 周 1/3 秒以上（点滅 3 回/秒以下）。刺激領域（.stim）には動きを付けない。
 * - 結果画面の見出しは KO / PERFECT の数だけ（判定負けは見出しにしない）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installFakeDocument, type FakeElement } from '../test/fake-dom';
import { BACKDROP_VARIANTS, backdropSvg, backdropUrl } from './backdrop';
import { outcomeHeadline } from './banner';
import { SPECIAL_IMPACT_MS, SPECIAL_MS, specialFrame } from './special';

describe('必殺演出（ラウンド間だけ・一度きり）', () => {
  const frames = Array.from({ length: 501 }, (_, k) => ({ t: k * 5, f: specialFrame(k * 5) }));

  it('衝撃の輪は突きの瞬間に一度だけ現れ、広がりながら単調に薄くなって消える', () => {
    const onsets = frames.filter((x, k) => x.f.ring && (k === 0 || !frames[k - 1]!.f.ring));
    expect(onsets).toHaveLength(1);
    expect(onsets[0]!.t).toBeGreaterThanOrEqual(SPECIAL_IMPACT_MS);
    const rings = frames.filter((x) => x.f.ring).map((x) => x.f.ring!);
    for (let k = 1; k < rings.length; k++) {
      expect(rings[k]!.alpha).toBeLessThanOrEqual(rings[k - 1]!.alpha + 1e-12);
      expect(rings[k]!.r).toBeGreaterThanOrEqual(rings[k - 1]!.r - 1e-12);
    }
    expect(Math.max(...rings.map((r) => r.alpha))).toBeLessThanOrEqual(0.6);
  });

  it('残像は一定の薄さで付き、当たったあと単調に消える（明滅しない）', () => {
    const alphas = frames.map((x) => x.f.trail[0]?.alpha ?? 0);
    let rises = 0;
    for (let k = 1; k < alphas.length; k++) if (alphas[k]! > alphas[k - 1]! + 1e-12) rises += 1;
    expect(rises).toBeLessThanOrEqual(1); // 現れる1回だけ
    for (const x of frames) for (const t of x.f.trail) expect(t.alpha).toBeLessThanOrEqual(0.25);
  });

  it(`${SPECIAL_MS} ms 以降は勝ちポーズとダウンで静止する`, () => {
    const end = specialFrame(SPECIAL_MS);
    expect(end).toMatchObject({ playerPose: 'victory', enemyPose: 'down', ring: null, trail: [] });
    expect(specialFrame(SPECIAL_MS + 5000)).toEqual(end);
    expect(specialFrame(-100)).toEqual(specialFrame(0));
  });
});

describe('Full の静的な背景', () => {
  it('レベルから決定的に作り、アニメーションや文字を含まない', () => {
    const seen = new Set<string>();
    for (let lv = 0; lv < 12; lv++) {
      const svg = backdropSvg(lv);
      expect(backdropSvg(lv)).toBe(svg);
      expect(svg).not.toMatch(/<animate|<set|animation|<script|<text/i);
      seen.add(svg);
      expect(backdropUrl(lv)).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\)$/);
    }
    expect(seen.size).toBeGreaterThanOrEqual(BACKDROP_VARIANTS);
  });
});

describe('結果画面の見出し', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installFakeDocument();
  });
  afterAll(() => restore());

  it('KO と PERFECT の数だけを出し、どちらも無ければ出さない', () => {
    const el = outcomeHeadline(['ko', 'decision', 'perfect', 'ko']) as unknown as FakeElement;
    expect(el.children.map((c) => c.textContent)).toEqual(['PERFECT × 1', 'KO × 2']);
    expect(outcomeHeadline(['decision', 'decision', null])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CSS の点検（受け入れ基準 8）
// ---------------------------------------------------------------------------

/**
 * src/ 以下の CSS を読む。Vitest は CSS の import を空にするので、Node の fs で直接読む
 * （tsconfig に Node の型が無いので、使う関数だけ型を書いて動的に読み込む）。
 */
interface MiniFs {
  readFileSync(p: URL, enc: 'utf8'): string;
  readdirSync(p: URL, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
}
const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as MiniFs;
function readCss(dir: URL, out: Record<string, string> = {}): Record<string, string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) readCss(url, out);
    else if (e.name.endsWith('.css')) out[url.pathname] = fs.readFileSync(url, 'utf8');
  }
  return out;
}
const CSS = readCss(new URL('../', import.meta.url));

/** '320ms' '1.2s' → ms */
function toMs(v: string): number | null {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

interface Decl {
  file: string;
  selector: string;
  prop: string;
  value: string;
}

/** とても素朴な CSS の宣言の取り出し（@keyframes の中身は飛ばす） */
function declarations(file: string, css: string): Decl[] {
  const out: Decl[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      const selector = stack.pop() ?? '';
      if (!stack.some((s) => s.startsWith('@keyframes')) && !selector.startsWith('@keyframes')) {
        for (const d of buf.split(';')) {
          const i = d.indexOf(':');
          if (i > 0) out.push({ file, selector, prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() });
        }
      }
      buf = '';
    } else if (ch === ';' && stack.length === 0) {
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

describe('CSS の動き（点滅 3 回/秒以下・刺激領域に動きなし）', () => {
  const decls = Object.entries(CSS).flatMap(([file, css]) => declarations(file, css));

  it('CSS を読めている', () => {
    expect(Object.keys(CSS).some((f) => f.endsWith('/styles.css'))).toBe(true);
    expect(decls.filter((d) => d.prop === 'animation').length).toBeGreaterThan(0);
  });

  it('繰り返すアニメーションは 1 周 333 ms 以上（3 回/秒以下）', () => {
    for (const d of decls) {
      if (d.prop !== 'animation' && d.prop !== 'animation-iteration-count') continue;
      for (const part of d.value.split(',')) {
        const tokens = part.trim().split(/\s+/);
        const count = tokens.find((t) => t === 'infinite' || /^\d+(\.\d+)?$/.test(t));
        const repeats = count === 'infinite' || (count !== undefined && Number(count) > 1);
        if (!repeats) continue;
        const dur = tokens.map(toMs).find((v) => v !== null) ?? null;
        expect(dur, `${d.file} ${d.selector} { ${d.prop}: ${d.value} }`).not.toBeNull();
        expect(dur as number, `${d.file} ${d.selector}`).toBeGreaterThanOrEqual(1000 / 3);
      }
    }
  });

  it('刺激領域（.stim / .stim-wrap）にはアニメーション・トランジションを付けない', () => {
    for (const d of decls) {
      if (!/\.stim(?![-\w])|\.stim-wrap/.test(d.selector)) continue;
      expect(d.prop, `${d.file} ${d.selector}`).not.toMatch(/^(animation|transition)/);
    }
  });
});
