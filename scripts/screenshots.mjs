#!/usr/bin/env node
/**
 * README 用のスクリーンショットを撮る（モバイル 390×844・deviceScaleFactor 2 の PNG → docs/screenshots/）。
 *
 *   npm run build && npm run screenshots
 *
 * - 本番ビルド（dist/）を `vite preview` で配信して撮る（PORT、既定 4178）。すでに起動しているなら BASE_URL を渡す:
 *   BASE_URL=http://localhost:4178/brain-fighter/ npm run screenshots
 * - 画面は `?test=1&seed=1` と window.__bfTest（src/ui/test-hooks.ts）で進める。ホーム・記録などは
 *   サンプルの保存データ（sampleSave: 直近 2 週間の訓練 9 日ぶん = 3 ゲーム × 1 試合 1 ラウンドと認定戦 4 回）を入れてから撮る。
 * - 刺激の提示中の画面は、requestAnimationFrame を一時的に止めて撮る（提示は 0.3〜0.5 秒しかないため）。
 *   止めた試行の時間は記録として意味が無いが、撮影用のブラウザの中だけのデータなので構わない。
 * - PNG は撮ったあと可逆のまま圧縮し直す（フィルタと zlib の設定を選び直すだけ。画素は変えない）。
 * - Playwright の同梱ブラウザが無ければ /opt/pw-browsers/chromium（または PW_CHROMIUM_PATH）を使う。
 * - E2E（npm run test:e2e）と同時に走らせない（負荷で E2E のタイミング照合が落ちることがある）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as zc, deflateSync, inflateSync } from 'node:zlib';
import { chromium, devices } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4178);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}/brain-fighter/`;
const OUT = join(ROOT, process.env.OUT ?? 'docs/screenshots');
/** これより大きい PNG は警告する（README に貼るので軽く保つ） */
const MAX_BYTES = 200 * 1024;

const MOBILE = {
  ...devices['Pixel 7'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  serviceWorkers: 'block',
  locale: 'ja-JP',
};

function chromiumExecutable() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* 同梱ブラウザの場所が分からない */
  }
  return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

// ---------------------------------------------------------------------------
// 配信
// ---------------------------------------------------------------------------

async function reachable(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function startPreview() {
  if (process.env.BASE_URL) return null;
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    throw new Error('dist/ がありません。先に npm run build を実行してください。');
  }
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout.resume();
  for (let k = 0; k < 100; k++) {
    if (await reachable(BASE_URL)) return child;
    if (child.exitCode !== null) throw new Error(`vite preview が終了しました（ポート ${PORT} が使用中かもしれません）`);
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`vite preview が ${BASE_URL} で応答しません`);
}

// ---------------------------------------------------------------------------
// サンプルの保存データ（仕様書 第8節の形）。各ゲームの適応ルールと戦闘力の式どおりに作る
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

