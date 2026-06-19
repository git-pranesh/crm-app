import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import CallLogTab from '../components/tabs/CallLogTab';
import FollowUpTab from '../components/tabs/FollowUpTab';
import MeetingsTab from '../components/tabs/MeetingsTab';
import WhatsAppTab from '../components/tabs/WhatsAppTab';
import DiscountTab from '../components/tabs/DiscountTab';
import QuoteTab from '../components/tabs/QuoteTab';
import DIPChecklistPanel from '../components/DIPChecklistPanel';

type Tab = 'overview' | 'activity' | 'calls' | 'followups' | 'meetings' | 'whatsapp' | 'quotes' | 'discount';

interface Lead {
  id: string; leadId: string; name: string; phone: string; phone2?: string; email?: string;
  stage: string; source?: string; adName?: string; utmCampaign?: string; utmAdSet?: string; utmSource?: string;
  projectType?: string; scope?: string; location?: string; possessionTimeline?: string;
  estimatedValue?: string | number | null; intentRating?: number | null;
  nextMeetingDate?: string | null; floorPlanUrl?: string | null;
  onHoldRevivalDate?: string | null; isDuplicate?: boolean;
  isSLABreached: boolean; createdAt: string; updatedAt: string;
  assignedDesigner?: { id: string; name: string } | null;
  assignedBL?: { id: string; name: string } | null;
  assignedDesignerId?: string | null; assignedBLId?: string | null;
  currentOffer?: { id: string; name: string } | null;
  _count: { calls: number; meetings: number; followUpTasks: number };
}

interface ActivityEntry {
  id: string; action: string; meta?: any; createdAt: string;
  user: { id: string; name: string };
}

interface Quote {
  id: string; quoteNumber?: string; totalAmount?: number; status?: string;
  createdAt: string;
}

interface AppUser { id: string; name: string; role: string; }

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
  EFFECTIVE_LEAD: 'Effective Lead', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'Proposal Ready', PROPOSAL_PRESENTED: 'Proposal Presented',
  ONBOARDING: 'Onboarding', HANDED_OVER: 'Handed Over',
  INACTIVE: 'Inactive', ON_HOLD: 'On Hold',
};

const ALL_STAGES = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY',
  'PROPOSAL_PRESENTED', 'ONBOARDING', 'HANDED_OVER', 'ON_HOLD', 'INACTIVE',
];

const ACTION_ICONS: Record<string, string> = {
  STAGE_CHANGED: '🔄', INTENT_RATING_UPDATED: '⭐', NOTE_ADDED: '📝',
  CALL_LOGGED: '📞', MEETING_SCHEDULED: '📅', MEETING_UPDATED: '📅',
  WHATSAPP_SENT: '💬', QUOTE_CREATED: '📄', DISCOUNT_REQUESTED: '💰',
  LEAD_CREATED: '✨', ASSIGNMENT_CHANGED: '👤', BL_ASSIGNED: '👔',
};

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
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2 py-1 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <span className="text-xs text-gray-700 text-right">{value ?? '—'}</span>
    </div>
  );
}

function AvatarChip({ name }: { name?: string | null }) {
  if (!name) return <span className="text-xs text-gray-300">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center shrink-0">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="text-xs text-gray-700">{name}</span>
    </span>
  );
}

function StarRating({ rating, onSelect }: { rating?: number | null; onSelect?: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => {
        const n = i + 1;
        const filled = n <= (hover || (rating ?? 0));
        return (
          <span
            key={i}
            className={`text-lg transition-colors ${onSelect ? 'cursor-pointer' : ''} ${filled ? 'text-amber-400' : 'text-gray-200'}`}
            onMouseEnter={() => onSelect && setHover(n)}
            onMouseLeave={() => onSelect && setHover(0)}
            onClick={() => onSelect?.(n)}
          >★</span>
        );
      })}
    </span>
  );
}

