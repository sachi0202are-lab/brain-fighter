# 生成画像の元データ（art-src/）

`raw/` は `genspark-image/gen.sh`（Genspark CLI、モデルは **GPT Image 2.5** 固定）で生成した元画像。
ファイル名は `.jpg`（CLI は `.png` で保存するが中身は JPEG）。アプリで使う形には `npm run art`（`scripts/art/process.mjs`）で加工する:

- シルエット（白地に黒）→ 黒＋アルファの PNG に変え、横一列のシートを 1 体ずつに切り分ける（立ち姿の高さを 640px にそろえる）
- ロゴとベルト（グリーンバック `#00ff00`）→ 緑を抜いて PNG に（半透明の縁の緑は混色の逆算で取り除く）
- ステージ背景 → 1280×720 の JPEG、キービジュアル → 幅 1200 の JPEG、サムネイル → 320×320 の JPEG
- アプリアイコン → `public/icons/`（192 / 512 / maskable 512 / apple-touch 180、favicon.svg と icon.svg は 128px の PNG を埋め込む）

生成し直すときは、下のプロンプトとオプションで `gen.sh` を実行し、出力を同じ名前で `raw/` に置いてから `npm run art` を実行する。
1 枚あたりの消費は 1k で約 28 クレジット、2k で約 44 クレジット（2026-10 時点の見積もり）。

| ファイル | 用途 | オプション |
|---|---|---|
| `player-sheet.jpg` | 自キャラ（構え・突き・勝ちポーズ）→ `fighters/player-*.png` | `-r 3:2 -s 2k` |
| `enemy-side-sheet.jpg` | 敵（横向きの構え・ダウン）→ `fighters/enemy-guard.png` `enemy-down.png` | `-r 3:2 -s 2k` |
| `enemy-front-sheet.jpg` | 敵の正面 3 体（標準・がっしり・細身）→ `fighters/enemy-front-{a,b,c}.png` | `-r 3:2 -s 2k` |
| `dh-plain-sheet.jpg` `dh-topknot-sheet.jpg` `dh-broad-sheet.jpg` `dh-robe-sheet.jpg` | ダブルヒットの構え（正面 4 体 × 上段・中段・下段）→ `fighters/dh-{plain,topknot,broad,robe}-{high,mid,low}.png` | `-r 3:2 -s 2k` |
| `stage-dojo.jpg` `stage-city.jpg` `stage-mountain.jpg` `stage-bridge.jpg` | ステージ背景 → `stages/*.jpg` | `-r 16:9 -s 2k` |
| `logo-green.jpg` | ロゴ → `ui/logo.png` | `-r 2:1 -s 2k` |
| `hero.jpg` | ホームのキービジュアル → `ui/hero.jpg` | `-r 2:1 -s 2k` |
| `thumb-double-hit.jpg` `thumb-combo-recall.jpg` `thumb-stance-change.jpg` | ゲームカードのサムネイル → `ui/thumb-*.jpg` | `-r 1:1 -s 1k` |
| `icon.jpg` | アプリアイコン → `public/icons/` | `-r 1:1 -s 1k` |
| `belts-green.jpg` | ベルト 10 本 → `ui/belt-{0..9}.png` | `-r 2:1 -s 2k` |

## プロンプト

### dh-plain-sheet

> Three solid black silhouettes of the same martial artist opponent, a standard athletic build with short hair, wearing a headband with two tails, seen from the FRONT (facing the viewer, body square to the camera, symmetrical), shadow puppet (kage-e) style, flat vector, crisp clean edges, no gradients, no outline strokes, no ground shadow, on a pure white background, arranged in a single horizontal row with generous empty white space between them and never touching, all exactly the same height and body proportions with feet on the same invisible baseline, feet shoulder-width apart. Only the arms differ: (1) left: HIGH guard, both arms raised straight up with both fists held high above the top of the head; (2) middle: MIDDLE guard, both elbows bent and tucked in, both fists held at shoulder height right beside the shoulders, close to the body; (3) right: LOW guard, both arms hanging down, both fists held at hip height right beside the hips. No text, no labels, no numbers, nothing else in the image

### dh-topknot-sheet

> Three solid black silhouettes of the same martial artist opponent, a standard athletic build with a samurai topknot (chonmage) hairstyle, seen from the FRONT (facing the viewer, body square to the camera, symmetrical), shadow puppet (kage-e) style, flat vector, crisp clean edges, no gradients, no outline strokes, no ground shadow, on a pure white background, arranged in a single horizontal row with generous empty white space between them and never touching, all exactly the same height and body proportions with feet on the same invisible baseline, feet shoulder-width apart. Only the arms differ: (1) left: HIGH guard, both arms raised straight up with both fists held high above the top of the head; (2) middle: MIDDLE guard, both elbows bent and tucked in, both fists held at shoulder height right beside the shoulders, close to the body; (3) right: LOW guard, both arms hanging down, both fists held at hip height right beside the hips. No text, no labels, no numbers, nothing else in the image

