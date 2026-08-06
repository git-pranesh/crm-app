import { useEffect, useRef, useState } from 'react';
import { Mail, ChevronDown, ChevronUp, Paperclip, X } from 'lucide-react';
import { api, type Meeting, type NextPlanItem } from '../../lib/api';
import NextPlanOfActionPicker from '../NextPlanOfActionPicker';

const MOM_ATTACHMENT_TYPES = ['Floor Plan', 'Proposal', 'Design Draft', 'Contract', 'Other'] as const;

function getApiBase() {
  return (import.meta as any).env?.VITE_API_BASE ?? '/api';
}

const MODES = [
  { value: 'EC_VISIT', label: 'EC Visit' },
  { value: 'SITE_VISIT', label: 'Site Visit' },
  { value: 'VIRTUAL', label: 'Virtual' },
  { value: 'PUBLIC_PLACE', label: 'Public Place' },
  { value: 'CLIENT_PLACE', label: "Client's Place" },
];

/** Earliest allowed datetime-local value: tomorrow at 00:00 (blocks same-day-or-earlier). */
function minRescheduleDateTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
}

const TYPES = [
  { value: 'DQL', label: 'DQL (Initial Meeting)' },
  { value: 'PP', label: 'PP (Proposal Presentation)' },
  { value: 'PD', label: 'PD (Post-Design)' },
  { value: 'ONBOARDING', label: 'OB (Onboarding)' },
  { value: 'OBM', label: 'OBM (Onboarding Meeting)' },
];

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  RESCHEDULED: 'bg-amber-100 text-amber-700',
  NO_SHOW: 'bg-red-100 text-red-700',
};

interface Props {
  leadId: string;
  onMeetingCreated?: () => void;
  onMeetingCompleted?: (meetingType: string) => void;
}