export default function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'overview');
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(true);

  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);

  const [stageModal, setStageModal] = useState(false);
  const [newStage, setNewStage] = useState('');
  const [inactivationReason, setInactivationReason] = useState('');
  const [changingStage, setChangingStage] = useState(false);

  const [intentModal, setIntentModal] = useState(false);
  const [pendingRating, setPendingRating] = useState(0);
  const [intentReason, setIntentReason] = useState('');
  const [savingIntent, setSavingIntent] = useState(false);

  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [floorPlan, setFloorPlan] = useState('');
  const [savingFloor, setSavingFloor] = useState(false);

  const [reassignField, setReassignField] = useState<'designer' | 'bl' | null>(null);
  const [reassignValue, setReassignValue] = useState('');
  const [savingReassign, setSavingReassign] = useState(false);

  const loadLead = useCallback(() => {
    if (!leadId) return;
    setLoadingLead(true);
    api.get<{ lead: Lead }>(`/leads/${leadId}`)
      .then((d) => {
        setLead(d.lead);
        setFloorPlan(d.lead.floorPlanUrl ?? '');
      })
      .catch(() => toast.error('Could not load lead'))
      .finally(() => setLoadingLead(false));
  }, [leadId]);

  const loadActivities = useCallback(() => {
    if (!leadId) return;
    api.get<{ activities: ActivityEntry[] }>(`/leads/${leadId}/activity`)
      .then((d) => setActivities(d.activities ?? []))
      .catch(() => {});
  }, [leadId]);

  const loadSidebarData = useCallback(() => {
    if (!leadId) return;
    api.get<{ quotes: Quote[] }>(`/quotes/lead/${leadId}`)
      .then((d) => setQuotes(d.quotes ?? []))
      .catch(() => {});
    api.get<{ users: AppUser[] }>('/admin/users')
      .then((d) => setUsers(d.users ?? []))
      .catch(() => {});
  }, [leadId]);

  useEffect(() => { loadLead(); }, [loadLead]);
  useEffect(() => { loadActivities(); }, [loadActivities]);
  useEffect(() => { loadSidebarData(); }, [loadSidebarData]);

  useEffect(() => {
    const t = searchParams.get('tab') as Tab | null;
    if (t) setActiveTab(t);
  }, [searchParams]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const openStageModal = () => { setNewStage(lead?.stage ?? ''); setInactivationReason(''); setStageModal(true); };

  const handleStageChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStage || newStage === lead?.stage) { setStageModal(false); return; }
    if (newStage === 'INACTIVE' && !inactivationReason.trim()) {
      toast.error('Please provide a reason for inactivation'); return;
    }
    setChangingStage(true);
    try {
      await api.patch(`/leads/${leadId}`, { stage: newStage, ...(newStage === 'INACTIVE' && { inactivationReason }) });
      toast.success(`Stage → ${STAGE_LABELS[newStage] ?? newStage}`);
      setStageModal(false);
      loadLead(); loadActivities();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not change stage');
    } finally {
      setChangingStage(false);
    }
  };

  const openIntentModal = (initial: number) => {
    setPendingRating(initial || 0);
    setIntentReason('');
    setIntentModal(true);
  };

  const handleIntentSave = async () => {
    if (!pendingRating) { toast.error('Select a rating'); return; }
    setSavingIntent(true);
    try {
      await api.patch(`/leads/${leadId}/intent-rating`, { rating: pendingRating, reason: intentReason });
      toast.success('Intent rating updated');
      setIntentModal(false);
      loadLead(); loadActivities();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not update rating');
    } finally {
      setSavingIntent(false);
    }
  };

  const handleNoteSubmit = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`/leads/${leadId}/notes`, { note: noteText });
      toast.success('Note saved');
      setNoteText('');
      loadActivities();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleFloorPlanSave = async () => {
    setSavingFloor(true);
    try {
      await api.patch(`/leads/${leadId}`, { floorPlanUrl: floorPlan || null });
      toast.success('Floor plan URL saved');
      loadLead();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not save');
    } finally {
      setSavingFloor(false);
    }
  };

  const handleReassign = async () => {
    if (!reassignField || !reassignValue) return;
    setSavingReassign(true);
    try {
      await api.patch(`/leads/${leadId}`, {
        ...(reassignField === 'designer' ? { assignedDesignerId: reassignValue } : { assignedBLId: reassignValue }),
      });
      toast.success('Reassigned');
      setReassignField(null);
      loadLead();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not reassign');
    } finally {
      setSavingReassign(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity' },
    { id: 'calls', label: `Calls${lead ? ` (${lead._count.calls})` : ''}` },
    { id: 'followups', label: 'Follow-ups' },
    { id: 'meetings', label: `Meetings${lead ? ` (${lead._count.meetings})` : ''}` },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'quotes', label: 'Quotes' },
    { id: 'discount', label: 'Discount' },
  ];

  const latestQuote = quotes[0];
  const designerUsers = users.filter((u) => u.role === 'DESIGNER');
  const blUsers = users.filter((u) => u.role === 'BL');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Stage-change modal */}
      {stageModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Change Stage</h3>
            <form onSubmit={handleStageChange} className="space-y-4">
              <select value={newStage} onChange={(e) => setNewStage(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
                {ALL_STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>
                ))}
              </select>
              {newStage === 'INACTIVE' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea rows={3} value={inactivationReason} onChange={(e) => setInactivationReason(e.target.value)}
                    required placeholder="e.g. Budget mismatch, not interested"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                  <p className="text-xs text-gray-400 mt-1">Feedback email + SMS sent automatically.</p>
                </div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStageModal(false)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={changingStage || !newStage || newStage === lead?.stage}
                  className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50">
                  {changingStage ? 'Saving…' : 'Update Stage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Intent override modal */}
      {intentModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-1">Override Intent Rating</h3>
            <p className="text-xs text-gray-400 mb-4">System-computed rating may differ. Reason required when overriding.</p>
            <div className="flex justify-center mb-4">
              <StarRating rating={pendingRating} onSelect={setPendingRating} />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <textarea rows={2} value={intentReason} onChange={(e) => setIntentReason(e.target.value)}
                placeholder="e.g. Confirmed purchase intent during site visit"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
              <p className="text-xs text-gray-400 mt-1">Required if overriding system rating.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIntentModal(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleIntentSave} disabled={savingIntent || !pendingRating}
                className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50">
                {savingIntent ? 'Saving…' : 'Save Rating'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3">
        {loadingLead ? (
          <div className="h-12 flex items-center">
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
          </div>
        ) : lead ? (
          <div className="flex items-start justify-between gap-4">
            {/* Left: name + subtitle + stage/intent row */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold text-gray-900 truncate">{lead.name}</h1>
                {lead.isSLABreached && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">⚠ SLA</span>
                )}
                {lead.currentOffer && (
                  <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">🎁 {lead.currentOffer.name}</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {lead.leadId}
                {lead.projectType ? ` · ${lead.projectType}` : ''}
                {lead.scope ? ` · ${lead.scope}` : ''}
                {lead.location ? ` · ${lead.location}` : ''}
              </p>
              {/* Stage + intent row */}
              <div className="flex items-center gap-3 mt-1.5">
                <button
                  onClick={openStageModal}
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-80 transition-opacity ${STAGE_COLORS[lead.stage] ?? 'bg-gray-100 text-gray-600'}`}
                  title="Click to change stage"
                >
                  {STAGE_LABELS[lead.stage] ?? lead.stage} ▾
                </button>
                <button
                  onClick={() => openIntentModal(lead.intentRating ?? 0)}
                  title="Click to override intent rating"
                  className="flex items-center gap-1 hover:opacity-70 transition-opacity"
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className={`text-base ${i < (lead.intentRating ?? 0) ? 'text-amber-400' : 'text-gray-200'}`}>★</span>
                  ))}
                </button>
              </div>
            </div>

            {/* Right: action buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => toast('Call logging — coming soon')}
                className="border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-50 transition-colors"
              >📞 Log Call</button>
              <button
                onClick={() => handleTabChange('meetings')}
                className="border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-50 transition-colors"
              >📅 Meeting</button>
              <button
                onClick={() => handleTabChange('discount')}
                className="border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-50 transition-colors"
              >💰 Discount</button>
              <button
                onClick={() => handleTabChange('whatsapp')}
                className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-600 transition-colors"
              >💬 WhatsApp</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Lead not found</p>
        )}
      </div>

      {/* DIP Checklist for ONBOARDING / HANDED_OVER */}
      {lead && (lead.stage === 'ONBOARDING' || lead.stage === 'HANDED_OVER') && (
        <div className="px-6 pt-4">
          <DIPChecklistPanel leadId={leadId!} stage={lead.stage} />
        </div>
      )}

      {/* Main content: tabs (left 2/3) + sidebar (right 1/3) */}
      <div className="px-6 py-4 flex gap-6 items-start">
        {/* Main col */}
        <div className="flex-1 min-w-0 space-y-0">
          {/* Tab nav */}
          <div className="bg-white rounded-t-xl border border-gray-200 border-b-0">
            <nav className="flex gap-0 overflow-x-auto scrollbar-hide">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`px-4 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab content */}
          <div className="bg-white rounded-b-xl border border-gray-200 p-5">
            {activeTab === 'overview' && lead && (
              <div className="space-y-5">
                {/* Key facts */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Key Facts</h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {[
                      { label: 'Project type', value: lead.projectType },
                      { label: 'Configuration', value: lead.scope },
                      { label: 'Location', value: lead.location },
                      { label: 'Est. value', value: fmtVal(lead.estimatedValue) },
                      { label: 'Possession', value: lead.possessionTimeline },
                      { label: 'Source', value: lead.source?.replace(/_/g, ' ') },
                      { label: 'Created', value: new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
                      { label: 'Offer', value: lead.currentOffer?.name },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex gap-2 py-1.5 border-b border-gray-50">
                        <span className="text-xs text-gray-400 w-28 shrink-0">{label}</span>
                        <span className="text-xs text-gray-700">{value ?? <span className="text-gray-300">—</span>}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Floor plan URL */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Floor Plan</h3>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={floorPlan}
                      onChange={(e) => setFloorPlan(e.target.value)}
                      placeholder="https://drive.google.com/… or any URL"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                    <button
                      onClick={handleFloorPlanSave}
                      disabled={savingFloor}
                      className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
                    >
                      {savingFloor ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {lead.floorPlanUrl && (
                    <a href={lead.floorPlanUrl} target="_blank" rel="noreferrer"
                      className="text-xs text-brand-500 hover:underline mt-1 block truncate">
                      {lead.floorPlanUrl}
                    </a>
                  )}
                </div>

                {/* Add note */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Add a Note</h3>
                  <textarea
                    rows={2}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a note about this lead…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
                  />
                  <div className="flex justify-end mt-1.5">
                    <button
                      onClick={handleNoteSubmit}
                      disabled={savingNote || !noteText.trim()}
                      className="bg-brand-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
                    >
                      {savingNote ? 'Saving…' : 'Save Note'}
                    </button>
                  </div>
                </div>

                {/* Recent activity */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Activity</h3>
                  {activities.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">No activity yet</p>
                  ) : (
                    <div className="space-y-2">
                      {activities.slice(0, 10).map((a) => (
                        <div key={a.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                          <span className="text-base mt-0.5">{ACTION_ICONS[a.action] ?? '•'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-700">
                              <span className="font-medium">{a.user?.name}</span>
                              {' — '}
                              {a.action === 'STAGE_CHANGED'
                                ? `Stage: ${STAGE_LABELS[a.meta?.from] ?? a.meta?.from} → ${STAGE_LABELS[a.meta?.to] ?? a.meta?.to}`
                                : a.action === 'NOTE_ADDED'
                                ? `Note: ${a.meta?.note ?? ''}`
                                : a.action === 'INTENT_RATING_UPDATED'
                                ? `Intent rating set to ${a.meta?.rating ?? '—'}`
                                : a.action.replace(/_/g, ' ').toLowerCase()}
                            </p>
                          </div>
                          <span className="text-xs text-gray-300 shrink-0">{relTime(a.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Full Activity Log</h3>
                {activities.length === 0 ? (
                  <p className="text-xs text-gray-400 py-8 text-center">No activity yet</p>
                ) : (
                  activities.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                      <span className="text-base mt-0.5">{ACTION_ICONS[a.action] ?? '•'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700">
                          <span className="font-medium">{a.user?.name ?? 'System'}</span>
                          {' — '}
                          {a.action === 'STAGE_CHANGED'
                            ? `Stage: ${STAGE_LABELS[a.meta?.from] ?? a.meta?.from} → ${STAGE_LABELS[a.meta?.to] ?? a.meta?.to}`
                            : a.action === 'NOTE_ADDED'
                            ? `Note: ${a.meta?.note ?? ''}`
                            : a.action === 'INTENT_RATING_UPDATED'
                            ? `Intent rating updated to ${a.meta?.rating ?? '—'}${a.meta?.reason ? ` (${a.meta.reason})` : ''}`
                            : a.action.replace(/_/g, ' ').toLowerCase()}
                        </p>
                        {a.meta && Object.keys(a.meta).length > 0 && a.action !== 'STAGE_CHANGED' && a.action !== 'NOTE_ADDED' && a.action !== 'INTENT_RATING_UPDATED' && (
                          <p className="text-xs text-gray-400 mt-0.5">{JSON.stringify(a.meta).slice(0, 80)}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-300 shrink-0">{relTime(a.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'calls' && <CallLogTab leadId={leadId!} />}
            {activeTab === 'followups' && <FollowUpTab leadId={leadId!} />}
            {activeTab === 'meetings' && <MeetingsTab leadId={leadId!} />}
            {activeTab === 'whatsapp' && <WhatsAppTab leadId={leadId!} />}
            {activeTab === 'quotes' && lead && <QuoteTab leadId={leadId!} leadRef={lead.leadId} />}
            {activeTab === 'discount' && <DiscountTab leadId={leadId!} />}
          </div>
        </div>

        {/* Sidebar col */}
        <div className="w-72 shrink-0 space-y-3">
          {/* Assignment */}
          <SidebarCard title="Assignment">
            {lead ? (
              <div className="space-y-3">
                {/* Designer */}
                <div>
                  <p className="text-xs text-gray-400 mb-1">Designer</p>
                  {reassignField === 'designer' ? (
                    <div className="flex gap-1">
                      <select value={reassignValue} onChange={(e) => setReassignValue(e.target.value)}
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400">
                        <option value="">Select</option>
                        {designerUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <button onClick={handleReassign} disabled={savingReassign || !reassignValue}
                        className="bg-brand-500 text-white px-2 py-1 rounded text-xs disabled:opacity-50">✓</button>
                      <button onClick={() => setReassignField(null)} className="text-gray-400 px-1 text-xs">✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <AvatarChip name={lead.assignedDesigner?.name} />
                      <button onClick={() => { setReassignField('designer'); setReassignValue(lead.assignedDesignerId ?? ''); }}
                        className="text-xs text-brand-500 hover:underline">Change</button>
                    </div>
                  )}
                </div>
                {/* BL */}
                <div>
                  <p className="text-xs text-gray-400 mb-1">Business Lead</p>
                  {reassignField === 'bl' ? (
                    <div className="flex gap-1">
                      <select value={reassignValue} onChange={(e) => setReassignValue(e.target.value)}
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400">
                        <option value="">Select</option>
                        {blUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <button onClick={handleReassign} disabled={savingReassign || !reassignValue}
                        className="bg-brand-500 text-white px-2 py-1 rounded text-xs disabled:opacity-50">✓</button>
                      <button onClick={() => setReassignField(null)} className="text-gray-400 px-1 text-xs">✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <AvatarChip name={lead.assignedBL?.name} />
                      <button onClick={() => { setReassignField('bl'); setReassignValue(lead.assignedBLId ?? ''); }}
                        className="text-xs text-brand-500 hover:underline">Change</button>
                    </div>
                  )}
                </div>
              </div>
            ) : <div className="h-12 bg-gray-50 rounded animate-pulse" />}
          </SidebarCard>

          {/* Project details */}
          <SidebarCard title="Project Details">
            {lead ? (
              <>
                <InfoRow label="Type" value={lead.projectType} />
                <InfoRow label="Config" value={lead.scope} />
                <InfoRow label="Location" value={lead.location} />
                <InfoRow label="Possession" value={lead.possessionTimeline} />
                <InfoRow label="Est. value" value={fmtVal(lead.estimatedValue)} />
                <InfoRow label="Floor plan" value={lead.floorPlanUrl
                  ? <a href={lead.floorPlanUrl} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline truncate block max-w-[120px]">View</a>
                  : undefined} />
                <InfoRow label="Lead rating" value={
                  <span className="flex gap-0.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} className={`text-xs ${i < (lead.intentRating ?? 0) ? 'text-amber-400' : 'text-gray-200'}`}>★</span>
                    ))}
                  </span>
                } />
              </>
            ) : <div className="h-24 bg-gray-50 rounded animate-pulse" />}
          </SidebarCard>

          {/* Source & campaign */}
          <SidebarCard title="Source & Campaign">
            {lead ? (
              <>
                <InfoRow label="Source" value={lead.source?.replace(/_/g, ' ')} />
                <InfoRow label="Ad/Campaign" value={lead.adName} />
                <InfoRow label="UTM Campaign" value={lead.utmCampaign} />
                <InfoRow label="UTM AdSet" value={lead.utmAdSet} />
                <InfoRow label="UTM Source" value={lead.utmSource} />
                <InfoRow label="Created" value={new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} />
                {lead.currentOffer && (
                  <div className="mt-2">
                    <span className="inline-flex items-center gap-1 text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">
                      🎁 {lead.currentOffer.name}
                    </span>
                  </div>
                )}
              </>
            ) : <div className="h-24 bg-gray-50 rounded animate-pulse" />}
          </SidebarCard>

          {/* Quote */}
          <SidebarCard title="Latest Quote">
            {latestQuote ? (
              <>
                <InfoRow label="Quote #" value={latestQuote.quoteNumber ?? latestQuote.id.slice(-6)} />
                <InfoRow label="Value" value={fmtVal(latestQuote.totalAmount)} />
                <InfoRow label="Status" value={
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {latestQuote.status ?? 'Draft'}
                  </span>
                } />
                <InfoRow label="Date" value={new Date(latestQuote.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                <button onClick={() => handleTabChange('quotes')}
                  className="mt-2 text-xs text-brand-500 hover:underline">View full quote →</button>
              </>
            ) : (
              <p className="text-xs text-gray-400 py-2">No quote yet</p>
            )}
          </SidebarCard>

          {/* Follow-up */}
          <SidebarCard title="Follow-up">
            {lead ? (
              lead._count.followUpTasks > 0 ? (
                <button onClick={() => handleTabChange('followups')}
                  className="text-xs text-brand-500 hover:underline">
                  {lead._count.followUpTasks} follow-up{lead._count.followUpTasks !== 1 ? 's' : ''} scheduled →
                </button>
              ) : (
                <p className="text-xs text-gray-400">No follow-up scheduled</p>
              )
            ) : <div className="h-6 bg-gray-50 rounded animate-pulse" />}
          </SidebarCard>
        </div>
      </div>
    </div>
  );
}
