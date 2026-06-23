import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';

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

const KANBAN_STAGES = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING',
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

const INTENT_COLOR = (rating: number | null | undefined) => {
  if (!rating) return 'bg-gray-300';
  if (rating >= 4) return 'bg-green-500';
  if (rating >= 3) return 'bg-amber-400';
  return 'bg-red-500';
};

const fmt = (val: string | number | null | undefined) => {
  const n = parseFloat(String(val ?? 0));
  if (!n) return null;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

const fmtSource = (s?: string) => (s ?? '').replace(/_/g, ' ');

function relTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function StarRating({ rating }: { rating: number | null | undefined }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`text-xs ${(rating ?? 0) >= i ? 'text-amber-400' : 'text-gray-200'}`}>★</span>
      ))}
    </div>
  );
}

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
      className="bg-white rounded-2xl p-3.5 cursor-grab active:cursor-grabbing group transition-all hover:shadow-warm"
      style={{ border: '1px solid #EDE8E3', boxShadow: '0 1px 3px 0 rgba(100,60,20,0.08)' }}
    >
      {/* Top row: name + lead ID */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <Link
          to={`/leads/${lead.id}`}
          className="text-sm font-semibold text-stone-900 hover:text-brand-600 leading-tight truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {lead.name}
        </Link>
        <span className="text-[10px] font-mono text-stone-400 px-1.5 py-0.5 rounded shrink-0" style={{ background: '#F5F0EB' }}>{lead.leadId}</span>
      </div>

      {/* Property type · scope */}
      {scope && (
        <p className="text-xs text-stone-500 mb-1.5 truncate">{scope}</p>
      )}

      {/* Value + location */}
      <div className="flex items-center gap-2 mb-2">
        {val && <span className="text-sm font-bold text-stone-800">{val}</span>}
        {lead.location && (
          <span className="text-xs text-stone-400 truncate flex-1">{lead.location}</span>
        )}
      </div>

      {/* Intent dot + stars */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${INTENT_COLOR(lead.intentRating)}`} />
        <StarRating rating={lead.intentRating} />
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2.5">
        {lead.isSLABreached && (
          <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
            SLA breach
          </span>
        )}
        {lead.followUpTasks && lead.followUpTasks.length > 0 && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
            Follow-up overdue
          </span>
        )}
      </div>

      {/* Bottom row: assignee + source + time */}
      <div className="flex items-center gap-1.5 pt-1.5" style={{ borderTop: '1px solid #F5F0EB' }}>
        {lead.assignedDesigner ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <div className="w-5 h-5 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-brand-700">
                {lead.assignedDesigner.name[0]?.toUpperCase()}
              </span>
            </div>
            <span className="text-[10px] text-stone-500 truncate">{lead.assignedDesigner.name}</span>
          </div>
        ) : lead.assignedBL ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-amber-700">
                {lead.assignedBL.name[0]?.toUpperCase()}
              </span>
            </div>
            <span className="text-[10px] text-stone-500 truncate">{lead.assignedBL.name}</span>
          </div>
        ) : (
          <span className="text-[10px] text-stone-300 flex-1">Unassigned</span>
        )}

        {lead.source && (
          <span className="text-[10px] text-stone-400 shrink-0 hidden sm:block">{fmtSource(lead.source)}</span>
        )}
        <span className="text-[10px] text-stone-400 shrink-0">{relTime(lead.createdAt)} ago</span>
      </div>
    </div>
  );
}

type FilterTab = 'all' | 'active' | 'onhold' | 'inactive';

export default function Pipeline() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dragCounters = useRef<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ leads: Lead[]; total: number }>('/leads?limit=200');
      setLeads(data.leads ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
      activeTab === 'all' ? true :
      activeTab === 'active' ? activeStages.has(l.stage) :
      activeTab === 'onhold' ? l.stage === 'ON_HOLD' :
      activeTab === 'inactive' ? l.stage === 'INACTIVE' :
      true;
    return matchSearch && matchTab;
  });

  const byStage = (stage: string) => filtered.filter((l) => l.stage === stage);

  const pipelineValue = filtered
    .filter((l) => activeStages.has(l.stage))
    .reduce((sum, l) => sum + parseFloat(String(l.estimatedValue ?? 0)), 0);

  const fmtPipeline = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
    return `₹${n.toLocaleString('en-IN')}`;
  };

  const colValue = (stage: string) =>
    byStage(stage).reduce((s, l) => s + parseFloat(String(l.estimatedValue ?? 0)), 0);

  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

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

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    dragCounters.current[targetStage] = 0;
    setDragOverStage(null);

    if (!draggedLead || draggedLead.stage === targetStage) {
      setDraggedLead(null);
      return;
    }

    const originalStage = draggedLead.stage;

    setLeads((prev) =>
      prev.map((l) => l.id === draggedLead.id ? { ...l, stage: targetStage } : l)
    );
    setDraggedLead(null);

    try {
      const token = localStorage.getItem('crm_token');
      const res = await fetch(`/api/leads/${draggedLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stage: targetStage }),
      });
      if (res.ok) {
        toast.success(`${draggedLead.name} → ${STAGE_LABELS[targetStage] ?? targetStage}`);
      } else {
        const body = await res.json().catch(() => ({}));
        setLeads((prev) =>
          prev.map((l) => l.id === draggedLead.id ? { ...l, stage: originalStage } : l)
        );
        const stageLabel = STAGE_LABELS[targetStage] ?? targetStage;
        const msg = body.missing?.length
          ? `Cannot move to ${stageLabel} — missing: ${body.missing.join(', ')}`
          : (body.error ?? `Stage update failed (${res.status})`);
        toast.error(msg, { duration: 6000 });
      }
    } catch {
      setLeads((prev) =>
        prev.map((l) => l.id === draggedLead.id ? { ...l, stage: originalStage } : l)
      );
      toast.error('Stage update failed — network error', { duration: 6000 });
    }
  };

  const handleDragEnd = () => {
    setDraggedLead(null);
    setDragOverStage(null);
    dragCounters.current = {};
  };

  const showKanban = activeTab === 'all' || activeTab === 'active';

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'onhold', label: 'On Hold' },
    { key: 'inactive', label: 'Inactive' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="bg-white px-5 py-3 flex items-center gap-3 shrink-0" style={{ borderBottom: '1px solid #EDE8E3' }}>
        {/* Filter tabs */}
        <div className="flex items-center gap-0.5 rounded-xl p-1" style={{ background: '#F5F0EB' }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-stone-900 shadow-warm-sm'
                  : 'text-stone-500 hover:text-stone-700'
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
        <div className="flex items-center rounded-xl overflow-hidden transition-all flex-1 max-w-xs" style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
          <span className="pl-2.5 text-gray-400 text-sm">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter this board…"
            className="bg-transparent px-2 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none flex-1"
          />
        </div>

        {/* Summary */}
        <div className="ml-auto text-xs text-gray-500 shrink-0">
          <span className="font-medium text-gray-800">{counts.active} leads</span>
          {' · Pipeline value '}
          <span className="font-medium text-gray-800">{fmtPipeline(pipelineValue)}</span>
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="space-y-3 w-full max-w-sm p-8">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />)}
          </div>
        </div>
      )}

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
                  {/* Column header */}
                  <div className={`rounded-xl mb-2 px-3 py-2.5 transition-colors ${
                    isDragTarget ? 'bg-brand-50 border-2 border-brand-300' : 'bg-gray-100 border-2 border-transparent'
                  }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_ACCENT[stage]}`} />
                      <p className="text-xs font-semibold text-gray-800 flex-1 truncate">
                        {STAGE_LABELS[stage]}
                      </p>
                      <span className="text-xs font-bold text-gray-600 bg-white rounded-full w-5 h-5 flex items-center justify-center">
                        {cards.length}
                      </span>
                    </div>
                    {colVal > 0 && (
                      <p className="text-[10px] text-gray-500 ml-4">{fmt(colVal)}</p>
                    )}
                  </div>

                  {/* Cards */}
                  <div
                    className={`flex-1 overflow-y-auto space-y-2 pr-0.5 rounded-xl transition-colors min-h-[60px] ${
                      isDragTarget && !isDraggingFromHere ? 'bg-brand-50/50' : ''
                    }`}
                  >
                    {cards.length === 0 && !isDragTarget && (
                      <div className="flex items-center justify-center py-8 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400">
                        No leads
                      </div>
                    )}
                    {cards.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
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

      {!loading && !showKanban && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto space-y-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <span className="text-3xl mb-2">🔍</span>
                <p className="text-sm font-medium">No leads in this view</p>
              </div>
            ) : filtered.map((lead) => (
              <Link
                key={lead.id}
                to={`/leads/${lead.id}`}
                className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all"
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
                  <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full shrink-0">SLA</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Invisible drag-end capture */}
      <div onDragEnd={handleDragEnd} className="fixed inset-0 pointer-events-none z-0" />
    </div>
  );
}