### dh-broad-sheet

> Three solid black silhouettes of the same martial artist opponent, a heavy, very broad-shouldered and muscular build, bald head, seen from the FRONT (facing the viewer, body square to the camera, symmetrical), shadow puppet (kage-e) style, flat vector, crisp clean edges, no gradients, no outline strokes, no ground shadow, on a pure white background, arranged in a single horizontal row with generous empty white space between them and never touching, all exactly the same height and body proportions with feet on the same invisible baseline, feet shoulder-width apart. Only the arms differ: (1) left: HIGH guard, both arms raised straight up with both fists held high above the top of the head; (2) middle: MIDDLE guard, both elbows bent and tucked in, both fists held at shoulder height right beside the shoulders, close to the body; (3) right: LOW guard, both arms hanging down, both fists held at hip height right beside the hips. No text, no labels, no numbers, nothing else in the image

### dh-robe-sheet

> Three solid black silhouettes of the same martial artist opponent, a slim build wearing a long loose martial-arts robe with wide sleeves and a hakama, hair tied back, seen from the FRONT (facing the viewer, body square to the camera, symmetrical), shadow puppet (kage-e) style, flat vector, crisp clean edges, no gradients, no outline strokes, no ground shadow, on a pure white background, arranged in a single horizontal row with generous empty white space between them and never touching, all exactly the same height and body proportions with feet on the same invisible baseline, feet shoulder-width apart. Only the arms differ: (1) left: HIGH guard, both arms raised straight up with both fists held high above the top of the head; (2) middle: MIDDLE guard, both elbows bent and tucked in, both fists held at shoulder height right beside the shoulders, close to the body; (3) right: LOW guard, both arms hanging down, both fists held at hip height right beside the hips. No text, no labels, no numbers, nothing else in the image

### player-sheet

> Three solid black silhouettes of the same lean martial artist character, shadow puppet (kage-e) style, flat vector, crisp clean edges, no gradients, no outline strokes, no ground shadow, all on a pure white background, arranged in a single horizontal row with generous empty white space between them and never touching: (1) left: side view facing right, standing fighting guard stance with both fists raised; (2) middle: side view facing right, lunging forward throwing a long straight punch with the rear leg extended; (3) right: side view facing right, standing victory pose with one fist raised high above the head. The character wears a loose karate gi with a headband whose two tails trail behind. Same body proportions and same size in all three poses, feet aligned on the same invisible baseline. No text, no labels, no numbers, nothing else in the image

### enemy-side-sheet

> Two solid black silhouettes of the same stocky, heavy-set martial artist character (broad shoulders, thick arms, a topknot hairstyle, loose trousers), shadow puppet (kage-e) style, flat vector, crisp clean edges, no gradients, no outline strokes, no ground shadow, on a pure white background, arranged in a single horizontal row with generous empty white space between them and never touching: (1) left: side view facing LEFT, standing fighting guard stance with both fists raised; (2) right: the same character knocked out, lying flat on his back on the ground, head toward the left, feet toward the right, drawn at exactly the same scale as the standing figure. Both figures rest on the same invisible baseline. No text, no labels, no numbers, nothing else in the image

### enemy-front-sheet

> Three solid black silhouettes of three different martial artist opponents, each standing in a front-facing fighting guard stance with both fists raised in front of the chest, shadow puppet (kage-e) style, flat vector, crisp clean edges, no gradients, no outline strokes, no ground shadow, on a pure white background, arranged in a single horizontal row with generous empty white space between them and never touching, all exactly the same height with feet on the same invisible baseline: (1) left: a standard athletic build wearing a headband with two tails; (2) middle: a heavy, very broad and muscular build with a topknot; (3) right: a slim, tall and wiry build with a long braided ponytail. No text, no labels, no numbers, nothing else in the image

### stage-dojo

