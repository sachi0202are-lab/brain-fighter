/**
 * 記録画面のグラフ（SVG の自前描画。チャートライブラリは使わない）。
 *
 * 描き方の決まり（dataviz の指針）
 * - 1つの図に y 軸は1本。量が違うものは別の図にする。
 * - 線は 2px（角丸）、端点は半径 4px のマーカー＋面色の 2px の輪、グリッドは 1px の実線で控えめに。
 * - 2系列以上なら凡例を必ず出す（1系列なら見出しが名前を兼ねる）。文字は系列色で塗らない。
 * - 端点のラベルは重なるなら出さない（凡例とツールチップに任せる）。
 * - 十字線とツールチップ（ポインタ・キーボードの ←/→ どちらでも）。値は表でも読める（表で見る）。
 */
import { ja } from '../i18n/ja';
import { h, svg } from './dom';

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  points: ChartPoint[];
}

export interface ChartOptions {
  title: string;
  series: ChartSeries[];
  /** line = 折れ線、step = 階段（ベルト）、dots = 点（ラウンドごとの正答率） */
  mode: 'line' | 'step' | 'dots';
  yMin: number;
  yMax: number;
  yTicks: number[];
  yFormat: (y: number) => string;
  /** 軸・ツールチップ・表の x の表示 */
  xFormat: (x: number) => string;
  /** 表の x 列の見出し */
  xHeading: string;
  /** 目安の範囲（薄い帯） */
  band?: { from: number; to: number; label: string };
  /** 図の高さ（軸ラベル込み, px） */
  height?: number;
  /** y 軸ラベル用の左余白 (px) */
  yLabelWidth?: number;
  emptyText: string;
}

const MARGIN = { r: 48, t: 12, b: 28 };

