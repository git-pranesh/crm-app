import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import EmptyState from '../components/ui/EmptyState';

interface Lead {
  id: string; leadId: string; name: string; phone: string; email?: string;
  source?: string; stage: string; isSLABreached: boolean; createdAt: string;
  assignedDesigner?: { id: string; name: string } | null;
  assignedBL?: { id: string; name: string } | null;
  _count: { calls: number; meetings: number; followUpTasks: number };
}

const STAGE_COLORS: Record<string, string> = {
  EFFECTIVE_LEAD: 'bg-indigo-100 text-indigo-700',
  MQL: 'bg-purple-100 text-purple-700',
  DQL: 'bg-fuchsia-100 text-fuchsia-700',
  PROPOSAL_READY: 'bg-amber-100 text-amber-700',
  PROPOSAL_PRESENTED: 'bg-orange-100 text-orange-700',
  ONBOARDING: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-500',
  ON_HOLD: 'bg-slate-100 text-slate-600',
};

const STAGE_OPTIONS = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'ONBOARDING', 'INACTIVE', 'ON_HOLD',
];

const SOURCE_OPTIONS = [
  'META_ADS', 'GOOGLE_ADS', 'REFERRAL', 'WALK_IN', 'ORGANIC', 'OTHER',
];

export default function LeadList() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({ search: '', stage: '', source: '', isSLABreached: '' });
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', source: '', projectType: '', location: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (filters.search) params.set('search', filters.search);
      if (filters.stage) params.set('stage', filters.stage);
      if (filters.source) params.set('source', filters.source);
      if (filters.isSLABreached) params.set('isSLABreached', filters.isSLABreached);
      const data = await api.get<{ leads: Lead[]; total: number; pages: number }>(`/leads?${params}`);
      setLeads(data.leads);
      setTotal(data.total);
      setPages(data.pages);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLead.name || !newLead.phone) { toast.error('Name and phone are required'); return; }
    setCreating(true);
    try {
      const data = await api.post<{ lead: Lead }>('/leads', newLead);
      toast.success(`Lead ${data.lead.leadId} created`);
      setNewLead({ name: '', phone: '', email: '', source: '', projectType: '', location: '' });
      setShowCreate(false);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0 sm:justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Leads <span className="text-gray-400 font-normal text-base">({total})</span></h1>
              <p className="text-xs text-gray-400">All leads in your scope</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors self-start sm:self-auto"
          >
            {showCreate ? 'Cancel' : '+ New Lead'}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Create New Lead</h2>
            <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { key: 'name', label: 'Full Name', required: true, placeholder: 'Priya Sharma' },
                { key: 'phone', label: 'Phone', required: true, placeholder: '+91 98765 43210' },
                { key: 'email', label: 'Email', required: false, placeholder: 'priya@example.com' },
                { key: 'projectType', label: 'Project Type', required: false, placeholder: '2BHK / Villa / Office' },
                { key: 'location', label: 'Location', required: false, placeholder: 'Whitefield, Bangalore' },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <input
                    value={(newLead as any)[f.key]}
                    onChange={(e) => setNewLead({ ...newLead, [f.key]: e.target.value })}
                    required={f.required}
                    placeholder={f.placeholder}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
                <select value={newLead.source} onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
                  <option value="">Select source</option>
                  {SOURCE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <button type="submit" disabled={creating}
                  className="bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors">
                  {creating ? 'Creating…' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3">
          <input
            value={filters.search}
            onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(1); }}
            placeholder="Search name, phone, lead ID…"
            className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <select value={filters.stage} onChange={(e) => { setFilters({ ...filters, stage: e.target.value }); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
            <option value="">All Stages</option>
            {STAGE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={filters.source} onChange={(e) => { setFilters({ ...filters, source: e.target.value }); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
            <option value="">All Sources</option>
            {SOURCE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox"
              checked={filters.isSLABreached === 'true'}
              onChange={(e) => { setFilters({ ...filters, isSLABreached: e.target.checked ? 'true' : '' }); setPage(1); }}
              className="rounded border-gray-300 text-brand-500 focus:ring-brand-400"
            />
            SLA Breached
          </label>
          {(filters.search || filters.stage || filters.source || filters.isSLABreached) && (
            <button onClick={() => { setFilters({ search: '', stage: '', source: '', isSLABreached: '' }); setPage(1); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline">
              Clear filters
            </button>
          )}
        </div>

        {/* Leads table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Loading leads…</div>
          ) : leads.length === 0 ? (
            <EmptyState icon="👤" title="No leads found" description="Try adjusting your filters or create a new lead" action={{ label: '+ New Lead', onClick: () => setShowCreate(true) }} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {['Lead ID', 'Name', 'Phone', 'Stage', 'Source', 'Designer', 'Activity', 'Created'].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {leads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <Link to={`/leads/${lead.id}`}
                            className="text-brand-600 hover:underline font-mono text-xs font-medium">
                            {lead.leadId}
                          </Link>
                          {lead.isSLABreached && <span className="ml-1 text-red-500 text-xs">⚠</span>}
                        </td>
                        <td className="py-3 px-4 font-medium text-gray-900">{lead.name}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs font-mono">{lead.phone}</td>
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${STAGE_COLORS[lead.stage] ?? 'bg-gray-100 text-gray-600'}`}>
                            {lead.stage.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{lead.source ?? '—'}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{lead.assignedDesigner?.name ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">
                          📞{lead._count.calls} 📅{lead._count.meetings} ✅{lead._count.followUpTasks}
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">
                          {new Date(lead.createdAt).toLocaleDateString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pages > 1 && (
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-xs text-gray-400">Page {page} of {pages} ({total} total)</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                      className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                      ← Prev
                    </button>
                    <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                      className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
