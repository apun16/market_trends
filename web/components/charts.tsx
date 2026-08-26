"use client";

import { useState } from "react";
const date = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

type Point = number | null | undefined;
type Series = { values: Point[]; color?: string; dash?: boolean; label?: string; width?: number };
const W = 720;

function scale(min: number, max: number, a: number, b: number) {
  const span = max - min || 1;
  return (v: number) => a + ((v - min) / span) * (b - a);
}

export function LineChart({ series, threshold, labels, height = 220, yFmt = (v: number) => v.toFixed(2), tooltipFmt = yFmt, band, marks, y0 = false }:
  { series: Series[]; threshold?: { value: number; label: string }; labels: string[]; height?: number; yFmt?: (v: number) => string;
    tooltipFmt?: (v: number) => string; band?: { from: number; to: number; label?: string }; marks?: { i: number; label: string; color?: string }[]; y0?: boolean }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const hasLabels = series.some((s) => s.label);
  const pad = { l: 44, r: hasLabels ? 120 : 16, t: 18, b: 26 };
  const all = series.flatMap((s) => s.values).filter((value): value is number => typeof value === "number" && Number.isFinite(value)).concat(threshold ? [threshold.value] : []);
  const min = y0 ? 0 : Math.min(...all), max = Math.max(...all);
  const lo = y0 ? 0 : min - (max - min) * 0.08, hi = max + (max - min) * 0.12;
  const n = Math.max(labels.length, ...series.map((s) => s.values.length));
  const sx = scale(0, n - 1, pad.l, W - pad.r), sy = scale(lo, hi, height - pad.b, pad.t);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => (y0 ? v : v));
  const path = (values: Point[]) => {
    let drawing = false;
    return values.flatMap((value, index) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        drawing = false;
        return [];
      }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${sx(index).toFixed(1)},${sy(value).toFixed(1)}`;
    }).join(" ");
  };
  const lastPoint = (values: Point[]) => {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (typeof value === "number" && Number.isFinite(value)) return { index, value };
    }
    return null;
  };
  const xt = [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1])];
  const inspect = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    const index = Math.round(((x - pad.l) / (W - pad.r - pad.l)) * (n - 1));
    setHovered(Math.max(0, Math.min(n - 1, index)));
  };
  const tipWidth = 154;
  const hoveredSeries = hovered === null ? [] : series.flatMap((item, index) => {
    const value = item.values[hovered];
    return typeof value === "number" && Number.isFinite(value) ? [{ item, index, value }] : [];
  });
  const tipHeight = 31 + hoveredSeries.length * 17;
  const tipX = hovered === null ? 0 : sx(hovered) > W - pad.r - tipWidth ? sx(hovered) - tipWidth - 10 : sx(hovered) + 10;
  return (
    <svg className="chart interactive-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Interactive time series. Hover or drag across the chart for exact values." onPointerMove={inspect} onPointerDown={inspect} onPointerLeave={() => setHovered(null)}>
      {band && <rect className="band" x={sx(band.from)} y={pad.t} width={sx(band.to) - sx(band.from)} height={height - pad.t - pad.b} />}
      {band?.label && <text x={sx(band.from) + 4} y={pad.t + 10} className="ann">{band.label}</text>}
      {ticks.map((t, i) => <g key={i}><line className="grid" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} /><text x={pad.l - 6} y={sy(t) + 3} textAnchor="end">{yFmt(t)}</text></g>)}
      {threshold && <g><line className="thr" x1={pad.l} x2={W - pad.r} y1={sy(threshold.value)} y2={sy(threshold.value)} /><text x={W - pad.r} y={sy(threshold.value) - 4} textAnchor="end">{threshold.label}</text></g>}
      {series.map((s, i) => <path key={i} className="line" d={path(s.values)} stroke={s.color ?? "var(--ink)"} strokeDasharray={s.dash ? "4 3" : undefined} strokeWidth={s.width} />)}
      {series.map((s, i) => {
        const last = lastPoint(s.values);
        return s.label && last ? <text key={`l${i}`} x={sx(last.index) + 4} y={sy(last.value) + 3} className="ann" fill={s.color}>{s.label}</text> : null;
      })}
      {marks?.map((m, i) => <g key={`m${i}`}><line x1={sx(m.i)} x2={sx(m.i)} y1={pad.t} y2={height - pad.b} stroke={m.color ?? "var(--ink)"} strokeWidth={1} strokeDasharray="2 2" /><text x={sx(m.i) - 4} y={pad.t + 10 + i * 14} textAnchor="end" className="ann" fill={m.color}>{m.label}</text></g>)}
      <line className="axis" x1={pad.l} x2={W - pad.r} y1={height - pad.b} y2={height - pad.b} />
      {xt.map((i) => <text key={i} x={sx(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{labels[i] ? date(labels[i]) : i}</text>)}
      {hovered !== null && <g className="chart-inspector" pointerEvents="none">
        <line className="crosshair" x1={sx(hovered)} x2={sx(hovered)} y1={pad.t} y2={height - pad.b} />
        {hoveredSeries.map(({ item, index, value }) => <circle key={`point-${index}`} cx={sx(hovered)} cy={sy(value)} r="4" fill={item.color ?? "var(--ink)"} stroke="#fff" strokeWidth="2" />)}
        <rect className="chart-tooltip-bg" x={tipX} y={pad.t + 3} width={tipWidth} height={tipHeight} rx="5" />
        <text className="chart-tooltip-date" x={tipX + 10} y={pad.t + 19}>{labels[hovered] ?? `Period ${hovered + 1}`}</text>
        {hoveredSeries.map(({ item, index, value }, row) => <g key={`tip-${index}`}>
          <circle cx={tipX + 11} cy={pad.t + 34 + row * 17} r="3" fill={item.color ?? "var(--ink)"} />
          <text className="chart-tooltip-label" x={tipX + 20} y={pad.t + 37 + row * 17}>{item.label ?? `Series ${index + 1}`}</text>
          <text className="chart-tooltip-value" x={tipX + tipWidth - 9} y={pad.t + 37 + row * 17} textAnchor="end">{tooltipFmt(value)}</text>
        </g>)}
      </g>}
      <rect className="chart-hit-area" x={pad.l} y={pad.t} width={W - pad.r - pad.l} height={height - pad.t - pad.b} fill="transparent" />
    </svg>
  );
}