function localDay(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 決定的な小さな乱数（サンプルの揺らぎ用） */
function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

function sampleSave(now = Date.now()) {
  // 乱数の種は、ダブルヒットが 8 日目にステージ 1 へ上がる推移になるものを選んだ（刺激のスクリーンショットに妨害図形が出る）
  const r = rand(20260996);
  const noise = (w) => (r() * 2 - 1) * w;
  // 訓練した日（何日前）
  const daysAgo = [13, 12, 10, 9, 8, 6, 5, 3, 1];
  const at = (ago, hour, min) => {
    const d = new Date(now - ago * DAY);
    d.setHours(hour, min, 0, 0);
    return d.getTime();
  };
  const rounds = [];
  const sessions = [];
  const ln = Math.log(500 / 33);
  const dh = { T: 300, stage: 0 };
  let n = 1;
  let step = 1;
  const orders = [
    ['double-hit', 'combo-recall', 'stance-change'],
    ['combo-recall', 'stance-change', 'double-hit'],
    ['stance-change', 'double-hit', 'combo-recall'],
  ];
  daysAgo.forEach((ago, dayIdx) => {
    const order = orders[dayIdx % 3];
    let t = at(ago, 20, 5);
    sessions.push({ id: `s${dayIdx}`, startedAt: new Date(t).toISOString(), endedAt: new Date(t + 5 * 60_000).toISOString(), order, done: [...order] });
    for (const gameId of order) {
      // 1 試合 = 1 ラウンド（仕様書 v1.2。3 ゲームとも）。難度はラウンド（= 試合）ごとに適応して次の日へ引き継ぐ
      const matchId = `m-${gameId}-${dayIdx}`;
      const roundNo = 1;
      t += 100_000;
      let rec;
      if (gameId === 'double-hit') {
        // 試行単位の階段法の結果（ラウンド末の T）。T が下限付近で正答率 80% 以上ならステージを上げて T = 100（1 試合で最大 1 段）
        const start = { ...dh };
        const correct = clamp(Math.round(24 * (0.77 + noise(0.07))), 0, 24);
        dh.T = clamp(dh.T * (dh.stage === 0 ? 0.78 + noise(0.05) : 0.92 + noise(0.03)), 33, 500);
        const power = Math.round(200 * dh.stage + (200 * Math.log(500 / dh.T)) / ln);
        if (dh.T < 42 && correct / 24 >= 0.8 && dh.stage < 4) {
          dh.stage += 1;
          dh.T = 100;
        }
        rec = { trials: 24, correct, paramsStart: { T: round1(start.T), stage: start.stage }, paramsEnd: { T: round1(dh.T), stage: dh.stage }, power, errors: { dir: 24 - correct } };
      } else if (gameId === 'combo-recall') {
        const trials = 20 + n;
        const errors = clamp(Math.round(1.6 + 0.8 * n + noise(1.6)), 0, trials);
        const sub = clamp((5 - errors) / 3, 0, 1);
        const power = Math.round((1000 * (n - 1 + sub)) / 9);
        const start = n;
        if (errors < 3) n = Math.min(9, n + 1);
        else if (errors > 5) n = Math.max(1, n - 1);
        rec = { trials, correct: trials - errors, paramsStart: { n: start }, paramsEnd: { n }, power, errors: { miss: Math.ceil(errors / 2), fa: Math.floor(errors / 2) } };
      } else {
        // スタンスチェンジは 1 ラウンド 16 試行（仕様書 v1.3。15 正答以上で +1、11 正答以下で −1）
        const trials = 16;
        const acc = clamp(0.885 - 0.012 * step + noise(0.06), 0.5, 1);
        const correct = Math.round(trials * acc);
        const a = correct / trials;
        const sub = clamp((a - 0.75) / 0.15, 0, 1);
        const power = Math.round((1000 * (step - 1 + sub)) / 20);
        const start = step;
        if (a >= 0.9) step = Math.min(20, step + 1);
        else if (a < 0.75) step = Math.max(1, step - 1);
        rec = { trials, correct, paramsStart: { step: start }, paramsEnd: { step }, power, errors: { switch: Math.ceil((trials - correct) / 2), repeat: Math.floor((trials - correct) / 2) } };
      }
      rounds.push({
        id: `r-${gameId}-${dayIdx}-${roundNo}`,
        gameId,
        startedAt: new Date(t).toISOString(),
        fx: 'light',
        ...rec,
        power: clamp(rec.power, 0, 1000),
        matchId,
        roundNo,
        maxCombo: Math.min(rec.correct, 5 + Math.floor(r() * 9)),
      });
    }
  });
  const trainingDays = daysAgo.map((ago) => localDay(now - ago * DAY)).sort();
  // 認定戦: 訓練 3 日目（10 日前）以降に 1 回目、その 7 日以上あとに 2 回目。スタンスチェンジはまだ受けていない（挑める）
  const cert = (ago) => new Date(at(ago, 21, 0)).toISOString();
  const certs = [
    { id: 'c1', gameId: 'double-hit', at: cert(10), tier: 1, rounds: [{ trials: 24, correct: 20 }, { trials: 24, correct: 21 }], passed: true },
    { id: 'c2', gameId: 'combo-recall', at: cert(9), tier: 1, rounds: [{ trials: 21, correct: 19 }, { trials: 21, correct: 18 }], passed: true },
    { id: 'c3', gameId: 'double-hit', at: cert(3), tier: 2, rounds: [{ trials: 24, correct: 19 }, { trials: 24, correct: 17 }], passed: false },
    { id: 'c4', gameId: 'combo-recall', at: cert(1), tier: 2, rounds: [{ trials: 22, correct: 19 }, { trials: 22, correct: 20 }], passed: true },
  ];
  return {
    version: 1,
    createdAt: new Date(now - 14 * DAY).toISOString(),
    settings: { fx: 'light', sound: false, colorSafe: false },
    games: {
      'double-hit': { state: { T: round1(dh.T), stage: dh.stage }, belt: 1, lastCertAt: cert(3), trainingDays },
      'combo-recall': { state: { n }, belt: 2, lastCertAt: cert(1), trainingDays },
      'stance-change': { state: { step }, belt: 0, trainingDays },
    },
    rounds,
    certs,
    trials: [],
    sessions,
    onboardedAt: new Date(now - 14 * DAY).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// PNG を可逆のまま小さくする（8bit・非インターレースの RGB / RGBA だけ。ほかはそのまま）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function optimizePng(buf) {
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (!ihdr) return buf;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [depth, ctype, , , interlace] = [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]];
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) return buf;
  let bpp = ctype === 6 ? 4 : 3;
  let stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  let px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const lo = y * (stride + 1) + 1;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0;
      const b = y > 0 ? px[o - stride + x] : 0;
      const c = y > 0 && x >= bpp ? px[o - stride + x - bpp] : 0;
      let v = raw[lo + x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      px[o + x] = v & 255;
    }
  }
  // 全面不透明の RGBA は RGB にする
  let outType = ctype;
  if (ctype === 6) {
    let opaque = true;
    for (let i = 3; i < px.length && opaque; i += 4) opaque = px[i] === 255;
    if (opaque) {
      const rgb = Buffer.alloc(width * height * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        rgb[j] = px[i];
        rgb[j + 1] = px[i + 1];
        rgb[j + 2] = px[i + 2];
      }
      px = rgb;
      bpp = 3;
      stride = width * 3;
      outType = 2;
    }
  }
  // 画面のスクリーンショットは平らな色が多いので、フィルタ無しが一番小さいことが多い。いくつか試して最小を選ぶ
  let best = null;
  for (const ft of [0, 1, 2]) {
    const out = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
      const o = y * stride;
      const lo = y * (stride + 1);
      out[lo] = ft;
      for (let x = 0; x < stride; x++) {
        const p = ft === 0 ? 0 : ft === 1 ? (x >= bpp ? px[o + x - bpp] : 0) : y > 0 ? px[o - stride + x] : 0;
        out[lo + 1 + x] = (px[o + x] - p) & 255;
      }
    }
    for (const strategy of [zc.Z_DEFAULT_STRATEGY, zc.Z_FILTERED]) {
      const z = deflateSync(out, { level: 9, memLevel: 9, strategy });
      if (!best || z.length < best.length) best = z;
    }
  }
  const head = Buffer.from(ihdr);
  head[9] = outType;
  const png = Buffer.concat([buf.subarray(0, 8), chunk('IHDR', head), chunk('IDAT', best), chunk('IEND', Buffer.alloc(0))]);
  return png.length < buf.length ? png : buf;
}

