import { useEffect, useState } from 'react';
import { Check, X, Tag } from 'lucide-react';
import { api } from '../../lib/api';
import toast from 'react-hot-toast';
import ConfirmDialog from '../ui/ConfirmDialog';

interface DiscountRequest {
  id: string;
  originalAmount: number;
  amount: number;
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

function getStoredRole(): string | null {
  try {
    const u = localStorage.getItem('crm_user');
    return u ? JSON.parse(u).role : null;
  } catch { return null; }
}

export default function DiscountTab({ leadId }: Props) {
  const [requests, setRequests] = useState<DiscountRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<{ open: boolean }>({ open: false });
  const [form, setForm] = useState({ originalAmount: '', amount: '', reason: '' });

  // BL review state
  const userRole = getStoredRole();
  const isBL = userRole === 'BL' || userRole === 'BRANCH_HEAD';
  const [reviewModal, setReviewModal] = useState<{ id: string; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const loadRequests = async () => {
    try {
      const data = await api.get<{ requests: DiscountRequest[] }>(`/discount-requests?leadId=${leadId}`);
      setRequests(data.requests);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRequests(); }, [leadId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.originalAmount || !form.amount || !form.reason) {
      toast.error('All fields are required');
      return;
    }
    setConfirm({ open: true });
  };

  const doSubmit = async () => {
    setConfirm({ open: false });
    setSubmitting(true);
    try {
      await api.post(`/leads/${leadId}/discount-request`, {
        originalAmount: Number(form.originalAmount),
        amount: Number(form.amount),
        reason: form.reason,
      });
      toast.success('Discount request submitted for BL approval');
      setForm({ originalAmount: '', amount: '', reason: '' });
      setShowForm(false);
      await loadRequests();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModal) return;
    if (reviewModal.action === 'REJECTED' && !rejectComment.trim()) {
      toast.error('Please add a comment explaining the rejection');
      return;
    }
    setReviewing(true);
    try {
      await api.patch(`/discount-requests/${reviewModal.id}`, {
        status: reviewModal.action,
        reviewerComment: rejectComment || undefined,
      });
      toast.success(reviewModal.action === 'APPROVED' ? 'Request approved ✓' : 'Request rejected');
      setReviewModal(null);
      setRejectComment('');
      await loadRequests();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setReviewing(false);
    }
  };

  const formatINR = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  const discountPct = form.originalAmount && form.amount
    ? (((Number(form.originalAmount) - Number(form.amount)) / Number(form.originalAmount)) * 100).toFixed(1)
    : null;

  const hasPending = requests.some((r) => r.status === 'PENDING');

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={confirm.open}
        title="Submit Discount Request?"
        message={`Request ${discountPct}% discount — this will be sent to your BL for approval.`}
        confirmLabel="Submit"
        onConfirm={doSubmit}
        onCancel={() => setConfirm({ open: false })}
      />

      {/* BL Review Modal */}
      {reviewModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 mb-4">
              <span className="flex items-center gap-2">
              {reviewModal.action === 'APPROVED' ? <Check size={16} strokeWidth={2.5} /> : <X size={16} strokeWidth={2.5} />}
              {reviewModal.action === 'APPROVED' ? 'Approve Discount Request' : 'Reject Discount Request'}
            </span>
            </h3>
            <form onSubmit={handleReview} className="space-y-4">
              {reviewModal.action === 'REJECTED' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for rejection <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={rejectComment}
                    onChange={(e) => setRejectComment(e.target.value)}
                    required
                    placeholder="e.g. 8% too high, max 5%"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              )}
              {reviewModal.action === 'APPROVED' && (
                <p className="text-sm text-gray-500">
                  Approving this discount will notify the designer and update the request status.
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setReviewModal(null); setRejectComment(''); }}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reviewing}
                  className={`flex-1 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
                    reviewModal.action === 'APPROVED' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {reviewing ? 'Saving…' : reviewModal.action === 'APPROVED' ? 'Approve' : 'Reject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Discount Requests</h2>
          <p className="text-sm text-gray-500">
            {requests.length} request{requests.length !== 1 ? 's' : ''} ·{' '}
            {requests.filter((r) => r.status === 'PENDING').length} pending
          </p>
        </div>
        {!isBL && (
          <button
            onClick={() => setShowForm(!showForm)}
            disabled={hasPending}
            title={hasPending ? 'A pending request already exists' : undefined}
            className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors"
          >
            {showForm ? 'Cancel' : '+ Request Discount'}
          </button>
        )}
      </div>

      {hasPending && !showForm && !isBL && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
          A discount request is currently pending BL review.
        </div>
      )}

      {!isBL && showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-medium text-gray-900">New Discount Request</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Original Amount (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number" min="0" value={form.originalAmount}
                onChange={(e) => setForm({ ...form, originalAmount: e.target.value })}
                required placeholder="500000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Proposed Amount (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number" min="0" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required placeholder="450000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>
          {discountPct && Number(discountPct) > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <span className="font-semibold text-amber-700">{discountPct}% discount</span>
              <span className="text-amber-600 text-sm">
                (₹{(Number(form.originalAmount) - Number(form.amount)).toLocaleString('en-IN')} off)
              </span>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3} value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required placeholder="Why is this discount needed?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <button
            type="submit" disabled={submitting}
            className="w-full bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit for BL Approval'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm animate-pulse">Loading requests…</div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mb-3">
            <Tag size={22} strokeWidth={1.5} className="text-stone-400" />
          </div>
          <p className="font-medium text-gray-900 mb-1">No discount requests</p>
          <p className="text-sm text-gray-400">
            {isBL ? 'No discount requests raised for this lead yet.' : 'Use the button above to raise a discount request for BL approval'}
          </p>
        </div>
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
                    <span className="text-base font-bold text-brand-600">{Number(req.discountPct).toFixed(1)}%</span>
                    <span className="text-xs text-gray-400">discount</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-400 line-through">{formatINR(req.originalAmount)}</span>
                    <span className="text-gray-900 font-medium">{formatINR(req.amount)}</span>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <p>By {req.requestedBy.name}</p>
                  <p>{new Date(req.createdAt).toLocaleDateString('en-IN')}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-2">{req.reason}</p>

              {/* BL action buttons on PENDING requests */}
              {isBL && req.status === 'PENDING' && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setReviewModal({ id: req.id, action: 'APPROVED' })}
                    className="flex-1 flex items-center justify-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 font-medium transition-colors"
                  >
                    <Check size={12} strokeWidth={2.5} /> Approve
                  </button>
                  <button
                    onClick={() => { setReviewModal({ id: req.id, action: 'REJECTED' }); setRejectComment(''); }}
                    className="flex-1 flex items-center justify-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 font-medium transition-colors"
                  >
                    <X size={12} strokeWidth={2.5} /> Reject
                  </button>
                </div>
              )}

              {req.reviewedBy && (
                <div className={`rounded-lg px-3 py-2 text-xs mt-2 ${req.status === 'APPROVED' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <span className="font-medium">{req.reviewedBy.name}</span>
                  {req.status === 'REJECTED' && req.reviewerComment && <span className="ml-1">— {req.reviewerComment}</span>}
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
