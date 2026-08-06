import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Check, X, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { getStoredUser } from '../../lib/auth';

interface TeamMemberUser { id: string; name: string; role: string; isActive: boolean }
interface TeamMember {
  id: string;
  isPrimary: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  createdAt: string;
  user: TeamMemberUser;
  requestedBy: { id: string; name: string; role: string };
  reviewedBy?: { id: string; name: string } | null;
}
interface ProjectDetail {
  id: string;
  designer?: { id: string; name: string } | null;
  pd?: { id: string; name: string } | null;
  dtl?: { id: string; name: string } | null;
  teamMembers: TeamMember[];
}
interface AdminUser { id: string; name: string; role: string; designation?: string | null; isActive: boolean }

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export default function TeamTab({ projectId, leadDisplayId }: { projectId: string; leadDisplayId: string }) {
  const user = getStoredUser();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [eligible, setEligible] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [asPrimary, setAsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [pdValue, setPdValue] = useState('');
  const [dtlValue, setDtlValue] = useState('');
  const [savingRole, setSavingRole] = useState<'pd' | 'dtl' | null>(null);

  const canInitiate = user && ['DESIGNER', 'BL', 'BRANCH_HEAD'].includes(user.role);
  const canApprove = user?.role === 'BL';
  const canSetPrimary = user && ['BL', 'BRANCH_HEAD'].includes(user.role);
  const isAdmin = user?.role === 'BRANCH_HEAD';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, eligRes, adminRes] = await Promise.all([
        api.get<{ project: ProjectDetail }>(`/projects/${projectId}`),
        canInitiate
          ? api.get<{ designers: { id: string; name: string }[] }>(`/projects/${projectId}/eligible-team-members`)
          : Promise.resolve({ designers: [] }),
        isAdmin
          ? api.get<{ users: AdminUser[] }>('/admin/users')
          : Promise.resolve({ users: [] }),
      ]);
      setProject(projRes.project);
      setEligible(eligRes.designers);
      setAdminUsers(adminRes.users);
      setPdValue(projRes.project.pd?.id ?? '');
      setDtlValue(projRes.project.dtl?.id ?? '');
    } catch (e: any) {
      toast.error(e.message || 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, [projectId, canInitiate, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleAssignPd = async () => {
    setSavingRole('pd');
    try {
      await api.patch(`/admin/projects/${projectId}/pd`, { userId: pdValue || null });
      toast.success('PD updated');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to assign PD');
    } finally {
      setSavingRole(null);
    }
  };

  const handleAssignDtl = async () => {
    setSavingRole('dtl');
    try {
      await api.patch(`/admin/projects/${projectId}/dtl`, { userId: dtlValue || null });
      toast.success('DTL updated');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to assign DTL');
    } finally {
      setSavingRole(null);
    }
  };

  const handleRequest = async () => {
    if (!selectedUserId) { toast.error('Select a designer'); return; }
    setSubmitting(true);
    try {
      await api.post(`/projects/${projectId}/team-members`, { userId: selectedUserId, isPrimary: asPrimary });
      toast.success(user?.role === 'DESIGNER' ? 'Request sent to BL for approval' : 'Team member added');
      setShowForm(false);
      setSelectedUserId('');
      setAsPrimary(false);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to request team member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (memberId: string) => {
    try {
      await api.patch(`/projects/${projectId}/team-members/${memberId}/approve`, {});
      toast.success('Approved');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to approve');
    }
  };

  const handleReject = async (memberId: string) => {
    if (!rejectReason.trim()) { toast.error('A reason is required'); return; }
    try {
      await api.patch(`/projects/${projectId}/team-members/${memberId}/reject`, { reason: rejectReason.trim() });
      toast.success('Rejected');
      setRejectingId(null);
      setRejectReason('');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to reject');
    }
  };

  const handleMakePrimary = async (memberId: string) => {
    try {
      await api.patch(`/projects/${projectId}/team-members/${memberId}/primary`, {});
      toast.success('Primary designer updated');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update primary');
    }
  };

  if (loading) return <p className="text-xs text-gray-400 py-6 text-center">Loading team…</p>;
  if (!project) return <p className="text-xs text-gray-400 py-6 text-center">Team unavailable</p>;

  const pending = project.teamMembers.filter((m) => m.status === 'PENDING');
  const approved = project.teamMembers.filter((m) => m.status === 'APPROVED');
  const rejected = project.teamMembers.filter((m) => m.status === 'REJECTED');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Project Team — {leadDisplayId}</h3>
        {canInitiate && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            <UserPlus size={13} /> Add team member
          </button>
        )}
      </div>

      {showForm && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400"
          >
            <option value="">Select a designer…</option>
            {eligible.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={asPrimary} onChange={(e) => setAsPrimary(e.target.checked)} />
            Mark as primary designer
          </label>
          {user?.role === 'DESIGNER' && (
            <p className="text-[10px] text-amber-600">This request needs BL approval before it takes effect.</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleRequest}
              disabled={submitting}
              className="px-3 py-1.5 bg-brand-500 text-white text-xs font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : user?.role === 'DESIGNER' ? 'Request' : 'Add'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-3 bg-gray-50">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Admin — Project Roles</p>
          <div>
            <p className="text-xs text-gray-500 mb-1">Project Designer (PD)</p>
            <div className="flex gap-1">
              <select value={pdValue} onChange={(e) => setPdValue(e.target.value)}
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400">
                <option value="">Unassigned</option>
                {adminUsers.filter((u) => u.role === 'DESIGNER' && u.isActive).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <button onClick={handleAssignPd} disabled={savingRole === 'pd'}
                className="bg-brand-500 text-white px-2 py-1 rounded text-xs disabled:opacity-50">Save</button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Design Team Lead (DTL)</p>
            <div className="flex gap-1">
              <select value={dtlValue} onChange={(e) => setDtlValue(e.target.value)}
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400">
                <option value="">Unassigned</option>
                {adminUsers.filter((u) => u.designation === 'DESIGN_TEAM_LEAD' && u.isActive).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <button onClick={handleAssignDtl} disabled={savingRole === 'dtl'}
                className="bg-brand-500 text-white px-2 py-1 rounded text-xs disabled:opacity-50">Save</button>
            </div>
            {adminUsers.filter((u) => u.designation === 'DESIGN_TEAM_LEAD' && u.isActive).length === 0 && (
              <p className="text-[10px] text-amber-600 mt-1">No user has the Design Team Lead designation yet — set it in Admin → Team Members first.</p>
            )}
          </div>
        </div>
      )}

      {/* Project designer (primary by default, not part of teamMembers) */}
      {project.designer && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Project Designer</p>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 text-xs">
            <span className="font-medium text-gray-700">{project.designer.name}</span>
            <span className="text-[10px] text-gray-400">Originally assigned</span>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Pending approval</p>
          <div className="space-y-1.5">
            {pending.map((m) => (
              <div key={m.id} className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">{m.user.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[m.status]}`}>{m.status}</span>
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5">Requested by {m.requestedBy.name}</p>
                {canApprove && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => handleApprove(m.id)} className="flex items-center gap-1 px-2 py-1 bg-green-500 text-white rounded text-[10px] font-medium hover:bg-green-600">
                      <Check size={10} /> Approve
                    </button>
                    <button onClick={() => setRejectingId(rejectingId === m.id ? null : m.id)} className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded text-[10px] font-medium hover:bg-red-100">
                      <X size={10} /> Reject
                    </button>
                  </div>
                )}
                {rejectingId === m.id && (
                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection"
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-red-300"
                    />
                    <button onClick={() => handleReject(m.id)} className="px-2 py-1 bg-red-500 text-white rounded text-[10px] font-medium">Confirm</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Team members</p>
        {approved.length === 0 ? (
          <p className="text-xs text-gray-400">No additional team members yet.</p>
        ) : (
          <div className="space-y-1.5">
            {approved.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-gray-700">{m.user.name}</span>
                  {m.isPrimary && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-brand-50 text-brand-600 rounded text-[9px] font-semibold">
                      <Star size={9} fill="currentColor" /> Primary
                    </span>
                  )}
                </div>
                {canSetPrimary && !m.isPrimary && (
                  <button onClick={() => handleMakePrimary(m.id)} className="text-[10px] text-gray-400 hover:text-brand-600">
                    Make primary
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {rejected.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Rejected requests</p>
          <div className="space-y-1.5">
            {rejected.map((m) => (
              <div key={m.id} className="px-3 py-2 rounded-lg border border-gray-100 bg-gray-50 text-xs opacity-70">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-600">{m.user.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[m.status]}`}>{m.status}</span>
                </div>
                {m.rejectionReason && <p className="text-[10px] text-gray-400 mt-0.5">Reason: {m.rejectionReason}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
