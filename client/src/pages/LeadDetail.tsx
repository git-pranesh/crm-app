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
  INACTIVE: 'bg-gray-100 text-gray-500',
  ON_HOLD: 'bg-slate-100 text-slate-600',
};

export default function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'calls');
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const tabParam = searchParams.get('tab') as Tab | null;
    if (tabParam) setActiveTab(tabParam);
  }, [searchParams]);

  useEffect(() => {
    if (!leadId) return;
    setLoadingLead(true);
    api.get<{ lead: Lead }>(`/leads/${leadId}`)
      .then((d) => setLead(d.lead))
      .catch(() => toast.error('Could not load lead details'))
      .finally(() => setLoadingLead(false));
  }, [leadId]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
    setMenuOpen(false);
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
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[lead.stage] ?? 'bg-gray-100 text-gray-600'}`}>
                        {lead.stage.replace(/_/g, ' ')}
                      </span>
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
