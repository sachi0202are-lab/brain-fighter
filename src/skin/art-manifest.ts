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
  'dh-plain-high': { file: 'fighters/dh-plain-high.png', w: 239, h: 647 },
  'dh-plain-mid': { file: 'fighters/dh-plain-mid.png', w: 236, h: 586 },
  'dh-plain-low': { file: 'fighters/dh-plain-low.png', w: 238, h: 586 },
  'dh-topknot-high': { file: 'fighters/dh-topknot-high.png', w: 240, h: 647 },
  'dh-topknot-mid': { file: 'fighters/dh-topknot-mid.png', w: 240, h: 600 },
  'dh-topknot-low': { file: 'fighters/dh-topknot-low.png', w: 240, h: 600 },
  'dh-broad-high': { file: 'fighters/dh-broad-high.png', w: 237, h: 647 },
  'dh-broad-mid': { file: 'fighters/dh-broad-mid.png', w: 238, h: 571 },
  'dh-broad-low': { file: 'fighters/dh-broad-low.png', w: 236, h: 571 },
  'dh-robe-high': { file: 'fighters/dh-robe-high.png', w: 231, h: 647 },
  'dh-robe-mid': { file: 'fighters/dh-robe-mid.png', w: 234, h: 581 },
  'dh-robe-low': { file: 'fighters/dh-robe-low.png', w: 236, h: 581 },
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
];
