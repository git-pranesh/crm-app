import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../lib/api';
import { getStoredUser } from '../lib/auth';

interface DashboardData {
  totalLeads: number;
  pipelineValue: number;
  avgNPS: number | null;
  collectedThisMonth: number;
  outstanding: number;
  inDelivery: { count: number; contractValueSum: number };
  needsAttention: { projectId: string; projectCode: string; clientName: string; leadId: string; category: string; description: string; daysOverdue: number }[];
  collectionsDue: { projectId: string; clientName: string; milestone: string; amount: number; dueDate?: string; status?: string }[];
  phaseLoad: { phase: string; count: number; valueSum: number }[];
  stageFunnel: { stage: string; count: number }[];
  sourceBreakdown: { source: string; count: number }[];
  conversionRates: { elToMql: number; mqlToDql: number; dqlToPp: number; ppToOnboarding: number };
  slaBreaches: { activeCount: number; list: { id: string; rule: string; breachedAt: string; lead: { id: string; leadId: string; name: string; stage: string } }[] };
  teamActivity: { callsToday: number; stagesMovedToday: number; tasksCompletedToday: number };
  leadsToday?: number;
  leadsThisWeek?: number;
  leadsThisMonth?: number;
}

const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n > 0) return `₹${n.toLocaleString('en-IN')}`;
  return '₹0';
};

const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'Eff. Lead', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'Prop. Ready', PROPOSAL_PRESENTED: 'Prop. Done', ONBOARDING: 'Onboarding',
  HANDED_OVER: 'Handed Over',
};
const STAGE_COLORS: Record<string, string> = {
  EFFECTIVE_LEAD: '#6366f1', MQL: '#8b5cf6', DQL: '#d946ef',
  PROPOSAL_READY: '#f59e0b', PROPOSAL_PRESENTED: '#f97316', ONBOARDING: '#22c55e',
};
const PIE_COLORS = ['#d95f32', '#f97316', '#f59e0b', '#6366f1', '#8b5cf6', '#22c55e', '#06b6d4'];
const PHASE_COLORS: Record<string, string> = {
  DESIGN: '#6366f1', TECHNICAL: '#8b5cf6', PRODUCTION: '#f59e0b',
  EXECUTION: '#f97316', HANDOVER: '#22c55e', COMPLETED: '#0d9488',
};
const RISK_COLORS: Record<string, string> = {
  Delayed: 'bg-red-100 text-red-700', 'At Risk': 'bg-amber-100 text-amber-700',
  Blocked: 'bg-rose-100 text-rose-700',
};
const RULE_LABELS: Record<string, string> = {
  FIRST_CONTACT: 'First contact >24h', LEAD_TO_MQL: 'Lead→MQL >5d',
  MQL_TO_DQL: 'MQL→DQL >5d', PROPOSAL_TO_PP: 'Proposal→PP >2d',
  FIRST_CONTACT_24H: 'First contact >24h', LEAD_TO_MQL_5D: 'Lead→MQL >5d',
  MQL_TO_DQL_5D: 'MQL→DQL >5d', PROPOSAL_TO_PP_2D: 'Proposal→PP >2d',
};

function SkeletonCard() {
  return <div className="h-28 bg-gray-200 rounded-xl animate-pulse" />;
}

