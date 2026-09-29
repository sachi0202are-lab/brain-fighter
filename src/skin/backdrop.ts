/**
 * Full の静的なカスタム背景（仕様書 9.1「静的なカスタム背景」・9.2「ステージごとに単色の背景」）。
 *
 * ステージ（敵レベル）ごとに、遠景のシルエット（屋根・街・山・橋）を SVG で描いて CSS の背景にする。
 * - 動かない（ラウンドの開始時に決まり、ラウンド中は変わらない）。点滅・アニメーションなし。
 * - 画面の下端（応答ボタンの後ろ）にだけ置く。刺激領域には重ならない（styles: skin.css）。
 * - 外部画像素材は使わない（図形だけ）。乱数も使わない（レベルから決定的に作る）。
 */
import { stageHue } from './fighter';

export const BACKDROP_VARIANTS = 4;

/** 0..1 の決定的な値（同じ入力なら同じ値） */
function wave(k: number, seed: number): number {
  const x = Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function skyline(variant: number, seed: number, base: number, scale: number): string {
  const W = 480;
  if (variant === 0) {
    // 屋根の連なり（道場）
    let d = '';
    for (let x = -20; x < W + 40; x += 96) {
      const h = base - (26 + 18 * wave(x, seed)) * scale;
      d += `M${x} ${base}L${x + 10} ${h + 14 * scale}L${x + 4} ${h + 14 * scale}L${x + 44} ${h}L${x + 84} ${h + 14 * scale}L${x + 78} ${h + 14 * scale}L${x + 88} ${base}Z`;
    }
    return d;
  }
  if (variant === 1) {
    // 街のビル
    let d = '';
    for (let x = 0; x < W; x += 30) {
      const w = 22 + 8 * wave(x, seed);
      const h = (24 + 60 * wave(x + 3, seed)) * scale;
      d += `M${x} ${base}V${base - h}H${x + w}V${base}Z`;
    }
    return d;
  }
  if (variant === 2) {
    // 山並み
    let d = `M0 ${base}`;
    for (let x = 0; x <= W; x += 60) {
      const peak = base - (30 + 50 * wave(x, seed)) * scale;
      d += `L${x + 30} ${peak}L${x + 60} ${base - (8 + 10 * wave(x + 1, seed)) * scale}`;
    }
    return `${d}L${W} ${base}Z`;
  }
  // 橋のアーチ
  const top = base - 46 * scale;
  let d = `M0 ${top}H${W}V${top + 8 * scale}H0Z`;
  for (let x = 0; x < W; x += 80) {
    d += `M${x} ${base}V${top + 8 * scale}H${x + 12}V${base}Z`;
    d += `M${x + 12} ${top + 8 * scale}Q${x + 46} ${top + 40 * scale} ${x + 80} ${top + 8 * scale}`;
  }
  return d;
}

/** 背景の SVG（幅 480・高さ 160 の座標。下端合わせで引き伸ばす） */
export function backdropSvg(level: number): string {
  const lv = Math.abs(Math.round(level));
  const variant = lv % BACKDROP_VARIANTS;
  const hue = stageHue(level);
  const far = skyline(variant, lv + 7, 150, 1.25);
  const near = skyline((variant + 1) % BACKDROP_VARIANTS, lv, 160, 0.8);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 160" preserveAspectRatio="xMidYMax slice">` +
    `<path d="${far}" fill="hsl(${hue} 30% 24%)" fill-opacity="0.55"/>` +
    `<path d="${near}" fill="hsl(${hue} 35% 13%)" fill-opacity="0.85" stroke="hsl(${hue} 35% 13%)" stroke-opacity="0.85"/>` +
    `<rect x="0" y="152" width="480" height="8" fill="hsl(${hue} 25% 9%)"/>` +
    `</svg>`
  );
}

/** CSS の background-image に入れる値 */
export function backdropUrl(level: number): string {
  return `url("data:image/svg+xml,${encodeURIComponent(backdropSvg(level))}")`;
}
