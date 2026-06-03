import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface SLABreach {
  id: string;
  rule: string;
  breachedAt: string;
  resolvedAt: string | null;
  lead: {
    id: string;
    leadId: string;
    name: string;
    stage: string;
    assignedDesigner?: { name: string } | null;
    assignedBL?: { name: string } | null;
  };
}

interface SLASummary {
  total: number;
  active: number;
  byRule: Record<string, number>;
}

const RULE_LABELS: Record<string, { label: string; color: string }> = {
  FIRST_CONTACT: { label: 'First Contact >24h', color: 'bg-red-100 text-red-700' },
  LEAD_TO_MQL: { label: 'Lead → MQL >5 days', color: 'bg-orange-100 text-orange-700' },
  MQL_TO_DQL: { label: 'MQL → DQL >5 days', color: 'bg-amber-100 text-amber-700' },
  PROPOSAL_TO_PP: { label: 'Proposal → PP >2 days', color: 'bg-yellow-100 text-yellow-700' },
};

export default function Dashboard() {
  const [breaches, setBreaches] = useState<SLABreach[]>([]);
  const [summary, setSummary] = useState<SLASummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [resolving, setResolving] = useState<string | null>(null);

  const loadBreaches = async () => {
    try {
      const data = await api.get<{ breaches: SLABreach[]; summary: SLASummary }>(
        `/sla/breaches?resolved=${filter === 'all' ? '' : 'false'}`,
      );
      setBreaches(data.breaches);
      setSummary(data.summary);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBreaches(); }, [filter]);

  const handleResolve = async (breachId: string) => {
    setResolving(breachId);
    try {
      await api.patch(`/sla/breaches/${breachId}/resolve`, {});
      await loadBreaches();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResolving(null);
    }
  };

  const daysSince = (date: string) => {
    return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Back</Link>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
              <span className="text-white text-sm font-bold">D</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
              <p className="text-xs text-gray-400">SLA &amp; Pipeline Overview</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* SLA Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-3xl font-bold text-red-500">{summary.active}</p>
              <p className="text-xs text-gray-500 mt-1">Active Breaches</p>
            </div>
            {Object.entries(RULE_LABELS).map(([rule, { label, color }]) => (
              <div key={rule} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-3xl font-bold text-gray-800">{summary.byRule[rule] ?? 0}</p>
                <p className="text-xs text-gray-500 mt-1">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* SLA Breach Panel */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">SLA Breaches</h2>
            <div className="flex gap-2">
              {(['active', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filter === f
                      ? 'bg-brand-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'active' ? 'Active' : 'All'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm animate-pulse">Loading breaches…</div>
          ) : error ? (
            <div className="text-center py-12 text-red-400 text-sm">{error}</div>
          ) : breaches.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-gray-500 text-sm">No {filter === 'active' ? 'active ' : ''}SLA breaches</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {breaches.map((breach) => {
                const ruleInfo = RULE_LABELS[breach.rule];
                return (
                  <div key={breach.id} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div className="flex items-start gap-3">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full mt-0.5 shrink-0 ${ruleInfo?.color ?? 'bg-gray-100 text-gray-600'}`}>
                        {ruleInfo?.label ?? breach.rule}
                      </span>
                      <div>
                        <Link
                          to={`/leads/${breach.lead.id}`}
                          className="font-medium text-gray-900 text-sm hover:text-brand-600 transition-colors"
                        >
                          {breach.lead.name}
                          <span className="text-gray-400 font-normal ml-1">({breach.lead.leadId})</span>
                        </Link>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Stage: {breach.lead.stage.replace('_', ' ')} ·{' '}
                          {breach.lead.assignedDesigner?.name ?? 'Unassigned'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {breach.resolvedAt
                            ? `Resolved ${new Date(breach.resolvedAt).toLocaleDateString('en-IN')}`
                            : `Breached ${daysSince(breach.breachedAt)} day${daysSince(breach.breachedAt) !== 1 ? 's' : ''} ago`}
                        </p>
                      </div>
                    </div>

                    {!breach.resolvedAt && (
                      <button
                        onClick={() => handleResolve(breach.id)}
                        disabled={resolving === breach.id}
                        className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors shrink-0 disabled:opacity-50"
                      >
                        {resolving === breach.id ? '…' : 'Resolve'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Navigation links */}
        <div className="grid grid-cols-2 gap-4">
          <Link
            to="/inbox"
            className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-3 hover:border-brand-300 transition-colors"
          >
            <span className="text-2xl">💬</span>
            <div>
              <p className="font-medium text-gray-900 text-sm">WhatsApp Inbox</p>
              <p className="text-xs text-gray-400">View all conversations</p>
            </div>
          </Link>
          <Link
            to="/tasks/team"
            className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-3 hover:border-brand-300 transition-colors"
          >
            <span className="text-2xl">📋</span>
            <div>
              <p className="font-medium text-gray-900 text-sm">Team Tasks</p>
              <p className="text-xs text-gray-400">Overdue &amp; upcoming</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
