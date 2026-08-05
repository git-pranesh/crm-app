import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Users, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import EmptyState from '../components/ui/EmptyState';

interface Lead {
  id: string; leadId: string; name: string; phone: string; email?: string;
  source?: string; stage: string; isSLABreached: boolean;
  estimatedValue?: string | null; intentRating?: number | null;
  onHoldRevivalDate?: string | null;
  firstOpenedAt?: string | null;
  isUnread?: boolean;
  avgNps?: number | null;
  createdAt: string; updatedAt: string;
  assignedDesigner?: { id: string; name: string } | null;
  assignedBL?: { id: string; name: string } | null;
  _count: { calls: number; meetings: number; followUpTasks: number };
}

function NpsBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-stone-300 text-xs">—</span>;
  const color = score >= 9 ? 'bg-green-100 text-green-700' : score >= 7 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${color}`}>{score}</span>;
}

const STAGE_COLORS: Record<string, string> = {
  EFFECTIVE_LEAD: 'bg-stone-100 text-stone-700',
  MQL: 'bg-amber-100 text-amber-800',
  DQL: 'bg-orange-100 text-orange-800',
  PROPOSAL_READY: 'bg-brand-50 text-brand-700',
  PROPOSAL_PRESENTED: 'bg-brand-100 text-brand-700',
  PROPOSAL_DISCUSSION: 'bg-purple-100 text-purple-700',
  ONBOARDING: 'bg-green-100 text-green-700',
  ONBOARDING_MEETING: 'bg-teal-100 text-teal-700',
  DESIGN_IN_PROGRESS: 'bg-emerald-100 text-emerald-700',
  HANDED_OVER: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-stone-100 text-stone-500',
  ON_HOLD: 'bg-stone-100 text-stone-600',
};

// NOTE: these abbreviations pre-date the funnel restructure and don't match
// the new PD/PP naming used elsewhere (PROPOSAL_READY→"PP" here is actually
// Proposal Ready, not Proposal Presented) — kept as-is to avoid an unrelated
// relabel; only new stages are added below with their real names.
const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'EL', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'PP', PROPOSAL_PRESENTED: 'PD',
  PROPOSAL_DISCUSSION: 'Proposal Discussion',
  ONBOARDING: 'Onboarding', ONBOARDING_MEETING: 'Onboarding Meeting',
  DESIGN_IN_PROGRESS: 'Design in Progress', HANDED_OVER: 'Handed Over',
  INACTIVE: 'Inactive', ON_HOLD: 'On Hold',
};

const STAGE_OPTIONS_ALL = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS',
  'HANDED_OVER', 'INACTIVE', 'ON_HOLD',
];
const STAGE_OPTIONS_DESIGNER = [
  'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS',
  'HANDED_OVER', 'INACTIVE', 'ON_HOLD',
];

function getCurrentUserRole(): string {
  try {
    const raw = localStorage.getItem('crm_user');
    if (!raw) return '';
    return JSON.parse(raw)?.role ?? '';
  } catch { return ''; }
}

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

  const userRole = getCurrentUserRole();
  const STAGE_OPTIONS = userRole === 'DESIGNER' ? STAGE_OPTIONS_DESIGNER : STAGE_OPTIONS_ALL;
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', source: '', projectType: '', location: '', scope: '', possessionTimeline: '', estimatedValue: '' });

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
    if (!newLead.name || !newLead.phone || !newLead.location || !newLead.source) {
      toast.error('Name, phone, location and source are required'); return;
    }
    const digits = newLead.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
    if (digits.length !== 10) {
      toast.error('Phone number must be exactly 10 digits'); return;
    }
    setCreating(true);
    try {
      const data = await api.post<{ lead: Lead }>('/leads', { ...newLead, phone: digits });
      toast.success(`Lead ${data.lead.leadId} created`);
      setNewLead({ name: '', phone: '', email: '', source: '', projectType: '', location: '', scope: '', possessionTimeline: '', estimatedValue: '' });
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
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="bg-white px-6 py-4" style={{ borderBottom: '1px solid #EDE8E3' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-stone-900 tracking-tight">Leads</h1>
            <p className="text-xs text-stone-400 mt-0.5">All leads in your scope</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="text-stone-600 px-3 py-2 rounded-xl text-sm hover:bg-stone-50 disabled:opacity-50 transition-colors font-medium"
              style={{ border: '1px solid #EDE8E3' }}
            >
              {exporting ? 'Exporting…' : '↓ Export CSV'}
            </button>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="bg-brand-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-600 transition-colors"
            >
              {showCreate ? 'Cancel' : '+ New Lead'}
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-2xl p-5 shadow-warm-sm" style={{ border: '1px solid #EDE8E3' }}>
            <h2 className="font-bold text-stone-900 mb-4 tracking-tight">Create New Lead</h2>
            <form onSubmit={handleCreate} className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { key: 'name', label: 'Full Name', required: true, placeholder: 'Priya Sharma' },
                { key: 'phone', label: 'Phone', required: true, placeholder: '98765 43210 (10 digits)' },
                { key: 'email', label: 'Email', placeholder: 'priya@example.com' },
                { key: 'projectType', label: 'Project Type', placeholder: '2BHK / Villa / Office' },
                { key: 'location', label: 'Location', required: true, placeholder: 'Whitefield, Bangalore' },
                { key: 'scope', label: 'Scope of Work', placeholder: '2-bedroom / 3-bedroom / Full home' },
                { key: 'possessionTimeline', label: 'Possession', placeholder: 'Immediate / 3 months / 6 months' },
                { key: 'estimatedValue', label: 'Estimated Value (₹)', placeholder: '1500000', type: 'number' },
              ].map((f: any) => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                    {f.label}{f.required && <span className="text-brand-500 ml-0.5">*</span>}
                  </label>
                  <input
                    value={(newLead as any)[f.key]}
                    onChange={(e) => setNewLead({ ...newLead, [f.key]: e.target.value })}
                    required={f.required}
                    placeholder={f.placeholder}
                    className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                    style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">Source</label>
                <select value={newLead.source} onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                  style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
                  <option value="">Select source</option>
                  {SOURCE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2 lg:col-span-3 flex justify-end">
                <button type="submit" disabled={creating}
                  className="bg-brand-500 text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 transition-colors">
                  {creating ? 'Creating…' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filter bar */}
        <div className="bg-white rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 shadow-warm-sm" style={{ border: '1px solid #EDE8E3' }}>
          <input
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search name, ID, phone, location…"
            className="flex-1 min-w-[200px] rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
          />
          <select value={filters.stage} onChange={(e) => setFilter('stage', e.target.value)}
            className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
            <option value="">All stages</option>
            {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}
            className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="On Hold">On Hold</option>
            <option value="Inactive">Inactive</option>
          </select>
          <select value={filters.source} onChange={(e) => setFilter('source', e.target.value)}
            className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-stone-400 hover:text-stone-600 underline">
              Clear
            </button>
          )}
        </div>

        {/* Count + Table */}
        <div className="bg-white rounded-2xl overflow-hidden shadow-warm-sm" style={{ border: '1px solid #EDE8E3' }}>
          <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid #EDE8E3' }}>
            <p className="text-xs text-stone-500 font-medium">
              {loading ? 'Loading…' : `${leads.length} of ${total} leads`}
            </p>
          </div>

          {loading ? (
            <div className="py-16 text-center text-stone-400 text-sm animate-pulse">Loading leads…</div>
          ) : leads.length === 0 ? (
            <EmptyState Icon={Users} title="No leads found" description="Try adjusting your filters or create a new lead"
              action={{ label: '+ New Lead', onClick: () => setShowCreate(true) }} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#FAF6F2', borderBottom: '1px solid #EDE8E3' }}>
                      {['Lead ID', 'Name', 'Stage', 'Status', 'Value', 'Designer', 'Source', 'Intent', 'Rating', 'NPS', 'Updated'].map((h) => (
                        <th key={h} className="text-left py-2.5 px-4 text-xs font-bold text-stone-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => {
                      const status = deriveStatus(lead.stage);
                      const isUnread = lead.isUnread && lead.assignedDesigner;
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => navigate(`/leads/${lead.id}`)}
                          className="cursor-pointer transition-colors"
                          style={{
                            borderBottom: '1px solid #F5F0EB',
                            borderLeft: isUnread ? '3px solid #d95f32' : '3px solid transparent',
                            background: isUnread ? '#FDFAF7' : undefined,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#FAF6F2')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = isUnread ? '#FDFAF7' : '')}
                        >
                          <td className="py-3 px-4">
                            <span className="text-brand-600 font-mono text-xs font-bold">{lead.leadId}</span>
                            {lead.isSLABreached && <AlertTriangle size={10} strokeWidth={2.5} className="ml-1 text-red-400 inline" />}
                            {isUnread && <span className="ml-1.5 text-[9px] font-bold bg-brand-100 text-brand-600 px-1.5 py-0.5 rounded-full">NEW</span>}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={isUnread ? 'font-extrabold text-stone-900' : 'font-semibold text-stone-900'}>{lead.name}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${STAGE_COLORS[lead.stage] ?? 'bg-stone-100 text-stone-600'}`}>
                              {STAGE_LABELS[lead.stage] ?? lead.stage}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[status]}`}>
                              {status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-stone-700 text-xs font-medium whitespace-nowrap">{fmtVal(lead.estimatedValue)}</td>
                          <td className="py-3 px-4">{avatar(lead.assignedDesigner?.name) ?? <span className="text-stone-300 text-xs">—</span>}</td>
                          <td className="py-3 px-4 text-stone-500 text-xs whitespace-nowrap">{lead.source?.replace(/_/g, ' ') ?? '—'}</td>
                          <td className={`py-3 px-4 text-xs ${intentColor(lead.intentRating)}`}>{intentLabel(lead.intentRating)}</td>
                          <td className="py-3 px-4"><Stars rating={lead.intentRating} /></td>
                          <td className="py-3 px-4"><NpsBadge score={lead.avgNps} /></td>
                          <td className="py-3 px-4 text-stone-400 text-xs whitespace-nowrap">{relTime(lead.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {pages > 1 && (
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: '1px solid #EDE8E3' }}>
                  <p className="text-xs text-stone-400">Page {page} of {pages}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                      className="text-xs px-3 py-1.5 rounded-xl disabled:opacity-40 hover:bg-stone-50 transition-colors"
                      style={{ border: '1px solid #EDE8E3' }}>
                      ← Prev
                    </button>
                    <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                      className="text-xs px-3 py-1.5 rounded-xl disabled:opacity-40 hover:bg-stone-50 transition-colors"
                      style={{ border: '1px solid #EDE8E3' }}>
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
