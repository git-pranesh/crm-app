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

  const isOverduePending = task.isOverdue && !task.isCompleted;

  return (
    <div
      className="bg-white rounded-2xl p-4 flex items-start gap-4 transition-all"
      style={{
        border: isOverduePending ? '1px solid #FECACA' : '1px solid #EDE8E3',
        background: isOverduePending ? '#FFF5F5' : '#fff',
        opacity: task.isCompleted ? 0.6 : 1,
        boxShadow: '0 1px 3px 0 rgba(100,60,20,0.06)',
      }}
    >
      <div className="mt-0.5 shrink-0">
        {task.isCompleted ? (
          <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xs font-bold">✓</span>
        ) : task.isOverdue ? (
          <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xs font-bold">!</span>
        ) : (
          <span className="w-5 h-5 rounded-full" style={{ border: '2px solid #EDE8E3' }} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            {task.lead && (
              <Link
                to={`/leads/${task.lead.id}`}
                className="text-sm font-semibold text-brand-600 hover:text-brand-700 hover:underline transition-colors"
              >
                {task.lead.name}
              </Link>
            )}
            {task.lead && (
              <span className="ml-2 text-xs text-stone-400 font-mono font-medium">{task.lead.leadId}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {task.isOverdue && !task.isCompleted && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Overdue</span>
            )}
            {task.isCompleted && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Done</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-stone-500">
          <span>📅 {formatDate(task.dueDate)}{task.dueTime ? ` at ${task.dueTime}` : ''}</span>
          <span className="text-stone-300">·</span>
          <span>👤 {task.assignedTo?.name}</span>
          {task.lead?.stage && (
            <>
              <span className="text-stone-300">·</span>
              <span className="capitalize">{task.lead.stage.replace(/_/g, ' ')}</span>
            </>
          )}
        </div>
      </div>

      {!task.isCompleted && (
        <button
          onClick={handleComplete}
          disabled={completing}
          className="shrink-0 text-xs text-stone-400 hover:text-green-600 transition-colors font-medium px-2.5 py-1 rounded-xl disabled:opacity-50"
          style={{ border: '1px solid #EDE8E3' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#86EFAC'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#EDE8E3'; }}
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
          <h1 className="text-2xl font-extrabold text-stone-900 tracking-tight">Tasks</h1>
          <p className="text-sm text-stone-400 mt-0.5">Follow-up tasks across your leads</p>
        </div>
      </div>

      {isBLOrHead && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('my')}
            className={`px-4 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'my'
                ? 'bg-brand-500 text-white'
                : 'text-stone-500 hover:text-stone-800'
            }`}
            style={tab === 'my' ? {} : { border: '1px solid #EDE8E3' }}
          >
            My Tasks ({myTasks.length})
          </button>
          <button
            onClick={() => setTab('team')}
            className={`px-4 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'team'
                ? 'bg-brand-500 text-white'
                : 'text-stone-500 hover:text-stone-800'
            }`}
            style={tab === 'team' ? {} : { border: '1px solid #EDE8E3' }}
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
            className={`px-3 py-1 rounded-xl text-xs font-semibold transition-colors ${
              filter === f.key
                ? f.key === 'overdue'
                  ? 'bg-red-500 text-white'
                  : 'bg-brand-500 text-white'
                : 'text-stone-500 hover:text-stone-700'
            }`}
            style={filter === f.key ? {} : { border: '1px solid #EDE8E3' }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-stone-400 py-12 animate-pulse">Loading tasks…</div>
      ) : activeTasks.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-2xl mb-2">✓</p>
          <p className="text-stone-400 text-sm">No {filter !== 'all' ? filter : ''} tasks</p>
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
