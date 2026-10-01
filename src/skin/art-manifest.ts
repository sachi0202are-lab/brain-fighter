/**
 * 画像素材の一覧と寸法。scripts/art/process.mjs が生成する（手で編集しない）。
 * ファイルは public/art/ の下（URL は import.meta.env.BASE_URL + "art/" + file）。
 */

export interface ArtEntry {
  file: string;
  w: number;
  h: number;
}

/** ファイター（黒いシルエット＋アルファ。立ち姿の高さを 640px にそろえてある） */
export const ART_SPRITES = {
  'player-guard': { file: 'fighters/player-guard.png', w: 339, h: 651 },
  'player-strike': { file: 'fighters/player-strike.png', w: 648, h: 597 },
  'player-victory': { file: 'fighters/player-victory.png', w: 382, h: 770 },
  'enemy-guard': { file: 'fighters/enemy-guard.png', w: 478, h: 650 },
  'enemy-down': { file: 'fighters/enemy-down.png', w: 828, h: 209 },
  'enemy-front-a': { file: 'fighters/enemy-front-a.png', w: 310, h: 648 },
  'enemy-front-b': { file: 'fighters/enemy-front-b.png', w: 365, h: 668 },
  'enemy-front-c': { file: 'fighters/enemy-front-c.png', w: 298, h: 645 },
} as const satisfies Record<string, ArtEntry>;

export type SpriteKey = keyof typeof ART_SPRITES;

/** ステージ背景（1280×720 の JPEG） */
export const ART_STAGES = {
  dojo: { file: 'stages/dojo.jpg', w: 1280, h: 720 },
  city: { file: 'stages/city.jpg', w: 1280, h: 720 },
  mountain: { file: 'stages/mountain.jpg', w: 1280, h: 720 },
  bridge: { file: 'stages/bridge.jpg', w: 1280, h: 720 },
} as const satisfies Record<string, ArtEntry>;

export type StageKey = keyof typeof ART_STAGES;

/** UI の素材（ロゴ・キービジュアル・ゲームカードのサムネイル） */
export const ART_UI = {
  'logo': { file: 'ui/logo.png', w: 800, h: 321 },
  'hero': { file: 'ui/hero.jpg', w: 1200, h: 596 },
  'thumb-double-hit': { file: 'ui/thumb-double-hit.jpg', w: 320, h: 320 },
  'thumb-combo-recall': { file: 'ui/thumb-combo-recall.jpg', w: 320, h: 320 },
  'thumb-stance-change': { file: 'ui/thumb-stance-change.jpg', w: 320, h: 320 },
} as const satisfies Record<string, ArtEntry>;

/** ベルト（0 白帯 … 9 黒帯二段）。無ければ空（CSS の色見本で代用する） */
export const ART_BELTS: readonly ArtEntry[] = [
  { file: 'ui/belt-0.png', w: 80, h: 84 },
  { file: 'ui/belt-1.png', w: 81, h: 84 },
  { file: 'ui/belt-2.png', w: 81, h: 84 },
  { file: 'ui/belt-3.png', w: 81, h: 84 },
  { file: 'ui/belt-4.png', w: 81, h: 84 },
  { file: 'ui/belt-5.png', w: 81, h: 84 },
  { file: 'ui/belt-6.png', w: 81, h: 84 },
  { file: 'ui/belt-7.png', w: 81, h: 84 },
  { file: 'ui/belt-8.png', w: 81, h: 84 },
  { file: 'ui/belt-9.png', w: 81, h: 84 },
];
