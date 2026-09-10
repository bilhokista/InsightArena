"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

export interface ChartDataPoint {
  label: string;
  value: number;
  date?: string;
}

export interface ChartSeries {
  id: string;
  name: string;
  data: ChartDataPoint[];
  color: string;
  secondaryColor?: string;
}

interface InteractiveChartProps {
  series: ChartSeries[];
  title?: string;
  description?: string;
  tooltipFormatter?: (value: number, series: ChartSeries) => string;
  height?: number;
  /** Renders the skeleton instead of the plot. Defaults to false. */
  isLoading?: boolean;
  /** Overrides the wording of the "no data yet" state. */
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Largest value across the visible series, or `null` when there is nothing to
 * scale against.
 *
 * `Math.max()` of an empty list is `-Infinity`, which used to flow straight
 * into the axis labels ("-Infinity") and into every bar height as
 * `value / -Infinity`. A series of all-zero values is the other trap: the max
 * is a legitimate 0, and dividing by it yields `NaN%`. Both are reported here
 * as "cannot scale" so the caller shows an empty state instead of a plot.
 */
export function computeMaxValue(series: ChartSeries[]): number | null {
  const values = series
    .flatMap((s) => s.data.map((d) => d.value))
    .filter((v) => Number.isFinite(v));

  if (values.length === 0) return null;

  const max = Math.max(...values);
  return max > 0 ? max : null;
}

/**
 * Plain-language summary of a series, announced to screen readers.
 *
 * A bar chart is `role="img"`; without this the only accessible content is a
 * title, and the data itself is unreachable.
 */
export function describeSeries(
  s: ChartSeries,
  format: (value: number, series: ChartSeries) => string,
): string {
  if (s.data.length === 0) return `${s.name}: no data.`;

  const values = s.data.map((d) => d.value);
  const first = s.data[0];
  const last = s.data[s.data.length - 1];

  if (s.data.length === 1) {
    return `${s.name}: a single point, ${format(first.value, s)} at ${
      first.date || first.label
    }.`;
  }

  return (
    `${s.name}: ${s.data.length} points from ${first.date || first.label} to ` +
    `${last.date || last.label}. ` +
    `Ranges from ${format(Math.min(...values), s)} to ` +
    `${format(Math.max(...values), s)}, ending at ${format(last.value, s)}.`
  );
}

/**
 * Up to three x-axis labels, de-duplicated by position.
 *
 * With a single point the first, middle and last index are all 0, which used
 * to print the same label three times as though it were a range.
 */
export function pickAxisLabels(points: ChartDataPoint[]): string[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0].label];
  if (points.length === 2) return [points[0].label, points[1].label];
  return [
    points[0].label,
    points[Math.floor(points.length / 2)].label,
    points[points.length - 1].label,
  ];
}

