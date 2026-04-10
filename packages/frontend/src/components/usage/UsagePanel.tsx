import { useState, useEffect, useMemo, useCallback } from 'react';

// ───── Types ─────
interface ProjectRow {
  id: string;
  name: string;
  total: number;
  sessions: number;
  activeDays: number;
  values: number[];
}
interface HeatmapResponse {
  days: number;
  topN: number;
  dates: string[];
  projects: ProjectRow[];
  grandTotal: number;
}

// ───── Color scale (log-ish buckets) ─────
// Matches the visual language of the html-sandbox prototype.
function colorFor(v: number): string {
  if (v === 0) return '#1f2937';      // neutral gray
  if (v <= 3) return '#14532d';       // deepest green (low)
  if (v <= 10) return '#166534';
  if (v <= 30) return '#16a34a';
  if (v <= 80) return '#4ade80';      // bright green
  return '#fde047';                    // yellow = hot
}

const RANGE_OPTIONS = [
  { days: 7, label: '7일' },
  { days: 14, label: '14일' },
  { days: 30, label: '30일' },
  { days: 60, label: '60일' },
  { days: 90, label: '90일' },
];

const TOP_OPTIONS = [5, 8, 10, 15, 20];

function formatShortDate(iso: string): string {
  // 'YYYY-MM-DD' → 'MM-DD'
  return iso.slice(5);
}

function weekdayIdx(iso: string): number {
  // 0 = Sun ... 6 = Sat
  return new Date(iso + 'T00:00:00').getDay();
}

