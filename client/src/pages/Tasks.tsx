import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { FollowUpTask } from '../lib/api';
import toast from 'react-hot-toast';
import { getStoredUser } from '../lib/auth';

type Filter = 'upcoming' | 'overdue' | 'completed' | 'all';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function TaskCard({ task, onComplete }: { task: FollowUpTask; onComplete: (id: string) => void }) {
  const [completing, setCompleting] = useState(false);

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await api.patch(`/tasks/${task.id}/complete`);
      onComplete(task.id);
      toast.success('Task marked complete');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCompleting(false);
    }
  };

  const overdueClass = task.isOverdue && !task.isCompleted ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white';
  const completedClass = task.isCompleted ? 'opacity-60' : '';

  return (
    <div className={`rounded-xl border p-4 flex items-start gap-4 ${overdueClass} ${completedClass}`}>
      <div className="mt-0.5">
        {task.isCompleted ? (
          <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xs">✓</span>
        ) : task.isOverdue ? (
          <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xs">!</span>
        ) : (
          <span className="w-5 h-5 rounded-full border-2 border-gray-300" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            {task.lead && (
              <Link
                to={`/leads/${task.lead.id}`}
                className="text-sm font-medium text-brand-600 hover:underline"
              >
                {task.lead.name}
              </Link>
            )}
            {task.lead && (
              <span className="ml-2 text-xs text-gray-400 font-mono">{task.lead.leadId}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {task.isOverdue && !task.isCompleted && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Overdue</span>
            )}
            {task.isCompleted && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Done</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>📅 {formatDate(task.dueDate)}{task.dueTime ? ` at ${task.dueTime}` : ''}</span>
          <span>·</span>
          <span>👤 {task.assignedTo?.name}</span>
          {task.lead?.stage && (
            <>
              <span>·</span>
              <span className="capitalize">{task.lead.stage.replace(/_/g, ' ')}</span>
            </>
          )}
        </div>
      </div>

      {!task.isCompleted && (
        <button
          onClick={handleComplete}
          disabled={completing}
          className="shrink-0 text-xs text-gray-400 hover:text-green-600 border border-gray-200 hover:border-green-300 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
        >
          {completing ? '…' : 'Done'}
        </button>
      )}
    </div>
  );
}

export default function Tasks() {
  const [myTasks, setMyTasks] = useState<FollowUpTask[]>([]);
  const [teamTasks, setTeamTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [tab, setTab] = useState<'my' | 'team'>('my');
  const user = getStoredUser();
  const isBLOrHead = user?.role === 'BL' || user?.role === 'BRANCH_HEAD';

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const [myRes, teamRes] = await Promise.all([
        api.get<{ tasks: FollowUpTask[] }>('/tasks/my'),
        isBLOrHead
          ? api.get<{ tasks: FollowUpTask[] }>('/tasks/team').catch(() => ({ tasks: [] }))
          : Promise.resolve({ tasks: [] }),
      ]);
      setMyTasks(myRes.tasks ?? []);
      setTeamTasks(teamRes.tasks ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, []);

  const handleComplete = (taskId: string) => {
    setMyTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, isCompleted: true, isOverdue: false } : t));
    setTeamTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, isCompleted: true, isOverdue: false } : t));
  };

  const applyFilter = (tasks: FollowUpTask[]) => {
    if (filter === 'overdue') return tasks.filter((t) => t.isOverdue && !t.isCompleted);
    if (filter === 'completed') return tasks.filter((t) => t.isCompleted);
    if (filter === 'upcoming') return tasks.filter((t) => !t.isCompleted && !t.isOverdue);
    return tasks;
  };

  const activeTasks = applyFilter(tab === 'my' ? myTasks : teamTasks);
  const overdueCount = (tab === 'my' ? myTasks : teamTasks).filter((t) => t.isOverdue && !t.isCompleted).length;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'overdue', label: `Overdue${overdueCount > 0 ? ` (${overdueCount})` : ''}` },
    { key: 'completed', label: 'Completed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">Follow-up tasks across your leads</p>
        </div>
      </div>

      {isBLOrHead && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('my')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === 'my' ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-800 border border-gray-200'}`}
          >
            My Tasks ({myTasks.length})
          </button>
          <button
            onClick={() => setTab('team')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === 'team' ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-800 border border-gray-200'}`}
          >
            Team Tasks ({teamTasks.length})
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f.key
                ? f.key === 'overdue'
                  ? 'bg-red-500 text-white'
                  : 'bg-brand-500 text-white'
                : 'text-gray-500 hover:text-gray-700 border border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading tasks…</div>
      ) : activeTasks.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No {filter !== 'all' ? filter : ''} tasks</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeTasks.map((task) => (
            <TaskCard key={task.id} task={task} onComplete={handleComplete} />
          ))}
        </div>
      )}
    </div>
  );
}
