import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import { api } from '../lib/api';

const REPORTS = [
  { id: 'lead_summary', label: 'Lead Summary', icon: '📊', desc: 'Total leads by source & time period' },
  { id: 'pipeline', label: 'Pipeline', icon: '🔄', desc: 'Stage distribution + avg days in stage' },
  { id: 'conversion', label: 'Conversion Rates', icon: '📈', desc: 'Stage-by-stage conversion %' },
  { id: 'timeline_performance', label: 'Timeline Performance', icon: '⏱️', desc: 'Avg days Lead→DQL→PP→Onboarding' },
  { id: 'designer_performance', label: 'Designer Performance', icon: '👤', desc: 'Leads, DQLs, PPs, onboardings per designer' },
  { id: 'bl_performance', label: 'BL Performance', icon: '👥', desc: 'Leads, closures, discount metrics per BL' },
  { id: 'source_performance', label: 'Source Performance', icon: '🎯', desc: 'Leads + conversion per source' },
  { id: 'campaign_performance', label: 'Campaign Performance', icon: '📣', desc: 'Leads + conversion per UTM campaign' },
  { id: 'inactive_leads', label: 'Inactive Leads', icon: '💤', desc: 'Who dropped, at what stage, client feedback' },
  { id: 'meeting_performance', label: 'Meeting Performance', icon: '📅', desc: 'Scheduled vs completed vs no-show per designer' },
  { id: 'sales_cycle', label: 'Sales Cycle', icon: '🏆', desc: 'Avg/fastest/slowest days to onboarding' },
  { id: 'lead_aging', label: 'Lead Aging', icon: '⏰', desc: 'Leads stuck past SLA threshold' },
  { id: 'monthly_trend', label: 'Monthly Trend', icon: '📆', desc: 'Leads per month + best/worst analysis' },
  { id: 'offer_performance', label: 'Offer Performance', icon: '🎁', desc: 'Onboardings + conversion rate per offer' },
];

const PIE_COLORS = ['#d95f32', '#f97316', '#f59e0b', '#6366f1', '#8b5cf6', '#22c55e', '#06b6d4'];

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-gray-400 text-center py-8">No data</p>;
  const headers = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {headers.map((h) => (
              <th key={h} className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {h.replace(/([A-Z])/g, ' $1').trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {headers.map((h) => (
                <td key={h} className="py-2.5 px-3 text-gray-700">
                  {row[h] === null || row[h] === undefined ? '—' : String(row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportChart({ type, data }: { type: string; data: unknown }) {
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : (data as any)?.monthly ?? [];
  if (!rows.length) return null;

  if (type === 'lead_summary' || type === 'source_performance' || type === 'offer_performance') {
    const key = type === 'offer_performance' ? 'offer' : 'source';
    return (
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={rows} dataKey="count" nameKey={key} cx="50%" cy="50%" outerRadius={70}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
            {rows.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'monthly_trend') {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={rows}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="leads" stroke="#d95f32" strokeWidth={2} dot={false} name="Leads" />
          <Line type="monotone" dataKey="onboardings" stroke="#22c55e" strokeWidth={2} dot={false} name="Onboardings" />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'pipeline' || type === 'conversion' || type === 'designer_performance' || type === 'meeting_performance') {
    const numKeys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number');
    const labelKey = Object.keys(rows[0])[0];
    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows}>
          <XAxis dataKey={labelKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {numKeys.slice(0, 3).map((k, i) => (
            <Bar key={k} dataKey={k} fill={PIE_COLORS[i]} radius={[3, 3, 0, 0]} name={k} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return null;
}

export default function Reports() {
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ startDate: '', endDate: '' });

  const runReport = async (type: string) => {
    setSelected(type);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      const qs = params.toString();
      const result = await api.get<{ type: string; data: unknown }>(`/reports/${type}${qs ? '?' + qs : ''}`);
      setData(result.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!selected) return;
    const params = new URLSearchParams();
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    const qs = params.toString();
    window.open(`/api/reports/${selected}/export${qs ? '?' + qs : ''}`, '_blank');
  };

  const tableRows = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : (data as any)?.monthly ?? (data ? [data] : []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link to="/dashboard" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Reports</h1>
            <p className="text-xs text-gray-400">14 report types — select to generate</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 flex gap-6">
        {/* Sidebar report list */}
        <div className="w-64 shrink-0">
          {/* Date filters */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date Range</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {REPORTS.map((r) => (
              <button
                key={r.id}
                onClick={() => runReport(r.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors ${
                  selected === r.id ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''
                }`}
              >
                <span className="text-lg shrink-0">{r.icon}</span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${selected === r.id ? 'text-brand-700' : 'text-gray-800'}`}>
                    {r.label}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{r.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {!selected && (
            <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-20">
              <p className="text-5xl mb-4">📊</p>
              <p className="font-semibold text-gray-900 mb-1">Select a report</p>
              <p className="text-sm text-gray-400">Choose from the list on the left to generate a report</p>
            </div>
          )}

          {selected && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Report header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div>
                  <h2 className="font-semibold text-gray-900">
                    {REPORTS.find((r) => r.id === selected)?.label}
                  </h2>
                  <p className="text-xs text-gray-400">
                    {REPORTS.find((r) => r.id === selected)?.desc}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => runReport(selected)}
                    className="text-xs bg-brand-500 text-white px-3 py-1.5 rounded-lg hover:bg-brand-600 transition-colors"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={exportCSV}
                    disabled={!data}
                    className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    ↓ Export CSV
                  </button>
                </div>
              </div>

              {loading && (
                <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Generating report…</div>
              )}
              {error && (
                <div className="px-6 py-4 text-red-500 text-sm">{error}</div>
              )}

              {data && !loading && (
                <div className="p-6 space-y-6">
                  {/* Chart */}
                  {tableRows.length > 0 && (
                    <div>
                      <ReportChart type={selected} data={data} />
                    </div>
                  )}

                  {/* Monthly trend summary */}
                  {selected === 'monthly_trend' && (data as any)?.bestMonth && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-green-50 rounded-xl p-4">
                        <p className="text-xs text-green-600 font-medium">Best Month</p>
                        <p className="text-lg font-bold text-green-700">{(data as any).bestMonth}</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-4">
                        <p className="text-xs text-red-600 font-medium">Worst Month</p>
                        <p className="text-lg font-bold text-red-700">{(data as any).worstMonth}</p>
                      </div>
                    </div>
                  )}

                  {/* Data table */}
                  <DataTable rows={tableRows} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
