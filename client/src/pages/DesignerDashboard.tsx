/**
 * DesignerDashboard — comprehensive role-specific dashboard for DESIGNER / CRE.
 * Renders the full layout from the mockup: KPI row, sales funnel, design progress,
 * performance score, NPS analytics, incentive overview, leaderboard, attention items,
 * notifications, client health, and month-end forecast.
 */
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import {
  TrendingUp, TrendingDown, Minus, Calendar, Star, Bell,
  AlertTriangle, Target, RefreshCw, ChevronRight,
} from 'lucide-react';

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n > 0) return `₹${n.toLocaleString('en-IN')}`;
  return '₹0';
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

// ── Types ─────────────────────────────────────────────────────────────────────
interface DesignerDash {
  activeProjects: { total: number; onTrack: number; atRisk: number; delayed: number };
  bookingAchieved: number;
  bookingTarget: number | null;
  poAchieved: number;
  poTarget: number | null;
  incentive: {
    walletBalance: number;
    projectedEarnings: number;
    coreCreditsEarned: number;
    coreCreditsTotal: number;
    boosterCredits: number;
    totalCredits: number;
    tier: string;
    nextMilestoneCredits: number;
    nextMilestoneBooking: number;
    furnitureIncentive: number;
    portfolioIncentive: number;
    potentialEarnings: number;
  };
  npsThisMonth: { SALE: number | null; ONBOARDING: number | null; DESIGN_FREEZE: number | null; SIGN_OFF: number | null };
  npsLastMonth: { SALE: number | null; ONBOARDING: number | null; DESIGN_FREEZE: number | null; SIGN_OFF: number | null };
  npsTrend: Array<{ month: string; SALE: number | null; DESIGN_FREEZE: number | null; SIGN_OFF: number | null }>;
  designProgress: Array<{ phase: string; label: string; count: number }>;
  deadlines: { today: number; tomorrow: number; thisWeek: number; nextWeek: number };
  leaderboard: Array<{ userId: string; name: string; bookingValue: number; npsAvg: number | null; rank: number; isCurrentUser: boolean }>;
  clientHealth: Array<{ projectId: string; projectCode: string; clientName: string; leadId: string; leadDbId: string; health: string; attentionCount: number }>;
  forecast: {
    bookingForecast: number;
    poForecast: number;
    incentiveForecast: number;
    npsForecast: number | null;
    npsOnTrack: boolean; // only NPS has a meaningful threshold (≥ 8.0)
  };
  attentionItems: Array<{ projectId: string; projectCode: string; clientName: string; leadId: string; category: string; description: string; daysOverdue: number }>;
  recentNotifications: Array<{ id: string; type: string; message: string; leadId: string | null; isRead: boolean; createdAt: string; lead?: { id: string; leadId: string; name: string } | null }>;
  stageFunnelValues: Record<string, number>;
  performanceScore: { overall: number; tier: string; categories: Array<{ name: string; score: number; weight: number }> };
}

interface DashData {
  totalLeads: number;
  avgNPS: number | null;
  stageFunnel: Array<{ stage: string; count: number }>;
  slaBreaches: { activeCount: number; list: any[] };
  needsAttention?: Array<{ projectId: string; projectCode: string; clientName: string; leadId: string; category: string; description: string; daysOverdue: number }>;
  designerDash?: DesignerDash;
  dateRange: { from: string; to: string };
}

// ── Palette ───────────────────────────────────────────────────────────────────
const BRAND = '#d95f32';
const CARD_BORDER = '1px solid #EDE8E3';
const MUTED_BG = '#FAF6F2';
const ACCENT_BG = '#FEF0E8';

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function Panel({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`bg-white rounded-2xl shadow-warm-sm ${className}`} style={{ border: CARD_BORDER, ...style }}>
      {children}
    </div>
  );
}

function PanelHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: CARD_BORDER }}>
      <h3 className="font-bold text-stone-900 tracking-tight">{title}</h3>
      {action}
    </div>
  );
}

