import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';

interface User {
  id: string; name: string; email: string; role: string;
  isActive: boolean; blId?: string;
  bl?: { id: string; name: string } | null;
  _count: { designerLeads: number; blLeads: number };
}
interface Health {
  db: string; totalLeads: number; totalUsers: number; activeBreaches: number;
  redisConfigured: boolean; smtpConfigured: boolean; twilioConfigured: boolean;
  metaConfigured: boolean; baseUrl: string;
  reportSchedules: { type: string; lastSentAt?: string }[];
}
interface Schedule { id: string; type: string; recipients: string[]; lastSentAt?: string }

const ROLE_COLORS: Record<string, string> = {
  DESIGNER: 'bg-blue-100 text-blue-700',
  CRE: 'bg-purple-100 text-purple-700',
  BL: 'bg-amber-100 text-amber-700',
  BRANCH_HEAD: 'bg-green-100 text-green-700',
};

type AdminTab = 'users' | 'schedules' | 'health';

export default function Admin() {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'DESIGNER', blId: '' });
  const [inviting, setInviting] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ type: 'WEEKLY', recipientIds: '' });
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [reassignDesignerId, setReassignDesignerId] = useState('');

  const bls = users.filter((u) => u.role === 'BL' && u.isActive);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [u, h, s] = await Promise.all([
        api.get<{ users: User[] }>('/admin/users'),
        api.get<Health>('/admin/health'),
        api.get<{ schedules: Schedule[] }>('/admin/report-schedules'),
      ]);
      setUsers(u.users);
      setHealth(h);
      setSchedules(s.schedules);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.name || !inviteForm.email) { toast.error('Name and email required'); return; }
    setInviting(true);
    try {
      await api.post('/admin/users/invite', { ...inviteForm, blId: inviteForm.blId || undefined });
      toast.success(`${inviteForm.name} invited successfully`);
      setInviteForm({ name: '', email: '', role: 'DESIGNER', blId: '' });
      await loadAll();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setInviting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.patch(`/admin/users/${deactivateTarget.id}/deactivate`, {
        reassignDesignerId: reassignDesignerId || undefined,
      });
      toast.success(`${deactivateTarget.name} deactivated`);
      setDeactivateTarget(null);
      setReassignDesignerId('');
      await loadAll();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipients = scheduleForm.recipientIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (!recipients.length) { toast.error('Enter at least one User ID'); return; }
    try {
      await api.post('/admin/report-schedules', { type: scheduleForm.type, recipients });
      toast.success('Report schedule created');
      setScheduleForm({ type: 'WEEKLY', recipientIds: '' });
      await loadAll();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      await api.delete(`/admin/report-schedules/${id}`);
      toast.success('Schedule removed');
      await loadAll();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'schedules', label: 'Report Schedules', icon: '📅' },
    { id: 'health', label: 'System Health', icon: '🩺' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate User?"
        message={`${deactivateTarget?.name}'s account will be disabled. Their leads will remain unless you choose to reassign.`}
        confirmLabel="Deactivate"
        destructive
        onConfirm={handleDeactivate}
        onCancel={() => { setDeactivateTarget(null); setReassignDesignerId(''); }}
      />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link to="/dashboard" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Admin Panel</h1>
            <p className="text-xs text-gray-400">Branch Head access only</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  tab === t.id ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading && <div className="text-center py-20 text-gray-400 animate-pulse">Loading…</div>}

        {/* ── USERS TAB ──────────────────────────────────────────────────────── */}
        {!loading && tab === 'users' && (
          <>
            {/* Invite form */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Invite New User</h2>
              <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  placeholder="Full name *" required
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="Email *" required
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
                  {['DESIGNER', 'CRE', 'BL', 'BRANCH_HEAD'].map((r) => <option key={r}>{r}</option>)}
                </select>
                <button type="submit" disabled={inviting}
                  className="bg-brand-500 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors">
                  {inviting ? 'Inviting…' : 'Send Invite'}
                </button>
              </form>
              {(inviteForm.role === 'DESIGNER' || inviteForm.role === 'CRE') && bls.length > 0 && (
                <div className="mt-3">
                  <select value={inviteForm.blId} onChange={(e) => setInviteForm({ ...inviteForm, blId: e.target.value })}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
                    <option value="">Assign to BL (optional)</option>
                    {bls.map((bl) => <option key={bl.id} value={bl.id}>{bl.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* User list */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Team Members ({users.filter((u) => u.isActive).length} active)</h2>
              </div>
              {users.length === 0 ? (
                <EmptyState icon="👤" title="No users yet" description="Invite team members using the form above" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {['Name', 'Email', 'Role', 'BL', 'Leads', 'Status', ''].map((h) => (
                          <th key={h} className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {users.map((u) => (
                        <tr key={u.id} className={`hover:bg-gray-50 ${!u.isActive ? 'opacity-50' : ''}`}>
                          <td className="py-3 px-4 font-medium text-gray-900">{u.name}</td>
                          <td className="py-3 px-4 text-gray-500 text-xs">{u.email}</td>
                          <td className="py-3 px-4">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-500 text-xs">{u.bl?.name ?? '—'}</td>
                          <td className="py-3 px-4 text-gray-700">
                            {u._count.designerLeads + u._count.blLeads}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-xs px-2 py-1 rounded-full ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {u.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {u.isActive && (
                              <button onClick={() => setDeactivateTarget(u)}
                                className="text-xs text-red-500 hover:text-red-700 hover:underline">
                                Deactivate
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── SCHEDULES TAB ─────────────────────────────────────────────────── */}
        {!loading && tab === 'schedules' && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Add Report Schedule</h2>
              <form onSubmit={handleAddSchedule} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Report Type</label>
                    <select value={scheduleForm.type} onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
                      <option value="WEEKLY">Weekly (every Monday 8am)</option>
                      <option value="MONTHLY">Monthly (1st of month 8am)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Recipient User IDs (comma-separated)</label>
                    <input value={scheduleForm.recipientIds}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, recipientIds: e.target.value })}
                      placeholder="userId1, userId2, …"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
                  </div>
                </div>
                <button type="submit"
                  className="bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors">
                  Create Schedule
                </button>
              </form>
            </div>

            {schedules.length === 0 ? (
              <EmptyState icon="📅" title="No report schedules" description="Create a schedule above to start receiving automatic reports" />
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {['Type', 'Recipients', 'Last Sent', ''].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {schedules.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.type === 'WEEKLY' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {s.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{s.recipients.length} recipient{s.recipients.length !== 1 ? 's' : ''}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">
                          {s.lastSentAt ? new Date(s.lastSentAt).toLocaleString('en-IN') : 'Never sent'}
                        </td>
                        <td className="py-3 px-4">
                          <button onClick={() => deleteSchedule(s.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── HEALTH TAB ────────────────────────────────────────────────────── */}
        {!loading && tab === 'health' && health && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total Leads', value: health.totalLeads, color: 'text-brand-600' },
                { label: 'Active Users', value: health.totalUsers, color: 'text-blue-600' },
                { label: 'SLA Breaches', value: health.activeBreaches, color: health.activeBreaches > 0 ? 'text-red-600' : 'text-green-600' },
                { label: 'Database', value: health.db, color: 'text-green-600' },
              ].map((item) => (
                <div key={item.label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Integration Status</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Redis / BullMQ', ok: health.redisConfigured },
                  { label: 'SMTP Email', ok: health.smtpConfigured },
                  { label: 'Twilio WhatsApp', ok: health.twilioConfigured },
                  { label: 'Meta Lead Ads', ok: health.metaConfigured },
                ].map((item) => (
                  <div key={item.label} className={`flex items-center gap-3 p-3 rounded-xl ${item.ok ? 'bg-green-50' : 'bg-gray-50'}`}>
                    <span className="text-lg">{item.ok ? '✅' : '⚙️'}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.label}</p>
                      <p className={`text-xs ${item.ok ? 'text-green-600' : 'text-gray-400'}`}>{item.ok ? 'Configured' : 'Not configured'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Base URL</h2>
              <p className="text-sm font-mono bg-gray-50 rounded-lg px-3 py-2 text-gray-700">{health.baseUrl}</p>
              <p className="text-xs text-gray-400 mt-1">Set <code>BASE_URL</code> env var to use your custom domain (e.g. https://crm.interiorsbydex.com)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
