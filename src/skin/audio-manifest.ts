/**
 * 音の一覧と長さ。scripts/audio/process.mjs が生成する（手で編集しない）。
 * ファイルは public/audio/ の下（URL は import.meta.env.BASE_URL + "audio/" + file）。
 */

/** 効果音（モノラル。短い音は WAV、ほかは MP3）。ms は長さ。hit / miss は正誤の 1 ビット（90 ms 以内） */
export const AUDIO_SFX = {
  'hit': { file: 'sfx/hit.wav', ms: 90 },
  'miss': { file: 'sfx/miss.wav', ms: 90 },
  'round-start': { file: 'sfx/round-start.mp3', ms: 1541 },
  'ko': { file: 'sfx/ko.mp3', ms: 1829 },
  'perfect': { file: 'sfx/perfect.mp3', ms: 2038 },
  'decision': { file: 'sfx/decision.mp3', ms: 1541 },
  'impact': { file: 'sfx/impact.mp3', ms: 836 },
  'victory': { file: 'sfx/victory.mp3', ms: 3030 },
} as const;

export type SfxName = keyof typeof AUDIO_SFX;

/** BGM（ステレオ MP3）。sec は長さ。ループは末尾と先頭を重ねてつなぐ */
export const AUDIO_BGM = {
  menu: { file: 'bgm/menu.mp3', sec: 60.1 },
  battle: { file: 'bgm/battle.mp3', sec: 90.1 },
} as const;

export type BgmTrack = keyof typeof AUDIO_BGM;
