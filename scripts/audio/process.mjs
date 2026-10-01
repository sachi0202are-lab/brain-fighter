#!/usr/bin/env node
/**
 * 生成した音（audio-src/raw/*.mp3）を、アプリで使う形に加工する:
 *   public/audio/sfx/*.mp3  … 効果音（頭の無音を切り、長さをそろえ、ピークを -1 dBFS に合わせる。モノラル 64 kbps）
 *   public/audio/bgm/*.mp3  … BGM（頭の無音を切り、短いフェードインを付け、ピークを -2 dBFS に合わせる。ステレオ 32 kHz 96 kbps）
 *   src/skin/audio-manifest.ts … 一覧と長さ（アプリは読み込み前に長さを知れる）
 *
 * ffmpeg / ffprobe が要る。
 *   node scripts/audio/process.mjs          # すべて
 *   node scripts/audio/process.mjs sfx      # 種類を絞る（sfx / bgm）
 *
 * 元の音は ../genspark-audio/gen.sh（ElevenLabs の効果音・音楽モデル）で生成したもの（プロンプトは audio-src/PROMPTS.md）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'audio-src', 'raw');
const OUT = join(ROOT, 'public', 'audio');
const MANIFEST = join(ROOT, 'src', 'skin', 'audio-manifest.ts');

/**
 * 効果音。ms = 出し終わる長さの上限（これより長い音は切ってフェードアウト）。
 * hit / miss は正誤の 1 ビット（仕様書 4.5「300 ms 以内、次の刺激が出る前に消える」。HUD は残り 120 ms 未満なら鳴らさない）なので 90 ms。
 */
const SFX = {
  hit: { ms: 90, fadeMs: 25 },
  miss: { ms: 90, fadeMs: 25 },
  'round-start': { ms: 1500, fadeMs: 300 },
  ko: { ms: 1800, fadeMs: 300 },
  perfect: { ms: 2000, fadeMs: 300 },
  decision: { ms: 1500, fadeMs: 400 },
  impact: { ms: 800, fadeMs: 150 },
  victory: { ms: 3000, fadeMs: 400 },
};

