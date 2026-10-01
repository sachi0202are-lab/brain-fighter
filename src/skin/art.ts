/**
 * 画像素材（public/art/）の読み込みと描画の補助。元は GPT Image 2.5 で生成した画像を
 * scripts/art/process.mjs で加工したもの（一覧と寸法は art-manifest.ts、プロンプトは art-src/PROMPTS.md）。
 *
 * - 読み込みは非同期、描画は同期（renderStimulus はフレームごとに同期で呼ばれる）。
 *   刺激領域で使う画像は、ラウンドの開始時点で読み込み済みのものだけを使う（freezeArtForRound / artInRound）。
 *   ラウンドの途中で見た目が変わらない（仕様書 4.2・9.5: 課題中に動く・変わる演出を置かない）。
 * - 画像が無い・読み込めない環境（Node のテスト、未キャッシュのオフライン）では null を返し、呼び出し側は図形の描画に戻る。
 * - ファイターは黒一色＋アルファのシルエットなので、使う場所の色に染めて描く（tinted）。
 * - ここにある画像はどれも静止画。ラウンド中に動かすものは無い。
 */
import { ART_BELTS, ART_SPRITES, ART_STAGES, ART_UI, type ArtEntry, type SpriteKey, type StageKey } from './art-manifest';

export { ART_BELTS, ART_SPRITES, ART_STAGES, ART_UI };
export type { ArtEntry, SpriteKey, StageKey };

/** 立ち姿の高さ (px)。process.mjs の STANDING_HEIGHT。各スプライトは「描きたい立ち姿の高さ ÷ この値」の倍率で描く */
export const SPRITE_STANDING_HEIGHT = 640;

/**
 * スプライトが向いている方向（1 = 右向き、−1 = 左向き、0 = 正面）。描くときの facing と違えば左右反転する。
 * enemy-down は頭が左の絵だが、右にいる敵が左の自キャラに倒されて後ろへ倒れる形（頭が右）にしたいので 1 とする。
 */
const NATURAL_FACING: Readonly<Record<SpriteKey, 1 | -1 | 0>> = {
  'player-guard': 1,
  'player-strike': 1,
  'player-victory': 1,
  'enemy-guard': -1,
  'enemy-down': 1,
  'enemy-front-a': 0,
  'enemy-front-b': 0,
  'enemy-front-c': 0,
};

export function artUrl(file: string): string {
  return `${import.meta.env.BASE_URL}art/${file}`;
}

export function spriteUrl(key: SpriteKey): string {
  return artUrl(ART_SPRITES[key].file);
}

/** ベルトのアイコン（無ければ null。CSS の色見本で代用する） */
export function beltUrl(belt: number): string | null {
  const e = ART_BELTS[belt];
  return e ? artUrl(e.file) : null;
}

const STAGE_KEYS: readonly StageKey[] = ['dojo', 'city', 'mountain', 'bridge'];

/** ステージ（敵レベルから決定的に選ぶ。backdrop.ts の遠景と同じ並び） */
export function stageKey(level: number): StageKey {
  return STAGE_KEYS[Math.abs(Math.round(level)) % STAGE_KEYS.length] as StageKey;
}

export function stageUrl(level: number): string {
  return artUrl(ART_STAGES[stageKey(level)].file);
}

const ENEMY_FRONT: readonly SpriteKey[] = ['enemy-front-a', 'enemy-front-b', 'enemy-front-c'];

/** 敵レベルから決める正面の敵（HUD のアバター用） */
export function enemyFrontSprite(level: number): SpriteKey {
  return ENEMY_FRONT[Math.abs(Math.round(level)) % ENEMY_FRONT.length] as SpriteKey;
}

// ---------------------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------------------

const loaded = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/** 画像を読む（同じファイルは 1 回だけ）。読めなければ null */
export function loadArt(file: string): Promise<HTMLImageElement | null> {
  const done = loaded.get(file);
  if (done) return Promise.resolve(done);
  const inFlight = pending.get(file);
  if (inFlight) return inFlight;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const finish = (): void => {
        loaded.set(file, img);
        resolve(img);
      };
      // 最初の drawImage で復号に時間がかからないように、先に復号しておく
      if (typeof img.decode === 'function') img.decode().then(finish, finish);
      else finish();
    };
    img.onerror = () => resolve(null);
    img.src = artUrl(file);
  });
  pending.set(file, promise);
  return promise;
}

/** 試合で使う画像（ファイター・ステージ）をまとめて先に読む（起動時に呼ぶ） */
export function preloadArt(): Promise<void> {
  const files = [...Object.values(ART_SPRITES), ...Object.values(ART_STAGES)].map((e) => e.file);
  return Promise.all(files.map(loadArt)).then(() => undefined);
}

