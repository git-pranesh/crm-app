import { useState, useEffect } from 'react';
import { Check, Mail, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import toast from 'react-hot-toast';
import EmailPreviewModal from './EmailPreviewModal';
import { DateTimeInput } from './ui/DateTimeInputs';

interface PDOBChecklist {
  id: string;
  leadId: string;
  paymentValue: number | null;
  projectValue: number | null;
  furnitureValue: number | null;
  obMeetingScheduledAt: string | null;
  obMeetingLocation: string | null;
  notes: string | null;
  finalPitchPresentationConfirmed: boolean;
  welcomeMailSent: boolean;
  welcomeMailSentAt: string | null;
  completedAt: string | null;
}

interface Props {
  leadId: string;
  stage: string;
  clientEmail: string | null;
  onComplete?: () => void;
  isLocked?: boolean;
}

const VISIBLE_STAGES = new Set(['PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS', 'HANDED_OVER']);

// Task #115 — Meeting Location is a fixed dropdown, not free text.
const LOCATION_OPTIONS = [
  { value: 'EC_VISIT', label: 'EC Visit' },
  { value: 'SITE_VISIT', label: 'Site Visit' },
  { value: 'VIRTUAL', label: 'Virtual' },
  { value: 'PUBLIC_PLACE', label: 'Public place' },
];

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PDOBChecklistPanel({ leadId, stage, clientEmail, onComplete, isLocked }: Props) {
  const [checklist, setChecklist] = useState<PDOBChecklist | null>(null);
  const [hasPaymentScreenshot, setHasPaymentScreenshot] = useState(false);
  const [hasObQuote, setHasObQuote] = useState(false);
  const [hasWelcomeMailScreenshot, setHasWelcomeMailScreenshot] = useState(false);
  const [hasFinalPitchPresentationFile, setHasFinalPitchPresentationFile] = useState(false);
  const [hasGeneratedQuotationFile, setHasGeneratedQuotationFile] = useState(false);
  const [template, setTemplate] = useState({ subject: '', html: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showMailModal, setShowMailModal] = useState(false);

  const [form, setForm] = useState({ paymentValue: '', projectValue: '', furnitureValue: '', obMeetingScheduledAt: '', obMeetingLocation: '', notes: '', finalPitchPresentationConfirmed: false });
  const [obMeetingNotifyClient, setObMeetingNotifyClient] = useState(true);

  const isEditable = stage === 'PROPOSAL_DISCUSSION' && !isLocked;

  const load = async () => {
    try {
      const data = await api.get<{
        checklist: PDOBChecklist | null;
        hasPaymentScreenshot: boolean;
        hasObQuote: boolean;
        hasWelcomeMailScreenshot: boolean;
        hasFinalPitchPresentationFile: boolean;
        hasGeneratedQuotationFile: boolean;
        welcomeMailTemplate: { subject: string; html: string };
      }>(`/leads/${leadId}/pd-ob-checklist`);
      setChecklist(data.checklist);
      setHasPaymentScreenshot(data.hasPaymentScreenshot);
      setHasObQuote(data.hasObQuote);
      setHasWelcomeMailScreenshot(data.hasWelcomeMailScreenshot);
      setHasFinalPitchPresentationFile(data.hasFinalPitchPresentationFile);
      setHasGeneratedQuotationFile(data.hasGeneratedQuotationFile);
      setTemplate(data.welcomeMailTemplate);
      if (data.checklist) {
        setForm({
          paymentValue: data.checklist.paymentValue?.toString() ?? '',
          projectValue: data.checklist.projectValue?.toString() ?? '',
          furnitureValue: data.checklist.furnitureValue?.toString() ?? '',
          obMeetingScheduledAt: toLocalInputValue(data.checklist.obMeetingScheduledAt),
          obMeetingLocation: data.checklist.obMeetingLocation ?? '',
          notes: data.checklist.notes ?? '',
          finalPitchPresentationConfirmed: data.checklist.finalPitchPresentationConfirmed,
        });
      }
    } catch (e: any) {
      console.warn('[PD-OB] load error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (VISIBLE_STAGES.has(stage)) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, stage]);

  const saveDetails = async () => {
    setSaving(true);
    try {
      const data = await api.patch<{ checklist: PDOBChecklist }>(`/leads/${leadId}/pd-ob-checklist`, {
        paymentValue: form.paymentValue === '' ? null : parseFloat(form.paymentValue),
        projectValue: form.projectValue === '' ? null : parseFloat(form.projectValue),
        furnitureValue: form.furnitureValue === '' ? null : parseFloat(form.furnitureValue),
        obMeetingScheduledAt: form.obMeetingScheduledAt || null,
        obMeetingLocation: form.obMeetingLocation || null,
        notes: form.notes || null,
        finalPitchPresentationConfirmed: form.finalPitchPresentationConfirmed,
        notifyClient: obMeetingNotifyClient,
      });
      setChecklist(data.checklist);
      await load();
      onComplete?.();
      toast.success('Details saved');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendWelcomeMail = async (subject: string, html: string) => {
    setSending(true);
    try {
      await api.post(`/leads/${leadId}/pd-ob-checklist/send-welcome-mail`, { subject, html });
      toast.success('Welcome mail sent — lead moved to Onboarding');
      setShowMailModal(false);
      await load();
      onComplete?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };

  if (!VISIBLE_STAGES.has(stage)) return null;

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-40 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-gray-100 rounded" />)}
        </div>
      </div>
    );
  }

  if (!checklist) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
        PD→OB checklist not yet created. It will appear once the lead enters Proposal Discussion stage.
      </div>
    );
  }

  const isComplete = !!checklist.completedAt;
  const requiredMissing = [
    !hasPaymentScreenshot && 'Payment screenshot',
    !hasObQuote && 'OB Quote',
    !hasFinalPitchPresentationFile && 'Final Pitch Presentation file (Files → Proposal Discussion)',
    !hasGeneratedQuotationFile && 'Generated Quotation file (Files → Proposal Discussion)',
    checklist.paymentValue == null && 'Payment value',
    checklist.projectValue == null && 'Project value',
    checklist.furnitureValue == null && 'Furniture value',
    !checklist.obMeetingScheduledAt && 'OB meeting date/time',
    !checklist.obMeetingLocation && 'OB meeting location',
    !checklist.notes?.trim() && 'Notes',
    !form.finalPitchPresentationConfirmed && 'Final Pitch Presentation confirmed',
    !hasWelcomeMailScreenshot && 'Welcome mail approval screenshot',
    !clientEmail && "Client's email",
  ].filter(Boolean) as string[];

  return (
    <div className={`border rounded-xl p-5 ${isComplete ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">PD → OB Checklist</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {isComplete ? 'Welcome mail sent — lead moved to Onboarding' : 'Complete before moving to Onboarding'}
          </p>
        </div>
        {isComplete && (
          <span className="inline-flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
            <Check size={11} strokeWidth={2.5} /> Done
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`text-xs px-3 py-2 rounded-lg ${hasPaymentScreenshot ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {hasPaymentScreenshot ? '✓' : '⚠'} Payment screenshot {hasPaymentScreenshot ? 'uploaded' : '— upload in Files tab'}
        </div>
        <div className={`text-xs px-3 py-2 rounded-lg ${hasObQuote ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {hasObQuote ? '✓' : '⚠'} OB Quote {hasObQuote ? 'uploaded' : '— upload in Files tab'}
        </div>
        <div className={`text-xs px-3 py-2 rounded-lg ${hasWelcomeMailScreenshot ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {hasWelcomeMailScreenshot ? '✓' : '⚠'} Approval screenshot {hasWelcomeMailScreenshot ? 'uploaded' : '— upload in Files tab'}
        </div>
        <div className={`text-xs px-3 py-2 rounded-lg ${hasFinalPitchPresentationFile ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {hasFinalPitchPresentationFile ? '✓' : '⚠'} Pitch Presentation file {hasFinalPitchPresentationFile ? 'uploaded' : '— upload in Files tab'}
        </div>
        <div className={`text-xs px-3 py-2 rounded-lg ${hasGeneratedQuotationFile ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {hasGeneratedQuotationFile ? '✓' : '⚠'} Generated Quotation file {hasGeneratedQuotationFile ? 'uploaded' : '— upload in Files tab'}
        </div>
        <label className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg cursor-pointer ${form.finalPitchPresentationConfirmed ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'} ${!isEditable ? 'pointer-events-none opacity-70' : ''}`}>
          <input
            type="checkbox"
            disabled={!isEditable || saving}
            checked={form.finalPitchPresentationConfirmed}
            onChange={(e) => setForm((f) => ({ ...f, finalPitchPresentationConfirmed: e.target.checked }))}
            className="rounded border-gray-300"
          />
          Final Pitch Presentation
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment value (₹)</label>
          <input
            type="number"
            disabled={!isEditable || saving}
            value={form.paymentValue}
            onChange={(e) => setForm((f) => ({ ...f, paymentValue: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Project value (₹)</label>
          <input
            type="number"
            disabled={!isEditable || saving}
            value={form.projectValue}
            onChange={(e) => setForm((f) => ({ ...f, projectValue: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Furniture value (₹)</label>
          <input
            type="number"
            disabled={!isEditable || saving}
            value={form.furnitureValue}
            onChange={(e) => setForm((f) => ({ ...f, furnitureValue: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">OB meeting date &amp; time</label>
          <DateTimeInput
            disabled={!isEditable || saving}
            value={form.obMeetingScheduledAt}
            onChange={(v) => setForm((f) => ({ ...f, obMeetingScheduledAt: v }))}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">OB meeting location</label>
          <select
            disabled={!isEditable || saving}
            value={form.obMeetingLocation}
            onChange={(e) => setForm((f) => ({ ...f, obMeetingLocation: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-gray-50"
          >
            <option value="">Select…</option>
            {LOCATION_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
        <input
          type="checkbox"
          disabled={!isEditable || saving}
          checked={obMeetingNotifyClient}
          onChange={(e) => setObMeetingNotifyClient(e.target.checked)}
          className="rounded border-gray-300 text-brand-500 focus:ring-brand-400"
        />
        Send meeting confirmation email to client (applies when OB meeting date &amp; location above are saved)
      </label>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
        <textarea
          disabled={!isEditable || saving}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={2}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-gray-50"
        />
      </div>

      {isEditable && (
        <div className="flex gap-2">
          <button
            onClick={saveDetails}
            disabled={saving}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
          <button
            onClick={() => setShowMailModal(true)}
            disabled={saving || requiredMissing.length > 0}
            title={requiredMissing.length > 0 ? `Missing: ${requiredMissing.join(', ')}` : undefined}
            className="flex-1 flex items-center justify-center gap-1.5 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Mail size={13} strokeWidth={2.5} /> Share welcome mail
          </button>
        </div>
      )}

      {isEditable && requiredMissing.length > 0 && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-amber-600">
          <AlertCircle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
          <span>Before sending: {requiredMissing.join(', ')}</span>
        </div>
      )}

      {showMailModal && (
        <EmailPreviewModal
          title="Share welcome mail"
          defaultSubject={template.subject}
          defaultHtml={template.html}
          recipientLabel={clientEmail ?? '(no email on file)'}
          sending={sending}
          onSend={sendWelcomeMail}
          onClose={() => setShowMailModal(false)}
        />
      )}
    </div>
  );
}
