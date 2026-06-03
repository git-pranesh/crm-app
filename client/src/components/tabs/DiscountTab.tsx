import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface DiscountRequest {
  id: string;
  originalAmount: number;
  requestedAmount: number;
  discountPct: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewerComment?: string;
  createdAt: string;
  requestedBy: { id: string; name: string; role: string };
  reviewedBy?: { id: string; name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

interface Props { leadId: string }

export default function DiscountTab({ leadId }: Props) {
  const [requests, setRequests] = useState<DiscountRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    originalAmount: '',
    requestedAmount: '',
    reason: '',
  });

  const loadRequests = async () => {
    try {
      const data = await api.get<{ requests: DiscountRequest[] }>(
        `/discount-requests?leadId=${leadId}`,
      );
      setRequests(data.requests);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRequests(); }, [leadId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.originalAmount || !form.requestedAmount || !form.reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/leads/${leadId}/discount-request`, {
        originalAmount: Number(form.originalAmount),
        requestedAmount: Number(form.requestedAmount),
        reason: form.reason,
      });
      setForm({ originalAmount: '', requestedAmount: '', reason: '' });
      setShowForm(false);
      await loadRequests();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatINR = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  const discountPct = form.originalAmount && form.requestedAmount
    ? (((Number(form.originalAmount) - Number(form.requestedAmount)) / Number(form.originalAmount)) * 100).toFixed(1)
    : null;

  const hasPending = requests.some((r) => r.status === 'PENDING');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Discount Requests</h2>
          <p className="text-sm text-gray-500">
            {requests.length} request{requests.length !== 1 ? 's' : ''} ·{' '}
            {requests.filter((r) => r.status === 'PENDING').length} pending
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={hasPending}
          title={hasPending ? 'A pending request already exists' : undefined}
          className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors"
        >
          {showForm ? 'Cancel' : '+ Request Discount'}
        </button>
      </div>

      {hasPending && !showForm && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
          A discount request is currently pending BL review.
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-medium text-gray-900">New Discount Request</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Original Amount (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.originalAmount}
                onChange={(e) => setForm({ ...form, originalAmount: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="e.g. 500000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Requested Amount (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.requestedAmount}
                onChange={(e) => setForm({ ...form, requestedAmount: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="e.g. 450000"
              />
            </div>
          </div>

          {discountPct && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <span className="text-amber-600 text-lg">%</span>
              <div>
                <span className="font-semibold text-amber-700">{discountPct}% discount</span>
                <span className="text-amber-600 text-sm ml-1">
                  (₹{(Number(form.originalAmount) - Number(form.requestedAmount)).toLocaleString('en-IN')} off)
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required
              placeholder="Why is this discount needed? (budget constraint, competitor offer, etc.)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit for BL Approval'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm animate-pulse">Loading requests…</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No discount requests for this lead</div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div key={req.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[req.status]}`}>
                      {req.status}
                    </span>
                    <span className="text-base font-bold text-brand-600">{req.discountPct.toFixed(1)}%</span>
                    <span className="text-xs text-gray-400">discount</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500 line-through">{formatINR(req.originalAmount)}</span>
                    <span className="text-gray-900 font-medium">{formatINR(req.requestedAmount)}</span>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <p>By {req.requestedBy.name}</p>
                  <p>{new Date(req.createdAt).toLocaleDateString('en-IN')}</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-2">{req.reason}</p>

              {req.reviewedBy && (
                <div className={`rounded-lg px-3 py-2 text-xs ${req.status === 'APPROVED' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <span className="font-medium">{req.reviewedBy.name}</span>
                  {req.status === 'REJECTED' && req.reviewerComment && (
                    <span className="ml-1">— {req.reviewerComment}</span>
                  )}
                  {req.status === 'APPROVED' && <span className="ml-1">approved this request</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