/** 画像の取り出し方（読み込み済みのものを返すか null） */
export type ArtSource = (file: string) => HTMLImageElement | null;

/** いま読み込み済みの画像（無ければ null）。ラウンドの外（ラウンド間・結果画面）用 */
export const artNow: ArtSource = (file) => loaded.get(file) ?? null;

let frozen: ReadonlySet<string> = new Set();

/** ラウンドの開始時に呼ぶ: この時点で読み込み済みの画像だけを、ラウンド中（刺激領域）の描画に使う */
export function freezeArtForRound(): void {
  frozen = new Set(loaded.keys());
}

/** 刺激領域用: ラウンドの開始時に読み込み済みだった画像だけ（途中で読み終わった画像は次のラウンドから） */
export const artInRound: ArtSource = (file) => (frozen.has(file) ? (loaded.get(file) ?? null) : null);

export function spritesReady(keys: readonly SpriteKey[], source: ArtSource = artNow): boolean {
  return keys.every((k) => source(ART_SPRITES[k].file) !== null);
}

export function stageReady(level: number, source: ArtSource = artNow): boolean {
  return source(ART_STAGES[stageKey(level)].file) !== null;
}

// ---------------------------------------------------------------------------
// 染色（黒いシルエット → 使う場所の色）
// ---------------------------------------------------------------------------

type Bitmap = HTMLCanvasElement | OffscreenCanvas;

const tints = new Map<string, Bitmap>();

function makeCanvas(w: number, h: number): { canvas: Bitmap; ctx: CanvasRenderingContext2D } | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) return { canvas, ctx: ctx as unknown as CanvasRenderingContext2D };
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      if (typeof canvas.getContext !== 'function') return null;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) return { canvas, ctx };
    }
  } catch {
    /* 作れない環境では元の画像のまま使う */
  }
  return null;
}

/** シルエットを color に染めた画像（同じ組はキャッシュ）。染められない環境では元の画像 */
export function tinted(img: HTMLImageElement, file: string, color: string): CanvasImageSource {
  const key = `${file}|${color}`;
  const hit = tints.get(key);
  if (hit) return hit;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const made = makeCanvas(w, h);
  if (!made) return img;
  made.ctx.drawImage(img, 0, 0, w, h);
  made.ctx.globalCompositeOperation = 'source-in';
  made.ctx.fillStyle = color;
  made.ctx.fillRect(0, 0, w, h);
  tints.set(key, made.canvas);
  return made.canvas;
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

export interface SpriteDraw {
  /** 足元の x (CSS px) */
  x: number;
  /** 地面の y (CSS px) */
  ground: number;
  /** 立ち姿の高さ (CSS px)。どのポーズも同じ倍率で描く */
  height: number;
  /** 1 = 右向き、−1 = 左向き */
  facing: 1 | -1;
  color: string;
  /** 不透明度（残像用。既定 1） */
  alpha?: number;
}

/** スプライトを描く。読み込まれていなければ何も描かず false（呼び出し側は図形で描く） */
export function drawSprite(ctx: CanvasRenderingContext2D, key: SpriteKey, o: SpriteDraw, source: ArtSource = artNow): boolean {
  const entry = ART_SPRITES[key];
  const img = source(entry.file);
  if (!img) return false;
  const scale = o.height / SPRITE_STANDING_HEIGHT;
  const w = entry.w * scale;
  const h = entry.h * scale;
  const natural = NATURAL_FACING[key];
  const flip = natural !== 0 && natural !== o.facing;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
  ctx.translate(o.x, o.ground);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(tinted(img, entry.file, o.color), -w / 2, -h, w, h);
  ctx.restore();
  return true;
}

/**
 * ステージ背景の画像を描く（横いっぱいに合わせ、下端をそろえて床が見えるようにする）。
 * 画像が無ければ何も描かず false（呼び出し側が単色で塗る）。
 */
export function drawStageBackdrop(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; level: number },
  source: ArtSource = artNow,
): boolean {
  const entry = ART_STAGES[stageKey(o.level)];
  const img = source(entry.file);
  if (!img) return false;
  const s = Math.max(o.width / entry.w, o.height / entry.h);
  const w = entry.w * s;
  const h = entry.h * s;
  ctx.save();
  ctx.drawImage(img, (o.width - w) / 2, o.height - h, w, h);
  // 足元ほど暗くして、明るいシルエットを浮かせる（静的な膜。動かない）
  const g = ctx.createLinearGradient(0, 0, 0, o.height);
  g.addColorStop(0, 'rgba(8, 10, 20, 0.12)');
  g.addColorStop(1, 'rgba(8, 10, 20, 0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, o.width, o.height);
  ctx.restore();
  return true;
}
