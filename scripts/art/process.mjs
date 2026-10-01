#!/usr/bin/env node
/**
 * 生成画像（art-src/raw/）を、アプリで使う素材に加工する:
 *   public/art/fighters/*.png  … シルエット（白地の黒いシルエットを「黒＋アルファ」に変え、シートを 1 体ずつに分ける）
 *   public/art/stages/*.jpg    … ステージ背景（1280×720 に縮小）
 *   public/art/ui/*            … ロゴ（グリーンバック抜き）・キービジュアル・ゲームカードのサムネイル・ベルト
 *   public/icons/*             … アプリアイコン（192 / 512 / maskable 512 / apple-touch 180）と favicon.svg / icon.svg
 *   src/skin/art-manifest.ts   … 素材の一覧と寸法（アプリは読み込み前に寸法を知れる）
 *
 * ImageMagick 6（convert / identify）が要る。画素の処理（白 → 透明、グリーンバック抜き、シートの分割）は Node で行い、
 * ImageMagick は読み書きと拡大縮小にだけ使う。
 *
 *   node scripts/art/process.mjs            # すべて
 *   node scripts/art/process.mjs fighters   # 種類を絞る（fighters / stages / ui / icons）
 *
 * 元画像は genspark-image/gen.sh（GPT Image 2.5）で生成したもの（プロンプトは art-src/PROMPTS.md）。
 * 保存名は .png でも中身は JPEG のことがあるので、拡張子ではなく中身で読む（ImageMagick は中身で判断する）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'art-src', 'raw');
const ART = join(ROOT, 'public', 'art');
const ICONS = join(ROOT, 'public', 'icons');
const MANIFEST = join(ROOT, 'src', 'skin', 'art-manifest.ts');

/** 立ち姿（基準のポーズ）の高さ (px)。同じシートの他のポーズも同じ倍率で縮小する */
const STANDING_HEIGHT = 640;
/** ベルトのアイコンの高さ (px) */
const BELT_HEIGHT = 80;

/** シルエットのシート: 白地に黒。左から順に sprites の名前を付ける。ref = 高さの基準にするポーズ */
const SHEETS = [
  { src: 'player-sheet', sprites: ['player-guard', 'player-strike', 'player-victory'], ref: 0 },
  { src: 'enemy-side-sheet', sprites: ['enemy-guard', 'enemy-down'], ref: 0 },
  { src: 'enemy-front-sheet', sprites: ['enemy-front-a', 'enemy-front-b', 'enemy-front-c'], ref: 0 },
];
const STAGES = ['dojo', 'city', 'mountain', 'bridge'];
const THUMBS = ['double-hit', 'combo-recall', 'stance-change'];

