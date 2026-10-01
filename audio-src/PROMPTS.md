# 生成した音の元データ（audio-src/）

`raw/` は `../genspark-audio/gen.sh`（Genspark CLI）で生成した元の MP3（128 kbps・44.1 kHz・ステレオ）。
効果音は `elevenlabs/sound-effects`、BGM は `elevenlabs/music`（歌なし）。アプリで使う形には `npm run audio`（`scripts/audio/process.mjs`、ffmpeg）で加工する:

- 効果音 → 頭の無音を切り、長さをそろえ（正誤の 1 ビット `hit` / `miss` は 90 ms）、ピークを −1 dBFS にそろえてモノラル 64 kbps の MP3 に
- BGM → 頭の無音を切り、0.3 秒のフェードインを付け、ピークを −2 dBFS にそろえてステレオ 32 kHz 96 kbps の MP3 に（ループはアプリ側で末尾と先頭を 1.5 秒重ねてつなぐ）

生成し直すときは、下のプロンプトとオプションで `gen.sh` を実行し、出力を同じ名前で `raw/` に置いてから `npm run audio` を実行する。
効果音は 1 件あたり約 4〜5 クレジット、BGM は長さに応じて増える（2026-10 時点）。

| ファイル | 用途 | コマンド |
|---|---|---|
| `hit.mp3` | 正解の 1 ビット（90 ms に切る） | `gen.sh sfx "…" 1 0.6` |
| `miss.mp3` | 不正解の 1 ビット（90 ms に切る） | `gen.sh sfx "…" 1 0.6` |
| `round-start.mp3` | ラウンド開始の合図（スタート直後） | `gen.sh sfx "…" 2 0.5` |
| `ko.mp3` / `perfect.mp3` / `decision.mp3` | ラウンド末の KO / PERFECT / 判定 | `gen.sh sfx "…" 2 0.5` |
| `impact.mp3` | 必殺演出の衝撃（Full・ラウンド間） | `gen.sh sfx "…" 1 0.6` |
| `victory.mp3` | 結果画面のファンファーレ（KO / PERFECT があるとき） | `gen.sh sfx "…" 3 0.5` |
| `menu.mp3` | BGM: ホーム・記録・設定・結果・ラウンド間以外のメニュー | `gen.sh music "…" 60` |
| `battle.mp3` | BGM: 試合中（ラウンド間を含む） | `gen.sh music "…" 90` |

## プロンプト

### hit

> A single short crisp martial arts punch impact, a bright snap with a tiny whoosh, dry and close-miked, no reverb, no voices, ends immediately

### miss

> A single short dull muffled thud, a punch landing on a padded block, low and soft, dry, no reverb, no voices, ends immediately

### round-start

> A single deep Japanese temple gong strike announcing the start of a martial arts match, clean metallic hit with a short natural decay, no reverb tail longer than two seconds, no music, no voices

### ko

> Fighting game knockout stinger: one heavy punch impact immediately followed by a short triumphant taiko drum and brass hit, dramatic, clean quick ending, no voices, no crowd

### perfect

> Bright triumphant arcade victory chime: a quick ascending sparkly bell arpeggio ending in a short brass hit, cheerful, clean ending, no voices

### decision

> A single soft low temple bell tone, calm and neutral, fading gently, no music, no voices

### impact

> A powerful cinematic martial arts punch impact with a deep bass thump and a very short whoosh just before it, dry, no reverb tail, no voices, ends immediately

### victory

> Short victory fanfare for a fighting game results screen: a quick taiko drum roll into a bright triumphant brass flourish, clean ending, no voices, no crowd

### menu（60 秒）

> Instrumental only, no vocals. Calm, focused lo-fi hip-hop beat with a Japanese dojo flavor: soft koto plucks, a breathy shakuhachi phrase now and then, warm round sub bass, light brushed drums, subtle vinyl crackle. A steady loopable groove at a constant intensity from the first second to the last: no intro buildup, no breakdown, no ending or fade out. 80 BPM, A minor, 60 seconds.

### battle（90 秒）

> Instrumental only, no vocals. Driving but controlled fighting-game stage theme: taiko drums, tight electronic drums, a pulsing synth bass, short shamisen riffs, occasional brass stabs, cinematic but not chaotic. Moderate intensity that stays steady from the first second to the last so it can loop: no intro buildup, no breakdown, no big finale, no fade out. 120 BPM, D minor, 90 seconds.