function DeltaBadge({ current, prev }: { current: number | null; prev: number | null }) {
  if (current == null) return <span className="text-stone-300 text-xs">—</span>;
  if (prev == null) return null;
  const delta = +(current - prev).toFixed(1);
  if (delta === 0) return <span className="text-stone-400 text-xs flex items-center gap-0.5"><Minus size={10} />0</span>;
  return delta > 0
    ? <span className="text-green-600 text-xs flex items-center gap-0.5"><TrendingUp size={10} />+{delta}</span>
    : <span className="text-red-500 text-xs flex items-center gap-0.5"><TrendingDown size={10} />{delta}</span>;
}

function NpsScore({ value }: { value: number | null }) {
  if (value == null) return <span className="text-stone-300 font-bold">—</span>;
  const color = value >= 9 ? 'text-green-600' : value >= 7 ? 'text-amber-500' : 'text-red-500';
  return <span className={`font-extrabold ${color}`}>{value.toFixed(1)}</span>;
}

function HealthPill({ health }: { health: string }) {
  const map: Record<string, string> = {
    ON_TRACK: 'bg-green-100 text-green-700',
    AT_RISK: 'bg-amber-100 text-amber-700',
    DELAYED: 'bg-red-100 text-red-700',
  };
  const label: Record<string, string> = { ON_TRACK: 'Healthy', AT_RISK: 'At Risk', DELAYED: 'Delayed' };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[health] ?? 'bg-stone-100 text-stone-500'}`}>
      {label[health] ?? health}
    </span>
  );
}

function ProgressBar({ value, max, color = BRAND }: { value: number; max: number; color?: string }) {
  const pctVal = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: '#EDE8E3' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pctVal}%`, background: color }} />
    </div>
  );
}

// ── Funnel stage config ───────────────────────────────────────────────────────
const FUNNEL_STAGES = [
  { key: 'EFFECTIVE_LEAD', label: 'Effective Lead', color: '#6366f1' },
  { key: 'MQL', label: 'MQL', color: '#8b5cf6' },
  { key: 'DQL', label: 'DQL', color: '#d946ef' },
  { key: 'PROPOSAL_READY', label: 'Proposal Ready', color: '#f59e0b' },
  { key: 'PROPOSAL_PRESENTED', label: 'Proposal Presented', color: '#f97316' },
  { key: 'ONBOARDING', label: 'Booking', color: '#22c55e' },
];

const TIER_LABEL: Record<string, string> = { BASIC: 'Basic', STANDARD: 'Standard', PREMIUM: 'Premium' };
const TIER_COLOR: Record<string, string> = { BASIC: 'text-stone-500', STANDARD: 'text-blue-600', PREMIUM: 'text-amber-600' };

const NOTIF_ICON: Record<string, string> = {
  NPS_SUBMITTED: '⭐',
  BL_ASSIGNED: '👤',
  DISCOUNT_REQUEST: '💸',
  MEETING_NO_SHOW: '❌',
  SLA_BREACH: '⚠️',
  OVERDUE_TASK: '⏰',
  RNR_ESCALATION: '📞',
};

