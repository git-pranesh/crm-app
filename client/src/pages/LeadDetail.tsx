import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Phone, CalendarPlus, Tag, MessageCircle, AlertTriangle, Gift,
  ChevronDown, Upload, ExternalLink, Pencil, Info, Check, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { describeActivity } from '../lib/activityLabels';
import CallLogTab from '../components/tabs/CallLogTab';
import FollowUpTab from '../components/tabs/FollowUpTab';
import MeetingsTab from '../components/tabs/MeetingsTab';
import WhatsAppTab from '../components/tabs/WhatsAppTab';
import DiscountTab from '../components/tabs/DiscountTab';
import QuoteTab from '../components/tabs/QuoteTab';
import FilesTab from '../components/tabs/FilesTab';
import DIPChecklistPanel from '../components/DIPChecklistPanel';
import PDOBChecklistPanel from '../components/PDOBChecklistPanel';
import OBOBMChecklistPanel from '../components/OBOBMChecklistPanel';

type Tab = 'overview' | 'activity' | 'calls' | 'followups' | 'meetings' | 'whatsapp' | 'quotes' | 'discount' | 'files';

interface Lead {
  id: string; leadId: string; name: string; phone: string; phone2?: string;
  email?: string; email2?: string; pan?: string; gst?: string;
  stage: string; source?: string; adName?: string; utmCampaign?: string; utmAdSet?: string; utmSource?: string;
  projectType?: string; scope?: string; location?: string; possessionTimeline?: string;
  builder?: string; expectedMoveIn?: string | null;
  offer1?: string; offer2?: string; offer3?: string;
  notes?: string;
  estimatedValue?: string | number | null; intentRating?: number | null; intentRatingSource?: string | null;
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

interface FollowUpTask {
  id: string; dueDate: string; dueTime?: string | null;
  isCompleted: boolean; isOverdue: boolean;
}

interface StageVisit {
  stage: string; enteredAt: string; exitedAt?: string; tatDays?: number;
}

interface AppUser { id: string; name: string; role: string; }

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

const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'Effective Lead', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'Proposal Ready', PROPOSAL_PRESENTED: 'Proposal Presented',
  PROPOSAL_DISCUSSION: 'Proposal Discussion',
  ONBOARDING: 'Onboarding', ONBOARDING_MEETING: 'Onboarding Meeting',
  DESIGN_IN_PROGRESS: 'Design in Progress', HANDED_OVER: 'Handed Over',
  INACTIVE: 'Inactive', ON_HOLD: 'On Hold',
};

const ALL_STAGES = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY',
  'PROPOSAL_PRESENTED', 'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING',
  'DESIGN_IN_PROGRESS', 'HANDED_OVER', 'ON_HOLD', 'INACTIVE',
];