> Wide cinematic background illustration for a fighting game stage: the interior of a traditional Japanese dojo at night, polished dark wooden floor, shoji screens glowing faintly, a few paper lanterns with warm orange light, a hanging calligraphy scroll without legible characters, wooden pillars and beams. Flat vector art with soft gradients and simple geometric shapes, dark moody palette dominated by deep navy (#0e1120) and indigo with a few warm orange accent lights, low overall brightness so that white UI text stays readable on top, symmetrical composition, an empty floor area across the bottom third for fighters to stand on, no people, no characters, no text, no logos

### stage-city

> Wide cinematic background illustration for a fighting game stage: a skyscraper rooftop at night overlooking a neon-lit city skyline, distant towers with scattered window lights, cool blue haze, a few orange and magenta neon accents far away, a low chain-link fence and rooftop vents at the left and right edges, a flat empty rooftop floor across the bottom third for fighters to stand on. Flat vector art with soft gradients and simple geometric shapes, dark moody palette dominated by deep navy (#0e1120) and indigo, low overall brightness so that white UI text stays readable on top, symmetrical composition, no people, no characters, no text, no logos, no signs with letters

### stage-mountain

> Wide cinematic background illustration for a fighting game stage: a mountain shrine at dusk, a stone courtyard in front of a large torii gate, drifting mist, silhouetted pine trees, layered mountain ridges fading into the distance, a thin sliver of orange sunset on the horizon. Flat vector art with soft gradients and simple geometric shapes, dark moody palette dominated by deep navy (#0e1120) and indigo with a few warm orange accent lights, low overall brightness so that white UI text stays readable on top, symmetrical composition, an empty flat stone floor across the bottom third for fighters to stand on, no people, no characters, no text, no logos

### stage-bridge

> Wide cinematic background illustration for a fighting game stage: an old stone arch bridge seen from on top of its walkway at twilight, paper lanterns along the stone railings on both sides, a calm river with soft reflections below, distant hills, a deep indigo sky with the first stars. Flat vector art with soft gradients and simple geometric shapes, dark moody palette dominated by deep navy (#0e1120) and indigo with a few warm orange accent lights, low overall brightness so that white UI text stays readable on top, symmetrical composition, an empty flat bridge walkway across the bottom third for fighters to stand on, no people, no characters, no text, no logos

### logo-green

> Video game logo wordmark reading exactly 'BRAIN FIGHTER' in two stacked lines (BRAIN on top, FIGHTER below), bold italic condensed sans-serif lettering with a slight forward lean, fiery orange (#ff7a3d) to golden gradient fill with a crisp white inner highlight and a thin dark navy (#0e1120) outline, clean flat vector style like a modern arcade fighting game title screen. No characters, no decorations, no glow, no drop shadow. The wordmark is isolated and centered on a completely flat, solid, uniform pure green (#00FF00) chroma-key background that fills the entire canvas

### hero

> Key visual banner for a brain-training mini game collection styled like a classic fighting game: two solid black shadow-puppet silhouettes of martial artists in fighting stances facing each other, one at the far left edge and one at the far right edge of the frame, standing on a faintly glowing circular dojo floor, dramatic warm orange rim light along their outlines, deep navy (#0e1120) background with subtle dark geometric light rays and a soft orange glow low in the center, flat vector style with soft gradients, the whole middle of the image is kept dark and empty so that a title can be placed over it later, no text, no letters, no logos, 2:1 wide banner

### thumb-double-hit

> Square illustration for a mini game card, flat vector style with bold simple shapes and crisp edges: a solid black shadow-puppet silhouette of a martial artist standing in a front-facing guard stance at the center, a bright yellow eight-pointed spark burst to the upper right of him, and a few small dim slate-blue triangles, squares and diamonds scattered around the edges, with a subtle electric blue (#3987e5) glow behind the figure. A solid dark navy (#171b2e) background fills the entire canvas edge to edge. No text, no letters, no frame, no border

### thumb-combo-recall

> Square illustration for a mini game card, flat vector style with bold simple shapes and crisp edges: a 3 by 3 grid of rounded square tiles seen straight on, the center tile holding a small solid black shadow-puppet silhouette of a martial artist in a guard stance, one of the outer tiles glowing bright warm orange (#d95926) with a small eight-pointed burst mark on it, the other tiles dim dark indigo. A solid dark navy (#171b2e) background fills the entire canvas edge to edge. No text, no letters, no numbers, no frame, no border

### thumb-stance-change

> Square illustration for a mini game card, flat vector style with bold simple shapes and crisp edges: at the top, two small signboard plates side by side, the left plate showing an orange circle and the right plate showing a blue square, with a curved two-headed switching arrow in emerald green (#199e70) between them; below them a solid black shadow-puppet silhouette of a martial artist in a front-facing guard stance with a subtle emerald green glow behind him. A solid dark navy (#171b2e) background fills the entire canvas edge to edge. No text, no letters, no numbers, no frame, no border

### icon

> Square app icon for a game called Brain Fighter: a bold solid black shadow-puppet silhouette of a martial artist's head in profile with a headband and a raised fist, placed inside a bright flat orange (#ff7a3d) circle, with a thin glowing white line pattern suggesting a brain drawn on the side of the head. Clean flat vector style, crisp edges, no gradients except a subtle highlight on the circle, no text, no letters. A solid deep navy (#0e1120) background fills the entire canvas edge to edge; the orange circle is perfectly centered and its diameter is about 62% of the canvas width, leaving generous navy margins on all sides

### belts-green

> A single horizontal row of ten martial arts rank belts, each drawn as the same small flat vector icon: a folded belt tied in a square knot with two short ends hanging down, seen from the front, thick clean dark outlines, all identical in size and shape, evenly spaced with clear gaps, never touching or overlapping, in this exact left-to-right order of colors: white, yellow, orange, green, blue, purple, brown, red, black, and black with two thin gold stripes near one end. The icons are isolated on a completely flat, solid, uniform pure green (#00FF00) chroma-key background that fills the entire canvas. No text, no numbers, no shadows