export function UsagePanel() {
  const [days, setDays] = useState<number>(30);
  const [top, setTop] = useState<number>(10);
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ project: string; date: string; value: number; x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/metrics/usage-heatmap?days=${days}&top=${top}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HeatmapResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [days, top]);

  useEffect(() => {
    load();
  }, [load]);

  // ───── Derived stats ─────
  const stats = useMemo(() => {
    if (!data) return null;
    let peakValue = 0;
    let peakProject = '';
    let peakDate = '';
    let activeDaysOverall = 0;
    const dayTotals = new Array(data.dates.length).fill(0);

    for (const p of data.projects) {
      p.values.forEach((v, i) => {
        dayTotals[i] += v;
        if (v > peakValue) {
          peakValue = v;
          peakProject = p.name;
          peakDate = data.dates[i];
        }
      });
    }
    activeDaysOverall = dayTotals.filter((v) => v > 0).length;

    let hottestDayIdx = 0;
    let hottestDayVal = 0;
    dayTotals.forEach((v, i) => {
      if (v > hottestDayVal) {
        hottestDayVal = v;
        hottestDayIdx = i;
      }
    });

    return {
      peakValue,
      peakProject,
      peakDate,
      activeDaysOverall,
      hottestDay: { date: data.dates[hottestDayIdx], value: hottestDayVal },
      avgPerDay: data.grandTotal / Math.max(1, data.dates.length),
    };
  }, [data]);

  // ───── Cell size — shrinks with wider ranges to fit ─────
  const cell = days <= 14 ? 28 : days <= 30 ? 22 : days <= 60 ? 14 : 10;
  const gap = days <= 30 ? 2 : 1;
  const labelWidth = 180;
  const totalWidth = 60;

  return (
    <div className="flex-1 overflow-auto bg-surface-950">
      <div className="max-w-[1400px] mx-auto p-6">
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-100">Usage</h1>
            <p className="text-[12px] text-gray-500 mt-0.5">
              프로젝트 × 일자 집중도. 실제 사용자 턴만 집계 (tool 호출 제외).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Range selector */}
            <div className="flex bg-surface-900 border border-surface-800 rounded-lg p-0.5">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setDays(opt.days)}
                  className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                    days === opt.days
                      ? 'bg-primary-600/30 text-primary-300'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Top-N selector */}
            <select
              value={top}
              onChange={(e) => setTop(Number(e.target.value))}
              className="bg-surface-900 border border-surface-800 rounded-lg text-[11px] text-gray-300 px-2 py-1 outline-none focus:border-primary-500/50"
              title="보여줄 프로젝트 수"
            >
              {TOP_OPTIONS.map((n) => (
                <option key={n} value={n}>Top {n}</option>
              ))}
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="px-2.5 py-1 text-[11px] text-gray-400 hover:text-gray-200 hover:bg-surface-800 rounded-md transition-colors disabled:opacity-50"
              title="새로고침"
            >
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>

        {/* ── Summary cards ── */}
        {data && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard
              label="총 턴 (진짜 사용자)"
              value={data.grandTotal.toLocaleString()}
              sub={`${days}일 · 하루 평균 ${stats.avgPerDay.toFixed(1)}`}
            />
            <SummaryCard
              label="활성 프로젝트"
              value={String(data.projects.length)}
              sub={`Top ${top} 중 턴 발생`}
            />
            <SummaryCard
              label="피크일"
              value={stats.hottestDay.value.toLocaleString()}
              sub={stats.hottestDay.date || '—'}
            />
            <SummaryCard
              label="최고 강도 셀"
              value={String(stats.peakValue)}
              sub={stats.peakProject ? `${stats.peakProject} · ${stats.peakDate}` : '—'}
            />
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-[12px] text-red-300">
            로드 실패: {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && !data && (
          <div className="p-12 text-center text-gray-500 text-[12px]">불러오는 중…</div>
        )}

        {/* ── Empty ── */}
        {!loading && data && data.projects.length === 0 && (
          <div className="p-12 text-center text-gray-500 text-[12px]">
            선택한 기간({days}일)에 기록된 사용자 턴이 없습니다.
          </div>
        )}

        {/* ── Heatmap ── */}
        {data && data.projects.length > 0 && (
          <div className="bg-surface-900 border border-surface-800 rounded-xl p-5 overflow-auto relative">
            <div
              className="inline-grid"
              style={{
                gridTemplateColumns: `${labelWidth}px repeat(${data.dates.length}, ${cell}px) ${totalWidth}px`,
                gap: `${gap}px`,
                alignItems: 'center',
              }}
            >
              {/* Header row */}
              <div />
              {data.dates.map((d, i) => {
                const showLabel = data.dates.length <= 31 || i % Math.ceil(data.dates.length / 31) === 0;
                const wd = weekdayIdx(d);
                const isWeekend = wd === 0 || wd === 6;
                return (
                  <div key={d} className="relative" style={{ height: 48 }}>
                    {showLabel && (
                      <span
                        className="absolute left-1/2 bottom-1 origin-left whitespace-nowrap text-[9px] font-mono"
                        style={{
                          transform: 'rotate(-55deg) translateX(0)',
                          color: isWeekend ? '#6b7280' : '#9ca3af',
                        }}
                      >
                        {formatShortDate(d)}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="text-[9px] text-gray-500 text-right pr-1 self-end pb-1">합계</div>

              {/* Project rows */}
              {data.projects.map((p) => (
                <Row key={p.id} project={p} dates={data.dates} cell={cell} onHover={setHover} />
              ))}
            </div>

            {/* Hover tooltip */}
            {hover && (
              <div
                className="pointer-events-none fixed z-[9999] bg-surface-950 border border-surface-700 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-200 shadow-xl"
                style={{ left: hover.x + 12, top: hover.y + 12 }}
              >
                <div className="font-semibold text-primary-300">{hover.project}</div>
                <div className="text-gray-400">
                  {hover.date} · <span className="text-amber-300 font-mono">{hover.value}</span> turns
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="mt-5 pt-4 border-t border-surface-800 flex items-center gap-2 text-[10px] text-gray-500">
              <span>강도</span>
              <LegendCell color="#1f2937" label="0" />
              <LegendCell color="#14532d" label="1-3" />
              <LegendCell color="#166534" label="4-10" />
              <LegendCell color="#16a34a" label="11-30" />
              <LegendCell color="#4ade80" label="31-80" />
              <LegendCell color="#fde047" label="81+" />
              <div className="flex-1" />
              <span className="text-gray-600">
                💡 노란 셀 = 하루 80턴 이상 "불타는 날"
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───── Row component ─────
function Row({
  project,
  dates,
  cell,
  onHover,
}: {
  project: ProjectRow;
  dates: string[];
  cell: number;
  onHover: (h: { project: string; date: string; value: number; x: number; y: number } | null) => void;
}) {
  return (
    <>
      <div
        className="text-[11px] text-gray-300 text-right pr-2.5 truncate"
        title={`${project.name} · ${project.total} turns · ${project.activeDays}일 활성`}
      >
        {project.name}
      </div>
      {project.values.map((v, i) => (
        <div
          key={i}
          style={{
            width: cell,
            height: cell,
            background: colorFor(v),
            borderRadius: 2,
          }}
          className="transition-transform hover:scale-[1.35] hover:ring-1 hover:ring-white/70 cursor-default"
          onMouseEnter={(e) =>
            onHover({
              project: project.name,
              date: dates[i],
              value: v,
              x: e.clientX,
              y: e.clientY,
            })
          }
          onMouseMove={(e) =>
            onHover({
              project: project.name,
              date: dates[i],
              value: v,
              x: e.clientX,
              y: e.clientY,
            })
          }
          onMouseLeave={() => onHover(null)}
        />
      ))}
      <div className="text-[11px] text-amber-300 font-mono font-semibold text-right pl-2.5 tabular-nums">
        {project.total.toLocaleString()}
      </div>
    </>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-900 border border-surface-800 rounded-xl p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-gray-100 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function LegendCell({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
