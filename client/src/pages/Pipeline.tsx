// Pipeline — two tabs: Sales Pipeline + Design Pipeline
import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Search, SlidersHorizontal, X, ChevronRight, Clock, Activity, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  leadId: string;
  name: string;
  phone: string;
  stage: string;
  source?: string;
  estimatedValue?: string | number | null;
  intentRating?: number | null;
  isSLABreached: boolean;
  followUpTasks?: { id: string }[];
  createdAt: string;
  location?: string;
  projectType?: string;
  scope?: string;
  assignedDesigner?: { id: string; name: string } | null;
  assignedBL?: { id: string; name: string } | null;
  _count?: { calls: number; meetings: number; followUpTasks: number };
}

interface DesignProject {
  id: string;
  projectCode: string;
  phase: string;
  health: string;
  progressPercent: number;
  contractValue: number | null;
  outstandingAmount: number | null;
  handoverTargetDate: string | null;
  createdAt: string;
  updatedAt: string;
  totalActiveDays: number;
  collectionsCount: number;
  attentionFlags: Array<{ id: string; category: string; description: string }>;
  lead: {
    id: string;
    leadId: string;
    name: string;
    phone: string;
    expectedMoveIn: string | null;
    estimatedValue: number | null;
  };
}

interface SalesFilters {
  originDateFrom: string;
  originDateTo: string;
  originMonth: string;
  budgetMin: string;
  budgetMax: string;
  possessionDateFrom: string;
  possessionDateTo: string;
  intentMin: string;
  projectedObFrom: string;
  projectedObTo: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const KANBAN_STAGES_ALL = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING',
] as const;

const KANBAN_STAGES_DESIGNER = [
  'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING',
] as const;

const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'Effective Lead',
  MQL: 'MQL',
  DQL: 'DQL',
  PROPOSAL_READY: 'Proposal Ready',
  PROPOSAL_PRESENTED: 'Proposal Presented',
  ONBOARDING: 'Onboarding',
  HANDED_OVER: 'Handed Over',
  INACTIVE: 'Inactive',
  ON_HOLD: 'On Hold',
};

const STAGE_ACCENT: Record<string, string> = {
  EFFECTIVE_LEAD: 'bg-stone-400',
  MQL: 'bg-amber-500',
  DQL: 'bg-orange-500',
  PROPOSAL_READY: 'bg-brand-400',
  PROPOSAL_PRESENTED: 'bg-brand-500',
  ONBOARDING: 'bg-green-500',
};

const PHASE_LABELS: Record<string, string> = {
  DESIGN: 'Design Development',
  TECHNICAL: 'Technical',
  PRODUCTION: 'Production',
  SITE_EXECUTION: 'Site Execution',
  HANDOVER: 'Handover',
  COMPLETED: 'Completed',
};

const PHASE_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  DESIGN:         { bg: 'bg-violet-100',  text: 'text-violet-700', border: 'border-violet-200' },
  TECHNICAL:      { bg: 'bg-blue-100',    text: 'text-blue-700',   border: 'border-blue-200' },
  PRODUCTION:     { bg: 'bg-amber-100',   text: 'text-amber-700',  border: 'border-amber-200' },
  SITE_EXECUTION: { bg: 'bg-orange-100',  text: 'text-orange-700', border: 'border-orange-200' },
  HANDOVER:       { bg: 'bg-green-100',   text: 'text-green-700',  border: 'border-green-200' },
  COMPLETED:      { bg: 'bg-emerald-100', text: 'text-emerald-700',border: 'border-emerald-200' },
};