// ---------------------------------------------------------------------------
// ImageMagick の呼び出し
// ---------------------------------------------------------------------------

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} が失敗しました:\n${r.stderr}`);
  return r.stdout;
}
const convert = (args, input) => run('convert', args, input);

function dims(file) {
  const [w, h] = run('identify', ['-format', '%w %h', `${file}[0]`]).toString().trim().split(' ').map(Number);
  return { w, h };
}

/** 8 bit のグレースケール画素（幅 × 高さ） */
function readGray(file) {
  const { w, h } = dims(file);
  return { w, h, data: convert([file, '-colorspace', 'Gray', '-depth', '8', 'gray:-']) };
}

/** 8 bit の RGB 画素（幅 × 高さ × 3） */
function readRgb(file) {
  const { w, h } = dims(file);
  return { w, h, data: convert([file, '-depth', '8', 'rgb:-']) };
}

/** RGBA 画素を PNG に書く（extra で縮小など） */
function writeRgba(w, h, rgba, out, extra = []) {
  mkdirSync(dirname(out), { recursive: true });
  convert(['-size', `${w}x${h}`, '-depth', '8', 'rgba:-', ...extra, '-strip', out], rgba);
}

/** 元画像の場所（無ければ null。その素材は飛ばして知らせる） */
function raw(name) {
  for (const ext of ['jpg', 'png', 'jpeg', 'webp']) {
    const p = join(RAW, `${name}.${ext}`);
    if (existsSync(p)) return p;
  }
  console.log(`  （art-src/raw/${name}.jpg が無いので飛ばす）`);
  return null;
}

const kb = (file) => `${(statSync(file).size / 1024).toFixed(0)}KB`;
const log = (file, note = '') => console.log(`  ${relative(ROOT, file)}  ${kb(file)}${note ? `  ${note}` : ''}`);

// ---------------------------------------------------------------------------
// 画素の処理
// ---------------------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 白地の黒いシルエット → アルファ（黒 = 不透明、白 = 透明）。JPEG のにじみは lo〜hi の外を切り捨てて消す */
function inkAlpha(gray, lo = 0.18, hi = 0.82) {
  const a = new Uint8Array(gray.length);
  const l = lo * 255;
  const span = (hi - lo) * 255;
  for (let i = 0; i < gray.length; i++) a[i] = Math.round(255 * (1 - clamp01((gray[i] - l) / span)));
  return a;
}

/**
 * グリーンバック（#00ff00）抜き → RGBA。緑が他の 2 色よりどれだけ強いかでアルファを決め、
 * 半透明の縁は緑の混ざりを取り除く（混色の逆算）。
 */
function keyGreen(rgb, n, k = 140) {
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const a = 1 - clamp01((g - Math.max(r, b)) / k);
    let rr = r;
    let gg = g;
    let bb = b;
    if (a > 0.02 && a < 1) {
      rr = Math.min(255, r / a);
      bb = Math.min(255, b / a);
      gg = clamp01((g - (1 - a) * 255) / a / 255) * 255;
    } else if (a <= 0.02) {
      rr = gg = bb = 0;
    }
    out[i * 4] = Math.round(rr);
    out[i * 4 + 1] = Math.round(gg);
    out[i * 4 + 2] = Math.round(bb);
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/** 不透明な画素の外接矩形（無ければ null） */
function bbox(alpha, w, h, x0 = 0, x1 = w - 1, thr = 40) {
  let top = h;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = x0; x <= x1; x++) {
      if (alpha[o + x] > thr) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return bottom < 0 ? null : { x0: left, x1: right, y0: top, y1: bottom };
}

/**
 * 横一列に並んだ n 体を、空いている列（アルファがどの行でも薄い列）で分ける。
 * 近い区間（minGap 未満の隙間。ハチマキの先など）はつなぎ、それでも n より多ければ隙間の狭い順につなぐ。
 */
function splitColumns(alpha, w, h, n, { thr = 40, minGap = 24 } = {}) {
  const colMax = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) if (alpha[o + x] > colMax[x]) colMax[x] = alpha[o + x];
  }
  let runs = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const ink = x < w && colMax[x] > thr;
    if (ink && start < 0) start = x;
    if (!ink && start >= 0) {
      runs.push([start, x - 1]);
      start = -1;
    }
  }
  runs = runs.filter(([a, b]) => b - a >= 4);
  const merge = (k) => runs.splice(k, 2, [runs[k][0], runs[k + 1][1]]);
  for (let k = 0; k < runs.length - 1; ) {
    if (runs[k + 1][0] - runs[k][1] < minGap) merge(k);
    else k += 1;
  }
  while (runs.length > n) {
    let best = 0;
    for (let k = 1; k < runs.length - 1; k++) {
      if (runs[k + 1][0] - runs[k][1] < runs[best + 1][0] - runs[best][1]) best = k;
    }
    merge(best);
  }
  if (runs.length !== n) throw new Error(`${n} 体に分けられません（${runs.length} 個の区間: ${JSON.stringify(runs)}）`);
  return runs.map(([x0, x1]) => bbox(alpha, w, h, x0, x1, thr));
}

/** RGBA の切り出し（pad ぶん広げる）。色は固定（シルエット用） */
function cropInk(alpha, w, h, box, pad, ink = [0, 0, 0]) {
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(w - 1, box.x1 + pad);
  const y1 = Math.min(h - 1, box.y1 + pad);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const out = Buffer.alloc(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = (y * bw + x) * 4;
      out[o] = ink[0];
      out[o + 1] = ink[1];
      out[o + 2] = ink[2];
      out[o + 3] = alpha[(y + y0) * w + (x + x0)];
    }
  }
  return { w: bw, h: bh, data: out };
}

/** RGBA の切り出し（色はそのまま） */
function cropRgba(rgba, w, box, pad, h) {
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(w - 1, box.x1 + pad);
  const y1 = Math.min(h - 1, box.y1 + pad);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const out = Buffer.alloc(bw * bh * 4);
  for (let y = 0; y < bh; y++) rgba.copy(out, y * bw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4);
  return { w: bw, h: bh, data: out };
}

/** RGBA からアルファだけ取り出す */
function alphaOf(rgba, n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = rgba[i * 4 + 3];
  return a;
}

// ---------------------------------------------------------------------------
// 素材ごとの処理
// ---------------------------------------------------------------------------

const manifest = { sprites: {}, belts: [], stages: {}, ui: {} };

function fighters() {
  console.log('ファイター（シルエット）');
  for (const sheet of SHEETS) {
    const file = raw(sheet.src);
    if (!file) continue;
    const { w, h, data } = readGray(file);
    const alpha = inkAlpha(data);
    const boxes = splitColumns(alpha, w, h, sheet.sprites.length);
    const refH = boxes[sheet.ref].y1 - boxes[sheet.ref].y0 + 1;
    const scale = STANDING_HEIGHT / refH;
    sheet.sprites.forEach((name, k) => {
      const c = cropInk(alpha, w, h, boxes[k], 6);
      const tw = Math.max(1, Math.round(c.w * scale));
      const th = Math.max(1, Math.round(c.h * scale));
      const out = join(ART, 'fighters', `${name}.png`);
      // 黒一色＋アルファなので、256 色のパレット PNG にしても劣化しない（アルファの段階がそのまま色数になる）
      writeRgba(c.w, c.h, c.data, out, ['-filter', 'Lanczos', '-resize', `${tw}x${th}!`, '-colors', '255']);
      manifest.sprites[name] = { file: `fighters/${name}.png`, w: tw, h: th };
      log(out, `${tw}×${th}`);
    });
  }
}

function stages() {
  console.log('ステージ背景');
  for (const name of STAGES) {
    const src = raw(`stage-${name}`);
    if (!src) continue;
    const out = join(ART, 'stages', `${name}.jpg`);
    mkdirSync(dirname(out), { recursive: true });
    convert([src, '-resize', '1280x720^', '-gravity', 'center', '-extent', '1280x720', '-quality', '80', '-sampling-factor', '4:2:0', '-strip', out]);
    manifest.stages[name] = { file: `stages/${name}.jpg`, w: 1280, h: 720 };
    log(out);
  }
}

function ui() {
  console.log('UI');
  // ロゴ: グリーンバック抜き → 余白を切る → 幅 800
  const logoRaw = raw('logo-green');
  if (logoRaw) {
    const { w, h, data } = readRgb(logoRaw);
    const rgba = keyGreen(data, w * h);
    const box = bbox(alphaOf(rgba, w * h), w, h, 0, w - 1, 8);
    const c = cropRgba(rgba, w, box, 8, h);
    const tw = 800;
    const th = Math.round((c.h * tw) / c.w);
    const out = join(ART, 'ui', 'logo.png');
    // 表示は幅 300px 前後なので、ディザ付きの 255 色パレットで十分（326KB → 約 80KB）
    writeRgba(c.w, c.h, c.data, out, ['-filter', 'Lanczos', '-resize', `${tw}x${th}!`, '-dither', 'FloydSteinberg', '-colors', '255']);
    manifest.ui.logo = { file: 'ui/logo.png', w: tw, h: th };
    log(out, `${tw}×${th}`);
  }
  // キービジュアル: 幅 1200 の JPEG
  const heroRaw = raw('hero');
  if (heroRaw) {
    const out = join(ART, 'ui', 'hero.jpg');
    mkdirSync(dirname(out), { recursive: true });
    convert([heroRaw, '-resize', '1200x', '-quality', '82', '-sampling-factor', '4:2:0', '-strip', out]);
    const d = dims(out);
    manifest.ui.hero = { file: 'ui/hero.jpg', w: d.w, h: d.h };
    log(out, `${d.w}×${d.h}`);
  }
  // ゲームカードのサムネイル: 320 の JPEG（角丸は CSS で付ける）
  for (const g of THUMBS) {
    const src = raw(`thumb-${g}`);
    if (!src) continue;
    const out = join(ART, 'ui', `thumb-${g}.jpg`);
    mkdirSync(dirname(out), { recursive: true });
    convert([src, '-resize', '320x320!', '-quality', '85', '-sampling-factor', '4:2:0', '-strip', out]);
    manifest.ui[`thumb-${g}`] = { file: `ui/thumb-${g}.jpg`, w: 320, h: 320 };
    log(out);
  }
  // ベルト: グリーンバック抜き → 10 個に分ける → 同じ倍率で高さをそろえる
  const beltsRaw = raw('belts-green');
  if (beltsRaw) {
    const { w, h, data } = readRgb(beltsRaw);
    const rgba = keyGreen(data, w * h);
    const alpha = alphaOf(rgba, w * h);
    const boxes = splitColumns(alpha, w, h, 10, { thr: 24, minGap: 12 });
    const maxH = Math.max(...boxes.map((b) => b.y1 - b.y0 + 1));
    const scale = BELT_HEIGHT / maxH;
    boxes.forEach((box, k) => {
      const c = cropRgba(rgba, w, box, 4, h);
      const tw = Math.max(1, Math.round(c.w * scale));
      const th = Math.max(1, Math.round(c.h * scale));
      const out = join(ART, 'ui', `belt-${k}.png`);
      writeRgba(c.w, c.h, c.data, out, ['-filter', 'Lanczos', '-resize', `${tw}x${th}!`, '-dither', 'FloydSteinberg', '-colors', '255']);
      manifest.belts[k] = { file: `ui/belt-${k}.png`, w: tw, h: th };
      log(out, `${tw}×${th}`);
    });
  }
}

function icons() {
  console.log('アイコン');
  mkdirSync(ICONS, { recursive: true });
  const src = raw('icon');
  if (!src) return;
  for (const [name, size] of [
    ['icon-512.png', 512],
    ['icon-192.png', 192],
    // maskable: 元画像は中央 62% に主役を収めてあるので、そのまま（安全領域は中央 80%）
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    const out = join(ICONS, name);
    // 不透明なので 255 色のパレット PNG（512px で約 37KB。フルカラーだと約 250KB）
    convert([src, '-filter', 'Lanczos', '-resize', `${size}x${size}!`, '-dither', 'FloydSteinberg', '-colors', '255', '-strip', `png8:${out}`]);
    log(out);
  }
  // SVG のアイコンと favicon は 128px の PNG を埋め込む（ブラウザのタブと manifest の "any" 用。約 5KB）
  const small = convert([src, '-filter', 'Lanczos', '-resize', '128x128!', '-dither', 'FloydSteinberg', '-colors', '255', '-strip', 'png8:-']);
  const b64 = small.toString('base64');
  const svg = (rounded) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n` +
    (rounded ? `  <clipPath id="r"><rect width="512" height="512" rx="96"/></clipPath>\n` : '') +
    `  <image width="512" height="512"${rounded ? ' clip-path="url(#r)"' : ''} href="data:image/png;base64,${b64}"/>\n` +
    `</svg>\n`;
  writeFileSync(join(ICONS, 'icon.svg'), svg(false));
  writeFileSync(join(ROOT, 'public', 'favicon.svg'), svg(true));
  log(join(ICONS, 'icon.svg'));
  log(join(ROOT, 'public', 'favicon.svg'));
}

