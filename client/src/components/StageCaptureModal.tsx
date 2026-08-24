import { useState } from 'react';
import { Star, AlertTriangle } from 'lucide-react';

// Task #114 — shown as a confirmation step on every stage move (from the
// lead-detail stage dropdown and the Pipeline kanban drag-drop) to capture
// an up-to-date intent rating and project value before the move commits.

interface Props {
  leadName: string;
  targetStageLabel: string;
  initialRating: number | null | undefined;
  initialValue: number | string | null | undefined;
  saving: boolean;
  error: string | null;
  /** True when this move fires the automatic sign-off NPS survey email (DESIGN_IN_PROGRESS/HANDED_OVER) — shows the mandatory checkbox. */
  triggersNpsSurvey?: boolean;
  onCancel: () => void;
  onConfirm: (rating: number, value: number, reason: string, sendNpsSurvey: boolean) => void;
}

export default function StageCaptureModal({
  leadName, targetStageLabel, initialRating, initialValue, saving, error, triggersNpsSurvey, onCancel, onConfirm,
}: Props) {
  const [rating, setRating] = useState(initialRating || 0);
  const [value, setValue] = useState(initialValue != null ? String(initialValue) : '');
  const [reason, setReason] = useState('');
  const [sendNpsSurvey, setSendNpsSurvey] = useState(true);

  const parsedValue = parseFloat(value);
  const canSubmit = rating > 0 && value.trim() !== '' && !isNaN(parsedValue) && parsedValue >= 0;

  return (
    <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-3xl shadow-warm-lg w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-stone-900 mb-1 tracking-tight">Confirm move to {targetStageLabel}</h3>
        <p className="text-xs text-stone-400 mb-4">
          {leadName} — confirm intent rating and project value before completing this move.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-stone-700 mb-1.5">Intent Rating</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} className="p-0.5" aria-label={`${n} star`}>
                <Star
                  size={22}
                  strokeWidth={1.8}
                  className={n <= rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300'}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-stone-700 mb-1.5">Project Value (₹)</label>
          <input
            type="number"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="1500000"
            className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-stone-700 mb-1.5">
            Reason for rating change <span className="text-stone-400 font-normal">(optional)</span>
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required only if this overrides the system-computed rating"
            className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition-all"
            style={{ border: '1px solid #EDE8E3', background: '#FDFAF7' }}
          />
        </div>

        {triggersNpsSurvey && (
          <label className="flex items-center gap-2 text-sm text-stone-700 mb-4">
            <input type="checkbox" checked={sendNpsSurvey} onChange={(e) => setSendNpsSurvey(e.target.checked)}
              className="rounded border-stone-300 text-brand-500 focus:ring-brand-400" />
            Send NPS survey email to client
          </label>
        )}

        {error && (
          <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-xs">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 text-stone-600 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors disabled:opacity-50"
            style={{ border: '1px solid #EDE8E3' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(rating, parsedValue, reason.trim(), sendNpsSurvey)}
            disabled={saving || !canSubmit}
            className="flex-1 bg-brand-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Confirm Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