const HEALTH_CONFIG: Record<string, { dot: string; label: string }> = {
  ON_TRACK: { dot: 'bg-green-500',  label: 'On Track' },
  AT_RISK:  { dot: 'bg-amber-500',  label: 'At Risk' },
  DELAYED:  { dot: 'bg-red-500',    label: 'Delayed' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCurrentUserRole(): string {
  try {
    const raw = localStorage.getItem('crm_user');
    if (!raw) return '';
    return JSON.parse(raw)?.role ?? '';
  } catch { return ''; }
}

const fmt = (val: string | number | null | undefined) => {
  const n = parseFloat(String(val ?? 0));
  if (!n) return null;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

function relTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

/** Generate last-N billing months as dropdown options.
 *  Billing cycle: 16th of the selected month → 15th of the next month.
 */
function billingMonthOptions(count = 14): Array<{ value: string; label: string }> {
  const now = new Date();
  const options: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-indexed
    const val = `${y}-${String(m + 1).padStart(2, '0')}`;
    const from = new Date(y, m, 16).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const toD   = new Date(y, m + 1, 15);
    const to   = toD.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    options.push({ value: val, label: `${from} – ${to}` });
  }
  return options;
}

const BILLING_MONTHS = billingMonthOptions();

// ── Shared UI ─────────────────────────────────────────────────────────────────
const INTENT_COLOR = (r: number | null | undefined) => {
  if (!r) return 'bg-gray-300';
  if (r >= 4) return 'bg-green-500';
  if (r >= 3) return 'bg-amber-400';
  return 'bg-red-500';
};

function StarRating({ rating }: { rating: number | null | undefined }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`text-xs ${(rating ?? 0) >= i ? 'text-amber-400' : 'text-gray-200'}`}>★</span>
      ))}
    </div>
  );
}

/** Clickable star input for minimum-intent filter. */
function StarFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hover, setHover] = useState(0);
  const selected = parseInt(value) || 0;
  return (
    <div className="flex gap-1 items-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(selected === i ? '' : String(i))}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          className="text-lg leading-none transition-colors"
        >
          <span className={(hover || selected) >= i ? 'text-amber-400' : 'text-gray-200'}>★</span>
        </button>
      ))}
      {selected > 0 && (
        <span className="text-xs text-stone-500 ml-0.5">≥ {selected}</span>
      )}
    </div>
  );
}