// ---------------------------------------------------------------------------
// 撮影の道具
// ---------------------------------------------------------------------------

const saved = [];

async function shot(page, name, opts = {}) {
  const path = join(OUT, `${name}.png`);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide', ...opts });
  writeFileSync(path, optimizePng(png));
  const bytes = statSync(path).size;
  saved.push({ name, bytes });
  const warn = bytes > MAX_BYTES ? `  ← ${Math.round(MAX_BYTES / 1024)}KB を超えています` : '';
  console.log(`  ${relative(ROOT, path)}  ${(bytes / 1024).toFixed(0)}KB（撮影時 ${(png.length / 1024).toFixed(0)}KB）${warn}`);
}

/**
 * requestAnimationFrame を包み、条件（ラウンドの snapshot に対する式）を満たしたフレームの直後から
 * rAF のコールバックを止められるようにする（刺激の提示中の画面を撮るため）。
 */
async function installFreeze(page) {
  await page.evaluate(() => {
    if (window.__shot) return;
    const raf = window.requestAnimationFrame.bind(window);
    const shotState = { freeze: false, want: null, held: [] };
    window.__shot = shotState;
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        if (shotState.freeze) {
          shotState.held.push(cb);
          return;
        }
        cb(t);
        if (shotState.want) {
          const s = window.__bfTest.state().snapshot;
          if (s && shotState.want(s)) {
            shotState.freeze = true;
            shotState.want = null;
          }
        }
      });
  });
}

/** 条件を満たすフレームで止める（例 "s.phase === 'stimulus' && s.i === 2"） */
async function freezeWhen(page, expr, timeout = 180_000) {
  await page.evaluate((e) => {
    window.__shot.want = new Function('s', `return (${e});`);
  }, expr);
  await page.waitForFunction(() => window.__shot.freeze, undefined, { timeout, polling: 50 });
}

