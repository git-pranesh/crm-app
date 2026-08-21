import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Paperclip, X } from 'lucide-react';
import { api, type CallRecord, type NextPlanItem } from '../../lib/api';
import NextPlanOfActionPicker from '../NextPlanOfActionPicker';
import { formatISTDate, formatISTDateTime, istInputToISO } from '../../lib/dateFormat';

const ATTACHMENT_TYPES = ['Lifestyle Capture', 'Proposal', 'Pitch Presentation'] as const;

const MEETING_TYPES = [
  { value: 'DQL', label: 'DQL' },
  { value: 'PP', label: 'PP' },
  { value: 'PD', label: 'PD' },
  { value: 'ONBOARDING', label: 'OB' },
  { value: 'OBM', label: 'OBM' },
];
const MEETING_MODES = [
  { value: 'EC_VISIT', label: 'EC Visit' },
  { value: 'SITE_VISIT', label: 'Site Visit' },
  { value: 'VIRTUAL', label: 'Virtual' },
  { value: 'PUBLIC_PLACE', label: 'Public Place' },
  { value: 'CLIENT_PLACE', label: "Client's Place" },
];
// Task #115 — Meeting Location is a fixed dropdown, not free text.
// Label text kept identical to MEETING_MODES above ("Public Place") so the
// same enum value doesn't read differently depending on which dropdown it's
// picked from.
const MEETING_LOCATION_OPTIONS = [
  { value: 'EC_VISIT', label: 'EC Visit' },
  { value: 'SITE_VISIT', label: 'Site Visit' },
  { value: 'VIRTUAL', label: 'Virtual' },
  { value: 'PUBLIC_PLACE', label: 'Public Place' },
];

function getApiBase() {
  return (import.meta as any).env?.VITE_API_BASE ?? '/api';
}

const OUTCOMES = [
  { value: 'ANSWERED', label: 'Answered' },
  { value: 'RNR_1', label: 'RNR 1' },
  { value: 'RNR_2', label: 'RNR 2' },
  { value: 'RNR_3', label: 'RNR 3' },
  { value: 'RNR_4', label: 'RNR 4' },
  { value: 'RNR_5', label: 'RNR 5' },
  { value: 'RNR_6_PLUS', label: 'RNR 6 & beyond' },
  { value: 'CALLBACK', label: 'Callback Scheduled' },
  { value: 'MEETING_SCHEDULED', label: 'Meeting Scheduled' },
];