// ── LeadCard ──────────────────────────────────────────────────────────────────
function LeadCard({
  lead,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  onDragStart: (e: React.DragEvent, lead: Lead) => void;
  onDragEnd: () => void;
}) {
  const val = fmt(lead.estimatedValue);
  const scope = [lead.projectType, lead.scope].filter(Boolean).join(' · ');

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead)}
      onDragEnd={onDragEnd}
      className="bg-white rounded-2xl p-3.5 cursor-grab active:cursor-grabbing transition-all hover:shadow-warm"
      style={{ border: '1px solid #EDE8E3', boxShadow: '0 1px 3px 0 rgba(100,60,20,0.08)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <Link
          to={`/leads/${lead.id}`}
          className="text-sm font-semibold text-stone-900 hover:text-brand-600 leading-tight truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {lead.name}
        </Link>
        <span className="text-[10px] font-mono text-stone-400 px-1.5 py-0.5 rounded shrink-0" style={{ background: '#F5F0EB' }}>
          {lead.leadId}
        </span>
      </div>

      {scope && <p className="text-xs text-stone-500 mb-1.5 truncate">{scope}</p>}

      <div className="flex items-center gap-2 mb-2">
        {val && <span className="text-sm font-bold text-stone-800">{val}</span>}
        {lead.location && <span className="text-xs text-stone-400 truncate flex-1">{lead.location}</span>}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${INTENT_COLOR(lead.intentRating)}`} />
        <StarRating rating={lead.intentRating} />
      </div>

      <div className="flex flex-wrap gap-1 mb-2.5">
        {lead.isSLABreached && (
          <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">SLA breach</span>
        )}
        {lead.followUpTasks && lead.followUpTasks.length > 0 && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Follow-up overdue</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-1.5" style={{ borderTop: '1px solid #F5F0EB' }}>
        {lead.assignedDesigner ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <div className="w-5 h-5 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-brand-700">{lead.assignedDesigner.name[0]?.toUpperCase()}</span>
            </div>
            <span className="text-[10px] text-stone-500 truncate">{lead.assignedDesigner.name}</span>
          </div>
        ) : lead.assignedBL ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-amber-700">{lead.assignedBL.name[0]?.toUpperCase()}</span>
            </div>
            <span className="text-[10px] text-stone-500 truncate">{lead.assignedBL.name}</span>
          </div>
        ) : (
          <span className="text-[10px] text-stone-300 flex-1">Unassigned</span>
        )}
        {lead.source && (
          <span className="text-[10px] text-stone-400 shrink-0 hidden sm:block">{lead.source.replace(/_/g, ' ')}</span>
        )}
        <span className="text-[10px] text-stone-400 shrink-0">{relTime(lead.createdAt)} ago</span>
      </div>
    </div>
  );
}

// ── Design Pipeline view ──────────────────────────────────────────────────────
function DesignPipelineView() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [phaseFilter, setPhaseFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ projects: DesignProject[] }>('/projects/pipeline');
      setProjects(data.projects ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const phases = Array.from(new Set(projects.map((p) => p.phase)));
  const filtered = phaseFilter ? projects.filter((p) => p.phase === phaseFilter) : projects;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="space-y-3 w-full max-w-lg p-8">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 text-stone-400">
        <Activity size={32} strokeWidth={1.5} className="mb-3 text-stone-300" />
        <p className="text-sm font-semibold text-stone-500">No active projects</p>
        <p className="text-xs mt-1">Projects appear here once a lead reaches Onboarding.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Phase filter pills */}
      <div className="bg-white px-5 py-3 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid #EDE8E3' }}>
        <button
          onClick={() => setPhaseFilter('')}
          className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all ${
            !phaseFilter ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
          }`}
        >
          All phases
          <span className={`ml-1.5 ${!phaseFilter ? 'text-stone-300' : 'text-stone-400'}`}>{projects.length}</span>
        </button>
        {phases.map((ph) => {
          const pc = PHASE_COLOR[ph] ?? PHASE_COLOR.DESIGN;
          const count = projects.filter((p) => p.phase === ph).length;
          return (
            <button
              key={ph}
              onClick={() => setPhaseFilter(phaseFilter === ph ? '' : ph)}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all border ${
                phaseFilter === ph
                  ? `${pc.bg} ${pc.text} ${pc.border} shadow-sm`
                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
              }`}
            >
              {PHASE_LABELS[ph] ?? ph}
              <span className="ml-1.5 opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="p-4 max-w-4xl mx-auto space-y-3">
        {filtered.map((proj) => {
          const pc = PHASE_COLOR[proj.phase] ?? PHASE_COLOR.DESIGN;
          const hc = HEALTH_CONFIG[proj.health] ?? HEALTH_CONFIG.ON_TRACK;
          const hasFlags = proj.attentionFlags.length > 0;

          return (
            <Link
              key={proj.id}
              to={`/leads/${proj.lead.id}`}
              className="block bg-white rounded-2xl p-4 hover:shadow-warm transition-all group"
              style={{ border: hasFlags ? '1.5px solid #fca5a5' : '1px solid #EDE8E3' }}
            >
              <div className="flex items-start gap-4">
                {/* Left: phase progress indicator */}
                <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${hc.dot}`} title={hc.label} />
                  <div className="w-0.5 flex-1 min-h-[40px] rounded-full bg-stone-100" />
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-stone-900 group-hover:text-brand-600 transition-colors">
                          {proj.lead.name}
                        </span>
                        <span className="text-[10px] font-mono text-stone-400">{proj.lead.leadId}</span>
                        <span className="text-[10px] text-stone-400">·</span>
                        <span className="text-[10px] font-mono text-stone-500">{proj.projectCode}</span>
                      </div>
                    </div>

                    {/* Phase badge */}
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border shrink-0 ${pc.bg} ${pc.text} ${pc.border}`}>
                      {PHASE_LABELS[proj.phase] ?? proj.phase}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="flex-1 bg-stone-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, proj.progressPercent)}%`,
                          background: proj.health === 'DELAYED' ? '#ef4444' : proj.health === 'AT_RISK' ? '#f59e0b' : '#22c55e',
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-stone-600 shrink-0">{proj.progressPercent}%</span>
                  </div>

                  {/* Stats row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      <span>{proj.totalActiveDays}d active</span>
                    </span>

                    {proj.lead.expectedMoveIn && (
                      <span>
                        Possession: <span className="font-medium text-stone-700">{fmtDate(proj.lead.expectedMoveIn)}</span>
                      </span>
                    )}

                    {proj.handoverTargetDate && (
                      <span>
                        Handover by: <span className="font-medium text-stone-700">{fmtDate(proj.handoverTargetDate)}</span>
                      </span>
                    )}

                    {proj.contractValue != null && (
                      <span>
                        Contract: <span className="font-medium text-stone-700">{fmt(proj.contractValue)}</span>
                      </span>
                    )}

                    <span className={`flex items-center gap-1 ${
                      proj.health === 'DELAYED' ? 'text-red-600' : proj.health === 'AT_RISK' ? 'text-amber-600' : 'text-green-600'
                    } font-medium`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${hc.dot}`} />
                      {hc.label}
                    </span>
                  </div>

                  {/* Attention flags */}
                  {hasFlags && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {proj.attentionFlags.slice(0, 3).map((f) => (
                        <span key={f.id} className="flex items-center gap-1 text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full border border-red-100">
                          <AlertCircle size={9} />
                          {f.category}{f.description ? `: ${f.description.slice(0, 40)}${f.description.length > 40 ? '…' : ''}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <ChevronRight size={14} className="text-stone-300 group-hover:text-brand-500 transition-colors shrink-0 mt-1" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Sales Pipeline view ───────────────────────────────────────────────────────
type FilterTab = 'all' | 'active' | 'onhold' | 'inactive';

const EMPTY_SALES_FILTERS: SalesFilters = {
  originDateFrom: '', originDateTo: '', originMonth: '',
  budgetMin: '', budgetMax: '',
  possessionDateFrom: '', possessionDateTo: '',
  intentMin: '',
  projectedObFrom: '', projectedObTo: '',
};

function SalesPipelineView({ userRole }: { userRole: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [salesFilters, setSalesFilters] = useState<SalesFilters>(EMPTY_SALES_FILTERS);

  // Drag state
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dragCounters = useRef<Record<string, number>>({});

  // Pending-drop modal
  const [pendingDrop, setPendingDrop] = useState<{ lead: Lead; targetStage: string } | null>(null);
  const [dropReason, setDropReason] = useState('');
  const [dropReopenDate, setDropReopenDate] = useState('');
  const [submittingDrop, setSubmittingDrop] = useState(false);

  const isDesigner = userRole === 'DESIGNER' || userRole === 'CRE';
  const KANBAN_STAGES = isDesigner ? KANBAN_STAGES_DESIGNER : KANBAN_STAGES_ALL;

  const activeFilterCount = Object.values(salesFilters).filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (isDesigner) params.set('pipelineMode', '1');
      // Advanced filters
      if (salesFilters.originDateFrom) params.set('originDateFrom', salesFilters.originDateFrom);
      if (salesFilters.originDateTo)   params.set('originDateTo',   salesFilters.originDateTo);
      if (salesFilters.originMonth)    params.set('originMonth',    salesFilters.originMonth);
      if (salesFilters.budgetMin)      params.set('budgetMin',      salesFilters.budgetMin);
      if (salesFilters.budgetMax)      params.set('budgetMax',      salesFilters.budgetMax);
      if (salesFilters.possessionDateFrom) params.set('possessionDateFrom', salesFilters.possessionDateFrom);
      if (salesFilters.possessionDateTo)   params.set('possessionDateTo',   salesFilters.possessionDateTo);
      if (salesFilters.intentMin)      params.set('intentMin',      salesFilters.intentMin);
      if (salesFilters.projectedObFrom) params.set('projectedObFrom', salesFilters.projectedObFrom);
      if (salesFilters.projectedObTo)   params.set('projectedObTo',   salesFilters.projectedObTo);

      const data = await api.get<{ leads: Lead[]; total: number }>(`/leads?${params}`);
      setLeads(data.leads ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [isDesigner, salesFilters]);

  useEffect(() => { load(); }, [load]);

  const activeStages = new Set(KANBAN_STAGES as unknown as string[]);

  const counts = {
    all: leads.length,
    active: leads.filter((l) => activeStages.has(l.stage)).length,
    onhold: leads.filter((l) => l.stage === 'ON_HOLD').length,
    inactive: leads.filter((l) => l.stage === 'INACTIVE').length,
  };

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.name.toLowerCase().includes(q) || l.leadId.toLowerCase().includes(q)
      || (l.phone ?? '').includes(q);
    const matchTab =
      activeTab === 'all'      ? true :
      activeTab === 'active'   ? activeStages.has(l.stage) :
      activeTab === 'onhold'   ? l.stage === 'ON_HOLD' :
      activeTab === 'inactive' ? l.stage === 'INACTIVE' :
      true;
    return matchSearch && matchTab;
  });

  const byStage = (stage: string) => filtered.filter((l) => l.stage === stage);

  const totalValue = leads.reduce((s, l) => s + parseFloat(String(l.estimatedValue ?? 0)), 0);
  const activeValue = leads.filter((l) => activeStages.has(l.stage))
    .reduce((s, l) => s + parseFloat(String(l.estimatedValue ?? 0)), 0);

  const fmtPipeline = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
    return `₹${n.toLocaleString('en-IN')}`;
  };

  const colValue = (stage: string) =>
    byStage(stage).reduce((s, l) => s + parseFloat(String(l.estimatedValue ?? 0)), 0);

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDragEnter = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    dragCounters.current[stage] = (dragCounters.current[stage] ?? 0) + 1;
    setDragOverStage(stage);
  };
  const handleDragLeave = (_e: React.DragEvent, stage: string) => {
    dragCounters.current[stage] = (dragCounters.current[stage] ?? 1) - 1;
    if (dragCounters.current[stage] <= 0) {
      dragCounters.current[stage] = 0;
      if (dragOverStage === stage) setDragOverStage(null);
    }
  };
  const handleDragEnd = () => { setDraggedLead(null); setDragOverStage(null); dragCounters.current = {}; };

  const commitDrop = async (lead: Lead, targetStage: string, extraFields: Record<string, string>) => {
    const originalStage = lead.stage;
    setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, stage: targetStage } : l));
    try {
      const token = localStorage.getItem('crm_token');
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stage: targetStage, ...extraFields }),
      });
      if (res.ok) {
        toast.success(`${lead.name} → ${STAGE_LABELS[targetStage] ?? targetStage}`);
      } else {
        const body = await res.json().catch(() => ({}));
        setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, stage: originalStage } : l));
        const msg = body.missing?.length
          ? `Cannot move to ${STAGE_LABELS[targetStage] ?? targetStage} — missing: ${body.missing.join(', ')}`
          : (body.error ?? `Stage update failed (${res.status})`);
        toast.error(msg, { duration: 6000 });
      }
    } catch {
      setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, stage: originalStage } : l));
      toast.error('Stage update failed — network error', { duration: 6000 });
    }
  };

  const handleDrop = (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    dragCounters.current[targetStage] = 0;
    setDragOverStage(null);
    if (!draggedLead || draggedLead.stage === targetStage) { setDraggedLead(null); return; }
    const lead = draggedLead;
    setDraggedLead(null);
    if (targetStage === 'ON_HOLD' || targetStage === 'INACTIVE') {
      setDropReason(''); setDropReopenDate(''); setPendingDrop({ lead, targetStage }); return;
    }
    commitDrop(lead, targetStage, {});
  };

  const handleDropModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingDrop) return;
    const { lead, targetStage } = pendingDrop;
    if (!dropReason.trim()) { toast.error('A reason is required'); return; }
    if (targetStage === 'ON_HOLD') {
      if (!dropReopenDate) { toast.error('A reopen date is required'); return; }
      if (new Date(dropReopenDate) <= new Date()) { toast.error('Reopen date must be in the future'); return; }
    }
    setSubmittingDrop(true);
    const extra: Record<string, string> = { reason: dropReason.trim() };
    if (targetStage === 'ON_HOLD') extra.onHoldRevivalDate = dropReopenDate;
    if (targetStage === 'INACTIVE') extra.inactivationReason = dropReason.trim();
    setPendingDrop(null);
    await commitDrop(lead, targetStage, extra);
    setSubmittingDrop(false);
  };

  const showKanban = activeTab === 'all' || activeTab === 'active';
  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'onhold', label: 'On Hold' },
    { key: 'inactive', label: 'Inactive' },
  ];

  const setSF = (k: keyof SalesFilters, v: string) =>
    setSalesFilters((prev) => ({ ...prev, [k]: v }));
  const clearFilters = () => setSalesFilters(EMPTY_SALES_FILTERS);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white px-5 py-3 flex flex-wrap items-center gap-3 shrink-0" style={{ borderBottom: '1px solid #EDE8E3' }}>
        {/* Status tabs */}
        <div className="flex items-center gap-0.5 rounded-xl p-1" style={{ background: '#F5F0EB' }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.key ? 'bg-white text-stone-900 shadow-warm-sm' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 ${activeTab === tab.key ? 'text-brand-600' : 'text-stone-400'}`}>
                {counts[tab.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center rounded-xl overflow-hidden flex-1 max-w-xs" style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
          <Search size={14} className="ml-2.5 text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter this board…"
            className="bg-transparent px-2 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none flex-1"
          />
        </div>

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold transition-all ${
            showFilters || activeFilterCount > 0
              ? 'bg-brand-50 text-brand-700 border border-brand-200'
              : 'text-stone-600 border border-stone-200 hover:bg-stone-50'
          }`}
        >
          <SlidersHorizontal size={12} />
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-brand-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Pipeline summary */}
        <div className="ml-auto text-xs text-gray-500 shrink-0 hidden md:flex items-center gap-3">
          <span>
            Total <span className="font-medium text-gray-800">{counts.all} leads</span>
            {' · '}
            <span className="font-medium text-gray-800">{fmtPipeline(totalValue)}</span>
          </span>
          <span className="text-gray-300">|</span>
          <span>
            Active <span className="font-medium text-green-700">{counts.active}</span>
            {' · '}
            <span className="font-medium text-green-700">{fmtPipeline(activeValue)}</span>
          </span>
        </div>
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="bg-white px-5 py-4 shrink-0" style={{ borderBottom: '1px solid #EDE8E3' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">

            {/* Lead origin date range */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Lead origin date (from)</label>
              <input
                type="date"
                value={salesFilters.originDateFrom}
                onChange={(e) => setSF('originDateFrom', e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Lead origin date (to)</label>
              <input
                type="date"
                value={salesFilters.originDateTo}
                onChange={(e) => setSF('originDateTo', e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>

            {/* Origin month — billing cycle (16th–15th) */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Origin billing month (16th–15th)</label>
              <select
                value={salesFilters.originMonth}
                onChange={(e) => setSF('originMonth', e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              >
                <option value="">All months</option>
                {BILLING_MONTHS.map((bm) => (
                  <option key={bm.value} value={bm.value}>{bm.label}</option>
                ))}
              </select>
            </div>

            {/* Budget range */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Client budget (min ₹)</label>
              <input
                type="number"
                value={salesFilters.budgetMin}
                onChange={(e) => setSF('budgetMin', e.target.value)}
                placeholder="e.g. 500000"
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Client budget (max ₹)</label>
              <input
                type="number"
                value={salesFilters.budgetMax}
                onChange={(e) => setSF('budgetMax', e.target.value)}
                placeholder="e.g. 5000000"
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>

            {/* Possession / Expected move-in date */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Possession date (from)</label>
              <input
                type="date"
                value={salesFilters.possessionDateFrom}
                onChange={(e) => setSF('possessionDateFrom', e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Possession date (to)</label>
              <input
                type="date"
                value={salesFilters.possessionDateTo}
                onChange={(e) => setSF('possessionDateTo', e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>

            {/* Intent rating minimum */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Minimum intent rating</label>
              <StarFilter value={salesFilters.intentMin} onChange={(v) => setSF('intentMin', v)} />
            </div>

            {/* Projected OB date range */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Proj. OB date (from)</label>
              <input
                type="date"
                value={salesFilters.projectedObFrom}
                onChange={(e) => setSF('projectedObFrom', e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1.5">Proj. OB date (to)</label>
              <input
                type="date"
                value={salesFilters.projectedObTo}
                onChange={(e) => setSF('projectedObTo', e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-stone-400">{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</p>
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 font-medium"
              >
                <X size={11} /> Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="space-y-3 w-full max-w-sm p-8">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />)}
          </div>
        </div>
      )}

      {/* Kanban board */}
      {!loading && showKanban && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 h-full p-4 min-w-max">
            {KANBAN_STAGES.map((stage) => {
              const cards = byStage(stage);
              const colVal = colValue(stage);
              const isDragTarget = dragOverStage === stage;
              const isDraggingFromHere = draggedLead?.stage === stage;
              return (
                <div
                  key={stage}
                  className="flex flex-col w-64 shrink-0 h-full"
                  onDragOver={handleDragOver}
                  onDragEnter={(e) => handleDragEnter(e, stage)}
                  onDragLeave={(e) => handleDragLeave(e, stage)}
                  onDrop={(e) => handleDrop(e, stage)}
                >
                  <div className={`rounded-xl mb-2 px-3 py-2.5 transition-colors ${
                    isDragTarget ? 'bg-brand-50 border-2 border-brand-300' : 'bg-gray-100 border-2 border-transparent'
                  }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_ACCENT[stage]}`} />
                      <p className="text-xs font-semibold text-gray-800 flex-1 truncate">{STAGE_LABELS[stage]}</p>
                      <span className="text-xs font-bold text-gray-600 bg-white rounded-full w-5 h-5 flex items-center justify-center">
                        {cards.length}
                      </span>
                    </div>
                    {colVal > 0 && <p className="text-[10px] text-gray-500 ml-4">{fmt(colVal)}</p>}
                  </div>
                  <div className={`flex-1 overflow-y-auto space-y-2 pr-0.5 rounded-xl transition-colors min-h-[60px] ${
                    isDragTarget && !isDraggingFromHere ? 'bg-brand-50/50' : ''
                  }`}>
                    {cards.length === 0 && !isDragTarget && (
                      <div className="flex items-center justify-center py-8 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400">
                        No leads
                      </div>
                    )}
                    {cards.map((lead) => (
                      <LeadCard key={lead.id} lead={lead} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
                    ))}
                    {isDragTarget && !isDraggingFromHere && (
                      <div className="border-2 border-dashed border-brand-300 rounded-xl h-20 flex items-center justify-center text-xs text-brand-500 font-medium">
                        Drop here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* List view for On Hold / Inactive */}
      {!loading && !showKanban && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto space-y-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Search size={28} strokeWidth={1.5} className="text-gray-300 mb-2" />
                <p className="text-sm font-medium">No leads in this view</p>
              </div>
            ) : filtered.map((lead) => (
              <Link
                key={lead.id}
                to={`/leads/${lead.id}`}
                className="flex items-center gap-4 bg-white rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                style={{ border: '1px solid #EDE8E3' }}
              >
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-gray-600 text-sm font-bold">{lead.name[0]?.toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{lead.name}</p>
                    <span className="text-[10px] font-mono text-gray-400">{lead.leadId}</span>
                  </div>
                  <p className="text-xs text-gray-500">{lead.phone}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-gray-700">{fmt(lead.estimatedValue) ?? '—'}</p>
                  <p className="text-[10px] text-gray-400">{relTime(lead.createdAt)} ago</p>
                </div>
                {lead.isSLABreached && (
                  <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full shrink-0">
                    SLA
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ON_HOLD / INACTIVE drop modal */}
      {pendingDrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={handleDropModalSubmit}
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            style={{ border: '1px solid #EDE8E3' }}
          >
            <h2 className="text-base font-bold text-stone-900 mb-1">
              Move to {STAGE_LABELS[pendingDrop.targetStage]}
            </h2>
            <p className="text-xs text-stone-500 mb-4">
              {pendingDrop.targetStage === 'ON_HOLD'
                ? 'A reason and a reopen date are required.'
                : 'Please provide a reason for marking this lead inactive.'}
            </p>
            <label className="block text-xs font-semibold text-stone-600 mb-1">Reason *</label>
            <textarea
              value={dropReason}
              onChange={(e) => setDropReason(e.target.value)}
              required
              rows={3}
              className="w-full rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand-300"
              style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
              placeholder="e.g. Client travelling, revisit in 2 months"
            />
            {pendingDrop.targetStage === 'ON_HOLD' && (
              <>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Reopen date *</label>
                <input
                  type="date"
                  value={dropReopenDate}
                  onChange={(e) => setDropReopenDate(e.target.value)}
                  required
                  className="w-full rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand-300"
                  style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                />
              </>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPendingDrop(null)}
                className="text-sm px-4 py-2 rounded-xl text-stone-600 hover:bg-stone-50"
                style={{ border: '1px solid #EDE8E3' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingDrop}
                className="text-sm px-4 py-2 rounded-xl bg-brand-500 text-white font-semibold hover:bg-brand-600 disabled:opacity-50"
              >
                {submittingDrop ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Pipeline() {
  const userRole = getCurrentUserRole();
  const isDesigner = userRole === 'DESIGNER' || userRole === 'CRE';
  const [tab, setTab] = useState<'sales' | 'design'>('sales');

  return (
    <div className="flex flex-col h-full">
      {/* Page header + top-level tab switcher */}
      <div className="bg-white px-5 py-3 flex items-center gap-4 shrink-0" style={{ borderBottom: '1px solid #EDE8E3' }}>
        <div>
          <h1 className="text-lg font-extrabold text-stone-900 tracking-tight leading-tight">Pipeline</h1>
        </div>
        <div className="flex items-center gap-1 rounded-xl p-1 ml-2" style={{ background: '#F5F0EB' }}>
          <button
            onClick={() => setTab('sales')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === 'sales' ? 'bg-white text-stone-900 shadow-warm-sm' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            Sales Pipeline
          </button>
          {isDesigner && (
            <button
              onClick={() => setTab('design')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                tab === 'design' ? 'bg-white text-stone-900 shadow-warm-sm' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              Design Pipeline
            </button>
          )}
        </div>
      </div>

      {tab === 'sales'  && <SalesPipelineView userRole={userRole} />}
      {tab === 'design' && isDesigner && <DesignPipelineView />}
    </div>
  );
}
