#!/usr/bin/env node
/**
 * プレースホルダーのアプリアイコンを生成する（外部素材・追加の依存なし）。
 * 紺の背景に橙の円と白い稲妻。PNG は Node 標準の zlib で書き出す。
 *   node scripts/gen-icons.mjs  → public/icons/*.png, public/icons/icon.svg, public/favicon.svg
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [0x0e, 0x11, 0x20];
const DISC = [0xff, 0x7a, 0x3d];
const BOLT = [0xf3, 0xf5, 0xff];
// 稲妻（中心 0,0・半径 1 の座標）
const BOLT_PTS = [
  [0.16, -0.64],
  [-0.32, 0.1],
  [-0.03, 0.1],
  [-0.17, 0.64],
  [0.32, -0.12],
  [0.03, -0.12],
];

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** scale = 円の半径（画像の半分に対する比率） */
function render(size, scale) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;
          let c = BG;
          if (u * u + v * v <= scale * scale) c = DISC;
          if (inPoly(u / scale, v / scale, BOLT_PTS)) c = BOLT;
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const k = (y * size + x) * 4;
      px[k] = Math.round(acc[0] / (ss * ss));
      px[k + 1] = Math.round(acc[1] / (ss * ss));
      px[k + 2] = Math.round(acc[2] / (ss * ss));
      px[k + 3] = 255;
    }
  }
  return px;
}

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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  // maskable: 中央 80% の安全領域に収める
  ['icon-maskable-512.png', 512, 0.62],
  ['apple-touch-icon.png', 180, 0.72],
];
for (const [name, size, scale] of files) {
  writeFileSync(join(outDir, name), png(size, render(size, scale)));
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const boltPath = (r) =>
  `M${BOLT_PTS.map(([x, y]) => `${(256 + x * r).toFixed(1)},${(256 + y * r).toFixed(1)}`).join(' L')} Z`;
const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512"${rounded ? ' rx="96"' : ''} fill="${hex(BG)}"/>
  <circle cx="256" cy="256" r="${0.8 * 256}" fill="${hex(DISC)}"/>
  <path d="${boltPath(0.8 * 256)}" fill="${hex(BOLT)}"/>
</svg>
`;
writeFileSync(join(outDir, 'icon.svg'), svg(false));
writeFileSync(join(root, 'public', 'favicon.svg'), svg(true));
console.log(`icons written to ${outDir}`);