async function unfreeze(page) {
  await page.evaluate(() => {
    const s = window.__shot;
    s.freeze = false;
    for (const cb of s.held.splice(0)) window.requestAnimationFrame(cb);
  });
}

/** 実行中のラウンドの snapshot が条件を満たすまで待つ */
async function waitSnapshot(page, expr, timeout = 180_000) {
  await page.waitForFunction(
    (e) => {
      const s = window.__bfTest.state().snapshot;
      return s !== null && new Function('s', `return (${e});`)(s);
    },
    expr,
    { timeout, polling: 20 },
  );
}

/**
 * 結果画面まで進める。3 ゲームとも 1 試合 1 ラウンド（仕様書 v1.2）なのでラウンド間の画面は出ないが、
 * 出たときは「次のラウンドへ」を押す（「もう1ラウンド」は選ばない）。
 */
async function playToResult(page) {
  const any = page.locator('[data-testid="next-round"], [data-testid="to-result"], [data-testid="result"]');
  for (let guard = 0; guard < 20; guard++) {
    await any.first().waitFor({ state: 'visible', timeout: 300_000 });
    if (await page.getByTestId('result').isVisible()) return;
    if (await page.getByTestId('to-result').isVisible()) await page.getByTestId('to-result').click();
    else await page.getByTestId('next-round').click().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 撮影
// ---------------------------------------------------------------------------

async function run(browser) {
  mkdirSync(OUT, { recursive: true });
  const url = (path) => new URL(path, BASE_URL).href;

  // ---- 初回の案内（記録なし・?test=1 なし） ----
  {
    const ctx = await browser.newContext(MOBILE);
    const page = await ctx.newPage();
    await page.goto(url('./#/'));
    await page.getByTestId('welcome').waitFor();
    await shot(page, '01-onboarding');
    await ctx.close();
  }

  const ctx = await browser.newContext(MOBILE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // ---- ホーム（サンプルの記録入り） ----
  await page.goto(url('./?test=1&seed=1#/'));
  await page.evaluate((json) => localStorage.setItem('brain-fighter.v1', json), JSON.stringify(sampleSave()));
  await page.reload();
  await page.getByTestId('total-power').waitFor();
  await shot(page, '02-home');

  // ---- ダブルヒット: 刺激の提示中 → 応答画面 → 最後まで遊んで結果画面（1 ラウンドの一本勝負で KO） ----
  await page.goto(url('./?test=1&seed=1#/play/double-hit'));
  await page.getByTestId('start').waitFor();
  await installFreeze(page);
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60, correct: () => true }));
  await page.getByTestId('start').click();
  await waitSnapshot(page, "s.kind === 'round' && s.i === 1 && s.phase === 'fixation'");
  await page.evaluate(() => window.__bfTest.stopAutoplay());
  await freezeWhen(page, "s.kind === 'round' && s.i === 1 && s.phase === 'stimulus'");
  await shot(page, '03-double-hit-stimulus');
  await unfreeze(page);
  // 応答画面: 火花の方向だけ選んだところ（構えはまだ）
  await waitSnapshot(page, "s.i === 1 && s.phase === 'response'");
  const expected = await page.evaluate(() => window.__bfTest.expected());
  await page.evaluate((dir) => window.__bfTest.press(dir), expected.dir);
  await freezeWhen(page, "s.phase === 'response' && s.selection.dir !== undefined");
  await shot(page, '04-double-hit-response');
  await unfreeze(page);
  await page.evaluate((stance) => window.__bfTest.press(stance), expected.stance);
  // 残りは 5 試行に1回誤る疑似プレイヤー（正答率 80%）
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60 }));
  await playToResult(page);
  await page.getByTestId('result').waitFor();
  await page.evaluate(() => window.__bfTest.stopAutoplay());
  await shot(page, '07-result-ko');

  // ---- コンボ・リコール（点灯中） ----
  await page.goto(url('./?test=1&seed=1#/play/combo-recall'));
  await page.getByTestId('start').waitFor();
  await installFreeze(page);
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60, correct: () => true }));
  await page.getByTestId('start').click();
  await waitSnapshot(page, "s.i === 2 && s.phase === 'response'");
  await page.evaluate(() => window.__bfTest.stopAutoplay());
  await freezeWhen(page, "s.i === 3 && s.phase === 'stimulus'");
  await shot(page, '05-combo-recall');
  await unfreeze(page);

  // ---- スタンスチェンジ（構え = 手がかり ＋ 攻撃アイコン。1 試合 1 ラウンドでウォームアップは無い） ----
  await page.goto(url('./?test=1&seed=1#/play/stance-change'));
  await page.getByTestId('start').waitFor();
  await installFreeze(page);
  await page.evaluate(() => window.__bfTest.autoplay({ delayMs: 60, correct: () => true }));
  await page.getByTestId('start').click();
  await waitSnapshot(page, "s.kind === 'round' && s.i === 2 && s.phase === 'cue'");
  await page.evaluate(() => window.__bfTest.stopAutoplay());
  await freezeWhen(page, "s.kind === 'round' && s.i === 2 && s.phase === 'stimulus'");
  await shot(page, '06-stance-change');
  await unfreeze(page);

  // ---- 記録（上: 総合戦闘力・ゲーム別 ／ 下: ベルト = 認定戦の結果の別グラフ） ----
  await page.goto(url('./?test=1&seed=1#/records'));
  await page.getByTestId('records').waitFor();
  await shot(page, '08-records');
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="belts-now"]');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12);
  });
  await shot(page, '09-records-belt');

  // ---- 認定戦（昇段審査）の説明と選択 ----
  await page.goto(url('./?test=1&seed=1#/cert'));
  await page.getByTestId('cert').waitFor();
  await shot(page, '10-cert');

  // ---- 設定 ----
  await page.goto(url('./?test=1&seed=1#/settings'));
  await page.getByTestId('settings').waitFor();
  await shot(page, '11-settings');

  if (errors.length > 0) throw new Error(`ページのエラー: ${errors.join(' / ')}`);
  await ctx.close();

  // ---- ブログ記事に埋め込んだところ（第11節のコード。公開 URL は手元の配信へ振り向ける） ----
  {
    const blog = await browser.newContext(MOBILE);
    await blog.route(
      (u) => u.hostname === 'blog.example.test',
      (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: blogPage() }),
    );
    await blog.route(
      (u) => u.hostname === 'sachi0202are-lab.github.io',
      async (route) => {
        const u = new URL(route.request().url());
        const response = await route.fetch({ url: new URL(u.pathname + u.search, BASE_URL).href });
        await route.fulfill({ response });
      },
    );
    const bp = await blog.newPage();
    await bp.goto('https://blog.example.test/2026/09/brain-fighter/');
    const frame = bp.frameLocator('iframe[title="Brain Fighter"]');
    await frame.getByTestId('welcome').waitFor();
    await frame.getByTestId('welcome-next').click();
    await frame.getByTestId('welcome-next').click();
    await frame.getByTestId('welcome-start').click();
    await frame.getByTestId('embed-note').waitFor();
    await shot(bp, '12-embed');
    await blog.close();
  }
}

