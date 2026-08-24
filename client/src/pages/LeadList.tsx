import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Users, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import EmptyState from '../components/ui/EmptyState';
import StatusBadge, { STATUS_LABELS, STATUS_COLORS } from '../components/StatusBadge';
import { SOURCE_OPTIONS } from '../lib/leadSources';
import { DateInput } from '../components/ui/DateTimeInputs';

interface Lead {
  id: string; leadId: string; name: string; phone: string; email?: string;
  source?: string; stage: string; status: 'ACTIVE' | 'ON_HOLD' | 'INACTIVE'; isSLABreached: boolean;
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
  // Legacy stage values, kept only for historical rows — no longer assignable.
  INACTIVE: 'bg-stone-100 text-stone-500',
  ON_HOLD: 'bg-stone-100 text-stone-600',
};

// Kept in lockstep with Pipeline.tsx's STAGE_LABELS — the abbreviations that
// used to live here (PP/PD/EL) disagreed with the Sales Pipeline's full-name
// labels for the exact same enum values, which was confusing when comparing
// the two views of the same leads.
const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'Effective Lead', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'Proposal Ready', PROPOSAL_PRESENTED: 'Proposal Presented',
  PROPOSAL_DISCUSSION: 'Proposal Discussion',
  ONBOARDING: 'Onboarding', ONBOARDING_MEETING: 'Onboarding Meeting',
  DESIGN_IN_PROGRESS: 'Design in Progress', HANDED_OVER: 'Handed Over',
  INACTIVE: 'Inactive', ON_HOLD: 'On Hold',
};

// Task #88: ON_HOLD/INACTIVE are status values, not stages — dropped from
// the stage filter options (the separate Status filter covers them).
const STAGE_OPTIONS_ALL = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS',
  'HANDED_OVER',
];
const STAGE_OPTIONS_DESIGNER = [
  'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS',
  'HANDED_OVER',
];