/** 0 から max までのきりのいい目盛り（4〜5本） */
export function niceTicks(max: number, count = 4): number[] {
  const m = Math.max(1, max);
  const raw = m / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(m / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export function chart(opts: ChartOptions): { el: HTMLElement; dispose: () => void } {
  const fig = h('figure', { class: 'chart', 'data-testid': 'chart' });
  const title = h('figcaption', { class: 'chart-title' }, opts.title);
  fig.append(title);
  const nonEmpty = opts.series.filter((s) => s.points.length > 0);
  if (nonEmpty.length === 0) {
    fig.append(h('p', { class: 'chart-empty muted' }, opts.emptyText));
    return { el: fig, dispose: () => {} };
  }

  if (opts.series.length >= 2) {
    fig.append(
      h(
        'div',
        { class: 'legend' },
        ...opts.series.map((s) =>
          h(
            'span',
            { class: 'legend-item' },
            opts.mode === 'dots'
              ? h('span', { class: 'dot-key', style: `background:${s.color}` })
              : h('span', { class: 'line-key', style: `background:${s.color}` }),
            s.name,
          ),
        ),
      ),
    );
  }

  const xs = [...new Set(nonEmpty.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const valueAt = (s: ChartSeries, x: number): number | undefined => {
    if (opts.mode === 'step') {
      let v: number | undefined;
      for (const p of s.points) if (p.x <= x) v = p.y;
      return v;
    }
    return s.points.find((p) => p.x === x)?.y;
  };

  const plot = h('div', {
    class: 'chart-plot',
    tabindex: '0',
    role: 'group',
    'aria-label': ja.records.chartAria(opts.title),
  });
  const tooltip = h('div', { class: 'chart-tooltip', hidden: true });
  fig.append(plot);

  let hover: number | null = null;
  let geom: { sx: (x: number) => number; sy: (y: number) => number; width: number; height: number; left: number } | null = null;
  let crosshair: SVGGElement | null = null;

  const render = (): void => {
    const width = Math.max(240, Math.floor(plot.clientWidth || 320));
    const height = opts.height ?? 200;
    const left = opts.yLabelWidth ?? 40;
    const pw = width - left - MARGIN.r;
    const ph = height - MARGIN.t - MARGIN.b;
    const x0 = xs[0] as number;
    const x1 = xs[xs.length - 1] as number;
    const sx = (x: number): number => (x1 === x0 ? left + pw / 2 : left + ((x - x0) / (x1 - x0)) * pw);
    const sy = (y: number): number => MARGIN.t + (1 - (y - opts.yMin) / (opts.yMax - opts.yMin)) * ph;
    geom = { sx, sy, width, height, left };
    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', class: 'chart-svg' });

    if (opts.band) {
      const top = sy(opts.band.to);
      // 帯の名前は見出しと表に書く（点と重ならないように図の中には文字を置かない）
      root.append(
        svg('rect', { x: left, y: top, width: pw, height: sy(opts.band.from) - top, class: 'chart-band' }, svg('title', null, opts.band.label)),
      );
    }
    for (const t of opts.yTicks) {
      const y = sy(t);
      root.append(
        svg('line', { x1: left, x2: left + pw, y1: y, y2: y, class: t === opts.yMin ? 'chart-axis' : 'chart-grid' }),
        svg('text', { x: left - 6, y, class: 'chart-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, opts.yFormat(t)),
      );
    }
    // x の目盛り: 最初と最後（間が広ければ中央も）
    const xTicks = xs.length === 1 ? [x0] : pw > 260 && xs.length > 2 ? [x0, xs[Math.floor(xs.length / 2)] as number, x1] : [x0, x1];
    xTicks.forEach((x, k) => {
      const anchor = xTicks.length === 1 ? 'middle' : k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle';
      root.append(svg('text', { x: sx(x), y: height - 8, class: 'chart-tick', 'text-anchor': anchor }, opts.xFormat(x)));
    });

    const ends: { s: ChartSeries; x: number; y: number }[] = [];
    for (const s of nonEmpty) {
      const pts = [...s.points].sort((a, b) => a.x - b.x);
      if (opts.mode === 'dots') {
        for (const p of pts) root.append(svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 4, fill: s.color, class: 'chart-dot' }));
        continue;
      }
      let d = '';
      pts.forEach((p, k) => {
        if (k === 0) d += `M${sx(p.x)},${sy(p.y)}`;
        else if (opts.mode === 'step') d += `H${sx(p.x)}V${sy(p.y)}`;
        else d += `L${sx(p.x)},${sy(p.y)}`;
      });
      const last = pts[pts.length - 1] as ChartPoint;
      if (opts.mode === 'step' && last.x < x1) d += `H${sx(x1)}`;
      if (pts.length > 1 || opts.mode === 'step') {
        root.append(svg('path', { d, stroke: s.color, class: 'chart-line' }));
      }
      const endX = opts.mode === 'step' ? x1 : last.x;
      root.append(svg('circle', { cx: sx(endX), cy: sy(last.y), r: 4, fill: s.color, class: 'chart-dot' }));
      ends.push({ s, x: endX, y: last.y });
    }
    // 端点のラベル（重なるときは出さない）
    const ys = ends.map((e) => sy(e.y)).sort((a, b) => a - b);
    const collide = ys.some((y, k) => k > 0 && y - (ys[k - 1] as number) < 14);
    if (!collide) {
      for (const e of ends) {
        root.append(
          svg('text', { x: sx(e.x) + 8, y: sy(e.y), class: 'chart-end-label', 'dominant-baseline': 'middle' }, opts.yFormat(e.y)),
        );
      }
    }
    crosshair = svg('g', { class: 'chart-crosshair' });
    root.append(crosshair);
    plot.replaceChildren(root, tooltip);
    if (hover !== null) showHover(hover);
  };

  const showHover = (idx: number): void => {
    if (!geom || !crosshair) return;
    hover = Math.max(0, Math.min(xs.length - 1, idx));
    const x = xs[hover] as number;
    const px = geom.sx(x);
    crosshair.replaceChildren(
      svg('line', { x1: px, x2: px, y1: MARGIN.t, y2: geom.height - MARGIN.b, class: 'chart-cross-line' }),
    );
    const rows: HTMLElement[] = [];
    for (const s of nonEmpty) {
      const v = valueAt(s, x);
      if (v === undefined) continue;
      crosshair.append(svg('circle', { cx: px, cy: geom.sy(v), r: 5, fill: s.color, class: 'chart-dot' }));
      rows.push(
        h(
          'div',
          { class: 'tt-row' },
          h('span', { class: 'line-key', style: `background:${s.color}` }),
          h('strong', null, opts.yFormat(v)),
          nonEmpty.length > 1 || opts.mode === 'dots' ? h('span', { class: 'tt-name' }, s.name) : null,
        ),
      );
    }
    tooltip.replaceChildren(h('div', { class: 'tt-head' }, opts.xFormat(x)), ...rows);
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth || 120;
    const leftPos = Math.min(Math.max(4, px + 10), geom.width - tw - 4);
    tooltip.style.left = `${px + 10 + tw > geom.width ? Math.max(4, px - tw - 10) : leftPos}px`;
    tooltip.style.top = `${MARGIN.t}px`;
  };

  const hideHover = (): void => {
    hover = null;
    crosshair?.replaceChildren();
    tooltip.hidden = true;
  };

  plot.addEventListener('pointermove', (e) => {
    if (!geom) return;
    const rect = plot.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    xs.forEach((x, k) => {
      const dd = Math.abs(geom!.sx(x) - px);
      if (dd < bestD) {
        bestD = dd;
        best = k;
      }
    });
    showHover(best);
  });
  plot.addEventListener('pointerleave', hideHover);
  plot.addEventListener('blur', hideHover);
  plot.addEventListener('focus', () => showHover(hover ?? xs.length - 1));
  plot.addEventListener('keydown', (e) => {
    const cur = hover ?? xs.length - 1;
    if (e.key === 'ArrowLeft') showHover(cur - 1);
    else if (e.key === 'ArrowRight') showHover(cur + 1);
    else if (e.key === 'Home') showHover(0);
    else if (e.key === 'End') showHover(xs.length - 1);
    else if (e.key === 'Escape') hideHover();
    else return;
    e.preventDefault();
  });

  // 表ビュー（ツールチップ無しでも全部の値が読める）
  const table = h(
    'table',
    { class: 'data-table' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, opts.xHeading), ...opts.series.map((s) => h('th', { scope: 'col' }, s.name)))),
    h(
      'tbody',
      null,
      ...xs.map((x) =>
        h(
          'tr',
          null,
          h('th', { scope: 'row' }, opts.xFormat(x)),
          ...opts.series.map((s) => {
            const v = opts.mode === 'step' ? s.points.find((p) => p.x === x)?.y : valueAt(s, x);
            return h('td', null, v === undefined ? '—' : opts.yFormat(v));
          }),
        ),
      ),
    ),
  );
  fig.append(h('details', { class: 'chart-table' }, h('summary', null, ja.records.tableView), table));

  const ro = new ResizeObserver(() => render());
  ro.observe(plot);
  render();
  return { el: fig, dispose: () => ro.disconnect() };
}
