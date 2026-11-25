// Small, dependency-free charts for Insights (inline SVG + HTML), following one set of specs:
// one hue (--chart-1, validated on both surfaces), bars ≤ 24px with a 4px rounded data end and a
// square baseline, hairline solid gridlines on round ticks, a hover/focus tooltip on every mark,
// and a table view for every chart (the card's "Table" toggle) so no value is hover-only.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { niceTicks } from "../../shared/insights";

/** Width of an element, kept current (the charts draw in real pixels so text never scales). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

/** A card: title, a one-line subtitle, the chart — or its table. */
export function ChartCard({ title, sub, table, children, wide, action, testId }: {
  title: string; sub?: ReactNode; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode; wide?: boolean; action?: ReactNode; testId?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card insight-card${wide ? " wide" : ""}`} data-testid={testId}>
      <header className="insight-head">
        <div className="insight-title">
          <h3>{title}</h3>
          {sub && <div className="muted small">{sub}</div>}
        </div>
        <div className="insight-actions">
          {action}
          <button type="button" className="link small" aria-pressed={asTable} onClick={() => setAsTable((x) => !x)}>{asTable ? "Chart" : "Table"}</button>
        </div>
      </header>
      {asTable ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{table.head.map((h, i) => <th key={i} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}>{typeof c === "number" ? fmt(c) : c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

/** Columns from one baseline, e.g. brews per day. The tallest column is labelled; the rest on hover / focus / in the table. */
export function ColumnChart({ data, unit, height = 190, ariaLabel, labelGap = 56 }: {
  data: { label: string; value: number; detail?: string }[]; unit: [string, string]; height?: number; ariaLabel: string;
  /** Minimum room per x label (px): dates need ~56, "5★" far less. */
  labelGap?: number;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const padL = 30, padR = 4, padT = 18, padB = 24;
  const plotW = Math.max(0, W - padL - padR), plotH = height - padT - padB;
  const band = n ? plotW / n : 0;
  const barW = Math.max(1, Math.min(24, band - 2)); // 2px surface gap between touching bars
  const xOf = (i: number) => padL + i * band + (band - barW) / 2;
  const yOf = (v: number) => padT + plotH - (top ? (v / top) * plotH : 0);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / labelGap))));
  const peak = data.findIndex((d) => d.value === max && max > 0);
  const word = (v: number) => (v === 1 ? unit[0] : unit[1]);
  const col = (i: number) => {
    const d = data[i];
    const x = xOf(i), y = yOf(d.value), h = padT + plotH - y;
    if (h <= 0) return null;
    const r = Math.min(4, barW / 2, h);
    return <path d={`M${x},${padT + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${padT + plotH} Z`} className={`col${hover === i ? " hot" : ""}`} />;
  };
  return (
    <div className="chart" ref={ref}>
      {W > 0 && (
        <svg width={W} height={height} role="group" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} className={t === 0 ? "axis" : "grid"} />
              <text x={padL - 6} y={yOf(t)} className="tick" textAnchor="end" dominantBaseline="middle">{fmt(t)}</text>
            </g>
          ))}
          {data.map((_, i) => <g key={i}>{col(i)}</g>)}
          {peak >= 0 && hover == null && (
            <text x={xOf(peak) + barW / 2} y={yOf(max) - 5} className="peak" textAnchor="middle">{fmt(max)}</text>
          )}
          {data.map((d, i) => (i % labelEvery === 0 ? <text key={i} x={xOf(i) + barW / 2} y={height - 6} className="tick" textAnchor="middle">{d.label}</text> : null))}
          {data.map((d, i) => (
            <rect key={i} x={padL + i * band} y={padT} width={band} height={plotH} className="hit" tabIndex={0}
              aria-label={`${d.label}: ${fmt(d.value)} ${word(d.value)}${d.detail ? `, ${d.detail}` : ""}`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          ))}
        </svg>
      )}
      {hover != null && W > 0 && (
        <div className="tip" style={{ left: Math.min(Math.max(xOf(hover) + barW / 2, 60), W - 60), top: Math.min(yOf(data[hover].value), padT + plotH - 4) }} role="status">
          <strong>{fmt(data[hover].value)}</strong> {word(data[hover].value)}
          <div className="muted">{data[hover].label}{data[hover].detail ? ` · ${data[hover].detail}` : ""}</div>
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars: name and figure on one line, the bar below (works at any width). */
export function BarList({ rows, max, value, note, empty = "Nothing here yet." }: {
  rows: { label: string; value: number; figure: string; sub?: string }[]; max?: number; value?: (v: number) => string; note?: ReactNode; empty?: string;
}) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <>
      <ol className="barlist">
        {rows.map((r) => (
          <li key={r.label} tabIndex={0} aria-label={`${r.label}: ${r.figure}${r.sub ? `, ${r.sub}` : ""}`}>
            <div className="barlist-line">
              <span className="barlist-name">{r.label}</span>
              <span className="barlist-fig"><strong>{r.figure}</strong></span>
            </div>
            <div className="barlist-track" aria-hidden="true"><span style={{ width: `${top ? Math.max(1.5, (r.value / top) * 100) : 0}%` }} title={value ? value(r.value) : undefined} /></div>
            {r.sub && <div className="barlist-sub muted">{r.sub}</div>}
          </li>
        ))}
      </ol>
      {note && <p className="muted small">{note}</p>}
    </>
  );
}

/** Rows × columns of counts on a one-hue ramp (5 steps; empty cells are the track). */
/** `labelEvery`: label every nth column with its start (e.g. the hour), spanning n columns, so narrow columns stay readable. */
export function Heatmap({ rows, cols, labelEvery = 1, grid, unit }: { rows: string[]; cols: string[]; labelEvery?: number; grid: number[][]; unit: [string, string] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0, ...grid.flat());
  const step = (v: number) => (v <= 0 || !max ? 0 : Math.max(1, Math.ceil((v / max) * 5)));
  return (
    // Every label and cell is a direct grid item with a fixed row height (WebKit mis-sizes
    // aspect-ratio cells inside display:contents rows, so neither is used).
    <div className="heatmap" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, 1fr))`, gridTemplateRows: `auto repeat(${rows.length}, var(--hm-cell)) auto` }}
      role="group" aria-label="Brews by weekday and time of day">
      <span />
      {cols.map((c, j) => (j % labelEvery ? null : (
        <span key={c} className={`hm-col${labelEvery > 1 ? " start" : ""}`} aria-hidden="true" style={{ gridColumn: `${j + 2} / span ${Math.min(labelEvery, cols.length - j)}`, gridRow: 1 }}>
          {labelEvery > 1 ? c.split("–")[0] : c}
        </span>
      )))}
      {rows.map((r, i) => (
        <Fragment key={r}>
          <span className="hm-rowlabel">{r}</span>
          {cols.map((c, j) => {
            const v = grid[i][j];
            const id = `${i}-${j}`;
            return (
              <span key={c} className={`hm-cell s${step(v)}${hover === id ? " hot" : ""}`} tabIndex={0} aria-label={`${r} ${c}: ${v} ${v === 1 ? unit[0] : unit[1]}`}
                onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(id)} onBlur={() => setHover(null)}>
                {hover === id && <span className="tip hm-tip" role="status"><strong>{v}</strong> {v === 1 ? unit[0] : unit[1]}<span className="muted"> · {r} {c}</span></span>}
              </span>
            );
          })}
        </Fragment>
      ))}
      <span />
      <div className="hm-legend" style={{ gridColumn: `2 / span ${cols.length}` }} aria-hidden="true">
        <span className="muted small">Fewer</span>{[1, 2, 3, 4, 5].map((s) => <span key={s} className={`hm-cell s${s}`} />)}<span className="muted small">More</span>
      </div>
    </div>
  );
}

