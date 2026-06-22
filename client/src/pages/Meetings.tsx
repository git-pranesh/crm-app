import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

interface Lead {
  id: string; leadId: string; name: string; phone?: string;
  assignedDesigner?: { id: string; name: string } | null;
}

interface Meeting {
  id: string; type: string; mode: string; status: string;
  scheduledAt: string; ppNumber?: number | null;
  mom?: string | null; outcome?: string | null;
  rescheduledReason?: string | null; momSent?: boolean;
  lead: Lead;
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  NO_SHOW: 'bg-red-100 text-red-700',
  RESCHEDULED: 'bg-amber-100 text-amber-700',
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled', COMPLETED: 'Completed',
  NO_SHOW: 'No-show', RESCHEDULED: 'Rescheduled',
};

const MODE_LABELS: Record<string, string> = {
  EC_VISIT: 'EC Visit', SITE_VISIT: 'Site Visit',
  VIRTUAL: 'Virtual', PUBLIC_PLACE: 'Public Place',
};

const TYPE_AGENDAS: Record<string, string> = {
  DQL: 'Initial design consultation',
  PP: 'Proposal presentation',
};

function meetingTypeLabel(m: Meeting) {
  if (m.type === 'PP' && m.ppNumber) return `PP${m.ppNumber}`;
  return m.type;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

function KpiCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function Meetings() {
  const now = new Date();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const [completeModal, setCompleteModal] = useState<Meeting | null>(null);
  const [noShowModal, setNoShowModal] = useState<Meeting | null>(null);
  const [mom, setMom] = useState('');
  const [outcome, setOutcome] = useState('');
  const [noShowReason, setNoShowReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ meetings: Meeting[] }>('/meetings');
      setMeetings(d.meetings);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upcoming = meetings.filter(m => m.status === 'SCHEDULED' && new Date(m.scheduledAt) >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const past = meetings.filter(m => m.status !== 'SCHEDULED' || new Date(m.scheduledAt) < now)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const kpi = {
    upcoming: meetings.filter(m => m.status === 'SCHEDULED' && new Date(m.scheduledAt) >= now).length,
    completed: meetings.filter(m => m.status === 'COMPLETED').length,
    noShow: meetings.filter(m => m.status === 'NO_SHOW').length,
    total: meetings.length,
  };

  const openComplete = (m: Meeting) => { setMom(''); setOutcome(''); setCompleteModal(m); };
  const openNoShow = (m: Meeting) => { setNoShowReason(''); setNoShowModal(m); };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mom.trim()) { toast.error('MOM is required'); return; }
    if (!outcome.trim()) { toast.error('Outcome is required'); return; }
    if (!completeModal) return;
    setSubmitting(true);
    try {
      await api.patch(`/meetings/${completeModal.id}/status`, { status: 'COMPLETED', mom, outcome });
      toast.success('Meeting marked complete');
      setCompleteModal(null);
      await load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const handleNoShow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noShowReason.trim()) { toast.error('Reason is required'); return; }
    if (!noShowModal) return;
    setSubmitting(true);
    try {
      await api.patch(`/meetings/${noShowModal.id}/status`, { status: 'NO_SHOW', rescheduledReason: noShowReason });
      toast.success('Meeting marked no-show');
      setNoShowModal(null);
      await load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const displayed = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Complete modal */}
      {completeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 mb-1">Mark Meeting Complete</h3>
            <p className="text-xs text-gray-400 mb-4">{completeModal.lead.name} · {meetingTypeLabel(completeModal)} · {fmtDateTime(completeModal.scheduledAt).date}</p>
            <form onSubmit={handleComplete} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minutes of Meeting (MOM) <span className="text-red-500">*</span>
                </label>
                <textarea rows={4} value={mom} onChange={e => setMom(e.target.value)} required
                  placeholder="Summarise what was discussed, decisions made, client feedback..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Outcome <span className="text-red-500">*</span>
                </label>
                <textarea rows={2} value={outcome} onChange={e => setOutcome(e.target.value)} required
                  placeholder="e.g. Client approved 2BHK concept, ready for proposal..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none" />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setCompleteModal(null)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50">
                  {submitting ? 'Saving…' : 'Mark Complete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* No-show modal */}
      {noShowModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-1">Mark as No-show</h3>
            <p className="text-xs text-gray-400 mb-4">{noShowModal.lead.name} · {meetingTypeLabel(noShowModal)}</p>
            <form onSubmit={handleNoShow} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea rows={3} value={noShowReason} onChange={e => setNoShowReason(e.target.value)} required
                  placeholder="e.g. Client did not pick up calls, WhatsApp unread..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none" />
                <p className="text-xs text-gray-400 mt-1">Required — you must provide a reason to mark a meeting as no-show.</p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setNoShowModal(null)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                  {submitting ? 'Saving…' : 'Mark No-show'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Meetings</h1>
        <p className="text-xs text-gray-400 mt-0.5">All meetings in your scope</p>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* KPI bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Upcoming" value={kpi.upcoming} sub="Scheduled ahead" color="text-blue-600" />
          <KpiCard label="Completed" value={kpi.completed} sub="Successfully done" color="text-green-600" />
          <KpiCard label="No-show" value={kpi.noShow} sub="Client absent" color="text-red-500" />
          <KpiCard label="Total" value={kpi.total} sub="All in scope" />
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-100">
            {([['upcoming', `Upcoming (${upcoming.length})`], ['past', `Past (${past.length})`]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Loading meetings…</div>
          ) : displayed.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-3xl mb-2">📅</p>
              <p className="text-gray-500 text-sm">No {tab} meetings</p>
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayed.map(m => {
                const { date, time } = fmtDateTime(m.scheduledAt);
                const typeLabel = meetingTypeLabel(m);
                return (
                  <div key={m.id} className="border border-gray-200 rounded-xl p-4 flex flex-col gap-2 hover:border-gray-300 transition-colors">
                    {/* Row 1: name + status */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm leading-tight">{m.lead.name}</p>
                        <span className="text-xs text-brand-500 font-mono">{m.lead.leadId}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[m.status] ?? m.status}
                      </span>
                    </div>

                    {/* Row 2: type + mode chips */}
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">{typeLabel}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{MODE_LABELS[m.mode] ?? m.mode}</span>
                    </div>

                    {/* Row 3: date + time */}
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span>📅</span>
                      <span>{date}</span>
                      <span className="text-gray-300">·</span>
                      <span>{time}</span>
                    </div>

                    {/* Row 4: agenda */}
                    <p className="text-xs text-gray-400 italic">{TYPE_AGENDAS[m.type] ?? m.type}</p>

                    {/* Bottom: assignee + action */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-50 mt-auto">
                      <div className="flex items-center gap-1.5">
                        {m.lead.assignedDesigner ? (
                          <>
                            <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">
                              {m.lead.assignedDesigner.name.charAt(0)}
                            </span>
                            <span className="text-xs text-gray-500 truncate max-w-[90px]">{m.lead.assignedDesigner.name}</span>
                          </>
                        ) : <span className="text-xs text-gray-300">Unassigned</span>}
                      </div>

                      {m.status === 'SCHEDULED' && (
                        <div className="flex gap-1.5">
                          <button onClick={() => openNoShow(m)}
                            className="text-xs border border-gray-200 text-gray-600 px-2.5 py-1 rounded-lg hover:bg-gray-50 transition-colors">
                            No-show
                          </button>
                          <button onClick={() => openComplete(m)}
                            className="text-xs bg-brand-500 text-white px-2.5 py-1 rounded-lg hover:bg-brand-600 transition-colors font-medium">
                            Complete
                          </button>
                        </div>
                      )}
                      {m.status === 'COMPLETED' && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">MOM sent</span>
                      )}
                      {m.status === 'RESCHEDULED' && (
                        <div className="text-right">
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Rescheduled</span>
                          {m.rescheduledReason && (
                            <p className="text-xs text-gray-400 mt-0.5 max-w-[120px] truncate" title={m.rescheduledReason}>{m.rescheduledReason}</p>
                          )}
                        </div>
                      )}
                      {m.status === 'NO_SHOW' && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">No-show</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
