import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import CallLogTab from '../components/tabs/CallLogTab';
import FollowUpTab from '../components/tabs/FollowUpTab';
import MeetingsTab from '../components/tabs/MeetingsTab';

type Tab = 'calls' | 'followups' | 'meetings';

export default function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('calls');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'calls', label: 'Call Log' },
    { id: 'followups', label: 'Follow-ups' },
    { id: 'meetings', label: 'Meetings' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Back</Link>
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
                <span className="text-white text-sm font-bold">D</span>
              </div>
              <h1 className="text-lg font-semibold text-gray-900">Lead Detail</h1>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">ID: {leadId}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6">
          <nav className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
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
      <div className="max-w-5xl mx-auto px-6 py-6">
        {activeTab === 'calls' && <CallLogTab leadId={leadId!} />}
        {activeTab === 'followups' && <FollowUpTab leadId={leadId!} />}
        {activeTab === 'meetings' && <MeetingsTab leadId={leadId!} />}
      </div>
    </div>
  );
}
