#!/usr/bin/env node
/**
 * 文言チェック（仕様書 第12節・第5.1節・第9.5節の「使わない語」）。
 * 対象: src/ public/（public/embed/ を含む）README.md index.html vite.config.ts（manifest の説明文）、
 *       埋め込み用ページ embed/、E2E の親ページ（e2e/*.html = ブログ記事に貼った状態の再現）。見つかれば exit 1。
 *
 *   npm run lint:words
 *
 * 語のリストはこのファイルにだけ置く（ここは検査対象外）。README やコメントで禁止語を例示しないこと。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['src', 'public', 'README.md', 'index.html', 'vite.config.ts', 'embed'];
/** 拡張子を絞って見る対象（E2E のテストコードは除き、親ページの HTML だけ） */
const HTML_ONLY_TARGETS = ['e2e'];
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.md', '.svg', '.txt', '.webmanifest', '.xml', '.yml', '.yaml']);

/** 第12節「使わない語」（そのままの形） */
const WORDS = [
  '認知症予防',
  '脳の老化',
  '頭が良くなる',
  '集中力が上がる',
  '記憶力が上がる',
  '判断力が上がる',
  '仕事・勉強に効く',
  '仕事に効く',
  '勉強に効く',
  '脳を鍛える',
  '脳が活性化',
  '脳年齢',
  '脳力スコア',
  '科学的に証明',
  '臨床試験で実証',
  '脳科学に基づく',
  '医師も推奨',
  // 第5.1節・第9.5節・第12節の能力ラベル
  '認知力',
  '天才',
  '才能がある',
];

/** 形が変わる語（正規表現） */
const PATTERNS = [
  { label: 'IQ', re: /(?<![A-Za-z])IQ(?![A-Za-z])|ＩＱ/g },
  { label: 'WEAK', re: /(?<![A-Za-z])WEAK(?![A-Za-z])/g },
  { label: 'たった◯日で', re: /たった\s*[0-9０-９一二三四五六七八九十百千◯〇○]+\s*日で/g },
  // 第12節「使わない動詞」: 鍛える・防ぐ・改善する・若返る・活性化する（活用形も）
  { label: '鍛える', re: /鍛え/g },
  { label: '防ぐ', re: /防[ぐげぎがご]|防い[でだ]/g },
  { label: '改善する', re: /改善/g },
  { label: '若返る', re: /若返/g },
  { label: '活性化する', re: /活性化/g },
  // 「脳トレ」はジャンル名としてだけ可（効果の動詞と結合しない）
  { label: '脳トレ＋効果の動詞', re: /脳トレ[でをにが]?(?:鍛|伸|上が|向上|改善)/g },
];

function check(text) {
  const hits = [];
  for (const w of WORDS) {
    let idx = text.indexOf(w);
    while (idx !== -1) {
      hits.push({ label: w, index: idx });
      idx = text.indexOf(w, idx + w.length);
    }
  }
  for (const { label, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) hits.push({ label, index: m.index });
  }
  return hits;
}

/** 検査そのものが正しく働くかの自己テスト（毎回実行） */
function selfTest() {
  const must = ['IQ', 'ＩＱ', 'たった3日で', 'たった７日で', '脳を鍛えよう', '鍛えて', '防げる', '防いで', '改善します', '若返り', '活性化', '脳年齢', '天才', 'WEAK', '脳トレで鍛え'];
  const mustNot = [
    '本アプリは娯楽・自己記録を目的とするゲームです。日常生活の能力向上や疾病の予防・治療を目的・保証するものではありません。医療機器ではありません。',
    '反応・記憶・切り替えを試す3分ミニゲーム集。格闘ゲーム風の演出で、ゲーム内の成績（戦闘力）と自己ベストを記録できます。',
    'unique UNIQUE_ID weakMap Weak 防御 脳トレゲーム',
  ];
  const failures = [];
  for (const s of must) if (check(s).length === 0) failures.push(`検出できない: ${s}`);
  for (const s of mustNot) if (check(s).length > 0) failures.push(`誤検出: ${s}`);
  if (failures.length > 0) {
    console.error('lint-words の自己テストに失敗しました:\n' + failures.join('\n'));
    process.exit(2);
  }
}

function* walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      yield* walk(join(p, name));
    }
  } else if (TEXT_EXT.has(extname(p))) {
    yield p;
  }
}

selfTest();
let count = 0;
let files = 0;
const targetFiles = [
  ...TARGETS.flatMap((t) => [...walk(join(ROOT, t))]),
  ...HTML_ONLY_TARGETS.flatMap((t) => [...walk(join(ROOT, t))].filter((f) => extname(f) === '.html')),
];
for (const file of targetFiles) {
  files += 1;
  const text = readFileSync(file, 'utf8');
  const hits = check(text);
  for (const hit of hits) {
    const before = text.slice(0, hit.index);
    const line = before.split('\n').length;
    const col = hit.index - before.lastIndexOf('\n');
    const src = text.split('\n')[line - 1].trim();
    console.error(`${relative(ROOT, file)}:${line}:${col}  使わない語「${hit.label}」  ${src.slice(0, 120)}`);
    count += 1;
  }
}
if (count > 0) {
  console.error(`\n文言チェック: ${count} 件の「使わない語」が見つかりました（仕様書 第12節）。`);
  process.exit(1);
}
console.log(`文言チェック: OK（${files} ファイル）`);
