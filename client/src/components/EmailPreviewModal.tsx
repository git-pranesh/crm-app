import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

interface Props {
  type: string;
  leadId: string;
  onClose: () => void;
  onSent?: () => void;
}

interface Preview {
  subject: string;
  html: string;
  to: string;
}

export default function EmailPreviewModal({ type, leadId, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get<Preview>(`/email/preview/${type}/${leadId}`)
      .then((data) => {
        setPreview(data);
        setSubject(data.subject);
        setBody(data.html);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [type, leadId]);

  const saveDraft = async () => {
    setSaving(true);
    try {
      await api.patch(`/email/draft/${type}/${leadId}`, { subject, body });
      toast.success('Draft saved');
      setEditMode(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async () => {
    setSending(true);
    try {
      await api.post(`/email/send/${type}/${leadId}`);
      toast.success('Email sent');
      onSent?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-gray-900">Email Preview</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              To: {preview?.to ?? '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditMode(!editMode)}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors"
            >
              {editMode ? 'Preview' : 'Edit'}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm animate-pulse">Loading preview…</div>
          ) : editMode ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Body (HTML)</label>
                <textarea
                  rows={16}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-3 text-sm">
                <span className="font-medium text-gray-700">Subject: </span>
                <span className="text-gray-900">{subject}</span>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <iframe
                  srcDoc={body}
                  title="Email preview"
                  className="w-full h-96"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {editMode && (
              <button
                onClick={saveDraft}
                disabled={saving}
                className="text-sm border border-brand-200 text-brand-600 px-4 py-2 rounded-lg hover:bg-brand-50 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
            )}
            <button
              onClick={sendEmail}
              disabled={sending || loading}
              className="text-sm bg-brand-500 text-white px-5 py-2 rounded-lg font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              {sending ? 'Sending…' : 'Send Now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
