import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface InboxRow {
  leadId: string;
  leadNumber: string;
  leadName: string;
  unreadCount: number;
  latestMessage: {
    direction: 'INBOUND' | 'OUTBOUND';
    body: string;
    createdAt: string;
  } | null;
}

export default function Inbox() {
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ inbox: InboxRow[]; totalUnread: number }>('/whatsapp/inbox')
      .then((d) => { setInbox(d.inbox); setTotalUnread(d.totalUnread); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Back</Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                WhatsApp Inbox
                {totalUnread > 0 && (
                  <span className="bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {totalUnread}
                  </span>
                )}
              </h1>
              <p className="text-xs text-gray-400">{inbox.length} conversations</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm animate-pulse">Loading inbox…</div>
        ) : error ? (
          <div className="text-center py-16 text-red-400 text-sm">{error}</div>
        ) : inbox.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-gray-500 text-sm">No WhatsApp conversations yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {inbox.map((row) => (
              <button
                key={row.leadId}
                onClick={() => navigate(`/leads/${row.leadId}?tab=whatsapp`)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                  <span className="text-brand-600 font-semibold text-sm">
                    {row.leadName.charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="font-medium text-gray-900 text-sm truncate">{row.leadName}</p>
                    <span className="text-xs text-gray-400 shrink-0">
                      {row.latestMessage
                        ? new Date(row.latestMessage.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short',
                          })
                        : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-gray-500 truncate">
                      {row.latestMessage?.direction === 'OUTBOUND' && (
                        <span className="text-blue-400 mr-1">You:</span>
                      )}
                      {row.latestMessage?.body ?? 'No messages yet'}
                    </p>
                    {row.unreadCount > 0 && (
                      <span className="bg-green-500 text-white text-xs font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full px-1.5 shrink-0">
                        {row.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{row.leadNumber}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