export default function MeetingsTab({ leadId, onMeetingCreated, onMeetingCompleted }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-DQL questionnaire
  const [questionnaire, setQuestionnaire] = useState<{ responses: Record<string, string>; submittedAt: string } | null>(null);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);

  // Schedule form
  const [form, setForm] = useState({ type: '', mode: '', scheduledAt: '', location: '' });

  // Status update modal
  const [statusModal, setStatusModal] = useState<{
    meetingId: string;
    meetingType: string;
    status: 'COMPLETED' | 'RESCHEDULED' | 'NO_SHOW';
  } | null>(null);
  const [statusForm, setStatusForm] = useState({
    mom: '', rescheduledReason: '', newScheduledAt: '', noShowReason: '',
    replanScheduledAt: '', replanLocation: '', momAgenda: '', sendMomMail: false,
  });
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [momAttachmentTypes, setMomAttachmentTypes] = useState<string[]>([]);
  const [momFiles, setMomFiles] = useState<File[]>([]);
  const [uploadingMomAttachment, setUploadingMomAttachment] = useState(false);
  const momFileRef = useRef<HTMLInputElement>(null);
  const [nextPlanItems, setNextPlanItems] = useState<NextPlanItem[]>([]);

  // Same exact-one-file-per-category pairing requirement as CallLogTab —
  // enforced on selection so it's never possible to submit more categories
  // than files (unmatched category) or more files than categories (orphaned
  // upload with no category reference).
  const toggleMomAttachmentType = (type: string) => {
    setMomAttachmentTypes((prev) => {
      if (prev.includes(type)) {
        const next = prev.filter((t) => t !== type);
        setMomFiles((files) => files.slice(0, next.length));
        return next;
      }
      return [...prev, type];
    });
  };

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
      await api.post(`/leads/${leadId}/meetings`, {
        type: form.type,
        mode: form.mode,
        scheduledAt: form.scheduledAt,
        location: form.location || undefined,
      });
      setForm({ type: '', mode: '', scheduledAt: '', location: '' });
      setShowForm(false);
      await loadMeetings();
      onMeetingCreated?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openStatusModal = (meetingId: string, meetingType: string, status: 'COMPLETED' | 'RESCHEDULED' | 'NO_SHOW') => {
    setStatusModal({ meetingId, meetingType, status });
    setStatusForm({
      mom: '', rescheduledReason: '', newScheduledAt: '', noShowReason: '', replanScheduledAt: '', replanLocation: '',
      momAgenda: '', sendMomMail: false,
    });
    setMomAttachmentTypes([]);
    setMomFiles([]);
    setNextPlanItems([]);
    setError(null);
  };

  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModal) return;
    if (statusModal.status === 'COMPLETED' && !statusForm.sendMomMail) {
      setError('You must confirm the MOM email will be sent to the client');
      return;
    }
    if (statusModal.status === 'COMPLETED' && momAttachmentTypes.length !== momFiles.length) {
      setError('Each selected attachment category must have exactly one uploaded file.');
      return;
    }
    setStatusSubmitting(true);
    setError(null);
    try {
      let momAttachments: { type: string; storagePath?: string }[] | undefined;
      if (statusModal.status === 'COMPLETED' && momFiles.length > 0 && momAttachmentTypes.length > 0) {
        setUploadingMomAttachment(true);
        const token = localStorage.getItem('crm_token') ?? '';
        const uploadedPaths: string[] = [];
        for (const file of momFiles) {
          const fd = new FormData();
          fd.append('file', file);
          const uploadResp = await fetch(`${getApiBase()}/leads/${leadId}/calls/upload-attachment`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
          if (!uploadResp.ok) {
            const err = await uploadResp.json().catch(() => ({}));
            throw new Error(err.error ?? 'Attachment upload failed');
          }
          const uploadData = await uploadResp.json();
          uploadedPaths.push(uploadData.storagePath);
        }
        momAttachments = momAttachmentTypes.map((type, i) => ({ type, storagePath: uploadedPaths[i] }));
        setUploadingMomAttachment(false);
      }

      await api.patch(`/meetings/${statusModal.meetingId}/status`, {
        status: statusModal.status,
        mom: statusForm.mom || undefined,
        momAgenda: statusForm.momAgenda || undefined,
        momAttachmentTypes: momAttachmentTypes.length ? momAttachmentTypes : undefined,
        momAttachments,
        sendMomMail: statusModal.status === 'COMPLETED' ? statusForm.sendMomMail : undefined,
        nextPlanOfAction: nextPlanItems.length ? nextPlanItems : undefined,
        rescheduledReason: statusForm.rescheduledReason || undefined,
        noShowReason: statusForm.noShowReason || undefined,
        newScheduledAt: statusForm.newScheduledAt
          ? new Date(statusForm.newScheduledAt).toISOString()
          : undefined,
        replanScheduledAt: statusForm.replanScheduledAt
          ? new Date(statusForm.replanScheduledAt).toISOString()
          : undefined,
        replanLocation: statusForm.replanLocation || undefined,
      });
      const completedType = statusModal.status === 'COMPLETED' ? statusModal.meetingType : null;
      setStatusModal(null);
      await loadMeetings();
      onMeetingCreated?.(); // reload lead data in parent
      if (completedType) onMeetingCompleted?.(completedType);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStatusSubmitting(false);
      setUploadingMomAttachment(false);
    }
  };

  /** Derive a display label like "DQL 1", "PP 2", "OB 1" using seqNumber */
  const meetingLabel = (m: Meeting) => {
    const seq = m.seqNumber ?? 1;
    const typeMap: Record<string, string> = { DQL: 'DQL', PP: 'PP', ONBOARDING: 'OB' };
    const abbrev = typeMap[m.type] ?? m.type;
    // Only append number if there are multiple of the same type
    const showNum = meetings.filter((x) => x.type === m.type).length > 1;
    return showNum ? `${abbrev} ${seq}` : abbrev === 'DQL' ? 'DQL Meeting' : abbrev === 'OB' ? 'Onboarding Meeting' : abbrev;
  };

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
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
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
          <div className="grid grid-cols-2 gap-4">
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Office, Client's site…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
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
              {statusModal.status === 'COMPLETED' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Agenda <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={statusForm.momAgenda}
                      onChange={(e) => setStatusForm({ ...statusForm, momAgenda: e.target.value })}
                      required
                      placeholder="What this meeting covered…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {MOM_ATTACHMENT_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => toggleMomAttachmentType(type)}
                          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                            momAttachmentTypes.includes(type)
                              ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium'
                              : 'border-gray-200 text-gray-500 hover:border-brand-300'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    {momAttachmentTypes.length > 0 && (
                      <div className="space-y-1.5">
                        <label className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed w-fit transition-colors ${
                          momFiles.length >= momAttachmentTypes.length
                            ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                            : 'border-gray-300 text-gray-600 cursor-pointer hover:border-brand-400'
                        }`}>
                          <Paperclip size={11} strokeWidth={2} />
                          Upload file ({momFiles.length}/{momAttachmentTypes.length})
                          <input
                            ref={momFileRef}
                            type="file"
                            multiple
                            disabled={momFiles.length >= momAttachmentTypes.length}
                            className="hidden"
                            onChange={(e) => {
                              const remaining = momAttachmentTypes.length - momFiles.length;
                              const picked = Array.from(e.target.files ?? []).slice(0, Math.max(remaining, 0));
                              setMomFiles((prev) => [...prev, ...picked]);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {momFiles.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {momFiles.map((f, i) => (
                              <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                {momAttachmentTypes[i]}: {f.name}
                                <button type="button" onClick={() => setMomFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-400">
                                  <X size={10} strokeWidth={2} />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {momFiles.length < momAttachmentTypes.length && (
                          <p className="text-[11px] text-amber-600">
                            Upload {momAttachmentTypes.length - momFiles.length} more file(s) to match the selected categories, or remove a category.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={statusForm.sendMomMail}
                      onChange={(e) => setStatusForm({ ...statusForm, sendMomMail: e.target.checked })}
                      required
                    />
                    I confirm the MOM will be emailed to the client <span className="text-red-500">*</span>
                  </label>
                  <div className="border-t border-gray-100 pt-3">
                    <NextPlanOfActionPicker items={nextPlanItems} onChange={setNextPlanItems} />
                  </div>
                </>
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
                      min={minRescheduleDateTime()}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">The meeting stays active and moves to this new time. Client will be notified.</p>
                  </div>
                </>
              )}
              {statusModal.status === 'NO_SHOW' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reason for no-show <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      rows={2}
                      value={statusForm.noShowReason}
                      onChange={(e) => setStatusForm({ ...statusForm, noShowReason: e.target.value })}
                      required
                      placeholder="e.g. Client forgot, unavailable at last minute…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">A follow-up email will be sent to the client automatically.</p>
                  </div>
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Next tentative replan</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Date & Time <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="datetime-local"
                          value={statusForm.replanScheduledAt}
                          onChange={(e) => setStatusForm({ ...statusForm, replanScheduledAt: e.target.value })}
                          required
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Location <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={statusForm.replanLocation}
                          onChange={(e) => setStatusForm({ ...statusForm, replanLocation: e.target.value })}
                          required
                          placeholder="e.g. Office, Client's site…"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Required so this no-show doesn't fall through the cracks — you can formally reschedule later.</p>
                  </div>
                </>
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
                  disabled={statusSubmitting || uploadingMomAttachment}
                  className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {uploadingMomAttachment ? 'Uploading…' : statusSubmitting ? 'Saving…' : 'Confirm'}
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
                      onClick={() => openStatusModal(meeting.id, meeting.type, 'COMPLETED')}
                      className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      Complete
                    </button>
                    <button
                      onClick={() => openStatusModal(meeting.id, meeting.type, 'RESCHEDULED')}
                      className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors"
                    >
                      Reschedule
                    </button>
                    <button
                      onClick={() => openStatusModal(meeting.id, meeting.type, 'NO_SHOW')}
                      className="text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      No-show
                    </button>
                  </div>
                )}
              </div>

              {/* Reschedule history — oldest first */}
              {meeting.rescheduleHistory && meeting.rescheduleHistory.length > 0 && (
                <div className="mt-2 space-y-1">
                  {meeting.rescheduleHistory.map((h, i) => (
                    <div key={i} className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
                      <span className="font-medium">Reschedule {i + 1}:</span>{' '}
                      was {new Date(h.scheduledAt).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })} — {h.reason}
                    </div>
                  ))}
                </div>
              )}
              {/* Current reschedule reason (latest) */}
              {!meeting.rescheduleHistory?.length && meeting.rescheduledReason && (
                <p className="text-xs text-amber-600 mt-2 bg-amber-50 rounded-lg px-3 py-1.5">
                  Rescheduled: {meeting.rescheduledReason}
                </p>
              )}
              {meeting.noShowReason && (
                <p className="text-xs text-red-600 mt-2 bg-red-50 rounded-lg px-3 py-1.5">
                  No-show reason: {meeting.noShowReason}
                </p>
              )}
              {meeting.location && (
                <p className="text-xs text-gray-400 mt-1">📍 {meeting.location}</p>
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

            </div>
          ))}
        </div>
      )}
    </div>
  );
}