// ── Main component ────────────────────────────────────────────────────────────
export default function DesignerDashboard() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const user = getStoredUser();

  const load = useCallback(async (from?: string, to?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const url = `/dashboard${params.toString() ? `?${params}` : ''}`;
      const res = await api.get<DashData>(url);
      setData(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApply = () => load(dateFrom || undefined, dateTo || undefined);
  const handleReset = () => { setDateFrom(''); setDateTo(''); load(); };

  const dd = data?.designerDash;

  // ── Funnel rows ───────────────────────────────────────────────────────────
  const funnelRows = FUNNEL_STAGES.map((s, i) => {
    const count = data?.stageFunnel.find((r) => r.stage === s.key)?.count ?? 0;
    const value = dd?.stageFunnelValues?.[s.key] ?? 0;
    const prevCount = i > 0 ? (data?.stageFunnel.find((r) => r.stage === FUNNEL_STAGES[i - 1].key)?.count ?? 0) : count;
    const convPct = prevCount > 0 ? pct(count, prevCount) : (count > 0 ? 100 : 0);
    return { ...s, count, value, convPct };
  });
  const totalLeadToBooking = funnelRows[0]?.count > 0
    ? pct(funnelRows[funnelRows.length - 1].count, funnelRows[0].count)
    : 0;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-stone-900 tracking-tight">My Dashboard</h1>
          <p className="text-sm text-stone-400 mt-0.5">{user?.name ?? ''} · Designer</p>
        </div>
        {/* Date-range filter */}
        <div className="flex items-center flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-stone-500 font-medium">From</label>
            <input
              type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-stone-500 font-medium">To</label>
            <input
              type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <button onClick={handleApply} className="px-3 py-1.5 text-sm font-medium text-white rounded-lg" style={{ background: BRAND }}>
            Apply
          </button>
          {(dateFrom || dateTo) && (
            <button onClick={handleReset} className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-700 underline">
              Reset
            </button>
          )}
          <button onClick={() => load(dateFrom || undefined, dateTo || undefined)} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400" title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {[1,2,3,4,5,6].map((i) => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: '#EDE8E3' }} />)}
          </div>
          <div className="h-48 rounded-2xl animate-pulse" style={{ background: '#EDE8E3' }} />
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm">{error}</div>}

      {data && !loading && (
        <>
          {/* ── Row 1: KPI cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">

            {/* Active Projects */}
            <Panel className="p-4">
              <p className="text-2xl font-extrabold text-stone-900">{dd?.activeProjects.total ?? '—'}</p>
              <p className="text-sm font-semibold text-stone-700 mt-1">Active Projects</p>
              {dd && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">{dd.activeProjects.onTrack} On Track</span>
                  {dd.activeProjects.atRisk > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">{dd.activeProjects.atRisk} At Risk</span>}
                  {dd.activeProjects.delayed > 0 && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-semibold">{dd.activeProjects.delayed} Delayed</span>}
                </div>
              )}
            </Panel>

            {/* Booking Progress */}
            <Panel className="p-4">
              <p className="text-2xl font-extrabold text-stone-900">{fmt(dd?.bookingAchieved ?? 0)}</p>
              <p className="text-sm font-semibold text-stone-700 mt-1">Booking Progress</p>
              {dd?.bookingTarget ? (
                <>
                  <div className="mt-2"><ProgressBar value={dd.bookingAchieved} max={dd.bookingTarget} /></div>
                  <p className="text-[10px] text-stone-400 mt-1">{pct(dd.bookingAchieved, dd.bookingTarget)}% of {fmt(dd.bookingTarget)} target</p>
                </>
              ) : (
                <p className="text-xs text-stone-400 mt-1">Month-to-date bookings</p>
              )}
            </Panel>

            {/* PO Progress */}
            <Panel className="p-4">
              <p className="text-2xl font-extrabold text-stone-900">{fmt(dd?.poAchieved ?? 0)}</p>
              <p className="text-sm font-semibold text-stone-700 mt-1">PO Progress</p>
              {dd?.poTarget ? (
                <>
                  <div className="mt-2"><ProgressBar value={dd.poAchieved} max={dd.poTarget} color="#06b6d4" /></div>
                  <p className="text-[10px] text-stone-400 mt-1">{pct(dd.poAchieved, dd.poTarget)}% of {fmt(dd.poTarget)} target</p>
                </>
              ) : (
                <p className="text-xs text-stone-400 mt-1">Collections this period</p>
              )}
            </Panel>

            {/* Estimated Incentive */}
            <Panel className="p-4" style={{ background: ACCENT_BG, border: '1px solid #f6ccb8' }}>
              <p className="text-2xl font-extrabold text-brand-700">{fmt(dd?.incentive.walletBalance ?? 0)}</p>
              <p className="text-sm font-semibold text-brand-600 mt-1">Estimated Incentive</p>
              <p className="text-xs text-stone-500 mt-1">
                <span className={`font-semibold ${TIER_COLOR[dd?.incentive.tier ?? 'BASIC']}`}>{TIER_LABEL[dd?.incentive.tier ?? 'BASIC']}</span>
                {' · '}Proj. {fmt(dd?.incentive.projectedEarnings ?? 0)}
              </p>
            </Panel>

            {/* Overall NPS */}
            <Panel className="p-4">
              <div className="flex items-start justify-between">
                <p className="text-2xl font-extrabold text-stone-900">
                  {data.avgNPS != null ? data.avgNPS.toFixed(1) : '—'}
                </p>
                {dd && <DeltaBadge current={data.avgNPS} prev={
                  (() => {
                    const lm = dd.npsLastMonth;
                    const vals = [lm.SALE, lm.ONBOARDING, lm.DESIGN_FREEZE, lm.SIGN_OFF].filter((v): v is number => v != null);
                    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
                  })()
                } />}
              </div>
              <p className="text-sm font-semibold text-stone-700 mt-1">Overall NPS</p>
              <p className="text-xs text-stone-400 mt-1">Avg across touchpoints</p>
            </Panel>

            {/* SLA Breaches */}
            <Panel className="p-4">
              <p className={`text-2xl font-extrabold ${data.slaBreaches.activeCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {data.slaBreaches.activeCount}
              </p>
              <p className="text-sm font-semibold text-stone-700 mt-1">SLA Breaches</p>
              <p className="text-xs text-stone-400 mt-1">
                {data.slaBreaches.activeCount === 0 ? 'All clear 🎉' : `${data.slaBreaches.list.length} active breach${data.slaBreaches.list.length !== 1 ? 'es' : ''}`}
              </p>
            </Panel>
          </div>

          {/* ── Row 2: Sales Funnel + Design Progress ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Sales Funnel */}
            <Panel>
              <PanelHeader title="Sales Funnel" />
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-stone-400 uppercase tracking-wider">
                      <th className="text-left pb-2 font-semibold">Stage</th>
                      <th className="text-right pb-2 font-semibold">Count</th>
                      <th className="text-right pb-2 font-semibold">Value</th>
                      <th className="text-right pb-2 font-semibold">Conv %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {funnelRows.map((row) => (
                      <tr key={row.key} className="hover:bg-stone-50">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: row.color }} />
                            <span className="text-stone-700 text-xs">{row.label}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right font-semibold text-stone-900">{row.count}</td>
                        <td className="py-2 text-right text-stone-500 text-xs">{row.value > 0 ? fmt(row.value) : '—'}</td>
                        <td className="py-2 text-right">
                          <span className={`text-xs font-semibold ${row.convPct >= 50 ? 'text-green-600' : row.convPct >= 25 ? 'text-amber-600' : 'text-red-500'}`}>
                            {row.convPct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between">
                  <span className="text-xs text-stone-500 font-medium">Lead → Booking conversion</span>
                  <span className={`text-sm font-bold ${totalLeadToBooking >= 20 ? 'text-green-600' : 'text-amber-600'}`}>{totalLeadToBooking}%</span>
                </div>
              </div>
            </Panel>

            {/* Design Progress */}
            <Panel>
              <PanelHeader
                title="Design Progress"
                action={<Link to="/projects" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">View All <ChevronRight size={12} /></Link>}
              />
              <div className="p-4 space-y-2">
                {dd?.designProgress.filter((p) => p.count > 0).length === 0 && (
                  <p className="text-sm text-stone-400 text-center py-6">No active projects</p>
                )}
                {dd?.designProgress.map((row) => {
                  const total = dd.activeProjects.total || 1;
                  const pctVal = Math.round((row.count / total) * 100);
                  const phaseColor: Record<string, string> = {
                    DESIGN: '#6366f1', TECHNICAL: '#8b5cf6', PRODUCTION: '#f59e0b',
                    SITE_EXECUTION: '#f97316', HANDOVER: '#22c55e', COMPLETED: '#0d9488',
                  };
                  return (
                    <div key={row.phase} className="flex items-center gap-3">
                      <span className="text-xs text-stone-500 w-32 shrink-0">{row.label}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#EDE8E3' }}>
                        <div className="h-full rounded-full" style={{ width: `${pctVal}%`, background: phaseColor[row.phase] ?? BRAND }} />
                      </div>
                      <span className="text-xs font-semibold text-stone-700 w-5 text-right">{row.count}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* ── Row 3: Performance Score + Today's Focus ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Performance Score */}
            <Panel>
              <PanelHeader title="Performance Score" action={<span className="text-xs text-stone-400 italic">Placeholder · weights TBD</span>} />
              <div className="p-5 flex gap-6 items-start">
                {/* Donut */}
                <div className="shrink-0 relative">
                  <ResponsiveContainer width={120} height={120}>
                    <PieChart>
                      <Pie
                        data={[
                          { value: dd?.performanceScore.overall ?? 0 },
                          { value: 100 - (dd?.performanceScore.overall ?? 0) },
                        ]}
                        cx="50%" cy="50%"
                        innerRadius={42} outerRadius={58}
                        startAngle={90} endAngle={-270}
                        dataKey="value"
                        stroke="none"
                      >
                        <Cell fill={BRAND} />
                        <Cell fill="#EDE8E3" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-xl font-extrabold text-stone-900">{dd?.performanceScore.overall ?? '—'}</p>
                    <p className="text-[10px] text-stone-400">/100</p>
                  </div>
                </div>
                {/* Sub-scores */}
                <div className="flex-1 space-y-2">
                  {dd?.performanceScore.categories.map((cat) => (
                    <div key={cat.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-600">{cat.name}</span>
                        <span className="font-semibold text-stone-800">{cat.score}</span>
                      </div>
                      <ProgressBar value={cat.score} max={100} />
                    </div>
                  ))}
                  <p className="text-[10px] text-stone-400 pt-1">
                    Tier: <span className={`font-semibold ${TIER_COLOR[dd?.performanceScore.tier ?? 'BASIC']}`}>{TIER_LABEL[dd?.performanceScore.tier ?? 'BASIC']}</span>
                  </p>
                </div>
              </div>
            </Panel>

            {/* Today's Focus */}
            <Panel>
              <PanelHeader
                title="Today's Focus"
                action={
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-400 italic">Auto-gen rules TBD</span>
                    <Link to="/tasks" className="text-xs text-brand-600 font-medium flex items-center gap-1">View All <ChevronRight size={12} /></Link>
                  </div>
                }
              />
              <div className="p-4">
                {/* Deadline summary */}
                {dd && (
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[
                      { label: 'Due Today', value: dd.deadlines.today, color: dd.deadlines.today > 0 ? 'text-red-600' : 'text-stone-400' },
                      { label: 'Tomorrow', value: dd.deadlines.tomorrow, color: dd.deadlines.tomorrow > 0 ? 'text-amber-600' : 'text-stone-400' },
                      { label: 'This Week', value: dd.deadlines.thisWeek, color: 'text-stone-700' },
                      { label: 'Next Week', value: dd.deadlines.nextWeek, color: 'text-stone-500' },
                    ].map((d) => (
                      <div key={d.label} className="text-center p-2 rounded-xl" style={{ background: MUTED_BG }}>
                        <p className={`text-xl font-extrabold ${d.color}`}>{d.value}</p>
                        <p className="text-[10px] text-stone-400 mt-0.5 leading-tight">{d.label}</p>
                      </div>
                    ))}
                  </div>
                )}
                {/* Static placeholder items */}
                <div className="space-y-2">
                  {data.slaBreaches.activeCount > 0 && (
                    <div className="flex items-center gap-3 p-2 rounded-xl" style={{ background: '#FEF2F2' }}>
                      <span className="text-red-500 shrink-0"><AlertTriangle size={14} /></span>
                      <span className="text-xs text-red-700 font-medium">{data.slaBreaches.activeCount} SLA breach{data.slaBreaches.activeCount !== 1 ? 'es' : ''} need attention</span>
                    </div>
                  )}
                  {dd && dd.deadlines.today > 0 && (
                    <div className="flex items-center gap-3 p-2 rounded-xl" style={{ background: '#FEF0E8' }}>
                      <span className="text-brand-500 shrink-0"><Calendar size={14} /></span>
                      <span className="text-xs text-brand-700 font-medium">{dd.deadlines.today} task{dd.deadlines.today !== 1 ? 's' : ''} due today or overdue</span>
                    </div>
                  )}
                  {dd && dd.activeProjects.delayed > 0 && (
                    <div className="flex items-center gap-3 p-2 rounded-xl" style={{ background: '#FEF2F2' }}>
                      <span className="text-red-500 shrink-0"><AlertTriangle size={14} /></span>
                      <span className="text-xs text-red-700 font-medium">{dd.activeProjects.delayed} project{dd.activeProjects.delayed !== 1 ? 's' : ''} are delayed</span>
                    </div>
                  )}
                  {(!data.slaBreaches.activeCount && (!dd || dd.deadlines.today === 0) && (!dd || dd.activeProjects.delayed === 0)) && (
                    <p className="text-sm text-stone-400 text-center py-4">All clear — nothing urgent today 🎉</p>
                  )}
                </div>
              </div>
            </Panel>
          </div>

          {/* ── Row 4: NPS Analytics ── */}
          <Panel>
            <PanelHeader title="NPS Analytics — Last 6 Months" />
            <div className="p-5">
              {/* Score summary */}
              <div className="grid grid-cols-3 gap-4 mb-5">
                {[
                  { label: 'Sales NPS', key: 'SALE' as const },
                  { label: 'Design Freeze NPS', key: 'DESIGN_FREEZE' as const },
                  { label: 'Sign Off NPS', key: 'SIGN_OFF' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="text-center p-3 rounded-xl" style={{ background: MUTED_BG }}>
                    <div className="text-2xl"><NpsScore value={dd?.npsThisMonth[key] ?? null} /></div>
                    <p className="text-xs text-stone-500 mt-1 font-medium">{label}</p>
                    {dd && (
                      <div className="mt-1 flex justify-center">
                        <DeltaBadge current={dd.npsThisMonth[key] ?? null} prev={dd.npsLastMonth[key] ?? null} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Trend chart */}
              {dd?.npsTrend && dd.npsTrend.some((m) => m.SALE != null || m.DESIGN_FREEZE != null || m.SIGN_OFF != null) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={dd.npsTrend} margin={{ left: 0, right: 10, top: 5, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-white border border-stone-200 rounded-lg shadow px-3 py-2 text-xs">
                            <p className="font-semibold text-stone-700 mb-1">{label}</p>
                            {payload.map((p) => (
                              <p key={p.dataKey as string} style={{ color: p.color }}>
                                {p.name}: {p.value != null ? p.value : '—'}
                              </p>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="SALE" name="Sales" stroke="#d946ef" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="DESIGN_FREEZE" name="Design Freeze" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="SIGN_OFF" name="Sign Off" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-32 text-stone-400 text-sm">
                  No NPS responses in the last 6 months
                </div>
              )}
            </div>
          </Panel>

          {/* ── Row 5: Incentive Overview + Upcoming Deadlines & Leaderboard ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Incentive Overview */}
            <Panel>
              <PanelHeader title="Incentive Overview" action={<span className="text-xs text-amber-600 font-medium italic">⚠ Approximations — no incentive model yet</span>} />
              {dd ? (
                <div className="p-5 space-y-4">
                  {/* Disclaimer banner */}
                  <div className="p-2.5 rounded-xl text-xs text-amber-700 leading-relaxed" style={{ background: '#FEFCE8', border: '1px solid #fde68a' }}>
                    These figures are rough approximations derived from your performance tier and booking volume. Official incentive data will appear here once the incentive model is configured.
                  </div>
                  {/* Earnings row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl" style={{ background: ACCENT_BG }}>
                      <p className="text-lg font-extrabold text-brand-700">{fmt(dd.incentive.walletBalance)}</p>
                      <p className="text-xs text-brand-600 mt-0.5">Approx. Earnings (MTD)</p>
                    </div>
                    <div className="p-3 rounded-xl" style={{ background: MUTED_BG }}>
                      <p className="text-lg font-extrabold text-stone-800">{fmt(dd.incentive.projectedEarnings)}</p>
                      <p className="text-xs text-stone-500 mt-0.5">Approx. Projected (EOM)</p>
                    </div>
                  </div>
                  {/* Credits */}
                  <div>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Approx. Credits (₹1L booking = 1 credit)</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Core', value: `${dd.incentive.coreCreditsEarned}/${dd.incentive.coreCreditsTotal}` },
                        { label: 'Booster', value: dd.incentive.boosterCredits },
                        { label: 'Total', value: dd.incentive.totalCredits },
                      ].map((c) => (
                        <div key={c.label} className="text-center p-2 rounded-lg" style={{ background: MUTED_BG }}>
                          <p className="text-sm font-extrabold text-stone-800">{c.value}</p>
                          <p className="text-[10px] text-stone-400">{c.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Next milestone */}
                  {dd.incentive.nextMilestoneCredits > 0 && (
                    <div className="p-3 rounded-xl border border-amber-100" style={{ background: '#FEFCE8' }}>
                      <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5"><Target size={12} /> Next Milestone (approx.)</p>
                      <p className="text-xs text-amber-600 mt-1">
                        {dd.incentive.nextMilestoneCredits} more credit{dd.incentive.nextMilestoneCredits !== 1 ? 's' : ''} needed · Book {fmt(dd.incentive.nextMilestoneBooking)} more
                      </p>
                    </div>
                  )}
                  {/* Extra incentives */}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { label: 'Furniture (approx.)', value: fmt(dd.incentive.furnitureIncentive) },
                      { label: 'Portfolio (approx.)', value: fmt(dd.incentive.portfolioIncentive) },
                      { label: 'Potential (approx.)', value: fmt(dd.incentive.potentialEarnings) },
                    ].map((c) => (
                      <div key={c.label} className="text-center">
                        <p className="text-sm font-bold text-stone-800">{c.value}</p>
                        <p className="text-[10px] text-stone-400">{c.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-stone-400 text-sm text-center py-8">Loading…</p>
              )}
            </Panel>

            {/* Leaderboard */}
            <Panel>
              <PanelHeader title="Team Leaderboard" action={<span className="text-xs text-stone-400">This period · Booking ₹</span>} />
              <div className="divide-y divide-stone-50">
                {dd?.leaderboard.length === 0 && (
                  <p className="text-sm text-stone-400 text-center py-8">No team data</p>
                )}
                {dd?.leaderboard.map((member) => (
                  <div
                    key={member.userId}
                    className={`flex items-center gap-3 px-5 py-3 ${member.isCurrentUser ? 'bg-orange-50' : 'hover:bg-stone-50'}`}
                  >
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-extrabold shrink-0 ${member.rank === 1 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500'}`}>
                      {member.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${member.isCurrentUser ? 'text-brand-700' : 'text-stone-800'}`}>
                        {member.name}{member.isCurrentUser && ' (You)'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-stone-900">{fmt(member.bookingValue)}</p>
                      {member.npsAvg != null && <p className="text-[10px] text-stone-400 flex items-center justify-end gap-0.5"><Star size={9} />{member.npsAvg}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* ── Row 6: Attention Required + Notifications + Client Health ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Attention Required
                Use dd.attentionItems (derived from the designer's own projects)
                for both DESIGNER and CRE. DESIGNER also gets data.needsAttention
                from deliveryWidgets; we prefer the more-specific dd source so CRE
                always sees real data rather than an empty list. */}
            {(() => {
              const items = dd?.attentionItems ?? data.needsAttention ?? [];
              return (
                <Panel>
                  <PanelHeader title="Attention Required" action={
                    items.length > 0 && (
                      <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{items.length}</span>
                    )
                  } />
                  {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-stone-400">
                      <span className="text-2xl mb-1">✓</span>
                      <p className="text-sm font-semibold text-stone-500">All clear</p>
                      <p className="text-xs">No flagged projects</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-stone-50 max-h-64 overflow-y-auto">
                      {items.map((item) => (
                        <div key={item.projectId} className="px-5 py-3 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-stone-800 truncate">{item.clientName}</p>
                            <p className="text-xs text-stone-500">{item.projectCode} · {item.category}</p>
                            {item.description && <p className="text-xs text-stone-400 mt-0.5 truncate">{item.description}</p>}
                          </div>
                          {item.daysOverdue > 0 && (
                            <span className="text-xs text-red-600 font-semibold shrink-0">{item.daysOverdue}d</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              );
            })()}

            {/* Notifications */}
            <Panel>
              <PanelHeader title="Recent Notifications" action={
                <Link to="/notifications" className="text-xs text-brand-600 font-medium flex items-center gap-1"><Bell size={12} /> View All</Link>
              } />
              {!dd?.recentNotifications.length ? (
                <div className="flex flex-col items-center justify-center py-8 text-stone-400">
                  <Bell size={20} strokeWidth={1.5} className="mb-2" />
                  <p className="text-sm">No recent notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-stone-50 max-h-64 overflow-y-auto">
                  {dd.recentNotifications.map((n) => (
                    <div key={n.id} className={`flex items-start gap-3 px-5 py-2.5 ${!n.isRead ? 'bg-orange-50' : 'hover:bg-stone-50'}`}>
                      <span className="text-base shrink-0 mt-0.5">{NOTIF_ICON[n.type] ?? '🔔'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-stone-700 leading-relaxed">{n.message}</p>
                        {n.lead && <p className="text-[10px] text-stone-400 mt-0.5">{n.lead.name} · {n.lead.leadId}</p>}
                        <p className="text-[10px] text-stone-300 mt-0.5">{new Date(n.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      {!n.isRead && <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: BRAND }} />}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* ── Client Health ── */}
          {dd?.clientHealth && dd.clientHealth.length > 0 && (
            <Panel>
              <PanelHeader title="Client Health" action={<Link to="/projects" className="text-xs text-brand-600 font-medium flex items-center gap-1">View All Projects <ChevronRight size={12} /></Link>} />
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {dd.clientHealth.slice(0, 9).map((p) => (
                  <Link
                    key={p.projectId}
                    to={`/leads/${p.leadDbId}`}
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-stone-50 transition-colors"
                    style={{ border: CARD_BORDER }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-800 truncate">{p.clientName}</p>
                      <p className="text-xs text-stone-400">{p.projectCode}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {p.attentionCount > 0 && (
                        <span className="text-xs text-red-500 font-semibold">{p.attentionCount}⚠</span>
                      )}
                      <HealthPill health={p.health} />
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {/* ── Row 7: Forecast ── */}
          {dd?.forecast && (
            <Panel>
              <PanelHeader
                title="Month-End Forecast (Linear Projection)"
                action={<span className="text-xs text-stone-400 italic">Extrapolated from days elapsed · no monthly targets set</span>}
              />
              <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Booking Forecast', value: fmt(dd.forecast.bookingForecast), note: 'approx. — based on stage transitions' },
                  { label: 'PO Forecast', value: fmt(dd.forecast.poForecast), note: 'approx. — collections extrapolated' },
                  { label: 'Incentive Forecast', value: fmt(dd.forecast.incentiveForecast), note: 'approx. — no incentive model yet' },
                  {
                    label: 'NPS Forecast',
                    value: dd.forecast.npsForecast != null ? dd.forecast.npsForecast.toFixed(1) : '—',
                    note: dd.forecast.npsForecast != null
                      ? (dd.forecast.npsOnTrack ? '≥ 8.0 — meeting target' : '< 8.0 — below target')
                      : 'no responses yet',
                  },
                ].map((f) => (
                  <div key={f.label} className="p-4 rounded-2xl text-center" style={{ background: MUTED_BG }}>
                    <p className="text-xl font-extrabold text-stone-900">{f.value}</p>
                    <p className="text-xs text-stone-500 mt-1 font-medium">{f.label}</p>
                    <span className="inline-block mt-2 text-[10px] text-stone-400 italic leading-tight">{f.note}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