function getCurrentUserRole(): string {
  try {
    const raw = localStorage.getItem('crm_user');
    if (!raw) return '';
    return JSON.parse(raw)?.role ?? '';
  } catch { return ''; }
}

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
  const [searchParams] = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  // Seed filters from the URL so links elsewhere in the app (e.g. dashboard
  // KPI tiles) can deep-link into a pre-filtered list, e.g. /leads?status=ACTIVE.
  const [filters, setFilters] = useState({
    search: '',
    stage: searchParams.get('stage') ?? '',
    source: searchParams.get('source') ?? '',
    status: searchParams.get('status') ?? '',
    projectType: '',
    location: '',
    originDateFrom: '',
    originDateTo: '',
    budgetMin: '',
    budgetMax: '',
    possessionDateFrom: '',
    possessionDateTo: '',
    intent: '',
    projectedObFrom: '',
    projectedObTo: '',
    slaBreached: searchParams.get('slaBreached') ?? '',
    excludeStages: searchParams.get('excludeStages') ?? '',
    hasUnresolvedSlaBreach: searchParams.get('hasUnresolvedSlaBreach') ?? '',
  });
  const [statusSummary, setStatusSummary] = useState<Record<string, { count: number; value: number }> | null>(null);

  const userRole = getCurrentUserRole();
  const STAGE_OPTIONS = userRole === 'DESIGNER' ? STAGE_OPTIONS_DESIGNER : STAGE_OPTIONS_ALL;

  // Task #88 — overall Active / On Hold / Inactive counts + value, independent of the current filters.
  useEffect(() => {
    api.get<{ overall: Record<string, { count: number; value: number }> }>('/leads/meta/status-summary')
      .then((d) => setStatusSummary(d.overall ?? null))
      .catch(() => {});
  }, [leads]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (filters.search) params.set('search', filters.search);
      if (filters.stage) params.set('stage', filters.stage);
      if (filters.source) params.set('source', filters.source);
      if (filters.status) params.set('status', filters.status);
      if (filters.projectType) params.set('projectType', filters.projectType);
      if (filters.location) params.set('location', filters.location);
      if (filters.originDateFrom) params.set('originDateFrom', filters.originDateFrom);
      if (filters.originDateTo) params.set('originDateTo', filters.originDateTo);
      if (filters.budgetMin) params.set('budgetMin', filters.budgetMin);
      if (filters.budgetMax) params.set('budgetMax', filters.budgetMax);
      if (filters.possessionDateFrom) params.set('possessionDateFrom', filters.possessionDateFrom);
      if (filters.possessionDateTo) params.set('possessionDateTo', filters.possessionDateTo);
      if (filters.intent) params.set('intent', filters.intent);
      if (filters.projectedObFrom) params.set('projectedObFrom', filters.projectedObFrom);
      if (filters.projectedObTo) params.set('projectedObTo', filters.projectedObTo);
      if (filters.slaBreached) params.set('isSLABreached', filters.slaBreached);
      if (filters.excludeStages) params.set('excludeStages', filters.excludeStages);
      if (filters.hasUnresolvedSlaBreach) params.set('hasUnresolvedSlaBreach', filters.hasUnresolvedSlaBreach);
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

  /** The canonical "New Lead" form lives in the global Layout modal (opened from
   * the sidebar) so there is exactly one create flow, one set of validation
   * rules, and one field order. This page's "+ New Lead" button just opens it. */
  const openNewLeadModal = () => window.dispatchEvent(new CustomEvent('open-new-lead-modal'));

  const handleExport = async (fmt: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const exportParams = new URLSearchParams();
      if (filters.search) exportParams.set('search', filters.search);
      if (filters.stage) exportParams.set('stage', filters.stage);
      if (filters.source) exportParams.set('source', filters.source);
       if (filters.status) exportParams.set('status', filters.status);
       if (filters.projectType) exportParams.set('projectType', filters.projectType);
       if (filters.location) exportParams.set('location', filters.location);
       if (filters.originDateFrom) exportParams.set('originDateFrom', filters.originDateFrom);
       if (filters.originDateTo) exportParams.set('originDateTo', filters.originDateTo);
       if (filters.budgetMin) exportParams.set('budgetMin', filters.budgetMin);
       if (filters.budgetMax) exportParams.set('budgetMax', filters.budgetMax);
       if (filters.possessionDateFrom) exportParams.set('possessionDateFrom', filters.possessionDateFrom);
       if (filters.possessionDateTo) exportParams.set('possessionDateTo', filters.possessionDateTo);
       if (filters.intent) exportParams.set('intent', filters.intent);
       if (filters.projectedObFrom) exportParams.set('projectedObFrom', filters.projectedObFrom);
       if (filters.projectedObTo) exportParams.set('projectedObTo', filters.projectedObTo);
      if (fmt === 'xlsx') exportParams.set('format', 'xlsx');
      const resp = await fetch(`/api/leads/export?${exportParams}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      if (!resp.ok) { toast.error('Export failed'); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_export_${new Date().toISOString().slice(0, 10)}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${fmt.toUpperCase()} downloaded`);
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

  const clearFilters = () => {
    setFilters({
      search: '', stage: '', source: '', status: '', projectType: '', location: '',
      originDateFrom: '', originDateTo: '', budgetMin: '', budgetMax: '',
      possessionDateFrom: '', possessionDateTo: '', intent: '',
      projectedObFrom: '', projectedObTo: '', slaBreached: '', excludeStages: '',
      hasUnresolvedSlaBreach: '',
    });
    setPage(1);
  };
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
            {/* Task #90 — export controls are admin/BL only; the designer/CRE
                portal no longer surfaces them (they're read-only on scope
                anyway). Excel export is Branch Head admin-only. */}
            {userRole !== 'DESIGNER' && userRole !== 'CRE' && (
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting}
                className="text-stone-600 px-3 py-2 rounded-xl text-sm hover:bg-stone-50 disabled:opacity-50 transition-colors font-medium"
                style={{ border: '1px solid #EDE8E3' }}
              >
                {exporting ? 'Exporting…' : '↓ Export CSV'}
              </button>
            )}
            {userRole === 'BRANCH_HEAD' && (
              <button
                onClick={() => handleExport('xlsx')}
                disabled={exporting}
                className="text-stone-600 px-3 py-2 rounded-xl text-sm hover:bg-stone-50 disabled:opacity-50 transition-colors font-medium"
                style={{ border: '1px solid #EDE8E3' }}
              >
                {exporting ? 'Exporting…' : '↓ Export Excel'}
              </button>
            )}
            <button
              onClick={openNewLeadModal}
              className="bg-brand-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-600 transition-colors"
            >
              + New Lead
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Task #88 — status split summary */}
        {statusSummary && (
          <div className="grid grid-cols-3 gap-3">
            {(['ACTIVE', 'ON_HOLD', 'INACTIVE'] as const).map((s) => (
              <div key={s} className="bg-white rounded-2xl px-4 py-3 shadow-warm-sm flex items-center justify-between" style={{ border: '1px solid #EDE8E3' }}>
                <div>
                  <p className="text-xs font-semibold text-stone-500">{STATUS_LABELS[s]}</p>
                  <p className="text-lg font-extrabold text-stone-900">{statusSummary[s]?.count ?? 0}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[s]}`}>
                  {fmtVal(statusSummary[s]?.value ?? 0)}
                </span>
              </div>
            ))}
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
            <option value="ACTIVE">Active</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <select value={filters.source} onChange={(e) => setFilter('source', e.target.value)}
            className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <input value={filters.projectType} onChange={(e) => setFilter('projectType', e.target.value)}
            placeholder="Project type"
            className="rounded-xl px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-brand-300"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
          <input value={filters.location} onChange={(e) => setFilter('location', e.target.value)}
            placeholder="Location"
            className="rounded-xl px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-brand-300"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
          <DateInput value={filters.originDateFrom} onChange={(v) => setFilter('originDateFrom', v)}
            placeholderText="Origin date (from)" className="rounded-xl px-3 py-1.5 text-sm border-[#EDE8E3] bg-[#FDFAF7] focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <DateInput value={filters.originDateTo} onChange={(v) => setFilter('originDateTo', v)}
            placeholderText="Origin date (to)" className="rounded-xl px-3 py-1.5 text-sm border-[#EDE8E3] bg-[#FDFAF7] focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input type="number" value={filters.budgetMin} onChange={(e) => setFilter('budgetMin', e.target.value)}
            placeholder="Budget min ₹" className="rounded-xl px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-brand-300"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
          <input type="number" value={filters.budgetMax} onChange={(e) => setFilter('budgetMax', e.target.value)}
            placeholder="Budget max ₹" className="rounded-xl px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-brand-300"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
          <DateInput value={filters.possessionDateFrom} onChange={(v) => setFilter('possessionDateFrom', v)}
            placeholderText="Possession date (from)" className="rounded-xl px-3 py-1.5 text-sm border-[#EDE8E3] bg-[#FDFAF7] focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <DateInput value={filters.possessionDateTo} onChange={(v) => setFilter('possessionDateTo', v)}
            placeholderText="Possession date (to)" className="rounded-xl px-3 py-1.5 text-sm border-[#EDE8E3] bg-[#FDFAF7] focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <select value={filters.intent} onChange={(e) => setFilter('intent', e.target.value)}
            title="Intent rating" className="rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
            <option value="">Any intent</option>
            <option value="1">1 star</option><option value="2">2 stars</option>
            <option value="3">3 stars</option><option value="4">4 stars</option><option value="5">5 stars</option>
          </select>
          <DateInput value={filters.projectedObFrom} onChange={(v) => setFilter('projectedObFrom', v)}
            placeholderText="Expected OB date (from)" className="rounded-xl px-3 py-1.5 text-sm border-[#EDE8E3] bg-[#FDFAF7] focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <DateInput value={filters.projectedObTo} onChange={(v) => setFilter('projectedObTo', v)}
            placeholderText="Expected OB date (to)" className="rounded-xl px-3 py-1.5 text-sm border-[#EDE8E3] bg-[#FDFAF7] focus:outline-none focus:ring-2 focus:ring-brand-300" />
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
              action={{ label: '+ New Lead', onClick: openNewLeadModal }} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#FAF6F2', borderBottom: '1px solid #EDE8E3' }}>
                      {['Lead ID', 'Name', 'Stage', 'Status', 'Value', 'Designer', 'Source', 'Intent', 'Rating', 'Updated'].map((h) => (
                        <th key={h} className="text-left py-2.5 px-4 text-xs font-bold text-stone-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => {
                      const status = lead.status;
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
                            {/* Task #90 — NPS shown right next to the name instead of its own column */}
                            <span className="flex items-center gap-1.5">
                              <span className={isUnread ? 'font-extrabold text-stone-900' : 'font-semibold text-stone-900'}>{lead.name}</span>
                              <NpsBadge score={lead.avgNps} />
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${STAGE_COLORS[lead.stage] ?? 'bg-stone-100 text-stone-600'}`}>
                              {STAGE_LABELS[lead.stage] ?? lead.stage}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge
                              status={status}
                              title={status === 'ON_HOLD' && lead.onHoldRevivalDate ? `Reopens ${new Date(lead.onHoldRevivalDate).toLocaleDateString('en-IN')}` : undefined}
                            />
                            {status === 'ON_HOLD' && lead.onHoldRevivalDate && (
                              <span className="ml-1.5 text-[10px] text-stone-400 whitespace-nowrap">
                                ↺ {new Date(lead.onHoldRevivalDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-stone-700 text-xs font-medium whitespace-nowrap">{fmtVal(lead.estimatedValue)}</td>
                          <td className="py-3 px-4">{avatar(lead.assignedDesigner?.name) ?? <span className="text-stone-300 text-xs">—</span>}</td>
                          <td className="py-3 px-4 text-stone-500 text-xs whitespace-nowrap">{lead.source?.replace(/_/g, ' ') ?? '—'}</td>
                          <td className={`py-3 px-4 text-xs ${intentColor(lead.intentRating)}`}>{intentLabel(lead.intentRating)}</td>
                          <td className="py-3 px-4"><Stars rating={lead.intentRating} /></td>
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