/** One headline number with an optional comparison to the previous period. */
export function StatTile({ label, value, delta, testId }: { label: string; value: string; delta?: string | null; testId?: string }) {
  return (
    <div className="stat-tile" data-testid={testId}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta && <div className="stat-delta muted small">{delta}</div>}
    </div>
  );
}

/**
 * A running total over time: a 2px line with a light area wash, the total labelled at the end,
 * and a crosshair that snaps to the nearest day (pointer, or ←/→ once focused).
 */
export function LineChart({ data, format, ariaLabel, height = 190, dayWord = "that day" }: {
  data: { label: string; value: number; day: number }[]; format: (n: number) => string; ariaLabel: string; height?: number; dayWord?: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const endLabel = n ? format(data[n - 1].value) : "";
  const padL = 44, padT = 12, padB = 24, padR = Math.max(12, endLabel.length * 7 + 14);
  const plotW = Math.max(0, W - padL - padR), plotH = height - padT - padB;
  const xOf = (i: number) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yOf = (v: number) => padT + plotH - (top ? (v / top) * plotH : 0);
  const line = data.map((d, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(d.value).toFixed(1)}`).join(" ");
  const area = n ? `${line} L${xOf(n - 1).toFixed(1)},${padT + plotH} L${xOf(0).toFixed(1)},${padT + plotH} Z` : "";
  const labels = Math.max(2, Math.min(6, Math.floor(plotW / 70)));
  const labelIdx = n > 1 ? [...new Set(Array.from({ length: labels }, (_, k) => Math.round((k / (labels - 1)) * (n - 1))))] : [0];
  const snap = (clientX: number, el: Element) => {
    const x = clientX - el.getBoundingClientRect().left;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((x - padL) / Math.max(1, plotW)) * (n - 1)))));
  };
  const h = hover ?? null;
  return (
    <div className="chart" ref={ref}>
      {W > 0 && n > 0 && (
        <svg width={W} height={height} role="img" tabIndex={0} aria-label={`${ariaLabel}: ${endLabel} by ${data[n - 1].label}`}
          onPointerMove={(e) => snap(e.clientX, e.currentTarget)} onPointerDown={(e) => snap(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(n - 1)} onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setHover((i) => Math.max(0, Math.min(n - 1, (i ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1)))); }
          }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={yOf(t)} y2={yOf(t)} className={t === 0 ? "axis" : "grid"} />
              <text x={padL - 6} y={yOf(t)} className="tick" textAnchor="end" dominantBaseline="middle">{format(t)}</text>
            </g>
          ))}
          <path d={area} className="area" />
          <path d={line} className="line" />
          {labelIdx.map((i) => <text key={i} x={xOf(i)} y={height - 6} className="tick" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{data[i].label}</text>)}
          {h != null && <line x1={xOf(h)} x2={xOf(h)} y1={padT} y2={padT + plotH} className="crosshair" />}
          <circle cx={xOf(h ?? n - 1)} cy={yOf(data[h ?? n - 1].value)} r={4} className="dot" />
          {h == null && <text x={xOf(n - 1) + 8} y={yOf(data[n - 1].value)} className="peak" dominantBaseline="middle">{endLabel}</text>}
        </svg>
      )}
      {h != null && W > 0 && (
        <div className="tip" style={{ left: Math.min(Math.max(xOf(h), 70), W - 70), top: yOf(data[h].value) }} role="status">
          <strong>{format(data[h].value)}</strong> so far
          <div className="muted">{data[h].label}{data[h].day ? ` · +${format(data[h].day)} ${dayWord}` : ""}</div>
        </div>
      )}
    </div>
  );
}