/** BGM。ループはアプリ側で末尾と先頭を重ねてつなぐ（skin/sound.ts）ので、ここでは頭の無音とフェードインだけ */
const BGM = {
  menu: {},
  battle: {},
};

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} が失敗しました:\n${r.stderr}`);
  return `${r.stdout}\n${r.stderr}`;
}

function raw(name) {
  const p = join(RAW, `${name}.mp3`);
  if (existsSync(p)) return p;
  console.log(`  （audio-src/raw/${name}.mp3 が無いので飛ばす）`);
  return null;
}

/** 秒（ffprobe） */
function durationSec(file) {
  const out = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.trim());
}

/** フィルタを通したあとの最大音量 (dBFS)。ピークを合わせるための 1 回目のパス */
function peakDb(file, filters) {
  const out = run('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', `${filters},volumedetect`, '-f', 'null', '-']);
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(out);
  if (!m) throw new Error(`音量を測れません: ${file}`);
  return Number(m[1]);
}

const kb = (file) => `${(statSync(file).size / 1024).toFixed(0)}KB`;
const log = (file, note = '') => console.log(`  ${relative(ROOT, file)}  ${kb(file)}${note ? `  ${note}` : ''}`);

/** 頭の無音を切る（-45 dB 未満を無音とみなす。20 ms は残す） */
const TRIM_LEAD = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02';

const manifest = { sfx: {}, bgm: {} };

function sfx() {
  console.log('効果音');
  mkdirSync(join(OUT, 'sfx'), { recursive: true });
  for (const [name, spec] of Object.entries(SFX)) {
    const src = raw(name);
    if (!src) continue;
    const sec = spec.ms / 1000;
    const fade = spec.fadeMs / 1000;
    const shape = `${TRIM_LEAD},atrim=0:${sec},afade=t=out:st=${(sec - fade).toFixed(3)}:d=${fade}`;
    const peak = peakDb(src, shape);
    const gain = (-1 - peak).toFixed(2);
    // 正誤の 1 ビットのような短い音は WAV にする（MP3 は符号化の遅れと詰め物で 40 ms ほど伸び、復号器によっては無音が残るため）
    const wav = spec.ms <= 200;
    const file = `sfx/${name}.${wav ? 'wav' : 'mp3'}`;
    const out = join(OUT, file);
    const codec = wav ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '64k'];
    run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-i', src, '-af', `${shape},volume=${gain}dB`, '-ac', '1', '-ar', '44100', ...codec, out]);
    const ms = Math.round(durationSec(out) * 1000);
    if (wav && ms > spec.ms + 5) throw new Error(`${name} が ${spec.ms} ms に収まっていません（${ms} ms）`);
    manifest.sfx[name] = { file, ms };
    log(out, `${ms} ms（ピーク ${peak.toFixed(1)} dB → ${gain} dB）`);
  }
}

function bgm() {
  console.log('BGM');
  mkdirSync(join(OUT, 'bgm'), { recursive: true });
  for (const name of Object.keys(BGM)) {
    const src = raw(name);
    if (!src) continue;
    const shape = `${TRIM_LEAD},afade=t=in:st=0:d=0.3`;
    const peak = peakDb(src, shape);
    const gain = (-2 - peak).toFixed(2);
    const out = join(OUT, 'bgm', `${name}.mp3`);
    run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-i', src, '-af', `${shape},volume=${gain}dB`, '-ac', '2', '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', '96k', out]);
    const sec = Math.round(durationSec(out) * 10) / 10;
    manifest.bgm[name] = { file: `bgm/${name}.mp3`, sec };
    log(out, `${sec} 秒（ピーク ${peak.toFixed(1)} dB → ${gain} dB）`);
  }
}

function writeManifest() {
  const lines = [
    '/**',
    ' * 音の一覧と長さ。scripts/audio/process.mjs が生成する（手で編集しない）。',
    ' * ファイルは public/audio/ の下（URL は import.meta.env.BASE_URL + "audio/" + file）。',
    ' */',
    '',
    '/** 効果音（モノラル。短い音は WAV、ほかは MP3）。ms は長さ。hit / miss は正誤の 1 ビット（90 ms 以内） */',
    'export const AUDIO_SFX = {',
    ...Object.entries(manifest.sfx).map(([k, v]) => `  '${k}': { file: '${v.file}', ms: ${v.ms} },`),
    '} as const;',
    '',
    'export type SfxName = keyof typeof AUDIO_SFX;',
    '',
    '/** BGM（ステレオ MP3）。sec は長さ。ループは末尾と先頭を重ねてつなぐ */',
    'export const AUDIO_BGM = {',
    ...Object.entries(manifest.bgm).map(([k, v]) => `  ${k}: { file: '${v.file}', sec: ${v.sec} },`),
    '} as const;',
    '',
    'export type BgmTrack = keyof typeof AUDIO_BGM;',
    '',
  ];
  writeFileSync(MANIFEST, lines.join('\n'));
  log(MANIFEST);
}

const only = new Set(process.argv.slice(2));
const want = (k) => only.size === 0 || only.has(k);
if (only.size > 0 && existsSync(MANIFEST)) {
  // 一部だけのときは、既存の manifest から他の項目を引き継ぐ
  const prev = (await import('node:fs')).readFileSync(MANIFEST, 'utf8');
  for (const m of prev.matchAll(/'?([\w-]+)'?: \{ file: '([^']+)', (ms|sec): ([\d.]+) \}/g)) {
    if (m[3] === 'ms') manifest.sfx[m[1]] = { file: m[2], ms: Number(m[4]) };
    else manifest.bgm[m[1]] = { file: m[2], sec: Number(m[4]) };
  }
}
if (want('sfx')) sfx();
if (want('bgm')) bgm();
writeManifest();
