import { useEffect, useState } from 'react';
import { api, type FollowUpTask } from '../../lib/api';

interface Props { leadId: string }

export default function FollowUpTab({ leadId }: Props) {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ dueDate: '', dueTime: '' });

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
      await api.post(`/leads/${leadId}/tasks`, { dueDate: form.dueDate, dueTime: form.dueTime || undefined });
      setForm({ dueDate: '', dueTime: '' });
      setShowForm(false);
      await loadTasks();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (taskId: string) => {
    try {
      await api.patch(`/tasks/${taskId}/complete`, {});
      await loadTasks();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const taskStatusClass = (task: FollowUpTask) => {
    if (task.isCompleted) return 'bg-green-50 border-green-200';
    if (task.isOverdue) return 'bg-red-50 border-red-200';
    return 'bg-white border-gray-200';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Follow-up Tasks</h2>
          <p className="text-sm text-gray-500">
            {tasks.filter(t => !t.isCompleted).length} pending ·{' '}
            {tasks.filter(t => t.isOverdue).length} overdue
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
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
              <input
                type="time"
                value={form.dueTime}
                onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
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

      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm animate-pulse">Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No follow-up tasks yet</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className={`border rounded-xl p-4 ${taskStatusClass(task)}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {task.isCompleted ? (
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">Done</span>
                  ) : task.isOverdue ? (
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700">Overdue</span>
                  ) : (
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">Upcoming</span>
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {new Date(task.dueDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {task.dueTime && <span className="text-gray-500 ml-1">at {task.dueTime}</span>}
                    </p>
                    <p className="text-xs text-gray-400">Assigned to {task.assignedTo.name}</p>
                  </div>
                </div>

                {!task.isCompleted && (
                  <button
                    onClick={() => handleComplete(task.id)}
                    className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                  >
                    Mark Done
                  </button>
                )}

                {task.isCompleted && task.completedAt && (
                  <p className="text-xs text-gray-400">
                    Completed {new Date(task.completedAt).toLocaleDateString('en-IN')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