function formatDuration(secs?: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

const OUTCOME_COLORS: Record<string, string> = {
  ANSWERED: 'bg-green-100 text-green-700',
  RNR_1: 'bg-amber-100 text-amber-700',
  RNR_2: 'bg-amber-100 text-amber-700',
  RNR_3: 'bg-orange-100 text-orange-700',
  RNR_4: 'bg-orange-100 text-orange-700',
  RNR_5: 'bg-red-100 text-red-700',
  RNR_6_PLUS: 'bg-red-100 text-red-700',
  CALLBACK: 'bg-blue-100 text-blue-700',
  MEETING_SCHEDULED: 'bg-purple-100 text-purple-700',
};

interface CardProps { call: CallRecord; onRecordingRefresh: (url: string) => void }

function CallCard({ call, onRecordingRefresh }: CardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState(call.recordingUrl ?? null);
  const isManual = !recordingUrl;

  const handleRefreshRecording = async () => {
    setRefreshing(true);
    try {
      const data = await api.get<{ recordingUrl: string | null }>(`/calls/${call.id}/recording-url`);
      if (data.recordingUrl) {
        setRecordingUrl(data.recordingUrl);
        onRecordingRefresh(data.recordingUrl);
      }
    } catch (e) {
      console.warn('Recording refresh failed:', e);
    } finally {
      setRefreshing(false);
    }
  };

  const callDateStr = call.calledAt
    ? formatISTDateTime(call.calledAt)
    : formatISTDate(call.createdAt);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${OUTCOME_COLORS[call.outcome] ?? 'bg-gray-100 text-gray-600'}`}>
            {call.outcome.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-gray-400">{formatDuration(call.duration)}</span>
          {call.location && <span className="text-xs text-gray-400">📍 {call.location}</span>}
          {isManual && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Manual</span>
          )}
        </div>
        <div className="text-right text-xs text-gray-400 shrink-0">
          <p>{call.loggedBy.name}</p>
          <p>{callDateStr}</p>
        </div>
      </div>

      {call.notes && (
        <p className="text-sm text-gray-600 mt-2">{call.notes}</p>
      )}
      {call.nextPlanOfAction && (
        <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5">
          <span className="text-xs font-medium text-blue-600">Next Plan: </span>
          <span className="text-xs text-blue-700">{call.nextPlanOfAction}</span>
        </div>
      )}

      {/* Attachments */}
      {call.attachments && call.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {call.attachments.map((att, i) => (
            <a
              key={i}
              href={att.fileUrl ?? '#'}
              target={att.fileUrl ? '_blank' : '_self'}
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full hover:bg-gray-200 transition-colors"
            >
              <Paperclip size={9} strokeWidth={2} /> {att.type}
            </a>
          ))}
        </div>
      )}

      {/* Recording player */}
      {recordingUrl ? (
        <div className="mt-3">
          <audio controls src={recordingUrl} className="w-full h-9" preload="none" />
        </div>
      ) : (
        <div className="mt-2">
          <button
            onClick={handleRefreshRecording}
            disabled={refreshing}
            className="text-xs text-brand-600 hover:text-brand-700 hover:underline disabled:opacity-50"
          >
            <span className="flex items-center gap-1">
              <RefreshCw size={11} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Checking…' : 'Fetch recording'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

interface Props { leadId: string }

export default function CallLogTab({ leadId }: Props) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [rnrCount, setRnrCount] = useState(0);
  const [needsEscalation, setNeedsEscalation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    outcome: '',
    duration: '',
    calledAt: '',
    location: '',
    notes: '',
    dueDate: '',
    dueTime: '',
    // Callback sub-form
    callbackDueDate: '',
    callbackDueTime: '',
    callbackAgenda: '',
    // Meeting-scheduled sub-form
    meetingType: '',
    meetingMode: '',
    meetingScheduledAt: '',
    meetingLocation: '',
  });
  const [nextPlanItems, setNextPlanItems] = useState<NextPlanItem[]>([]);
  const [selectedAttachmentTypes, setSelectedAttachmentTypes] = useState<string[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachmentFileRef = useRef<HTMLInputElement>(null);
  // Task #115 — the mandatory follow-up task sub-form also supports multiple attachments.
  const [taskAttachmentFiles, setTaskAttachmentFiles] = useState<File[]>([]);
  const taskAttachmentFileRef = useRef<HTMLInputElement>(null);

  const loadCalls = async () => {
    try {
      const data = await api.get<{ calls: CallRecord[]; rnrCount: number; needsEscalation: boolean }>(
        `/leads/${leadId}/calls`,
      );
      setCalls(data.calls);
      setRnrCount(data.rnrCount);
      setNeedsEscalation(data.needsEscalation);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCalls(); }, [leadId]);

  // Task #115 — attachments support multiple files per category. Each click
  // on a category button adds a new attachment slot (categories can repeat);
  // slots and uploaded files are paired by position, in the order added.
  const addAttachmentType = (type: string) => {
    setSelectedAttachmentTypes((prev) => [...prev, type]);
  };
  const removeAttachmentSlot = (index: number) => {
    setSelectedAttachmentTypes((prev) => prev.filter((_, i) => i !== index));
    setAttachmentFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setForm({
      outcome: '', duration: '', calledAt: '', location: '', notes: '', dueDate: '', dueTime: '',
      callbackDueDate: '', callbackDueTime: '', callbackAgenda: '',
      meetingType: '', meetingMode: '', meetingScheduledAt: '', meetingLocation: '',
    });
    setNextPlanItems([]);
    setSelectedAttachmentTypes([]);
    setAttachmentFiles([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.outcome || !form.notes.trim()) return;
    if (form.outcome === 'CALLBACK' && (!form.callbackDueDate || !form.callbackDueTime)) return;
    if (form.outcome === 'MEETING_SCHEDULED' && (!form.meetingType || !form.meetingMode || !form.meetingScheduledAt)) return;
    if (!['CALLBACK', 'MEETING_SCHEDULED'].includes(form.outcome) && (!form.dueDate || !form.dueTime)) return;
    if (selectedAttachmentTypes.length !== attachmentFiles.length) {
      setError('Each selected attachment category must have exactly one uploaded file.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // Upload attachment files first if provided (returns storagePath for DB + signedUrl for display)
      const uploadedPaths: string[] = [];
      if (attachmentFiles.length > 0 && selectedAttachmentTypes.length > 0) {
        setUploadingAttachment(true);
        const token = localStorage.getItem('crm_token') ?? '';
        for (const file of attachmentFiles) {
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
        setUploadingAttachment(false);
      }

      // Pair each selected attachment type with an uploaded file (in order)
      const attachments = selectedAttachmentTypes.length > 0
        ? selectedAttachmentTypes.map((type, i) => ({ type, storagePath: uploadedPaths[i] }))
        : undefined;

      // Task #115 — upload the follow-up task's own attachments (no fixed category list).
      let taskAttachments: { type: string; storagePath: string }[] | undefined;
      if (!['CALLBACK', 'MEETING_SCHEDULED'].includes(form.outcome) && taskAttachmentFiles.length > 0) {
        setUploadingAttachment(true);
        const token = localStorage.getItem('crm_token') ?? '';
        taskAttachments = [];
        for (const file of taskAttachmentFiles) {
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
          taskAttachments.push({ type: 'ATTACHMENT', storagePath: uploadData.storagePath });
        }
        setUploadingAttachment(false);
      }

      await api.post(`/leads/${leadId}/calls`, {
        outcome: form.outcome,
        duration: form.duration ? Number(form.duration) * 60 : undefined,
        notes: form.notes.trim(),
        calledAt: form.calledAt ? istInputToISO(form.calledAt) : undefined,
        location: form.location.trim() || undefined,
        attachments,
        followUpTask: !['CALLBACK', 'MEETING_SCHEDULED'].includes(form.outcome)
          ? { dueDate: form.dueDate, dueTime: form.dueTime, attachments: taskAttachments }
          : undefined,
        callbackDetails: form.outcome === 'CALLBACK'
          ? { dueDate: form.callbackDueDate, dueTime: form.callbackDueTime, agenda: form.callbackAgenda.trim() || undefined }
          : undefined,
        meetingDetails: form.outcome === 'MEETING_SCHEDULED'
          ? { type: form.meetingType, mode: form.meetingMode, scheduledAt: istInputToISO(form.meetingScheduledAt), location: form.meetingLocation.trim() || undefined }
          : undefined,
        nextPlanOfAction: nextPlanItems.length ? nextPlanItems : undefined,
      });
      resetForm();
      setTaskAttachmentFiles([]);
      setShowForm(false);
      await loadCalls();
    } catch (e: any) {
      setError(e.message);
      setUploadingAttachment(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Escalation banner */}
      {needsEscalation && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
          <AlertTriangle size={18} strokeWidth={2} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700">Escalation Required</p>
            <p className="text-sm text-red-600 mt-0.5">
              This lead has {rnrCount} RNR attempts. Please escalate to your Business Lead for review.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Call Log</h2>
          <p className="text-sm text-gray-500">{calls.length} call{calls.length !== 1 ? 's' : ''} · {rnrCount} RNR</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          {showForm ? 'Cancel' : '+ Log Call'}
        </button>
      </div>

      {/* Log Call Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-medium text-gray-900">Log a Call</h3>

          {/* Row 1: Outcome + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Outcome <span className="text-red-500">*</span>
              </label>
              <select
                value={form.outcome}
                onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="">Select outcome…</option>
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
              <input
                type="number"
                min="0"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="0"
              />
            </div>
          </div>

          {/* Row 2: Date + Time of call */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time of Call</label>
              <input
                type="datetime-local"
                value={form.calledAt}
                onChange={(e) => setForm({ ...form, calledAt: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Office, Virtual…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>

          {/* Attachments — now occupies the slot the free-text Agenda field used to.
              Task #115: multiple attachments are allowed, including repeats of the
              same category — clicking a category adds another slot rather than
              toggling a single one. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {ATTACHMENT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addAttachmentType(type)}
                  className="text-xs px-3 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-brand-300 hover:text-brand-700"
                >
                  + {type}
                </button>
              ))}
            </div>
            {selectedAttachmentTypes.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {selectedAttachmentTypes.map((type, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-brand-50 border border-brand-200 text-brand-700 px-2 py-0.5 rounded-full">
                      {type}{attachmentFiles[i] ? `: ${attachmentFiles[i].name}` : ' (no file yet)'}
                      <button type="button" onClick={() => removeAttachmentSlot(i)} className="text-brand-400 hover:text-red-400">
                        <X size={10} strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                </div>
                <label className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed w-fit transition-colors ${
                  attachmentFiles.length >= selectedAttachmentTypes.length
                    ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                    : 'border-gray-300 text-gray-600 cursor-pointer hover:border-brand-400'
                }`}>
                  <Paperclip size={11} strokeWidth={2} />
                  Upload file ({attachmentFiles.length}/{selectedAttachmentTypes.length})
                  <input
                    ref={attachmentFileRef}
                    type="file"
                    multiple
                    disabled={attachmentFiles.length >= selectedAttachmentTypes.length}
                    className="hidden"
                    onChange={(e) => {
                      const remaining = selectedAttachmentTypes.length - attachmentFiles.length;
                      const picked = Array.from(e.target.files ?? []).slice(0, Math.max(remaining, 0));
                      setAttachmentFiles((prev) => [...prev, ...picked]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {attachmentFiles.length < selectedAttachmentTypes.length && (
                  <p className="text-[11px] text-amber-600">
                    Upload {selectedAttachmentTypes.length - attachmentFiles.length} more file(s) to match the added attachment slots, or remove a slot.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="What was discussed on the call…"
            />
          </div>

          {/* Outcome-specific sub-forms */}
          {form.outcome === 'CALLBACK' && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                Callback Details <span className="text-red-500">*</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={form.callbackDueDate}
                  onChange={(e) => setForm({ ...form, callbackDueDate: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <input
                  type="time"
                  value={form.callbackDueTime}
                  onChange={(e) => setForm({ ...form, callbackDueTime: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <input
                  type="text"
                  value={form.callbackAgenda}
                  onChange={(e) => setForm({ ...form, callbackAgenda: e.target.value })}
                  placeholder="Agenda for the callback…"
                  className="col-span-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">A follow-up call task will be created automatically and linked back to this call.</p>
            </div>
          )}

          {form.outcome === 'MEETING_SCHEDULED' && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                Meeting Details <span className="text-red-500">*</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={form.meetingType}
                  onChange={(e) => setForm({ ...form, meetingType: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <option value="">Type…</option>
                  {MEETING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <select
                  value={form.meetingMode}
                  onChange={(e) => setForm({ ...form, meetingMode: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <option value="">Mode…</option>
                  {MEETING_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <input
                  type="datetime-local"
                  value={form.meetingScheduledAt}
                  onChange={(e) => setForm({ ...form, meetingScheduledAt: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <select
                  value={form.meetingLocation}
                  onChange={(e) => setForm({ ...form, meetingLocation: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <option value="">Location…</option>
                  {MEETING_LOCATION_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <p className="text-xs text-gray-400 mt-1">A meeting will be created automatically and linked back to this call.</p>
            </div>
          )}

          {!['CALLBACK', 'MEETING_SCHEDULED'].includes(form.outcome) && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                Follow-up Task <span className="text-red-500">*</span>
                <span className="text-xs font-normal text-gray-400 ml-1">(mandatory)</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Due Time <span className="text-red-500">*</span></label>
                  <input
                    type="time"
                    value={form.dueTime}
                    onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-1">Attachments</label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-600 cursor-pointer hover:border-brand-400 w-fit">
                    <Paperclip size={11} strokeWidth={2} />
                    Add attachment(s)
                    <input
                      ref={taskAttachmentFileRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        setTaskAttachmentFiles((prev) => [...prev, ...picked]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {taskAttachmentFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {taskAttachmentFiles.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {f.name}
                          <button type="button" onClick={() => setTaskAttachmentFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-400">
                            <X size={10} strokeWidth={2} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <NextPlanOfActionPicker items={nextPlanItems} onChange={setNextPlanItems} />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={submitting || uploadingAttachment}
            className="w-full bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {uploadingAttachment ? 'Uploading attachment…' : submitting ? 'Saving…' : 'Save Call'}
          </button>
        </form>
      )}

      {/* Call List */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm animate-pulse">Loading calls…</div>
      ) : calls.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No calls logged yet</div>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => (
            <CallCard key={call.id} call={call} onRecordingRefresh={(url) => {
              setCalls((prev) => prev.map((c) => c.id === call.id ? { ...c, recordingUrl: url } : c));
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
