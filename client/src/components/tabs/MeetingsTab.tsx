import { useEffect, useState } from 'react';
import { Mail, ChevronDown, ChevronUp } from 'lucide-react';
import { api, type Meeting } from '../../lib/api';

const MODES = [
  { value: 'EC_VISIT', label: 'EC Visit' },
  { value: 'SITE_VISIT', label: 'Site Visit' },
  { value: 'VIRTUAL', label: 'Virtual' },
  { value: 'PUBLIC_PLACE', label: 'Public Place' },
];

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  RESCHEDULED: 'bg-amber-100 text-amber-700',
  NO_SHOW: 'bg-red-100 text-red-700',
};

interface Props { leadId: string; onMeetingCreated?: () => void }

export default function MeetingsTab({ leadId, onMeetingCreated }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-DQL questionnaire
  const [questionnaire, setQuestionnaire] = useState<{ responses: Record<string, string>; submittedAt: string } | null>(null);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);

  // Schedule form
  const [form, setForm] = useState({ type: '', mode: '', scheduledAt: '' });

  // Status update modal
  const [statusModal, setStatusModal] = useState<{
    meetingId: string;
    status: 'COMPLETED' | 'RESCHEDULED' | 'NO_SHOW';
  } | null>(null);
  const [statusForm, setStatusForm] = useState({ mom: '', rescheduledReason: '', newScheduledAt: '' });
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  const loadMeetings = async () => {
    try {
      const data = await api.get<{ meetings: Meeting[] }>(`/leads/${leadId}/meetings`);
      setMeetings(data.meetings);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMeetings(); }, [leadId]);

  useEffect(() => {
    api.get<{ questionnaire: { responses: Record<string, string>; submittedAt: string } | null }>(`/leads/${leadId}/questionnaire`)
      .then((d) => setQuestionnaire(d.questionnaire))
      .catch(() => {});
  }, [leadId]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.type || !form.mode || !form.scheduledAt) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/leads/${leadId}/meetings`, form);
      setForm({ type: '', mode: '', scheduledAt: '' });
      setShowForm(false);
      await loadMeetings();
      onMeetingCreated?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openStatusModal = (meetingId: string, status: 'COMPLETED' | 'RESCHEDULED' | 'NO_SHOW') => {
    setStatusModal({ meetingId, status });
    setStatusForm({ mom: '', rescheduledReason: '', newScheduledAt: '' });
    setError(null);
  };

  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModal) return;
    setStatusSubmitting(true);
    setError(null);
    try {
      await api.patch(`/meetings/${statusModal.meetingId}/status`, {
        status: statusModal.status,
        mom: statusForm.mom || undefined,
        rescheduledReason: statusForm.rescheduledReason || undefined,
        newScheduledAt: statusForm.newScheduledAt
          ? new Date(statusForm.newScheduledAt).toISOString()
          : undefined,
      });
      setStatusModal(null);
      await loadMeetings();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStatusSubmitting(false);
    }
  };

  const meetingLabel = (m: Meeting) =>
    m.type === 'PP' && m.ppNumber ? `PP${m.ppNumber}` : m.type === 'DQL' ? 'DQL Meeting' : m.type;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Meetings</h2>
          <p className="text-sm text-gray-500">{meetings.length} scheduled</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          {showForm ? 'Cancel' : '+ Schedule Meeting'}
        </button>
      </div>

      {/* Schedule Form */}
      {showForm && (
        <form onSubmit={handleSchedule} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-medium text-gray-900">Schedule a Meeting</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <span className="text-red-500">*</span>
              </label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="">Select type…</option>
                <option value="DQL">DQL (Initial Meeting)</option>
                <option value="PP">PP (Proposal Presentation)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mode <span className="text-red-500">*</span>
              </label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="">Select mode…</option>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date & Time <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <Mail size={12} strokeWidth={1.8} /> Confirmation email + SMS will be sent to client automatically.
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Scheduling…' : 'Schedule Meeting'}
          </button>
        </form>
      )}

      {/* Status Update Modal */}
      {statusModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 mb-4">
              Mark as {statusModal.status.charAt(0) + statusModal.status.slice(1).toLowerCase()}
            </h3>
            <form onSubmit={handleStatusUpdate} className="space-y-4">
              {statusModal.status === 'COMPLETED' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minutes of Meeting (MOM) <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={statusForm.mom}
                    onChange={(e) => setStatusForm({ ...statusForm, mom: e.target.value })}
                    required
                    placeholder="Summary of what was discussed, decisions made, next steps…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">MOM will be emailed to the client automatically.</p>
                </div>
              )}
              {statusModal.status === 'RESCHEDULED' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reason for Rescheduling <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={statusForm.rescheduledReason}
                      onChange={(e) => setStatusForm({ ...statusForm, rescheduledReason: e.target.value })}
                      required
                      placeholder="e.g. Client unavailable, site not ready…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New Date & Time <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={statusForm.newScheduledAt}
                      onChange={(e) => setStatusForm({ ...statusForm, newScheduledAt: e.target.value })}
                      required
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">The meeting stays active and moves to this new time. Client will be notified.</p>
                  </div>
                </>
              )}
              {statusModal.status === 'NO_SHOW' && (
                <p className="text-sm text-gray-500">
                  An email asking the client to reschedule will be sent automatically.
                </p>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStatusModal(null)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={statusSubmitting}
                  className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {statusSubmitting ? 'Saving…' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Meeting List */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm animate-pulse">Loading meetings…</div>
      ) : meetings.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No meetings scheduled yet</div>
      ) : (
        <div className="space-y-3">
          {meetings.map((meeting) => (
            <div key={meeting.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 text-sm">{meetingLabel(meeting)}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[meeting.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {meeting.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {new Date(meeting.scheduledAt).toLocaleString('en-IN', {
                      weekday: 'short', day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {MODES.find(m => m.value === meeting.mode)?.label ?? meeting.mode}
                  </p>
                </div>

                {meeting.status === 'SCHEDULED' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openStatusModal(meeting.id, 'COMPLETED')}
                      className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      Complete
                    </button>
                    <button
                      onClick={() => openStatusModal(meeting.id, 'RESCHEDULED')}
                      className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors"
                    >
                      Reschedule
                    </button>
                    <button
                      onClick={() => openStatusModal(meeting.id, 'NO_SHOW')}
                      className="text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      No-show
                    </button>
                  </div>
                )}
              </div>

              {meeting.rescheduledReason && (
                <p className="text-xs text-amber-600 mt-2 bg-amber-50 rounded-lg px-3 py-1.5">
                  Rescheduled: {meeting.rescheduledReason}
                </p>
              )}
              {meeting.mom && (
                <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-xs font-medium text-gray-500 mb-0.5">MOM</p>
                  <p className="text-xs text-gray-700">{meeting.mom}</p>
                </div>
              )}

              {/* Pre-DQL questionnaire view */}
              {meeting.type === 'DQL' && questionnaire && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowQuestionnaire(!showQuestionnaire)}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium hover:underline"
                  >
                    <span className="flex items-center gap-1">
                      {showQuestionnaire ? <ChevronUp size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />}
                      {showQuestionnaire ? 'Hide' : 'View'} Pre-meeting Questionnaire
                    </span>
                  </button>
                  {showQuestionnaire && (
                    <div className="mt-2 bg-fuchsia-50 border border-fuchsia-100 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-fuchsia-600 font-medium mb-1">
                        Submitted: {new Date(questionnaire.submittedAt).toLocaleDateString('en-IN')}
                      </p>
                      {Object.entries(questionnaire.responses).map(([q, a]) => (
                        <div key={q}>
                          <p className="text-xs font-medium text-gray-600">{q}</p>
                          <p className="text-xs text-gray-800">{a}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {meeting.type === 'DQL' && !questionnaire && (
                <p className="text-xs text-gray-400 mt-2 italic">No pre-meeting questionnaire submitted yet</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
