import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import CallLogTab from '../components/tabs/CallLogTab';
import FollowUpTab from '../components/tabs/FollowUpTab';
import MeetingsTab from '../components/tabs/MeetingsTab';
import WhatsAppTab from '../components/tabs/WhatsAppTab';
import DiscountTab from '../components/tabs/DiscountTab';
import QuoteTab from '../components/tabs/QuoteTab';
import DIPChecklistPanel from '../components/DIPChecklistPanel';

type Tab = 'calls' | 'followups' | 'meetings' | 'whatsapp' | 'discount' | 'quotes';

interface Lead {
  id: string; leadId: string; name: string; phone: string; email?: string;
  stage: string; source?: string; projectType?: string; location?: string;
  isSLABreached: boolean; estimatedValue?: number;
  assignedDesigner?: { name: string } | null;
  assignedBL?: { name: string } | null;
  currentOffer?: { name: string } | null;
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

const ALL_STAGES = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL',
  'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'ONBOARDING', 'HANDED_OVER',
  'ON_HOLD', 'INACTIVE',
];

export default function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'calls');
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(true);

  // Stage-change modal
  const [stageModal, setStageModal] = useState(false);
  const [newStage, setNewStage] = useState('');
  const [inactivationReason, setInactivationReason] = useState('');
  const [changingStage, setChangingStage] = useState(false);

  useEffect(() => {
    const tabParam = searchParams.get('tab') as Tab | null;
    if (tabParam) setActiveTab(tabParam);
  }, [searchParams]);

  const loadLead = () => {
    if (!leadId) return;
    setLoadingLead(true);
    api.get<{ lead: Lead }>(`/leads/${leadId}`)
      .then((d) => setLead(d.lead))
      .catch(() => toast.error('Could not load lead details'))
      .finally(() => setLoadingLead(false));
  };

  useEffect(() => { loadLead(); }, [leadId]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const openStageModal = () => {
    setNewStage(lead?.stage ?? '');
    setInactivationReason('');
    setStageModal(true);
  };

  const handleStageChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStage || newStage === lead?.stage) { setStageModal(false); return; }
    if (newStage === 'INACTIVE' && !inactivationReason.trim()) {
      toast.error('Please provide a reason for inactivation');
      return;
    }
    setChangingStage(true);
    try {
      await api.patch(`/leads/${leadId}`, {
        stage: newStage,
        ...(newStage === 'INACTIVE' && { inactivationReason }),
      });
      toast.success(`Stage updated to ${newStage.replace(/_/g, ' ')}`);
      setStageModal(false);
      loadLead();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not change stage');
    } finally {
      setChangingStage(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'calls', label: '📞 Calls' },
    { id: 'followups', label: '✅ Follow-ups' },
    { id: 'meetings', label: '📅 Meetings' },
    { id: 'whatsapp', label: '💬 WhatsApp' },
    { id: 'quotes', label: '📝 Quotes' },
    { id: 'discount', label: '💰 Discount' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Stage-change modal */}
      {stageModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Change Stage</h3>
            <form onSubmit={handleStageChange} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
                <select
                  value={newStage}
                  onChange={(e) => setNewStage(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  {ALL_STAGES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              {newStage === 'INACTIVE' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for inactivation <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={inactivationReason}
                    onChange={(e) => setInactivationReason(e.target.value)}
                    required
                    placeholder="e.g. Budget mismatch, not interested"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    📧 Feedback email + SMS will be sent to the client automatically.
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStageModal(false)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingStage || !newStage || newStage === lead?.stage}
                  className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {changingStage ? 'Saving…' : 'Update Stage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link to="/leads" className="text-gray-400 hover:text-gray-600 text-sm shrink-0">← Leads</Link>
              <div className="min-w-0">
                {loadingLead ? (
                  <div className="h-5 w-40 bg-gray-100 rounded animate-pulse" />
                ) : lead ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-lg font-semibold text-gray-900 truncate">{lead.name}</h1>
                      <span className="text-xs font-mono text-gray-400">{lead.leadId}</span>
                      {lead.isSLABreached && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">⚠ SLA Breach</span>
                      )}
                      {lead.currentOffer && (
                        <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">🎁 {lead.currentOffer.name}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <button
                        onClick={openStageModal}
                        className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-80 transition-opacity ${STAGE_COLORS[lead.stage] ?? 'bg-gray-100 text-gray-600'}`}
                        title="Click to change stage"
                      >
                        {lead.stage.replace(/_/g, ' ')} ▾
                      </button>
                      {lead.phone && <span className="text-xs text-gray-400">{lead.phone}</span>}
                      {lead.source && <span className="text-xs text-gray-400">· {lead.source}</span>}
                      {lead.projectType && <span className="text-xs text-gray-400">· {lead.projectType}</span>}
                      {lead.assignedDesigner && <span className="text-xs text-gray-400">· {lead.assignedDesigner.name}</span>}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Lead not found</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DIP Checklist — visible during ONBOARDING and HANDED_OVER */}
      {lead && (lead.stage === 'ONBOARDING' || lead.stage === 'HANDED_OVER') && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4">
          <DIPChecklistPanel leadId={leadId!} stage={lead.stage} />
        </div>
      )}

      {/* Tabs — horizontal scroll on mobile */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-0.5 overflow-x-auto scrollbar-hide -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
      </div>

      {/* Tab Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'calls' && <CallLogTab leadId={leadId!} />}
        {activeTab === 'followups' && <FollowUpTab leadId={leadId!} />}
        {activeTab === 'meetings' && <MeetingsTab leadId={leadId!} />}
        {activeTab === 'whatsapp' && <WhatsAppTab leadId={leadId!} />}
        {activeTab === 'quotes' && lead && <QuoteTab leadId={leadId!} leadRef={lead.leadId} />}
        {activeTab === 'discount' && <DiscountTab leadId={leadId!} />}
      </div>
    </div>
  );
}