const ACTION_ICONS: Record<string, string> = {
  STAGE_CHANGED: '↗', INTENT_RATING_UPDATED: '★', NOTE_ADDED: '·',
  CALL_LOGGED: '·', MEETING_SCHEDULED: '·', MEETING_UPDATED: '·',
  WHATSAPP_SENT: '·', QUOTE_CREATED: '·', DISCOUNT_REQUESTED: '·',
  LEAD_CREATED: '·', ASSIGNMENT_CHANGED: '·', BL_ASSIGNED: '·',
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
    <div className="bg-white rounded-2xl p-4 shadow-warm-sm" style={{ border: '1px solid #EDE8E3' }}>
      <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2 py-1 last:border-0" style={{ borderBottom: '1px solid #F5F0EB' }}>
      <span className="text-xs text-stone-400 shrink-0">{label}</span>
      <span className="text-xs text-stone-700 text-right">{value ?? '—'}</span>
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

/** Thin field row used inside the two key-facts blocks */
function FactRow({ label, value, className }: { label: string; value?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex gap-2 py-1.5 border-b border-gray-50 last:border-0 ${className ?? ''}`}>
      <span className="text-xs text-gray-400 w-32 shrink-0">{label}</span>
      <span className="text-xs text-gray-700 flex-1">{value ?? <span className="text-gray-300">—</span>}</span>
    </div>
  );
}

const EMPTY_EDIT = {
  // Client details
  name: '', phone: '', phone2: '', email: '', email2: '', pan: '', gst: '',
  // Project details
  projectType: '', scope: '', location: '', builder: '', source: '',
  estimatedValue: '', expectedMoveIn: '',
  offer1: '', offer2: '', offer3: '',
  notes: '',
  // Legacy
  possessionTimeline: '', nextMeetingDate: '',
};

/** Preset possession timeframes; anything else stored is treated as a custom date. */
const POSSESSION_PRESETS = ['Immediate', '3 months', '6 months', '1 year+'];

/** true if `v` looks like a YYYY-MM-DD date (what the custom date input produces). */
function isIsoDateString(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

const SOURCE_OPTIONS = [
  'Meta Ads', 'Google Ads', 'Referral', 'Walk-in', 'Manual',
  'Website', 'Instagram', 'WhatsApp', 'LinkedIn', 'Other',
];

/** Gate requirements to show in the stage roadmap ℹ popover (mirrors stageRequirements.ts) */
/** Funnel stages shown in the horizontal roadmap. EFFECTIVE_LEAD/HANDED_OVER are
 * legacy/off-funnel stages and are intentionally excluded here — new leads
 * start at MQL and DESIGN_IN_PROGRESS is now the funnel's terminal stage. */
const FUNNEL_STAGES = [
  'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS',
];

const FUNNEL_ABBREV: Record<string, string> = {
  EFFECTIVE_LEAD: 'EL', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'PR', PROPOSAL_PRESENTED: 'PP',
  PROPOSAL_DISCUSSION: 'PD', ONBOARDING: 'OB',
  ONBOARDING_MEETING: 'OBM', DESIGN_IN_PROGRESS: 'DIP', HANDED_OVER: 'HO',
};

/** Priority bucket for activity log grouping (lower = shown first) */
const ACTIVITY_BUCKET: Record<string, number> = {
  CALL_LOGGED: 0,
  MEETING_SCHEDULED: 1,
  STAGE_CHANGED: 2,
  INTENT_RATING_UPDATED: 3,
  MEETING_COMPLETED: 4,
  MEETING_RESCHEDULED: 5,
  MEETING_CANCELLED: 6,
  MEETING_NO_SHOW: 6,
};

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
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
  const [onHoldReason, setOnHoldReason] = useState('');
  const [onHoldReopenDate, setOnHoldReopenDate] = useState('');
  const [changingStage, setChangingStage] = useState(false);

  const [intentModal, setIntentModal] = useState(false);
  const [pendingRating, setPendingRating] = useState(0);
  const [intentReason, setIntentReason] = useState('');
  const [savingIntent, setSavingIntent] = useState(false);

  const [editDetailsModal, setEditDetailsModal] = useState(false);
  const [editDetails, setEditDetails] = useState<typeof EMPTY_EDIT>(EMPTY_EDIT);
  const [possessionMode, setPossessionMode] = useState<'preset' | 'custom'>('preset');
  const [savingDetails, setSavingDetails] = useState(false);

  const [reassignField, setReassignField] = useState<'designer' | 'bl' | null>(null);
  const [reassignValue, setReassignValue] = useState('');
  const [savingReassign, setSavingReassign] = useState(false);

  const [uploadingFloorPlan, setUploadingFloorPlan] = useState(false);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  const [stagePushPrompt, setStagePushPrompt] = useState<{ targetStage: string; label: string } | null>(null);

  const [stageHistory, setStageHistory] = useState<StageVisit[]>([]);
  const [leadFollowUpTasks, setLeadFollowUpTasks] = useState<FollowUpTask[]>([]);
  const [gateInfoStage, setGateInfoStage] = useState<string | null>(null); // popover target
  const [gateDetails, setGateDetails] = useState<Record<string, { label: string; satisfied: boolean }[]>>({});
  const [gateDetailsLoading, setGateDetailsLoading] = useState(false);

  const [avgNps, setAvgNps] = useState<number | null>(null);
  const [npsPerStage, setNpsPerStage] = useState<Record<string, { stage: string; score: number | null; sentAt: string; respondedAt: string | null }>>({});

  const loadLead = useCallback(() => {
    if (!leadId) return;
    setLoadingLead(true);
    api.get<{ lead: Lead; avgNps: number | null; npsPerStage: Record<string, any> }>(`/leads/${leadId}`)
      .then((d) => { setLead(d.lead); setAvgNps(d.avgNps ?? null); setNpsPerStage(d.npsPerStage ?? {}); })
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

  const loadStageHistory = useCallback(() => {
    if (!leadId) return;
    api.get<{ history: StageVisit[] }>(`/leads/${leadId}/stage-history`)
      .then((d) => setStageHistory(d.history ?? []))
      .catch(() => {});
  }, [leadId]);

  const loadFollowUpTasks = useCallback(() => {
    if (!leadId) return;
    api.get<{ tasks: FollowUpTask[] }>(`/leads/${leadId}/tasks`)
      .then((d) => setLeadFollowUpTasks(d.tasks ?? []))
      .catch(() => {});
  }, [leadId]);

  useEffect(() => { loadLead(); }, [loadLead]);
  useEffect(() => { loadActivities(); }, [loadActivities]);
  useEffect(() => { loadSidebarData(); }, [loadSidebarData]);
  useEffect(() => { loadStageHistory(); }, [loadStageHistory]);
  useEffect(() => { loadFollowUpTasks(); }, [loadFollowUpTasks]);

  /** Called by MeetingsTab after a meeting is marked COMPLETED */
  const handleMeetingCompleted = useCallback(async (meetingType: string) => {
    if (!lead) return;
    const PROMPTS: Record<string, { from: string; label: string; targetStage: string }[]> = {
      DQL: [{ from: 'MQL', targetStage: 'DQL', label: 'DQL' }],
      PP: [
        { from: 'PROPOSAL_READY', targetStage: 'PROPOSAL_PRESENTED', label: 'Proposal Presented' },
        { from: 'DQL', targetStage: 'PROPOSAL_PRESENTED', label: 'Proposal Presented' }, // direct DQL→PP
      ],
      ONBOARDING: [{ from: 'PROPOSAL_DISCUSSION', targetStage: 'ONBOARDING', label: 'Onboarding' }],
    };
    const candidates = (PROMPTS[meetingType] ?? []).filter((p) => p.from === lead.stage);
    if (!candidates.length) return;
    const p = candidates[0];
    try {
      // Pre-check gate requirements — only show the prompt if the server will accept the move
      const result = await api.get<{ ok: boolean }>(`/leads/${lead.id}/can-advance?toStage=${p.targetStage}`);
      if (!result.ok) return; // gate not satisfied — don't prompt
    } catch {
      return; // endpoint unavailable — don't prompt
    }
    setStagePushPrompt({ targetStage: p.targetStage, label: p.label });
  }, [lead]);

  useEffect(() => {
    const t = searchParams.get('tab') as Tab | null;
    if (t) setActiveTab(t);
  }, [searchParams]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const resetStageModalFields = () => { setInactivationReason(''); setOnHoldReason(''); setOnHoldReopenDate(''); };
  const openStageModal = () => { setNewStage(lead?.stage ?? ''); resetStageModalFields(); setStageModal(true); };
  /** Opens the stage modal pre-selected to a specific target stage */
  const openStageModalTo = (targetStage: string) => { setNewStage(targetStage); resetStageModalFields(); setStageModal(true); };

  const toLocalDatetimeInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEditDetails = () => {
    if (!lead) return;
    setEditDetails({
      name: lead.name ?? '',
      phone: lead.phone ?? '',
      phone2: lead.phone2 ?? '',
      email: lead.email ?? '',
      email2: lead.email2 ?? '',
      pan: lead.pan ?? '',
      gst: lead.gst ?? '',
      projectType: lead.projectType ?? '',
      scope: lead.scope ?? '',
      location: lead.location ?? '',
      builder: lead.builder ?? '',
      source: lead.source ?? '',
      estimatedValue: lead.estimatedValue != null ? String(lead.estimatedValue) : '',
      expectedMoveIn: lead.expectedMoveIn ? lead.expectedMoveIn.slice(0, 10) : '',
      offer1: lead.offer1 ?? '',
      offer2: lead.offer2 ?? '',
      offer3: lead.offer3 ?? '',
      notes: lead.notes ?? '',
      possessionTimeline: lead.possessionTimeline ?? '',
      nextMeetingDate: lead.nextMeetingDate ? toLocalDatetimeInput(lead.nextMeetingDate) : '',
    });
    const savedPossession = lead.possessionTimeline ?? '';
    setPossessionMode(
      savedPossession && !POSSESSION_PRESETS.includes(savedPossession) ? 'custom' : 'preset',
    );
    setEditDetailsModal(true);
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDetails(true);
    try {
      await api.patch(`/leads/${leadId}`, {
        name: editDetails.name.trim() || null,
        phone: editDetails.phone.trim() || null,
        phone2: editDetails.phone2.trim() || null,
        email: editDetails.email.trim() || null,
        email2: editDetails.email2.trim() || null,
        pan: editDetails.pan.trim() || null,
        gst: editDetails.gst.trim() || null,
        projectType: editDetails.projectType.trim() || null,
        scope: editDetails.scope.trim() || null,
        location: editDetails.location.trim() || null,
        builder: editDetails.builder.trim() || null,
        source: editDetails.source.trim() || null,
        estimatedValue: editDetails.estimatedValue.trim() || null,
        expectedMoveIn: editDetails.expectedMoveIn ? new Date(editDetails.expectedMoveIn).toISOString() : null,
        offer1: editDetails.offer1.trim() || null,
        offer2: editDetails.offer2.trim() || null,
        offer3: editDetails.offer3.trim() || null,
        notes: editDetails.notes.trim() || null,
        possessionTimeline: editDetails.possessionTimeline.trim() || null,
        nextMeetingDate: editDetails.nextMeetingDate
          ? new Date(editDetails.nextMeetingDate).toISOString()
          : null,
      });
      toast.success('Lead details updated');
      setEditDetailsModal(false);
      loadLead(); loadActivities();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not update details');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleStageChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStage || newStage === lead?.stage) { setStageModal(false); return; }
    if (newStage === 'INACTIVE' && !inactivationReason.trim()) {
      toast.error('Please provide a reason for inactivation'); return;
    }
    if (newStage === 'ON_HOLD') {
      if (!onHoldReason.trim()) { toast.error('Please provide a reason for placing on hold'); return; }
      if (!onHoldReopenDate) { toast.error('Please select a reopen date'); return; }
      if (new Date(onHoldReopenDate) <= new Date()) { toast.error('Reopen date must be in the future'); return; }
    }
    setChangingStage(true);
    try {
      await api.patch(`/leads/${leadId}`, {
        stage: newStage,
        ...(newStage === 'INACTIVE' && { inactivationReason }),
        ...(newStage === 'ON_HOLD' && {
          reason: onHoldReason,
          onHoldRevivalDate: onHoldReopenDate,
        }),
      });
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

  const handleFloorPlanUpload = async (file: File) => {
    setUploadingFloorPlan(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('crm_token') ?? '';
      const baseUrl = (import.meta as any).env?.VITE_API_URL ?? '';
      const res = await fetch(`${baseUrl}/api/leads/${leadId}/floor-plan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      // Safely parse JSON — the server may return HTML on unhandled multer errors
      let data: { error?: string; url?: string } = {};
      try {
        data = await res.json();
      } catch {
        // Non-JSON body (e.g. HTML error page from Express default handler)
        if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      toast.success('Floor plan uploaded');
      loadLead();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not upload floor plan');
    } finally {
      setUploadingFloorPlan(false);
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
    { id: 'files', label: 'Files' },
  ];

  const latestQuote = quotes[0];
  const designerUsers = users.filter((u) => u.role === 'DESIGNER');
  const blUsers = users.filter((u) => u.role === 'BL');

  return (
    <div className="min-h-screen">
      {/* ── Auto Stage-Advance Prompt (after meeting completed) ─────────────── */}
      {stagePushPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <div className="text-3xl mb-3">🎉</div>
            <h3 className="font-semibold text-gray-900 text-lg mb-2">Meeting Completed!</h3>
            <p className="text-sm text-gray-500 mb-5">
              Would you like to advance this lead to <strong>{stagePushPrompt.label}</strong>?
              The server will verify all gate requirements before accepting the move.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setStagePushPrompt(null)}
                className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                Not yet
              </button>
              <button
                onClick={() => { const t = stagePushPrompt!.targetStage; setStagePushPrompt(null); openStageModalTo(t); }}
                className="flex-1 bg-brand-500 text-white py-2 rounded-xl text-sm font-medium hover:bg-brand-600 transition-colors"
              >
                Advance Stage →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stage-change modal ────────────────────────────────────────────────── */}
      {stageModal && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-warm-lg w-full max-w-sm p-6">
            <h3 className="font-bold text-stone-900 mb-4 tracking-tight">Change Stage</h3>
            <form onSubmit={handleStageChange} className="space-y-4">
              <select value={newStage} onChange={(e) => setNewStage(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}>
                {ALL_STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>
                ))}
              </select>
              {newStage === 'INACTIVE' && (
                <div>
                  <label className="block text-sm font-semibold text-stone-700 mb-1.5">
                    Reason <span className="text-brand-500">*</span>
                  </label>
                  <textarea rows={3} value={inactivationReason} onChange={(e) => setInactivationReason(e.target.value)}
                    required placeholder="e.g. Budget mismatch, not interested"
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                    style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
                  <p className="text-xs text-stone-400 mt-1">Feedback email + SMS sent automatically to client and internal team.</p>
                </div>
              )}
              {newStage === 'ON_HOLD' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-stone-700 mb-1.5">
                      Reason <span className="text-brand-500">*</span>
                    </label>
                    <textarea rows={2} value={onHoldReason} onChange={(e) => setOnHoldReason(e.target.value)}
                      required placeholder="e.g. Client travelling, budget review pending"
                      className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                      style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-stone-700 mb-1.5">
                      Reopen date <span className="text-brand-500">*</span>
                    </label>
                    <input type="date" value={onHoldReopenDate} onChange={(e) => setOnHoldReopenDate(e.target.value)}
                      required min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                      className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                      style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
                    <p className="text-xs text-stone-400 mt-1">Client + internal team notified. Designer alerted on this date.</p>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStageModal(false)}
                  className="flex-1 text-stone-600 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors"
                  style={{ border: '1px solid #EDE8E3' }}>Cancel</button>
                <button type="submit" disabled={changingStage || !newStage || newStage === lead?.stage}
                  className="flex-1 bg-brand-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 transition-colors">
                  {changingStage ? 'Saving…' : 'Update Stage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Lead Details modal ───────────────────────────────────────────── */}
      {editDetailsModal && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-warm-lg w-full max-w-lg p-6 my-4">
            <h3 className="font-bold text-stone-900 mb-1 tracking-tight">Edit Lead Details</h3>
            <p className="text-xs text-stone-400 mb-5">
              The following <strong>Project Details</strong> are required before moving EL → MQL:
              Client Budget, Project Type, Lead Source, Location, Builder, Scope of Work, Expected Move-in.
              Client Details fields are recommended but not gated.
              Leads with 1★ intent cannot advance regardless.
            </p>
            <form onSubmit={handleSaveDetails} className="space-y-5">
              {/* ── Client Details ─────────────────────────────────────────── */}
              <div>
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">Client Details</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: 'name', label: 'Full Name', placeholder: 'Amit Sharma', colSpan: 2 },
                    { key: 'phone', label: 'Phone', placeholder: '+91 98765 43210' },
                    { key: 'phone2', label: 'Alternate Phone', placeholder: '' },
                    { key: 'email', label: 'Email', placeholder: 'amit@example.com', type: 'email' },
                    { key: 'email2', label: 'Alternate Email', placeholder: '', type: 'email' },
                    { key: 'pan', label: 'PAN', placeholder: 'ABCDE1234F' },
                    { key: 'gst', label: 'GST', placeholder: '29ABCDE1234F1ZX' },
                  ] as { key: keyof typeof EMPTY_EDIT; label: string; placeholder?: string; type?: string; colSpan?: number }[]).map((f) => (
                    <div key={f.key} className={f.colSpan === 2 ? 'col-span-2' : ''}>
                      <label className="block text-xs font-semibold text-stone-600 mb-1">{f.label}</label>
                      <input
                        type={f.type ?? 'text'}
                        value={editDetails[f.key]}
                        onChange={(e) => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                        placeholder={f.placeholder}
                        className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                        style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Project Details ─────────────────────────────────────────── */}
              <div>
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">Project Details</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: 'projectType', label: 'Project Type', placeholder: '2BHK / Villa / Office' },
                    { key: 'scope', label: 'Scope of Work', placeholder: '3-bed full home' },
                    { key: 'location', label: 'Location', placeholder: 'Whitefield, Bangalore' },
                    { key: 'builder', label: 'Builder (or N/A)', placeholder: 'Sobha / Godrej / N/A' },
                  ] as { key: keyof typeof EMPTY_EDIT; label: string; placeholder?: string; type?: string; colSpan?: number; multiline?: boolean }[]).map((f) => (
                    <div key={f.key} className={f.colSpan === 2 ? 'col-span-2' : ''}>
                      <label className="block text-xs font-semibold text-stone-600 mb-1">{f.label}</label>
                      <input
                        type={f.type ?? 'text'}
                        value={editDetails[f.key]}
                        onChange={(e) => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                        placeholder={f.placeholder}
                        className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                        style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                      />
                    </div>
                  ))}
                  {/* Source — select with common values */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">Lead Source <span className="text-brand-500">*</span></label>
                    <select
                      value={editDetails.source}
                      onChange={(e) => setEditDetails({ ...editDetails, source: e.target.value })}
                      className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                      style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                    >
                      <option value="">Select source…</option>
                      {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {/* Possession — preset timeframe dropdown, or a custom date */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">Possession</label>
                    <select
                      value={possessionMode === 'preset' ? editDetails.possessionTimeline : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setPossessionMode('custom');
                          setEditDetails({
                            ...editDetails,
                            possessionTimeline: isIsoDateString(editDetails.possessionTimeline) ? editDetails.possessionTimeline : '',
                          });
                        } else {
                          setPossessionMode('preset');
                          setEditDetails({ ...editDetails, possessionTimeline: e.target.value });
                        }
                      }}
                      className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                      style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                    >
                      <option value="">Select timeframe…</option>
                      {POSSESSION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                      <option value="__custom__">Custom date…</option>
                    </select>
                    {possessionMode === 'custom' && (
                      <>
                        <input
                          type="date"
                          value={isIsoDateString(editDetails.possessionTimeline) ? editDetails.possessionTimeline : ''}
                          onChange={(e) => setEditDetails({ ...editDetails, possessionTimeline: e.target.value })}
                          className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all mt-2"
                          style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                        />
                        {editDetails.possessionTimeline && !isIsoDateString(editDetails.possessionTimeline) && (
                          <p className="text-[11px] text-stone-400 mt-1">
                            Previously saved as "{editDetails.possessionTimeline}" — pick a date above to replace it.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {([
                    { key: 'estimatedValue', label: 'Client Budget (₹)', placeholder: '1500000', type: 'number' },
                    { key: 'expectedMoveIn', label: 'Expected Move-in', type: 'date' },
                    { key: 'offer1', label: 'Offer 1', placeholder: '10% discount on modular' },
                    { key: 'offer2', label: 'Offer 2', placeholder: '' },
                    { key: 'offer3', label: 'Offer 3', placeholder: '' },
                    { key: 'notes', label: 'Notes', placeholder: 'Any additional context…', colSpan: 2, multiline: true },
                  ] as { key: keyof typeof EMPTY_EDIT; label: string; placeholder?: string; type?: string; colSpan?: number; multiline?: boolean }[]).map((f) => (
                    <div key={f.key} className={f.colSpan === 2 ? 'col-span-2' : ''}>
                      <label className="block text-xs font-semibold text-stone-600 mb-1">{f.label}</label>
                      {f.multiline ? (
                        <textarea
                          rows={3}
                          value={editDetails[f.key]}
                          onChange={(e) => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                          placeholder={f.placeholder}
                          className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all resize-none"
                          style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                        />
                      ) : (
                        <input
                          type={f.type ?? 'text'}
                          value={editDetails[f.key]}
                          onChange={(e) => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                          placeholder={f.placeholder}
                          className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                          style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditDetailsModal(false)}
                  className="flex-1 text-stone-600 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors"
                  style={{ border: '1px solid #EDE8E3' }}>Cancel</button>
                <button type="submit" disabled={savingDetails}
                  className="flex-1 bg-brand-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 transition-colors">
                  {savingDetails ? 'Saving…' : 'Save Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Intent override modal ─────────────────────────────────────────────── */}
      {intentModal && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-warm-lg w-full max-w-sm p-6">
            <h3 className="font-bold text-stone-900 mb-1 tracking-tight">Override Intent Rating</h3>
            <p className="text-xs text-stone-400 mb-4">System auto-rates based on meeting type. Reason required when overriding manually.</p>
            <div className="flex justify-center mb-4">
              <StarRating rating={pendingRating} onSelect={setPendingRating} />
            </div>
            {pendingRating === 1 && (
              <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-xs">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>1★ means "no action planned". This lead will be blocked from advancing stages until the rating is updated.</span>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-stone-700 mb-1.5">Reason</label>
              <textarea rows={2} value={intentReason} onChange={(e) => setIntentReason(e.target.value)}
                placeholder="e.g. Client confirmed purchase intent during site visit"
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
                style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }} />
              <p className="text-xs text-stone-400 mt-1">Required if overriding system rating.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIntentModal(false)}
                className="flex-1 text-stone-600 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors"
                style={{ border: '1px solid #EDE8E3' }}>Cancel</button>
              <button onClick={handleIntentSave} disabled={savingIntent || !pendingRating}
                className="flex-1 bg-brand-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 transition-colors">
                {savingIntent ? 'Saving…' : 'Save Rating'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hidden floor plan file input ─────────────────────────────────────── */}
      <input
        type="file"
        ref={floorPlanInputRef}
        accept=".pdf,.jpg,.jpeg,.png,.dwg,.dxf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFloorPlanUpload(file);
          e.target.value = '';
        }}
      />

      {/* ── Sticky header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white px-6 py-3" style={{ borderBottom: '1px solid #EDE8E3' }}>
        {loadingLead ? (
          <div className="h-12 flex items-center">
            <div className="h-4 w-48 rounded-lg animate-pulse" style={{ background: '#EDE8E3' }} />
          </div>
        ) : lead ? (
          <div className="flex items-start justify-between gap-4">
            {/* Left: name + subtitle + stage/intent row */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-extrabold text-stone-900 tracking-tight truncate min-w-0" title={lead.name}>{lead.name}</h1>
                {lead.isSLABreached && (
                  <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">
                    <AlertTriangle size={10} strokeWidth={2.5} /> SLA
                  </span>
                )}
                {lead.currentOffer && (
                  <span className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-semibold">
                    <Gift size={10} strokeWidth={2} /> {lead.currentOffer.name}
                  </span>
                )}
                {avgNps != null && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-bold ${avgNps >= 9 ? 'bg-green-100 text-green-700' : avgNps >= 7 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}
                    title={`NPS: ${avgNps}/10 (average of ${Object.keys(npsPerStage).length} survey${Object.keys(npsPerStage).length !== 1 ? 's' : ''})`}
                  >
                    ★ NPS {avgNps}
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-400 mt-0.5 font-medium">
                {lead.leadId}
                {lead.projectType ? ` · ${lead.projectType}` : ''}
                {lead.scope ? ` · ${lead.scope}` : ''}
                {lead.location ? ` · ${lead.location}` : ''}
              </p>
              {/* Stage + intent row */}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <button
                  onClick={openStageModal}
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold cursor-pointer hover:opacity-80 transition-opacity ${STAGE_COLORS[lead.stage] ?? 'bg-stone-100 text-stone-600'}`}
                  title="Click to change stage"
                >
                  <span className="flex items-center gap-1">{STAGE_LABELS[lead.stage] ?? lead.stage} <ChevronDown size={10} strokeWidth={2.5} /></span>
                </button>
                {/* Intent stars + auto badge */}
                <button
                  onClick={() => openIntentModal(lead.intentRating ?? 0)}
                  title="Click to override intent rating"
                  className="flex items-center gap-1.5 hover:opacity-70 transition-opacity"
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className={`text-base ${i < (lead.intentRating ?? 0) ? 'text-amber-400' : 'text-stone-200'}`}>★</span>
                  ))}
                  {lead.intentRatingSource === 'auto' && (
                    <span className="text-[9px] font-bold bg-sky-100 text-sky-600 px-1.5 py-0.5 rounded-full tracking-wide">AUTO</span>
                  )}
                  {lead.intentRatingSource === 'manual' && (
                    <span className="text-[9px] font-bold bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full tracking-wide">MANUAL</span>
                  )}
                </button>
                {/* 1-star warning */}
                {lead.intentRating === 1 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-medium">
                    <AlertTriangle size={10} strokeWidth={2.5} />
                    1★ — cannot advance stage
                  </span>
                )}
              </div>
            </div>

            {/* Right: action buttons */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              <button
                onClick={() => toast('Call logging — coming soon')}
                className="flex items-center gap-1.5 text-stone-600 px-3 py-1.5 rounded-xl text-xs hover:bg-stone-50 transition-colors font-medium"
                style={{ border: '1px solid #EDE8E3' }}
              ><Phone size={13} strokeWidth={2} /> Log Call</button>
              <button
                onClick={() => handleTabChange('meetings')}
                className="flex items-center gap-1.5 text-stone-600 px-3 py-1.5 rounded-xl text-xs hover:bg-stone-50 transition-colors font-medium"
                style={{ border: '1px solid #EDE8E3' }}
              ><CalendarPlus size={13} strokeWidth={2} /> Meeting</button>
              <button
                onClick={() => handleTabChange('discount')}
                className="flex items-center gap-1.5 text-stone-600 px-3 py-1.5 rounded-xl text-xs hover:bg-stone-50 transition-colors font-medium"
                style={{ border: '1px solid #EDE8E3' }}
              ><Tag size={13} strokeWidth={2} /> Discount</button>
              <button
                onClick={() => handleTabChange('whatsapp')}
                className="flex items-center gap-1.5 bg-green-500 text-white px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-green-600 transition-colors"
              ><MessageCircle size={13} strokeWidth={2} /> WhatsApp</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Lead not found</p>
        )}
      </div>

      {/* PD→OB checklist for PROPOSAL_DISCUSSION (and later, as a record) */}
      {lead && ['PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS', 'HANDED_OVER'].includes(lead.stage) && (
        <div className="px-6 pt-4">
          <PDOBChecklistPanel leadId={leadId!} stage={lead.stage} clientEmail={lead.email ?? null} onComplete={loadLead} />
        </div>
      )}

      {/* OB→OBM checklist for ONBOARDING (and later, as a record) */}
      {lead && ['ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS', 'HANDED_OVER'].includes(lead.stage) && (
        <div className="px-6 pt-4">
          <OBOBMChecklistPanel leadId={leadId!} stage={lead.stage} clientEmail={lead.email ?? null} onComplete={loadLead} />
        </div>
      )}

      {/* DIP Checklist for ONBOARDING_MEETING / DESIGN_IN_PROGRESS / HANDED_OVER (legacy) */}
      {lead && (lead.stage === 'ONBOARDING_MEETING' || lead.stage === 'DESIGN_IN_PROGRESS' || lead.stage === 'HANDED_OVER') && (
        <div className="px-6 pt-4">
          <DIPChecklistPanel leadId={leadId!} stage={lead.stage} />
        </div>
      )}

      {/* ── Main content: tabs (left 2/3) + sidebar (right 1/3) ─────────────── */}
      <div className="px-6 py-4 flex gap-6 items-start">
        {/* Main col */}
        <div className="flex-1 min-w-0 space-y-0">
          {/* Tab nav */}
          <div className="bg-white rounded-t-2xl" style={{ border: '1px solid #EDE8E3', borderBottom: 'none' }}>
            <nav className="flex gap-0 overflow-x-auto scrollbar-hide">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-stone-500 hover:text-stone-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab content */}
          <div className="bg-white rounded-b-2xl p-5" style={{ border: '1px solid #EDE8E3' }}>
            {activeTab === 'overview' && lead && (
              <div className="space-y-6">
                {/* ── Stage Roadmap ─────────────────────────────────────────── */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">Stage Roadmap</h3>
                    <span className="text-[10px] text-gray-400">Allocated {fmtDateTime(lead.createdAt)}</span>
                  </div>
                  <div className="relative overflow-x-auto pb-2">
                    <div className="flex items-start gap-0 min-w-max">
                      {FUNNEL_STAGES.map((stage, idx) => {
                        // Find all visits to this stage
                        const visits = stageHistory.filter((v) => v.stage === stage);
                        const isCurrent = lead.stage === stage;
                        const wasVisited = visits.length > 0;
                        const visit = visits[visits.length - 1]; // most recent visit
                        const isGateInfoOpen = gateInfoStage === stage;
                        const nextStage = FUNNEL_STAGES[idx + 1];
                        const hasGate = !!nextStage; // every stage but the last has an outgoing transition to check

                        return (
                          <div key={stage} className="flex items-center">
                            {idx > 0 && (
                              <div className={`h-0.5 w-8 ${wasVisited || isCurrent ? 'bg-brand-300' : 'bg-gray-100'}`} />
                            )}
                            <div className="relative flex flex-col items-center">
                              {/* Node */}
                              <button
                                onClick={openStageModal}
                                title={`Click to change stage`}
                                className={`w-14 h-14 rounded-full flex flex-col items-center justify-center text-center transition-all border-2 ${
                                  isCurrent
                                    ? 'bg-brand-500 border-brand-600 text-white shadow-md'
                                    : wasVisited
                                    ? 'bg-brand-50 border-brand-200 text-brand-700'
                                    : 'bg-gray-50 border-gray-100 text-gray-300'
                                }`}
                              >
                                <span className="text-[10px] font-bold leading-none">{FUNNEL_ABBREV[stage]}</span>
                                {wasVisited && visit?.tatDays !== undefined && (
                                  <span className="text-[8px] leading-tight mt-0.5 opacity-80">{visit.tatDays}d</span>
                                )}
                              </button>

                              {/* Entry date */}
                              {(wasVisited || isCurrent) && visit?.enteredAt && (
                                <span className="text-[9px] text-gray-400 mt-1 text-center w-16 leading-tight">
                                  {fmtDate(visit.enteredAt)}
                                </span>
                              )}

                              {/* Gate info button + popover — labels & satisfied state come straight from the
                                  server's /can-advance check (the same authoritative logic used to actually
                                  block the move), never a separately-maintained client-side copy. */}
                              {hasGate && (
                                <div className="relative mt-0.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isGateInfoOpen) {
                                        setGateInfoStage(null);
                                      } else {
                                        setGateInfoStage(stage);
                                        if (lead && nextStage) {
                                          setGateDetailsLoading(true);
                                          api.get<{ details: { label: string; satisfied: boolean }[] }>(
                                            `/leads/${lead.id}/can-advance?fromStage=${stage}&toStage=${nextStage}`,
                                          )
                                            .then((res) => setGateDetails((prev) => ({ ...prev, [stage]: res.details ?? [] })))
                                            .catch(() => setGateDetails((prev) => { const { [stage]: _drop, ...rest } = prev; return rest; }))
                                            .finally(() => setGateDetailsLoading(false));
                                        }
                                      }
                                    }}
                                    className="text-gray-300 hover:text-brand-400 transition-colors"
                                    title="Gate requirements"
                                  >
                                    <Info size={10} strokeWidth={2} />
                                  </button>
                                  {isGateInfoOpen && (
                                    <div
                                      className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-lg border border-gray-100 p-2.5 z-20 w-48 text-left"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                                        Gate to {FUNNEL_ABBREV[nextStage ?? stage]}
                                      </p>
                                      {gateDetailsLoading && !gateDetails[stage] ? (
                                        <p className="text-[9px] text-gray-400">Checking…</p>
                                      ) : gateDetails[stage] && gateDetails[stage].length === 0 ? (
                                        <p className="text-[9px] text-gray-400">No requirements to advance</p>
                                      ) : (
                                        (gateDetails[stage] ?? []).map((d, gi) => (
                                          <div key={gi} className="flex items-start gap-1 mb-0.5">
                                            <span className={`mt-px shrink-0 ${d.satisfied ? 'text-green-500' : 'text-red-500'}`}>
                                              {d.satisfied ? <Check size={8} strokeWidth={3} /> : <X size={8} strokeWidth={3} />}
                                            </span>
                                            <span className={`text-[9px] leading-tight ${d.satisfied ? 'text-gray-600' : 'text-red-600 font-medium'}`}>{d.label}</span>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Close popover on outside click */}
                  {gateInfoStage && (
                    <div className="fixed inset-0 z-10" onClick={() => setGateInfoStage(null)} />
                  )}
                </div>

                {/* ── Follow-up Tasks ───────────────────────────────────────── */}
                {leadFollowUpTasks.filter((t) => !t.isCompleted).length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-800">Follow-up Tasks</h3>
                      <button onClick={() => handleTabChange('followups')} className="text-xs text-brand-500 hover:underline">View all →</button>
                    </div>
                    <div className="space-y-1.5">
                      {leadFollowUpTasks.filter((t) => !t.isCompleted).map((t) => {
                        const color = t.isOverdue
                          ? 'bg-red-50 border-red-200 text-red-700'
                          : 'bg-green-50 border-green-200 text-green-700';
                        const label = t.isOverdue ? 'Overdue' : 'Upcoming';
                        const dueStr = fmtDate(t.dueDate) + (t.dueTime ? ` ${t.dueTime}` : '');
                        return (
                          <div key={t.id} className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs ${color}`}>
                            <span className="font-medium">{label}</span>
                            <span className="opacity-80">{dueStr}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Client Details ────────────────────────────────────────── */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">Client Details</h3>
                    <button
                      onClick={openEditDetails}
                      className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium"
                    >
                      <Pencil size={11} strokeWidth={2} /> Edit
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8">
                    <FactRow label="Full Name" value={lead.name} />
                    <FactRow label="Phone" value={lead.phone} />
                    <FactRow label="Alternate Phone" value={lead.phone2} />
                    <FactRow label="Email" value={lead.email
                      ? <a href={`mailto:${lead.email}`} className="text-brand-500 hover:underline">{lead.email}</a>
                      : undefined} />
                    <FactRow label="Alternate Email" value={lead.email2
                      ? <a href={`mailto:${lead.email2}`} className="text-brand-500 hover:underline">{lead.email2}</a>
                      : undefined} />
                    <FactRow label="PAN" value={lead.pan} />
                    <FactRow label="GST" value={lead.gst} />
                  </div>
                </div>

                {/* ── Project Details ───────────────────────────────────────── */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">Project Details</h3>
                    <button
                      onClick={openEditDetails}
                      className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium"
                    >
                      <Pencil size={11} strokeWidth={2} /> Edit
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8">
                    <FactRow label="Project Type" value={lead.projectType} />
                    <FactRow label="Scope of Work" value={lead.scope} />
                    <FactRow label="Location" value={lead.location} />
                    <FactRow label="Builder" value={lead.builder} />
                    <FactRow label="Client Budget" value={fmtVal(lead.estimatedValue)} />
                    <FactRow label="Expected Move-in" value={lead.expectedMoveIn
                      ? new Date(lead.expectedMoveIn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                      : undefined} />
                    <FactRow label="Possession" value={lead.possessionTimeline} />
                    <FactRow label="Source" value={lead.source?.replace(/_/g, ' ')} />
                  </div>

                  {/* Offers */}
                  {(lead.offer1 || lead.offer2 || lead.offer3) && (
                    <div className="mt-2 space-y-0.5">
                      {[lead.offer1, lead.offer2, lead.offer3].filter(Boolean).map((o, i) => (
                        <FactRow key={i} label={`Offer ${i + 1}`} value={o} />
                      ))}
                    </div>
                  )}

                  {/* Floor plan */}
                  <div className="mt-3 flex items-center gap-3 py-1.5 border-b border-gray-50">
                    <span className="text-xs text-gray-400 w-32 shrink-0">Floor Plan</span>
                    <div className="flex items-center gap-2">
                      {lead.floorPlanUrl ? (
                        <a
                          href={lead.floorPlanUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium"
                        >
                          <ExternalLink size={11} strokeWidth={2} /> View file
                        </a>
                      ) : (
                        <>
                          <span className="text-xs text-gray-300">No file uploaded</span>
                          <button
                            onClick={() => floorPlanInputRef.current?.click()}
                            disabled={uploadingFloorPlan}
                            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 px-2 py-0.5 rounded-lg transition-colors disabled:opacity-50"
                            style={{ border: '1px solid #EDE8E3' }}
                          >
                            <Upload size={10} strokeWidth={2} />
                            {uploadingFloorPlan ? 'Uploading…' : 'Upload'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Notes */}
                  {lead.notes && (
                    <div className="mt-2 py-2 border-b border-gray-50">
                      <span className="text-xs text-gray-400 block mb-1">Notes</span>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{lead.notes}</p>
                    </div>
                  )}

                  {/* Latest Quote */}
                  {latestQuote && (
                    <div className="mt-3 flex items-center gap-2 py-1.5 border-b border-gray-50">
                      <span className="text-xs text-gray-400 w-32 shrink-0">Latest Quote</span>
                      <button
                        onClick={() => handleTabChange('quotes')}
                        className="inline-flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium"
                      >
                        <ExternalLink size={11} strokeWidth={2} />
                        {latestQuote.quoteNumber ?? `#${latestQuote.id.slice(-6)}`}
                        {latestQuote.totalAmount ? ` — ${fmtVal(latestQuote.totalAmount)}` : ''}
                        <span className="ml-1 text-gray-400 font-normal">({latestQuote.status ?? 'Draft'})</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'activity' && (() => {
              // Group activities by type bucket, preserving chronological order within each group
              const BUCKET_LABELS: Record<number, string> = {
                0: 'Calls',
                1: 'Meetings Scheduled',
                2: 'Stage Movements',
                3: 'Intent Rating',
                4: 'Meeting Completions',
                5: 'Meetings Rescheduled',
                6: 'Meetings No-Show / Cancelled',
              };
              const OTHER_BUCKET = 99;
              const getBucket = (action: string) => ACTIVITY_BUCKET[action] ?? OTHER_BUCKET;
              const grouped = new Map<number, ActivityEntry[]>();
              for (const a of [...activities].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())) {
                const b = getBucket(a.action);
                if (!grouped.has(b)) grouped.set(b, []);
                grouped.get(b)!.push(a);
              }
              const sortedBuckets = [...grouped.entries()].sort(([a], [b]) => a - b);
              return (
                <div className="space-y-5">
                  <h3 className="text-sm font-semibold text-gray-700">Full Activity Log</h3>
                  {activities.length === 0 ? (
                    <p className="text-xs text-gray-400 py-8 text-center">No activity yet</p>
                  ) : sortedBuckets.map(([bucket, entries]) => (
                    <div key={bucket}>
                      {bucket !== OTHER_BUCKET && (
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">
                          {BUCKET_LABELS[bucket] ?? 'Other'}
                        </p>
                      )}
                      <div className="space-y-0">
                        {entries.map((a) => {
                          const isBackward = a.action === 'STAGE_CHANGED' && a.meta?.isBackward;
                          const direction = a.action === 'INTENT_RATING_UPDATED' ? a.meta?.direction : null;
                          const rowColor = isBackward
                            ? 'bg-red-50 border-red-100'
                            : direction === 'increase'
                            ? 'bg-green-50 border-green-100'
                            : direction === 'decrease'
                            ? 'bg-red-50 border-red-100'
                            : '';
                          return (
                            <div key={a.id} className={`flex items-start gap-3 py-2.5 border-b last:border-0 rounded-lg px-1 ${rowColor || 'border-gray-50'}`}>
                              <span className="text-base mt-0.5 shrink-0">
                                {isBackward ? '↩' : direction === 'increase' ? '▲' : direction === 'decrease' ? '▼' : (ACTION_ICONS[a.action] ?? '•')}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-700">
                                  <span className="font-medium">{a.user?.name ?? 'System'}</span>
                                  {' — '}
                                  {describeActivity(a.action, a.meta)}
                                </p>
                              </div>
                              <span className="text-xs text-gray-300 shrink-0">{relTime(a.createdAt)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {activeTab === 'calls' && <CallLogTab leadId={leadId!} />}
            {activeTab === 'followups' && <FollowUpTab leadId={leadId!} />}
            {activeTab === 'meetings' && (
              <MeetingsTab
                leadId={leadId!}
                onMeetingCreated={loadLead}
                onMeetingCompleted={handleMeetingCompleted}
              />
            )}
            {activeTab === 'whatsapp' && <WhatsAppTab leadId={leadId!} />}
            {activeTab === 'quotes' && lead && <QuoteTab leadId={leadId!} leadRef={lead.leadId} />}
            {activeTab === 'discount' && <DiscountTab leadId={leadId!} />}
            {activeTab === 'files' && lead && (
              <FilesTab leadId={leadId!} currentStage={lead.stage} />
            )}
          </div>
        </div>

        {/* ── Sidebar col ─────────────────────────────────────────────────────── */}
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

          {/* Intent Rating */}
          <SidebarCard title="Intent Rating">
            {lead ? (
              <>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} className={`text-sm ${i < (lead.intentRating ?? 0) ? 'text-amber-400' : 'text-gray-200'}`}>★</span>
                    ))}
                  </div>
                  <button onClick={() => openIntentModal(lead.intentRating ?? 0)}
                    className="text-xs text-brand-500 hover:underline font-medium">Override</button>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {lead.intentRatingSource === 'auto' && (
                    <span className="text-[9px] font-bold bg-sky-100 text-sky-600 px-1.5 py-0.5 rounded-full">AUTO — from meeting type</span>
                  )}
                  {lead.intentRatingSource === 'manual' && (
                    <span className="text-[9px] font-bold bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">MANUAL override</span>
                  )}
                  {!lead.intentRatingSource && (
                    <span className="text-[9px] text-gray-400">No rating yet</span>
                  )}
                </div>
                {lead.intentRating === 1 && (
                  <div className="mt-2 flex items-start gap-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg px-2.5 py-1.5 text-xs">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" strokeWidth={2.5} />
                    <span>Stage advance blocked. Update intent to proceed.</span>
                  </div>
                )}
              </>
            ) : <div className="h-10 bg-gray-50 rounded animate-pulse" />}
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
                      <Gift size={10} strokeWidth={2} /> {lead.currentOffer.name}
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