export function InteractiveChart({
  series,
  title,
  description,
  tooltipFormatter,
  height = 300,
  isLoading = false,
  emptyTitle = "No data yet",
  emptyDescription = "There is nothing to chart for this period. Data will appear here once it is recorded.",
}: InteractiveChartProps) {
  const [visibleSeries, setVisibleSeries] = useState(
    new Set(series.map((s) => s.id)),
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleSeriesVisibility = useCallback((seriesId: string) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev);
      if (next.has(seriesId)) {
        next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return next;
    });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setTooltipPos({ x, y });

      // Calculate which data point we're hovering over
      const pointCount = series[0]?.data.length ?? 0;
      if (pointCount === 0) {
        setHoveredIndex(null);
        return;
      }

      const chartArea = rect.width * 0.85; // Approximate chart width
      const pointWidth = chartArea / pointCount;
      const index = Math.floor(x / pointWidth);

      // Previously `data.length - 1` on an absent series produced NaN here,
      // which silently poisoned every downstream index lookup.
      setHoveredIndex(Math.max(0, Math.min(index, pointCount - 1)));
    },
    [series],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    setTooltipPos(null);
  }, []);

  const defaultFormatter = (value: number) => value.toFixed(2);
  const formatter = tooltipFormatter || defaultFormatter;

  const visibleData = useMemo(
    () => series.filter((s) => visibleSeries.has(s.id)),
    [series, visibleSeries],
  );

  // null means "nothing to scale against" — see computeMaxValue.
  const maxValue = useMemo(() => computeMaxValue(visibleData), [visibleData]);
  const dataPoints = series[0]?.data.length || 0;

  const summary = useMemo(
    () =>
      visibleData.length === 0
        ? "No series are currently shown."
        : visibleData.map((s) => describeSeries(s, formatter)).join(" "),
    // `formatter` is derived from a prop on every render; the summary is cheap
    // and correctness matters more than skipping the recompute.
    [visibleData, formatter],
  );

  const axisLabels = pickAxisLabels(series[0]?.data ?? []);

  if (isLoading) {
    return (
      <div
        className="space-y-4 rounded-xl border border-white/10 bg-slate-900/50 p-6"
        aria-busy="true"
      >
        {title && <Skeleton className="h-6 w-48" />}
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="w-full rounded-lg" style={{ height: `${height}px` }} />
        <span className="sr-only" role="status">
          Loading chart data
        </span>
      </div>
    );
  }

  // No plottable data: an axis drawn over nothing reads as "the values are
  // zero" rather than "we have no values", which is the bug this guards.
  //
  // Deliberately keyed on the whole `series` prop, not on `maxValue`: when the
  // data exists but the user has hidden every series, replacing the card with
  // an empty state would take the legend away and leave them no way back.
  if (computeMaxValue(series) === null) {
    return (
      <div className="space-y-4 rounded-xl border border-white/10 bg-slate-900/50 p-6">
        {title && (
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {description && (
              <p className="mt-1 text-sm text-slate-400">{description}</p>
            )}
          </div>
        )}
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-slate-900/50 p-6">
      {title && (
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {description && (
            <p className="mt-1 text-sm text-slate-400">{description}</p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {series.map((s) => {
          const isVisible = visibleSeries.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => toggleSeriesVisibility(s.id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isVisible
                  ? "bg-white/10 text-white"
                  : "bg-white/5 text-slate-500 opacity-50"
              } hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-[#4FD1C5] focus:ring-offset-2 focus:ring-offset-slate-900`}
              aria-pressed={isVisible}
              title={isVisible ? `Hide ${s.name}` : `Show ${s.name}`}
            >
              <div
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.name}</span>
            </button>
          );
        })}
      </div>

      {/* Screen-reader summary of the plotted data. */}
      <p className="sr-only" data-testid="chart-summary">
        {summary}
      </p>

      {maxValue === null ? (
        <p
          className="rounded-lg bg-slate-950/50 px-4 py-8 text-center text-sm text-slate-400"
          role="status"
        >
          All series are hidden. Use the legend above to show one.
        </p>
      ) : (
      <>
      {/* Chart container */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative overflow-hidden rounded-lg bg-slate-950/50"
        style={{ height: `${height}px` }}
        role="img"
        aria-label={title ? `${title}. ${summary}` : summary}
      >
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 flex h-full flex-col justify-between bg-gradient-to-r from-slate-900 to-transparent px-3 py-2 text-xs text-slate-500">
          <span>{maxValue.toFixed(0)}</span>
          <span>{(maxValue * 0.5).toFixed(0)}</span>
          <span>0</span>
        </div>

        {/* Chart bars/lines */}
        <div className="relative h-full">
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-full border-b border-white/5" />
            ))}
          </div>

          {/* Data visualization */}
          <div className="absolute inset-0 flex items-end gap-0.5 overflow-x-auto px-12 py-4">
            {Array.from({ length: dataPoints }).map((_, idx) => {
              const isHovered = hoveredIndex === idx;
              return (
                <div
                  key={idx}
                  className="relative flex flex-1 items-end gap-0.5"
                >
                  {visibleData.map((s) => {
                    const dataPoint = s.data[idx];
                    if (!dataPoint) return null;

                    const heightPercent = Number.isFinite(dataPoint.value)
                      ? Math.max(
                          0,
                          Math.min(100, (dataPoint.value / maxValue) * 100),
                        )
                      : 0;

                    return (
                      <div
                        key={s.id}
                        className="relative flex-1"
                        style={{ height: `${heightPercent}%` }}
                      >
                        <div
                          className={`h-full w-full transition-all ${
                            isHovered ? "opacity-100" : "opacity-70"
                          }`}
                          style={{
                            backgroundColor: s.color,
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${s.name}: ${formatter(dataPoint.value, s)} on ${dataPoint.date || dataPoint.label}`}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Tooltip */}
          {hoveredIndex !== null && tooltipPos && visibleData.length > 0 && (
            <div
              className="pointer-events-none absolute rounded-lg border border-white/20 bg-slate-900/95 p-3 shadow-lg"
              style={{
                left: `${Math.min(
                  tooltipPos.x,
                  (containerRef.current?.clientWidth || 0) - 200,
                )}px`,
                top: `${tooltipPos.y - 80}px`,
              }}
              role="tooltip"
            >
              <div className="text-xs text-slate-400">
                {series[0]?.data[hoveredIndex]?.date ||
                  series[0]?.data[hoveredIndex]?.label}
              </div>
              <div className="mt-2 space-y-1">
                {visibleData.map((s) => {
                  const value = s.data[hoveredIndex]?.value;
                  if (value === undefined) return null;
                  return (
                    <div key={s.id} className="flex items-center gap-2 text-sm">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-white">{s.name}:</span>
                      <span className="font-semibold text-[#4FD1C5]">
                        {formatter(value, s)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* X-axis labels (sample) */}
      <div className="mt-3 flex justify-between text-xs text-slate-500">
        {axisLabels.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
      </>
      )}
    </div>
  );
}
