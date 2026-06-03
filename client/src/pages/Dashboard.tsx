import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../lib/api';

interface DashboardData {
  totalLeads: number;
  leadsToday: number;
  leadsThisWeek: number;
  leadsThisMonth: number;
  stageFunnel: { stage: string; count: number }[];
  sourceBreakdown: { source: string; count: number }[];
  conversionRates: { elToMql: number; mqlToDql: number; dqlToPp: number; ppToOnboarding: number };
  slaBreaches: {
    activeCount: number;
    list: { id: string; rule: string; breachedAt: string; lead: { id: string; leadId: string; name: string; stage: string } }[];
  };
  teamActivity: { callsToday: number; stagesMovedToday: number; tasksCompletedToday: number };
  personalStats: { activeLeads: number; ppDone: number; onboardings: number; targetVsAchieved: { target: number | null; achieved: number } };
}

const STAGE_COLORS: Record<string, string> = {
  EFFECTIVE_LEAD: '#6366f1', MQL: '#8b5cf6', DQL: '#d946ef',
  PROPOSAL_READY: '#f59e0b', PROPOSAL_PRESENTED: '#f97316', ONBOARDING: '#22c55e',
};
const PIE_COLORS = ['#d95f32', '#f97316', '#f59e0b', '#6366f1', '#8b5cf6', '#22c55e', '#06b6d4'];

const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'Eff. Lead', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'Prop. Ready', PROPOSAL_PRESENTED: 'Prop. Done', ONBOARDING: 'Onboarding',
};

const RULE_LABELS: Record<string, string> = {
  FIRST_CONTACT: 'First Contact >24h', LEAD_TO_MQL: 'Lead→MQL >5d',
  MQL_TO_DQL: 'MQL→DQL >5d', PROPOSAL_TO_PP: 'Proposal→PP >2d',
};

function StatCard({ label, value, sub, color = 'brand' }: { label: string; value: number | string; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    brand: 'bg-brand-50 border-brand-200 text-brand-600',
    green: 'bg-green-50 border-green-200 text-green-600',
    red: 'bg-red-50 border-red-200 text-red-600',
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
  };
  return (
    <div className={`border rounded-xl p-5 ${colors[color]}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm font-medium mt-1 opacity-80">{label}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Home</Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
                <span className="text-white text-sm font-bold">D</span>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
                <p className="text-xs text-gray-400">Interiors by DeX CRM</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/reports" className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-gray-700 transition-colors">Reports →</Link>
            <Link to="/inbox" className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-gray-700 transition-colors">Inbox</Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {loading && (
          <div className="text-center py-20 text-gray-400 animate-pulse">Loading dashboard…</div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">{error}</div>
        )}

        {data && (
          <>
            {/* Lead count cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Leads" value={data.totalLeads} color="brand" />
              <StatCard label="Today" value={data.leadsToday} sub="leads created" color="blue" />
              <StatCard label="This Week" value={data.leadsThisWeek} sub="leads created" color="blue" />
              <StatCard label="This Month" value={data.leadsThisMonth} sub="leads created" color="blue" />
            </div>

            {/* Personal stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Active Leads" value={data.personalStats.activeLeads} color="brand" />
              <StatCard label="PP Done" value={data.personalStats.ppDone} color="blue" />
              <StatCard label="Onboardings" value={data.personalStats.onboardings} color="green" />
              {data.slaBreaches.activeCount > 0
                ? <StatCard label="SLA Breaches" value={data.slaBreaches.activeCount} sub="active" color="red" />
                : <StatCard label="SLA Status" value="✓ Clean" color="green" />
              }
            </div>

            {/* Team activity */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Today's Activity</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Calls Logged', value: data.teamActivity.callsToday, icon: '📞' },
                  { label: 'Stage Moves', value: data.teamActivity.stagesMovedToday, icon: '🔄' },
                  { label: 'Tasks Completed', value: data.teamActivity.tasksCompletedToday, icon: '✅' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3 bg-gray-50 rounded-xl p-4">
                    <span className="text-2xl">{item.icon}</span>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{item.value}</p>
                      <p className="text-xs text-gray-500">{item.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Stage funnel */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4">Pipeline Funnel</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.stageFunnel.map((s) => ({ ...s, stage: STAGE_LABELS[s.stage] ?? s.stage }))}>
                    <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {data.stageFunnel.map((s, i) => (
                        <Cell key={s.stage} fill={STAGE_COLORS[s.stage] ?? '#d95f32'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Source breakdown */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4">Lead Sources</h2>
                {data.sourceBreakdown.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No source data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={data.sourceBreakdown}
                        dataKey="count"
                        nameKey="source"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ source, percent }) => `${source} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {data.sourceBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Conversion rates */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Conversion Rates</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'EL → MQL', value: data.conversionRates.elToMql },
                  { label: 'MQL → DQL', value: data.conversionRates.mqlToDql },
                  { label: 'DQL → PP', value: data.conversionRates.dqlToPp },
                  { label: 'PP → Onboarding', value: data.conversionRates.ppToOnboarding },
                ].map((r) => (
                  <div key={r.label} className="text-center">
                    <p className="text-3xl font-bold text-brand-600">{r.value}%</p>
                    <p className="text-xs text-gray-500 mt-1">{r.label}</p>
                    <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${r.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* SLA Breaches panel */}
            {data.slaBreaches.activeCount > 0 && (
              <div className="bg-white rounded-xl border border-red-200">
                <div className="flex items-center justify-between px-5 py-4 border-b border-red-100">
                  <h2 className="font-semibold text-red-700 flex items-center gap-2">
                    <span>⚠️</span>
                    Active SLA Breaches
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                      {data.slaBreaches.activeCount}
                    </span>
                  </h2>
                  <Link to="/dashboard" className="text-xs text-red-500 hover:underline">View all →</Link>
                </div>
                <div className="divide-y divide-red-50">
                  {data.slaBreaches.list.map((b) => (
                    <div key={b.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{b.lead.name}
                          <span className="text-gray-400 font-normal ml-1 text-xs">({b.lead.leadId})</span>
                        </p>
                        <p className="text-xs text-red-600">{RULE_LABELS[b.rule] ?? b.rule}</p>
                      </div>
                      <Link
                        to={`/leads/${b.lead.id}`}
                        className="text-xs bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-lg text-gray-600"
                      >
                        View Lead →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
