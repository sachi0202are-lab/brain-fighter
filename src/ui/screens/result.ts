/**
 * 結果画面: KO / PERFECT / 判定、正答率、最大コンボ、戦闘力の増減、自己ベスト差、一言。「次のゲームへ」「ホームへ」
 *
 * 訓練は 1 試合 1 ラウンド（仕様書 v1.2）なので、KO / PERFECT の演出はここで出す（ラウンドの外）:
 * - Light: 静止画のファイター＋ KO / PERFECT の見出し＋ KO / PERFECT の音 → ファンファーレ
 * - Full: 必殺演出（一度だけ動いて止まる）＋技名テロップ＋衝撃音 → KO / PERFECT の音 → ファンファーレ
 * 判定負けは煽らず、見出しを出さずに判定の音だけ。ラウンドのカードに「次は ◯ 問正解で KO」を情報として 1 行出す（仕様書 9.3）。
 * 1 ラウンドの試合はラウンドを「一本勝負」、見出しを「ラウンドの結果」「KO」（× 1 を付けない）で出す。
 * 音は重ねずに順に鳴らし、画面を離れたら残りは鳴らさない。
 * どのプリセットでも課題の時間には関わらない（試合はもう終わっている）。
 */
import { gameText, ja } from '../../i18n/ja';
import { AUDIO_SFX } from '../../skin/audio-manifest';
import { fightersCanvas, koNextNote, outcomeHeadline, outcomeText, specialTelop } from '../../skin/banner';
import { SKIN_FEATURES } from '../../skin/presets';
import { prefersReducedMotion, specialScene, type SpecialScene } from '../../skin/special';
import '../../skin/skin.css';
import type { App } from '../app';
import { h } from '../dom';
import { fmtInt, fmtPct, fmtSigned } from '../format';
import { topBar } from './home';

export function mountResult(app: App, root: HTMLElement): () => void {
  const v = app.lastMatch;
  if (!v) {
    root.append(
      h('main', { class: 'screen' }, topBar(ja.result.title, true), h('p', null, ja.result.none), h('a', { class: 'btn', href: '#/' }, ja.result.home)),
    );
    return () => {};
  }
  const features = SKIN_FEATURES[v.fx];
  const name = gameText(v.gameId).name;
  const sound = features.sound && app.store.data.settings.sound ? app.sound : null;
  const trials = v.rounds.reduce((a, r) => a + r.trials, 0);
  const correct = v.rounds.reduce((a, r) => a + r.correct, 0);
  const maxCombo = Math.max(0, ...v.rounds.map((r) => r.maxCombo));
  const last = v.rounds[v.rounds.length - 1];
  const outcome = last?.outcome ?? null;
  const won = outcome === 'ko' || outcome === 'perfect';
  const delta = v.powerAfter - v.powerBefore;
  const bestDiff = v.powerAfter - v.bestBefore;

  // ---- 絵と音（ラウンドの外。試合はもう終わっている） ----
  const timers: number[] = [];
  const later = (fn: () => void, ms: number): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  /** KO / PERFECT / 判定の音。勝ちなら、その音が終わってからファンファーレ */
  const stinger = (): void => {
    if (!sound || !outcome) return;
    sound.sfx(outcome);
    if (won) later(() => sound.sfx('victory'), AUDIO_SFX[outcome].ms);
  };
  let scene: SpecialScene | null = null;
  let art: HTMLElement | null = null;
  if (features.special && won && last) {
    // 突きが当たった瞬間に衝撃音、その直後に KO / PERFECT の音
    const onImpact = (): void => {
      sound?.impact();
      later(stinger, 180);
    };
    scene = specialScene({ level: v.level, reducedMotion: prefersReducedMotion(), onImpact });
    art = h('div', { class: 'scene' }, scene.el, specialTelop(last.seed));
  } else if (features.fighters && outcome) {
    art = h('div', { class: 'scene' }, fightersCanvas({ outcome, level: v.level }));
    stinger();
  }

  const rounds = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, v.rounds.length === 1 ? ja.result.singleRoundHeading : ja.result.roundsHeading),
    h(
      'ol',
      { class: 'round-list' },
      ...v.rounds.map((r) =>
        h(
          'li',
          { class: 'round-item' },
          h('span', { class: 'round-no' }, ja.play.round(r.roundNo, v.rounds.length)),
          features.outcomeLogo && r.outcome ? h('span', { class: `round-outcome outcome-${r.outcome}` }, outcomeText(r.outcome)) : null,
          h('span', { class: 'round-acc' }, fmtPct(r.trials > 0 ? r.correct / r.trials : 0)),
        ),
      ),
    ),
    features.outcomeLogo ? koNextNote(v.rounds.map((r) => r.outcome), v.nextEnemyHp ?? null) : null,
  );

  const actions = h(
    'div',
    { class: 'actions' },
    v.nextGame
      ? h('a', { class: 'btn primary block', href: `#/play/${v.nextGame}`, 'data-testid': 'next-game' }, ja.result.nextGame(gameText(v.nextGame).name))
      : null,
    v.sessionDone ? h('p', { class: 'notice', 'data-testid': 'session-done' }, ja.result.sessionDone) : null,
    h('a', { class: 'btn block', href: '#/records', 'data-testid': 'to-records' }, ja.result.records),
    h('a', { class: 'btn ghost block', href: '#/', 'data-testid': 'to-home' }, ja.result.home),
  );

  root.append(
    h(
      'main',
      { class: 'screen result', 'data-testid': 'result', 'data-outcome': outcome ?? '' },
      topBar(`${name} ${ja.result.title}`, true),
      features.outcomeLogo ? outcomeHeadline(v.rounds.map((r) => r.outcome)) : null,
      art,
      rounds,
      h(
        'section',
        { class: 'card stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, ja.result.accuracy), h('span', { class: 'stat-value' }, fmtPct(trials > 0 ? correct / trials : 0))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, ja.result.maxCombo), h('span', { class: 'stat-value' }, fmtInt(maxCombo))),
        h(
          'div',
          { class: 'stat' },
          h('span', { class: 'stat-label' }, ja.result.power),
          h('span', { class: 'stat-value' }, `${ja.result.powerChange(v.powerBefore, v.powerAfter)}（${fmtSigned(delta)}）`),
        ),
        h(
          'div',
          { class: 'stat' },
          h('span', { class: 'stat-label' }, ja.result.bestDiff),
          h('span', { class: 'stat-value' }, bestDiff > 0 ? `${ja.result.newBest}（${fmtSigned(bestDiff)}）` : fmtSigned(bestDiff)),
        ),
      ),
      v.tip ? h('p', { class: 'tip card' }, v.tip) : null,
      actions,
    ),
  );
  return () => {
    scene?.stop();
    for (const t of timers) clearTimeout(t);
  };
}
