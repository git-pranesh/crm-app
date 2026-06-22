import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import EmptyState from '../components/ui/EmptyState';

interface Lead {
  id: string; leadId: string; name: string; phone: string; email?: string;
  source?: string; stage: string; isSLABreached: boolean;
  estimatedValue?: string | null; intentRating?: number | null;
  onHoldRevivalDate?: string | null;
  createdAt: string; updatedAt: string;
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
  HANDED_OVER: 'bg-teal-100 text-teal-700',
  INACTIVE: 'bg-gray-100 text-gray-500',
  ON_HOLD: 'bg-slate-100 text-slate-600',
};

const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'EL', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'PP', PROPOSAL_PRESENTED: 'PD',
  ONBOARDING: 'Onboarding', HANDED_OVER: 'Handed Over',
  INACTIVE: 'Inactive', ON_HOLD: 'On Hold',
};

const STAGE_OPTIONS = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY',
  'PROPOSAL_PRESENTED', 'ONBOARDING', 'HANDED_OVER', 'INACTIVE', 'ON_HOLD',
];

const SOURCE_OPTIONS = ['META_ADS', 'GOOGLE_ADS', 'REFERRAL', 'WALK_IN', 'ORGANIC', 'OTHER'];

function deriveStatus(stage: string): 'Active' | 'On Hold' | 'Inactive' {
  if (stage === 'INACTIVE') return 'Inactive';
  if (stage === 'ON_HOLD') return 'On Hold';
  return 'Active';
}

const STATUS_COLORS = {
  Active: 'bg-green-100 text-green-700',
  'On Hold': 'bg-slate-100 text-slate-600',
  Inactive: 'bg-gray-100 text-gray-500',
};

function intentLabel(r?: number | null) {
  if (!r) return '—';
  if (r <= 2) return 'Low';
  if (r === 3) return 'Medium';
  return 'High';
}

function intentColor(r?: number | null) {
  if (!r) return 'text-gray-400';
  if (r <= 2) return 'text-gray-500';
  if (r === 3) return 'text-amber-600';
  return 'text-green-600 font-medium';
}

function Stars({ rating }: { rating?: number | null }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`text-sm ${i < (rating ?? 0) ? 'text-amber-400' : 'text-gray-200'}`}>★</span>
      ))}
    </span>
  );
}

function fmtVal(v?: string | number | null) {
  if (!v) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function relTime(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function avatar(name?: string | null) {
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center shrink-0">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="text-gray-700 text-xs truncate max-w-[80px]">{name}</span>
    </span>
  );
}

export default function LeadList() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({ search: '', stage: '', source: '', status: '' });
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', source: '', projectType: '', location: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (filters.search) params.set('search', filters.search);
      if (filters.stage) params.set('stage', filters.stage);
      if (filters.source) params.set('source', filters.source);
      if (filters.status) params.set('status', filters.status);
      const data = await api.get<{ leads: Lead[]; total: number; pages: number }>(`/leads?${params}`);
      setLeads(data.leads);
      setTotal(data.total);
      setPages(data.pages);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, filters.search, filters.stage, filters.source, filters.status]);

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

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const exportParams = new URLSearchParams();
      if (filters.search) exportParams.set('search', filters.search);
      if (filters.stage) exportParams.set('stage', filters.stage);
      if (filters.source) exportParams.set('source', filters.source);
      if (filters.status) exportParams.set('status', filters.status);
      const resp = await fetch(`/api/leads/export?${exportParams}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      if (!resp.ok) { toast.error('Export failed'); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const clearFilters = () => { setFilters({ search: '', stage: '', source: '', status: '' }); setPage(1); };
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Leads</h1>
            <p className="text-xs text-gray-400 mt-0.5">All leads in your scope</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="border border-gray-200 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {exporting ? 'Exporting…' : '↓ Export CSV'}
            </button>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
            >
              {showCreate ? 'Cancel' : '+ New Lead'}
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Create New Lead</h2>
            <form onSubmit={handleCreate} className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { key: 'name', label: 'Full Name', required: true, placeholder: 'Priya Sharma' },
                { key: 'phone', label: 'Phone', required: true, placeholder: '+91 98765 43210' },
                { key: 'email', label: 'Email', placeholder: 'priya@example.com' },
                { key: 'projectType', label: 'Project Type', placeholder: '2BHK / Villa / Office' },
                { key: 'location', label: 'Location', placeholder: 'Whitefield, Bangalore' },
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
              <div className="col-span-2 lg:col-span-3 flex justify-end">
                <button type="submit" disabled={creating}
                  className="bg-brand-500 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors">
                  {creating ? 'Creating…' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <input
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search name, ID, phone, location…"
            className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <select value={filters.stage} onChange={(e) => setFilter('stage', e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
            <option value="">All stages</option>
            {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="On Hold">On Hold</option>
            <option value="Inactive">Inactive</option>
          </select>
          <select value={filters.source} onChange={(e) => setFilter('source', e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Clear
            </button>
          )}
        </div>

        {/* Count + Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {loading ? 'Loading…' : `${leads.length} of ${total} leads`}
            </p>
          </div>

          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Loading leads…</div>
          ) : leads.length === 0 ? (
            <EmptyState icon="👤" title="No leads found" description="Try adjusting your filters or create a new lead"
              action={{ label: '+ New Lead', onClick: () => setShowCreate(true) }} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['Lead ID', 'Name', 'Stage', 'Status', 'Value', 'Designer', 'Source', 'Intent', 'Rating', 'Updated'].map((h) => (
                        <th key={h} className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {leads.map((lead) => {
                      const status = deriveStatus(lead.stage);
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => navigate(`/leads/${lead.id}`)}
                          className="hover:bg-gray-50 cursor-pointer"
                        >
                          <td className="py-3 px-4">
                            <span className="text-brand-600 font-mono text-xs font-semibold">{lead.leadId}</span>
                            {lead.isSLABreached && <span className="ml-1 text-red-400 text-xs">⚠</span>}
                          </td>
                          <td className="py-3 px-4 font-medium text-gray-900 whitespace-nowrap">{lead.name}</td>
                          <td className="py-3 px-4">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STAGE_COLORS[lead.stage] ?? 'bg-gray-100 text-gray-600'}`}>
                              {STAGE_LABELS[lead.stage] ?? lead.stage}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status]}`}>
                              {status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-700 text-xs whitespace-nowrap">{fmtVal(lead.estimatedValue)}</td>
                          <td className="py-3 px-4">{avatar(lead.assignedDesigner?.name) ?? <span className="text-gray-300 text-xs">—</span>}</td>
                          <td className="py-3 px-4 text-gray-500 text-xs whitespace-nowrap">{lead.source?.replace(/_/g, ' ') ?? '—'}</td>
                          <td className={`py-3 px-4 text-xs ${intentColor(lead.intentRating)}`}>{intentLabel(lead.intentRating)}</td>
                          <td className="py-3 px-4"><Stars rating={lead.intentRating} /></td>
                          <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">{relTime(lead.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {pages > 1 && (
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-xs text-gray-400">Page {page} of {pages}</p>
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
