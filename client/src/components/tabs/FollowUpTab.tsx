import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, type FollowUpTask } from '../../lib/api';
import { formatISTDate, todayISTDateString } from '../../lib/dateFormat';

function todayDateStr() {
  return todayISTDateString();
}

interface Props { leadId: string }

export default function FollowUpTab({ leadId }: Props) {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    dueDate: '', dueTime: '', timeFrom: '', timeTo: '', taskType: 'INTERNAL', agenda: '',
  });

  // Action modal: complete / not-done / reschedule
  const [actionModal, setActionModal] = useState<{ taskId: string; kind: 'complete' | 'not-done' | 'reschedule' } | null>(null);
  const [actionForm, setActionForm] = useState({
    outcome: '', completedAt: todayDateStr(), reason: '', dueDate: '', dueTime: '',
  });
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const loadTasks = async () => {
    try {
      const data = await api.get<{ tasks: FollowUpTask[] }>(`/leads/${leadId}/tasks`);
      setTasks(data.tasks);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, [leadId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.dueDate) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/leads/${leadId}/tasks`, {
        dueDate: form.dueDate,
        dueTime: form.dueTime || undefined,
        timeFrom: form.timeFrom || undefined,
        timeTo: form.timeTo || undefined,
        taskType: form.taskType,
        agenda: form.agenda.trim() || undefined,
      });
      setForm({ dueDate: '', dueTime: '', timeFrom: '', timeTo: '', taskType: 'INTERNAL', agenda: '' });
      setShowForm(false);
      await loadTasks();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openAction = (taskId: string, kind: 'complete' | 'not-done' | 'reschedule') => {
    setActionModal({ taskId, kind });
    setActionForm({ outcome: '', completedAt: todayDateStr(), reason: '', dueDate: '', dueTime: '' });
    setError(null);
  };

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModal) return;
    setActionSubmitting(true);
    setError(null);
    try {
      if (actionModal.kind === 'complete') {
        await api.patch(`/tasks/${actionModal.taskId}/complete`, {
          outcome: actionForm.outcome.trim(),
          completedAt: actionForm.completedAt ? new Date(actionForm.completedAt).toISOString() : undefined,
        });
        toast.success('Task marked complete');
      } else if (actionModal.kind === 'not-done') {
        await api.patch(`/tasks/${actionModal.taskId}/not-done`, { outcome: actionForm.outcome.trim() });
        toast.success('Task marked not done');
      } else {
        await api.patch(`/tasks/${actionModal.taskId}/reschedule`, {
          dueDate: actionForm.dueDate, dueTime: actionForm.dueTime || undefined, reason: actionForm.reason.trim(),
        });
        toast.success('Task rescheduled');
      }
      setActionModal(null);
      await loadTasks();
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setActionSubmitting(false);
    }
  };

  const statusBadge = (task: FollowUpTask) => {
    switch (task.status) {
      case 'COMPLETED': return <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">Done</span>;
      case 'NOT_DONE': return <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-200 text-gray-600">Not Done</span>;
      case 'RESCHEDULED': return <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">Rescheduled</span>;
      default:
        return task.isOverdue
          ? <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700">Overdue</span>
          : <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">Upcoming</span>;
    }
  };

  const taskStatusClass = (task: FollowUpTask) => {
    if (task.status === 'COMPLETED') return 'bg-green-50 border-green-200';
    if (task.status === 'NOT_DONE') return 'bg-gray-50 border-gray-200';
    if (task.isOverdue) return 'bg-red-50 border-red-200';
    return 'bg-white border-gray-200';
  };

  const isActionable = (task: FollowUpTask) => task.status === 'PENDING';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Follow-up Tasks</h2>
          <p className="text-sm text-gray-500">
            {tasks.filter(t => t.status === 'PENDING').length} pending ·{' '}
            {tasks.filter(t => t.isOverdue && t.status === 'PENDING').length} overdue
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add Task'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-medium text-gray-900">New Follow-up Task</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                min={todayDateStr()}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.taskType}
                onChange={(e) => setForm({ ...form, taskType: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="INTERNAL">Internal</option>
                <option value="EXTERNAL">External (notify client)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
              <input
                type="time"
                value={form.timeFrom}
                onChange={(e) => setForm({ ...form, timeFrom: e.target.value, dueTime: e.target.value || form.dueTime })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="time"
                value={form.timeTo}
                onChange={(e) => setForm({ ...form, timeTo: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Agenda</label>
            <input
              type="text"
              value={form.agenda}
              onChange={(e) => setForm({ ...form, agenda: e.target.value })}
              placeholder="What this task is about…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create Task'}
          </button>
        </form>
      )}

      {/* Action modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 mb-4">
              {actionModal.kind === 'complete' ? 'Mark Task Complete' : actionModal.kind === 'not-done' ? 'Mark Task Not Done' : 'Reschedule Task'}
            </h3>
            <form onSubmit={handleAction} className="space-y-4">
              {(actionModal.kind === 'complete' || actionModal.kind === 'not-done') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Outcome <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={actionForm.outcome}
                    onChange={(e) => setActionForm({ ...actionForm, outcome: e.target.value })}
                    required
                    placeholder="What happened / result of this task…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              )}
              {actionModal.kind === 'complete' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Completed On</label>
                  <input
                    type="date"
                    value={actionForm.completedAt}
                    onChange={(e) => setActionForm({ ...actionForm, completedAt: e.target.value })}
                    max={todayDateStr()}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">Can be backdated; cannot be set in the future.</p>
                </div>
              )}
              {actionModal.kind === 'reschedule' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        New Due Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={actionForm.dueDate}
                        onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })}
                        min={todayDateStr()}
                        required
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                      <input
                        type="time"
                        value={actionForm.dueTime}
                        onChange={(e) => setActionForm({ ...actionForm, dueTime: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reason <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={actionForm.reason}
                      onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })}
                      required
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  </div>
                </>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionSubmitting}
                  className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {actionSubmitting ? 'Saving…' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm animate-pulse">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No follow-up tasks yet</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className={`border rounded-xl p-4 ${taskStatusClass(task)}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  {statusBadge(task)}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {formatISTDate(task.dueDate, { weekday: 'short' })}
                      {(task.timeFrom || task.dueTime) && (
                        <span className="text-gray-500 ml-1">
                          at {task.timeFrom ?? task.dueTime}{task.timeTo ? `–${task.timeTo}` : ''}
                        </span>
                      )}
                      {task.taskType === 'EXTERNAL' && (
                        <span className="ml-1.5 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">External</span>
                      )}
                    </p>
                    {task.agenda && <p className="text-xs text-gray-500 italic">{task.agenda}</p>}
                    <p className="text-xs text-gray-400">Assigned to {task.assignedTo.name}</p>
                  </div>
                </div>

                {isActionable(task) && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => openAction(task.id, 'complete')}
                      className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      Complete
                    </button>
                    <button
                      onClick={() => openAction(task.id, 'reschedule')}
                      className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1.5 rounded-lg hover:bg-amber-100 transition-colors"
                    >
                      Reschedule
                    </button>
                    <button
                      onClick={() => openAction(task.id, 'not-done')}
                      className="text-xs bg-gray-100 text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Not Done
                    </button>
                  </div>
                )}

                {task.status === 'COMPLETED' && task.completedAt && (
                  <p className="text-xs text-gray-400">
                    Completed {formatISTDate(task.completedAt)}
                  </p>
                )}
              </div>

              {task.outcome && (
                <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Outcome</p>
                  <p className="text-xs text-gray-700">{task.outcome}</p>
                </div>
              )}

              {task.rescheduleHistory && task.rescheduleHistory.length > 0 && (
                <div className="mt-2 space-y-1">
                  {task.rescheduleHistory.map((h, i) => (
                    <div key={i} className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
                      <span className="font-medium">Reschedule {i + 1}:</span>{' '}
                      was {formatISTDate(h.dueDate)}
                      {h.dueTime ? ` at ${h.dueTime}` : ''} — {h.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
