"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FootprintsIcon,
  HeartPulseIcon,
  Moon01Icon,
  Activity01Icon,
  Fire02Icon,
} from "@hugeicons/core-free-icons";
import type { HealthSnapshot } from "@/lib/api";
import { cn, panelBg } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const GOALS = {
  calories: 500,
  activeMinutes: 30,
  steps: 10_000,
  activeZone: 30,
};

const streakFill = "bg-[#C9A227] dark:bg-[#A8860D]";
const streakMuted = "bg-[#E0E0E0] dark:bg-white/10";

function fmtHoursMinutes(totalMinutes: number | null | undefined) {
  if (totalMinutes == null || !Number.isFinite(totalMinutes)) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function ConcentricRings({
  metrics,
  centerValue,
  centerColor,
  size = 132,
}: {
  metrics: Array<{
    key: string;
    label: string;
    value: number;
    max: number;
    color: string;
  }>;
  centerValue: string;
  centerColor: string;
  size?: number;
}) {
  const stroke = 8;
  const gap = 6;
  const cx = size / 2;
  const cy = size / 2;
  // Outer ring uses largest radius; nest inward
  const outerR = (size - stroke) / 2;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {metrics.map((m, i) => {
            const r = outerR - i * (stroke + gap);
            const c = 2 * Math.PI * r;
            const pct = clamp01(m.max > 0 ? m.value / m.max : 0);
            const dash = c * pct;
            return (
              <g key={m.key}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={stroke}
                  className="text-black/[0.06] dark:text-white/10"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={m.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${c}`}
                  className="transition-[stroke-dasharray] duration-700 ease-out"
                />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p
            className="font-mono text-2xl font-semibold leading-none tabular-nums sm:text-3xl"
            style={{ color: centerColor }}
          >
            {centerValue}
          </p>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        {metrics.map((m) => {
          const pct = clamp01(m.max > 0 ? m.value / m.max : 0) * 100;
          return (
            <div
              key={m.key}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:gap-2.5"
            >
              <div className="flex w-10 items-center gap-1.5 sm:w-12">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: m.color }}
                />
                <span className="text-[11px] text-muted-foreground">
                  {m.label}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${pct}%`, background: m.color }}
                />
              </div>
              <p className="min-w-[4.5rem] text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:min-w-[5.5rem]">
                {fmtNum(m.value)}/{fmtNum(m.max)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function weekdayShort(date: string | null, index: number, total: number) {
  const d = date
    ? new Date(`${date}T12:00:00`)
    : (() => {
        const fallback = new Date();
        fallback.setDate(fallback.getDate() - (total - 1 - index));
        return fallback;
      })();
  return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
}

/** Smooth mountain-style curve through points (Catmull-Rom → cubic). */
function smoothCurvePath(
  coords: Array<{ x: number; y: number }>
): string {
  if (coords.length < 2) return "";
  if (coords.length === 2) {
    return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} L ${coords[1].x.toFixed(1)} ${coords[1].y.toFixed(1)}`;
  }
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Goal-scaled day bars (full height at 10k+) — filled, tight premium track. */
function StepsDayBars({
  points,
}: {
  points: Array<{ date: string | null; steps: number | null }>;
}) {
  const days =
    points.length > 0
      ? points
      : Array.from({ length: 7 }, () => ({
          date: null as string | null,
          steps: 0,
        }));

  const maxH = 58;
  const minH = 10;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-[8.5rem] w-full flex-col rounded-2xl bg-[#F0F0F0]/90 px-2.5 py-2 dark:bg-white/[0.06] sm:px-3">
        <div
          className="grid min-h-0 flex-1 items-end gap-1 sm:gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {days.map((p, i) => {
            const steps = Math.max(0, Math.round(p.steps || 0));
            const ratio = Math.min(1, steps / GOALS.steps);
            const barH =
              steps <= 0 ? minH : Math.max(minH, Math.round(ratio * maxH));
            const hitGoal = steps >= GOALS.steps;
            const day = weekdayShort(p.date, i, days.length);
            const label = p.date
              ? new Date(`${p.date}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              : day;
            return (
              <Tooltip key={`${p.date}-${i}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex h-full w-full min-w-0 cursor-default flex-col items-center justify-end gap-1.5"
                    aria-label={`${label}: ${fmtNum(steps)} steps`}
                  >
                    <span
                      className={cn(
                        "w-full rounded-md transition-all sm:rounded-[7px]",
                        steps > 0 ? streakFill : streakMuted,
                        hitGoal && "ring-1 ring-[#C9A227]/50"
                      )}
                      style={{ height: barH }}
                    />
                    <span
                      className={cn(
                        "text-[9px] font-medium leading-none tracking-wide sm:text-[10px]",
                        steps > 0
                          ? "text-[#C9A227] dark:text-[#A8860D]"
                          : "text-neutral-400 dark:text-white/35"
                      )}
                    >
                      {day}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {label}: {fmtNum(steps)} / {fmtNum(GOALS.steps)} steps
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

function HeartTimeChart({
  points,
}: {
  points: Array<{ label: string; bpm: number | null }>;
}) {
  const series = points
    .filter((p): p is { label: string; bpm: number } => p.bpm != null)
    .map((p) => ({ ...p, bpm: Math.round(p.bpm) }));
  if (series.length < 2) {
    return (
      <div className="flex h-[8.5rem] items-center justify-center rounded-2xl bg-[#F0F0F0]/90 text-xs text-muted-foreground dark:bg-white/[0.06]">
        No heart trend yet
      </div>
    );
  }

  const rawMin = Math.min(...series.map((p) => p.bpm));
  const rawMax = Math.max(...series.map((p) => p.bpm));
  const padY = Math.max(4, Math.round((rawMax - rawMin) * 0.15) || 6);
  const yMin = Math.max(0, Math.floor((rawMin - padY) / 5) * 5);
  const yMax = Math.ceil((rawMax + padY) / 5) * 5;
  const ySpan = Math.max(1, yMax - yMin);
  const yTicks = [yMax, Math.round((yMin + yMax) / 2), yMin];

  const w = 280;
  const h = 118;
  const left = 28;
  const right = 8;
  const top = 14;
  const bottom = 20;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const coords = series.map((p, i) => {
    const x =
      left +
      (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
    const y = top + (1 - (p.bpm - yMin) / ySpan) * plotH;
    return { ...p, x, y, i };
  });

  const xTickIdx = Array.from(
    new Set(
      [
        0,
        Math.floor((series.length - 1) / 3),
        Math.floor(((series.length - 1) * 2) / 3),
        series.length - 1,
      ].filter((i) => i >= 0)
    )
  );

  const d = smoothCurvePath(coords);
  const areaD =
    coords.length >= 2
      ? `${d} L ${coords[coords.length - 1].x.toFixed(1)} ${(top + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(top + plotH).toFixed(1)} Z`
      : "";

  return (
    <div className="flex h-[8.5rem] w-full flex-col rounded-2xl bg-[#F0F0F0]/90 px-2 py-2 dark:bg-white/[0.06] sm:px-2.5">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-full w-full flex-1"
        role="img"
        aria-label="Heart rate over time"
      >
        <defs>
          <linearGradient id="hr-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Y grid + labels */}
        {yTicks.map((tick) => {
          const y = top + (1 - (tick - yMin) / ySpan) * plotH;
          return (
            <g key={`y-${tick}`}>
              <line
                x1={left}
                x2={w - right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                className="text-black/8 dark:text-white/10"
              />
              <text
                x={left - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-neutral-400 dark:fill-white/45"
                style={{ fontSize: 8, fontVariantNumeric: "tabular-nums" }}
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line
          x1={left}
          x2={left}
          y1={top}
          y2={top + plotH}
          stroke="currentColor"
          strokeWidth={1}
          className="text-black/15 dark:text-white/20"
        />
        <line
          x1={left}
          x2={w - right}
          y1={top + plotH}
          y2={top + plotH}
          stroke="currentColor"
          strokeWidth={1}
          className="text-black/15 dark:text-white/20"
        />

        {/* Soft mountain fill + rounded wavy stroke */}
        {areaD ? <path d={areaD} fill="url(#hr-fill)" /> : null}
        <path
          d={d}
          fill="none"
          stroke="#f43f5e"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points + always-visible BPM */}
        {coords.map((c) => (
          <g key={c.i}>
            <circle cx={c.x} cy={c.y} r={3} fill="#f43f5e" />
            <text
              x={c.x}
              y={Math.max(10, c.y - 7)}
              textAnchor="middle"
              className="fill-rose-600 dark:fill-rose-400"
              style={{
                fontSize: 8,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.bpm}
            </text>
          </g>
        ))}

        {/* X time labels */}
        {xTickIdx.map((i) => {
          const c = coords[i];
          if (!c) return null;
          return (
            <text
              key={`x-${i}`}
              x={c.x}
              y={h - 4}
              textAnchor="middle"
              className="fill-neutral-400 dark:fill-white/45"
              style={{ fontSize: 8 }}
            >
              {c.label || `P${i + 1}`}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function SleepStageBar({
  stages,
}: {
  stages?: Record<string, number> | null;
}) {
  const order = ["deep", "rem", "light", "asleep", "awake", "restless"];
  const colors: Record<string, string> = {
    deep: "#1d4ed8",
    rem: "#7c3aed",
    light: "#60a5fa",
    asleep: "#38bdf8",
    awake: "#94a3b8",
    restless: "#a78bfa",
  };
  const entries = Object.entries(stages || {})
    .filter(([, v]) => v && v > 0)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  if (!entries.length) {
    return (
      <div className="mt-auto h-2.5 w-full rounded-full bg-black/5 dark:bg-white/10" />
    );
  }

  return (
    <div className="mt-auto space-y-1.5 pt-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {entries.map(([k, v]) => (
          <Tooltip key={k}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="h-full transition-opacity hover:opacity-90"
                style={{
                  width: `${(v / total) * 100}%`,
                  background: colors[k] || "#818cf8",
                }}
                aria-label={`${k} ${v} minutes`}
              />
            </TooltipTrigger>
            <TooltipContent className="capitalize text-xs">
              {k}: {v} min
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground">
        {entries.slice(0, 4).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1 capitalize">
            <span
              className="size-1.5 rounded-full"
              style={{ background: colors[k] || "#818cf8" }}
            />
            {k} {v}m
          </span>
        ))}
      </div>
    </div>
  );
}

function ZoneScale({
  azm,
}: {
  azm?: {
    total: number;
    fatBurn: number;
    cardio: number;
    peak: number;
  } | null;
}) {
  const total = Math.max(1, azm?.total || 0);
  const fat = azm?.fatBurn || 0;
  const cardio = azm?.cardio || 0;
  const peak = azm?.peak || 0;
  const marker =
    total > 0
      ? clamp01((fat * 0.2 + cardio * 0.55 + peak * 0.9) / total)
      : 0.35;

  return (
    <div className="mt-auto w-full min-w-0 pt-3">
      <div className="relative mb-1 h-2.5 px-0.5">
        <div
          className="absolute top-0 -translate-x-1/2 text-[9px] leading-none text-sky-500"
          style={{ left: `${Math.min(96, Math.max(4, marker * 100))}%` }}
        >
          ▼
        </div>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        <div className="min-w-0 flex-1 bg-[#fb7185]" />
        <div className="min-w-0 flex-1 bg-[#7dd3fc]" />
        <div className="min-w-0 flex-1 bg-[#38bdf8]" />
        <div className="min-w-0 flex-1 bg-[#22d3ee]" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
        <span className="whitespace-nowrap">Fat {fat}</span>
        <span className="whitespace-nowrap">Cardio {cardio}</span>
        <span className="whitespace-nowrap">Peak {peak}</span>
      </div>
    </div>
  );
}

export function HealthDashboard({ snap }: { snap: HealthSnapshot }) {
  const calories = snap.activity?.calories ?? 0;
  const active = snap.activity?.activeMinutes ?? 0;
  const steps = snap.activity?.steps ?? 0;
  const sleepMin = snap.sleep?.minutesAsleep ?? null;
  const heartHourly = useMemo(
    () => snap.charts?.heartHourly || [],
    [snap.charts?.heartHourly]
  );
  const chartBpms = useMemo(
    () =>
      heartHourly
        .map((p) => p.bpm)
        .filter((n): n is number => n != null && Number.isFinite(n))
        .map((n) => Math.round(n)),
    [heartHourly]
  );
  const chartAvg = chartBpms.length
    ? Math.round(chartBpms.reduce((a, b) => a + b, 0) / chartBpms.length)
    : null;
  const chartMin = chartBpms.length ? Math.min(...chartBpms) : null;
  const chartMax = chartBpms.length ? Math.max(...chartBpms) : null;
  const chartLatest = chartBpms.length ? chartBpms[chartBpms.length - 1] : null;

  const avgBpm = snap.heart?.avgBpm ?? chartAvg;
  const minBpm = snap.heart?.minBpm ?? chartMin;
  const maxBpm = snap.heart?.maxBpm ?? chartMax;
  const bpm =
    snap.heart?.restingBpm ?? snap.heart?.avgBpm ?? chartLatest ?? chartAvg ?? null;
  const weekSteps = useMemo(
    () => snap.charts?.weekSteps || [],
    [snap.charts?.weekSteps]
  );
  const primaryExercise = snap.exercises?.[0];

  const weekBars = useMemo(() => {
    if (weekSteps.length) return weekSteps;
    return [{ date: snap.date, steps }];
  }, [weekSteps, snap.date, steps]);

  return (
    <section
      className={cn(
        "grid w-full gap-3 sm:gap-4",
        "grid-cols-1 auto-rows-auto",
        "md:h-full md:min-h-0 md:grid-cols-12 md:grid-rows-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
      )}
    >
      {/* Top-left — summary hero */}
      <div
        className={cn(
          "col-span-1 flex min-h-[220px] flex-col justify-between rounded-[28px] px-5 pb-5 pt-4 sm:min-h-[260px] sm:rounded-[32px] sm:px-8 sm:pb-8 sm:pt-5",
          "md:col-span-7 md:col-start-1 md:row-start-1 md:h-full md:min-h-0",
          panelBg
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold tracking-tight sm:text-base">
            Health data
          </p>
          <p className="text-xs text-muted-foreground">{snap.date || "Today"}</p>
        </div>
        <div className="mt-4 flex min-h-0 flex-1 items-center sm:mt-5">
          <ConcentricRings
            centerValue={fmtNum(calories)}
            centerColor="#34d399"
            metrics={[
              {
                key: "cal",
                label: "Cal",
                value: calories,
                max: GOALS.calories,
                color: "#34d399",
              },
              {
                key: "act",
                label: "Act",
                value: active,
                max: GOALS.activeMinutes,
                color: "#38bdf8",
              },
              {
                key: "stp",
                label: "Stp",
                value: steps,
                max: GOALS.steps,
                color: "#f97316",
              },
              {
                key: "azm",
                label: "Zone",
                value: snap.activity?.activeZoneMinutes ?? 0,
                max: GOALS.activeZone,
                color: "#f43f5e",
              },
            ]}
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-black/5 pt-3 dark:border-white/10 sm:mt-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#F2F2F2] text-neutral-500 dark:bg-white/10 dark:text-white/70">
              <HugeiconsIcon icon={Activity01Icon} size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {primaryExercise?.name || "Activity"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {primaryExercise
                  ? primaryExercise.activeDurationMinutes != null
                    ? `${primaryExercise.activeDurationMinutes} min`
                    : "Logged today"
                  : "No workout logged today"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <p className="font-mono text-sm font-semibold tabular-nums">
              {snap.activity?.distanceKm != null
                ? `${snap.activity.distanceKm} km`
                : "—"}
            </p>
            <p className="inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums">
              <HugeiconsIcon
                icon={Fire02Icon}
                size={14}
                className="text-orange-500"
              />
              {fmtNum(calories)}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom — heart + steps (stacked on mobile, equal + aligned on md+) */}
      <div
        className={cn(
          "col-span-1 flex min-h-0 flex-col gap-3 sm:gap-4",
          "md:col-span-7 md:col-start-1 md:row-start-2 md:grid md:h-full md:grid-cols-2"
        )}
      >
        <div
          className={cn(
            "flex min-h-[240px] flex-col rounded-[28px] p-4 sm:rounded-[32px] sm:p-5",
            "md:h-full md:min-h-0",
            panelBg
          )}
        >
          <div className="flex h-12 shrink-0 items-start justify-between gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#F2F2F2] text-rose-500 dark:bg-white/10">
              <HugeiconsIcon icon={HeartPulseIcon} size={16} />
            </div>
            <div className="min-w-0 text-right">
              <p className="font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums">
                {fmtNum(bpm)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  bpm
                </span>
              </p>
              <p className="mt-1 h-4 truncate text-[10px] leading-none text-muted-foreground">
                Avg {fmtNum(avgBpm)} · Min {fmtNum(minBpm)} · Max{" "}
                {fmtNum(maxBpm)}
              </p>
            </div>
          </div>
          <div className="mt-auto w-full pt-3">
            <HeartTimeChart points={heartHourly} />
          </div>
        </div>

        <div
          className={cn(
            "flex min-h-[240px] flex-col rounded-[28px] p-4 sm:rounded-[32px] sm:p-5",
            "md:h-full md:min-h-0",
            panelBg
          )}
        >
          <div className="flex h-12 shrink-0 items-start justify-between gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#F2F2F2] text-[#C9A227] dark:bg-white/10 dark:text-[#A8860D]">
              <HugeiconsIcon icon={FootprintsIcon} size={16} />
            </div>
            <div className="min-w-0 text-right">
              <p className="font-mono text-2xl font-semibold leading-none tracking-tight text-[#C9A227] tabular-nums dark:text-[#A8860D]">
                {fmtNum(steps)}
              </p>
              <p className="mt-1 h-4 truncate text-[10px] leading-none text-muted-foreground">
                Goal {fmtNum(GOALS.steps)} steps
              </p>
            </div>
          </div>
          <div className="mt-auto w-full pt-3">
            <StepsDayBars points={weekBars} />
          </div>
        </div>
      </div>

      {/* Right — sleep + active zone stack */}
      <div
        className={cn(
          "col-span-1 flex min-h-0 flex-col overflow-hidden rounded-[28px] p-4 ring-1 ring-black/[0.04] sm:rounded-[32px] sm:p-6 dark:ring-white/[0.06]",
          "md:col-span-5 md:col-start-8 md:row-span-2 md:row-start-1 md:h-full md:min-h-0",
          panelBg
        )}
      >
        <div className="shrink-0 pb-4 sm:pb-5">
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Recovery
          </h3>
          <p className="mt-2 max-w-[20rem] text-sm leading-relaxed text-muted-foreground">
            Sleep stages and active zone minutes from your watch.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
          <div className="flex min-h-[160px] flex-col overflow-hidden rounded-[22px] bg-neutral-50 px-4 py-4 dark:bg-white/10 sm:min-h-0 sm:flex-1 sm:rounded-[26px] sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400">
                <HugeiconsIcon icon={Moon01Icon} size={16} />
              </span>
              <div className="min-w-0 text-right">
                <p className="font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-[2rem]">
                  {fmtHoursMinutes(sleepMin)}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">Sleep</p>
              </div>
            </div>
            <SleepStageBar stages={snap.sleep?.stages} />
          </div>

          <div className="flex min-h-[160px] flex-col overflow-hidden rounded-[22px] bg-neutral-50 px-4 py-4 dark:bg-white/10 sm:min-h-0 sm:flex-1 sm:rounded-[26px] sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <HugeiconsIcon icon={Activity01Icon} size={16} />
              </span>
              <div className="min-w-0 text-right">
                <p className="font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-[2rem]">
                  {fmtNum(snap.activity?.activeZoneMinutes)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    min
                  </span>
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Active Zone
                </p>
              </div>
            </div>
            <ZoneScale azm={snap.activity?.activeZoneMinutesDetail} />
          </div>
        </div>
      </div>
    </section>
  );
}