function writeManifest() {
  const entry = (v) => `{ file: '${v.file}', w: ${v.w}, h: ${v.h} }`;
  const lines = [
    '/**',
    ' * 画像素材の一覧と寸法。scripts/art/process.mjs が生成する（手で編集しない）。',
    ' * ファイルは public/art/ の下（URL は import.meta.env.BASE_URL + "art/" + file）。',
    ' */',
    '',
    'export interface ArtEntry {',
    '  file: string;',
    '  w: number;',
    '  h: number;',
    '}',
    '',
    '/** ファイター（黒いシルエット＋アルファ。立ち姿の高さを 640px にそろえてある） */',
    'export const ART_SPRITES = {',
    ...Object.entries(manifest.sprites).map(([k, v]) => `  '${k}': ${entry(v)},`),
    '} as const satisfies Record<string, ArtEntry>;',
    '',
    'export type SpriteKey = keyof typeof ART_SPRITES;',
    '',
    '/** ステージ背景（1280×720 の JPEG） */',
    'export const ART_STAGES = {',
    ...Object.entries(manifest.stages).map(([k, v]) => `  ${k}: ${entry(v)},`),
    '} as const satisfies Record<string, ArtEntry>;',
    '',
    'export type StageKey = keyof typeof ART_STAGES;',
    '',
    '/** UI の素材（ロゴ・キービジュアル・ゲームカードのサムネイル） */',
    'export const ART_UI = {',
    ...Object.entries(manifest.ui).map(([k, v]) => `  '${k}': ${entry(v)},`),
    '} as const satisfies Record<string, ArtEntry>;',
    '',
    '/** ベルト（0 白帯 … 9 黒帯二段）。無ければ空（CSS の色見本で代用する） */',
    'export const ART_BELTS: readonly ArtEntry[] = [',
    ...manifest.belts.map((v) => `  ${entry(v)},`),
    '];',
    '',
  ];
  writeFileSync(MANIFEST, lines.join('\n'));
  log(MANIFEST);
}

const only = new Set(process.argv.slice(2));
const want = (k) => only.size === 0 || only.has(k);
if (only.size > 0 && !existsSync(MANIFEST)) {
  throw new Error('一部だけ処理するには、先に全体を一度処理して art-manifest.ts を作ってください');
}
if (only.size > 0) {
  // 一部だけのときは、既存の manifest から他の項目を引き継ぐ
  const prev = readFileSync(MANIFEST, 'utf8');
  const pick = (re) => [...prev.matchAll(re)].map((m) => [m[1], { file: m[2], w: Number(m[3]), h: Number(m[4]) }]);
  const entries = /'?([\w-]+)'?: \{ file: '([^']+)', w: (\d+), h: (\d+) \}/g;
  for (const [k, v] of pick(entries)) {
    if (v.file.startsWith('fighters/')) manifest.sprites[k] = v;
    else if (v.file.startsWith('stages/')) manifest.stages[k] = v;
    else if (v.file.startsWith('ui/belt-')) manifest.belts[Number(v.file.match(/belt-(\d+)/)[1])] = v;
    else manifest.ui[k] = v;
  }
}
if (want('fighters')) fighters();
if (want('stages')) stages();
if (want('ui')) ui();
if (want('icons')) icons();
writeManifest();