/** ブログ記事の代わり（WordPress の「カスタム HTML」ブロックに第11節のコードを貼った状態） */
function blogPage() {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ブログ記事（埋め込みの例）</title></head>
<body style="margin:0;padding:16px;font-family:sans-serif;background:#f6f4ef;color:#222;line-height:1.7">
<h1 style="font-size:20px;margin:0 0 8px">ミニゲームを遊んでみた</h1>
<p style="margin:0 0 12px;font-size:14px">記事の本文。下のミニゲームはこの記事の中で遊べます。</p>
<div style="max-width:420px;margin:0 auto;aspect-ratio:9/16;">
  <iframe src="https://sachi0202are-lab.github.io/brain-fighter/embed/"
          style="width:100%;height:100%;border:0;border-radius:12px;"
          allow="fullscreen" loading="lazy" title="Brain Fighter"></iframe>
</div>
<p style="text-align:center"><a href="https://sachi0202are-lab.github.io/brain-fighter/" target="_blank" rel="noopener">全画面で開く</a></p>
</body></html>`;
}

const server = await startPreview();
const executablePath = chromiumExecutable();
// 別オリジンの iframe（ブログ埋め込み）も同じプロセスで deviceScaleFactor どおりに描かせる
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'],
});
try {
  console.log(`スクリーンショット → ${relative(ROOT, OUT)}/（${BASE_URL}）`);
  await run(browser);
  const over = saved.filter((s) => s.bytes > MAX_BYTES);
  console.log(`${saved.length} 枚${over.length > 0 ? `（${over.length} 枚が ${MAX_BYTES / 1024}KB 超）` : ''}`);
} finally {
  await browser.close();
  server?.kill();
}