function KPICard({ label, value, sub, accent = false }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${accent ? 'bg-brand-50 border-brand-200' : 'bg-white border-gray-200'}`}>
      <p className={`text-2xl font-bold ${accent ? 'text-brand-700' : 'text-gray-900'}`}>{value}</p>
      <p className={`text-sm font-medium mt-1 ${accent ? 'text-brand-600' : 'text-gray-700'}`}>{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

function hoursOverdue(breachedAt: string) {
  return Math.floor((Date.now() - new Date(breachedAt).getTime()) / 3600000);
}

// ── Branch Head / Admin layout ────────────────────────────────────────────────

function BHDashboard({ data }: { data: DashboardData }) {
  const funnelData = data.stageFunnel.map((s) => ({
    stage: STAGE_LABELS[s.stage] ?? s.stage,
    count: s.count,
    fill: STAGE_COLORS[s.stage] ?? '#d95f32',
  }));

  const totalSource = data.sourceBreakdown.reduce((a, s) => a + s.count, 0);

  const attentionCount = data.needsAttention.length;
  const slaCount = data.slaBreaches.activeCount;

  return (
    <div className="space-y-6">
      {/* Row 1 – KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          label="Sales Pipeline"
          value={fmt(data.pipelineValue)}
          sub={`${data.totalLeads} active leads, est. value`}
          accent
        />
        <KPICard
          label="In Delivery"
          value={data.inDelivery.count}
          sub={`${fmt(data.inDelivery.contractValueSum)} contract value in flight`}
        />
        <KPICard
          label="Collected This Month"
          value={fmt(data.collectedThisMonth)}
          sub="Payments in last 30 days"
        />
        <KPICard
          label="Outstanding"
          value={fmt(data.outstanding)}
          sub="Yet to collect on delivery projects"
        />
        <KPICard
          label="Needs Attention"
          value={attentionCount + slaCount}
          sub={`${attentionCount} project${attentionCount !== 1 ? 's' : ''} · ${slaCount} SLA lead${slaCount !== 1 ? 's' : ''}`}
        />
        <KPICard
          label="NPS Score"
          value={data.avgNPS != null ? data.avgNPS.toFixed(1) : '—'}
          sub="Avg across touchpoints"
        />
      </div>

      {/* Row 2 – Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pipeline funnel – horizontal bars */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Pipeline Funnel</h3>
          {funnelData.every((d) => d.count === 0) ? (
            <div className="flex items-center justify-center h-44 text-gray-400 text-sm">No active leads</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={72} />
                <Tooltip formatter={(v) => [v, 'Leads']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Source mix – donut */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Lead Sources</h3>
          {data.sourceBreakdown.length === 0 ? (
            <div className="flex items-center justify-center h-44 text-gray-400 text-sm">No source data</div>
          ) : (
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={data.sourceBreakdown}
                      dataKey="count"
                      nameKey="source"
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={75}
                    >
                      {data.sourceBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [v, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 min-w-[120px] pt-2">
                {data.sourceBreakdown.map((s, i) => (
                  <div key={s.source} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-gray-600 truncate flex-1">{s.source.replace(/_/g, ' ')}</span>
                    <span className="text-gray-400 shrink-0">{totalSource > 0 ? Math.round(s.count / totalSource * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 3 – Conversion + SLA breaches */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stage conversion */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Stage Conversion</h3>
          <div className="space-y-3">
            {[
              { label: 'EL → MQL', value: data.conversionRates.elToMql },
              { label: 'MQL → DQL', value: data.conversionRates.mqlToDql },
              { label: 'DQL → PP', value: data.conversionRates.dqlToPp },
              { label: 'PP → Onboarding', value: data.conversionRates.ppToOnboarding },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-28 shrink-0">{r.label}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all"
                    style={{ width: `${Math.min(r.value, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-semibold text-brand-700 w-10 text-right">{r.value}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* SLA breaches */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              SLA Breaches
              {data.slaBreaches.activeCount > 0 && (
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {data.slaBreaches.activeCount}
                </span>
              )}
            </h3>
          </div>
          {data.slaBreaches.activeCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <span className="text-2xl mb-1">✓</span>
              <p className="text-sm font-medium text-gray-500">All clear</p>
              <p className="text-xs">No active SLA breaches</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
              {data.slaBreaches.list.map((b) => (
                <div key={b.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {b.lead.name}
                      <span className="text-gray-400 font-normal ml-1 text-xs">({b.lead.leadId})</span>
                    </p>
                    <p className="text-xs text-red-600">{RULE_LABELS[b.rule] ?? b.rule} · {hoursOverdue(b.breachedAt)}h overdue</p>
                  </div>
                  <Link
                    to={`/leads/${b.lead.id}`}
                    className="text-xs bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-lg text-gray-600 shrink-0 ml-2"
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 4 – Activity feed */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Today's Activity</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Calls Logged', value: data.teamActivity.callsToday, icon: '📞', color: 'bg-blue-50 text-blue-600' },
            { label: 'Stage Moves', value: data.teamActivity.stagesMovedToday, icon: '🔄', color: 'bg-purple-50 text-purple-600' },
            { label: 'Tasks Completed', value: data.teamActivity.tasksCompletedToday, icon: '✅', color: 'bg-green-50 text-green-600' },
          ].map((item) => (
            <div key={item.label} className={`rounded-xl p-4 ${item.color} bg-opacity-60`}>
              <div className="text-2xl mb-1">{item.icon}</div>
              <p className="text-3xl font-bold">{item.value}</p>
              <p className="text-xs font-medium mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── BL / Designer / CRE layout ─────────────────────────────────────────────

function BLDashboard({ data }: { data: DashboardData }) {
  const phaseData = data.phaseLoad.map((p) => ({
    phase: p.phase.charAt(0) + p.phase.slice(1).toLowerCase(),
    count: p.count,
    value: p.valueSum,
  }));

  const slaCount = data.slaBreaches?.activeCount ?? 0;
  const attentionCount = data.needsAttention.length;

  return (
    <div className="space-y-6">
      {/* Row 1 – KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          label="Sales Pipeline"
          value={fmt(data.pipelineValue)}
          sub={`${data.totalLeads ?? 0} leads in scope`}
          accent
        />
        <KPICard
          label="In Delivery"
          value={data.inDelivery.count}
          sub={`${fmt(data.inDelivery.contractValueSum)} in flight`}
        />
        <KPICard
          label="Collected This Month"
          value={fmt(data.collectedThisMonth)}
          sub="Payments in 30 days"
        />
        <KPICard
          label="Outstanding"
          value={fmt(data.outstanding)}
          sub="Yet to collect"
        />
        <KPICard
          label="Needs Attention"
          value={attentionCount + slaCount}
          sub={`${attentionCount} project · ${slaCount} SLA`}
        />
        <KPICard
          label="NPS"
          value={data.avgNPS != null ? data.avgNPS.toFixed(1) : '—'}
          sub="Avg score"
        />
      </div>

      <SectionHeader title="Delivery" />

      {/* Row 2 – Phase load + Needs attention */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Phase load */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Phase Load</h3>
          {phaseData.length === 0 ? (
            <div className="flex items-center justify-center h-44 text-gray-400 text-sm">No active projects</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={phaseData} margin={{ bottom: 4 }}>
                <XAxis dataKey="phase" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-xs">
                        <p className="font-semibold text-gray-900">{d.phase}</p>
                        <p className="text-gray-600">{d.count} project{d.count !== 1 ? 's' : ''}</p>
                        {d.value > 0 && <p className="text-gray-600">{fmt(d.value)} contract</p>}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {phaseData.map((d, i) => (
                    <Cell key={i} fill={PHASE_COLORS[d.phase.toUpperCase()] ?? '#d95f32'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Needs attention */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">Needs Attention</h3>
            {attentionCount > 0 && (
              <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{attentionCount}</span>
            )}
          </div>
          {data.needsAttention.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <span className="text-2xl mb-1">✓</span>
              <p className="text-sm font-medium text-gray-500">All clear</p>
              <p className="text-xs">No flagged projects</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
              {data.needsAttention.map((item) => (
                <div key={item.projectId} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.clientName}</p>
                      <p className="text-xs text-gray-500">{item.projectCode} · Lead {item.leadId}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${RISK_COLORS[item.category] ?? 'bg-gray-100 text-gray-600'}`}>
                      {item.category}
                    </span>
                  </div>
                  {item.description && (
                    <p className="text-xs text-gray-500 mt-1 truncate">{item.description}</p>
                  )}
                  {item.daysOverdue > 0 && (
                    <p className="text-xs text-red-500 mt-0.5">{item.daysOverdue}d past handover</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 3 – Collections due + Coming soon */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Collections due */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Collections Due</h3>
          </div>
          {data.collectionsDue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <span className="text-2xl mb-1">✓</span>
              <p className="text-sm font-medium text-gray-500">All clear</p>
              <p className="text-xs">No collections pending</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
              {data.collectionsDue.map((item) => (
                <div key={item.projectId} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.clientName}</p>
                    <p className="text-xs text-gray-500">{item.milestone}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-900">{fmt(item.amount)}</p>
                    {item.status && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        item.status === 'Due' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {item.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Site & service pulse — coming soon */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col items-center justify-center text-center min-h-[180px]">
          <span className="text-3xl mb-2">🔧</span>
          <h3 className="font-semibold text-gray-700 mb-1">Site & Service Pulse</h3>
          <p className="text-xs text-gray-400 max-w-[180px] leading-relaxed">
            Service & Warranty module is coming in a future release.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const user = getStoredUser();

  const isBH = user?.role === 'BRANCH_HEAD' || user?.role === 'ADMIN';

  useEffect(() => {
    api.get<DashboardData>('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {isBH ? 'Branch overview — all teams' : `Your scope · ${user?.name ?? ''}`}
          </p>
        </div>
        <Link
          to="/reports"
          className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-gray-700 transition-colors"
        >
          Full Reports →
        </Link>
      </div>

      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {[1,2,3,4,5,6].map((i) => <SkeletonCard key={i} />)}
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="h-64 bg-gray-200 rounded-xl animate-pulse" />
            <div className="h-64 bg-gray-200 rounded-xl animate-pulse" />
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">{error}</div>
      )}

      {data && (isBH ? <BHDashboard data={data} /> : <BLDashboard data={data} />)}
    </div>
  );
}
