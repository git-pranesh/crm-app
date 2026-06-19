import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { getStoredUser, logout } from '../App';

interface SearchLead {
  id: string;
  leadId: string;
  name: string;
  phone: string;
  stage: string;
}

interface NotifItem {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  lead?: { id: string; leadId: string; name: string };
}

const SOURCE_OPTIONS = ['META_ADS', 'GOOGLE_ADS', 'REFERRAL', 'WALK_IN', 'ORGANIC', 'OTHER'];

const NAV_GROUPS = [
  {
    label: 'OVERVIEW',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: '▤' }],
  },
  {
    label: 'SALES',
    items: [
      { to: '/pipeline', label: 'Pipeline', icon: '⬡' },
      { to: '/leads', label: 'Leads', icon: '👤' },
      { to: '/inbox', label: 'WhatsApp', icon: '💬' },
      { to: '/leads?tab=discounts', label: 'Discounts', icon: '%' },
      { to: '/leads?tab=meetings', label: 'Meetings', icon: '📅' },
    ],
  },
  {
    label: 'DELIVERY',
    items: [{ to: '/projects', label: 'Projects', icon: '🏗' }],
  },
  {
    label: 'INSIGHTS',
    items: [{ to: '/reports', label: 'Reports', icon: '📈' }],
  },
  {
    label: 'WORKSPACE',
    items: [
      { to: '/admin', label: 'Team & Roles', icon: '👥' },
      { to: '/settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

const ROLE_COLORS: Record<string, string> = {
  CRE: 'bg-indigo-100 text-indigo-700',
  BL: 'bg-purple-100 text-purple-700',
  DESIGNER: 'bg-blue-100 text-blue-700',
  BRANCH_HEAD: 'bg-amber-100 text-amber-700',
};

function fmtRelTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getStoredUser();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchLead[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const notifsRef = useRef<HTMLDivElement>(null);

  const [showNewLead, setShowNewLead] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', source: '', projectType: '', location: '' });

  const fetchNotifs = useCallback(async () => {
    try {
      const data = await api.get<{ unreadCount: number; notifications: NotifItem[] }>('/notifications/my');
      setUnreadCount(data.unreadCount ?? 0);
      setNotifs(data.notifications ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchNotifs();
    const id = setInterval(fetchNotifs, 30000);
    return () => clearInterval(id);
  }, [fetchNotifs]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); setSearchOpen(false); return; }
    const t = setTimeout(async () => {
      try {
        const data = await api.get<{ leads: SearchLead[] }>(`/leads?search=${encodeURIComponent(search)}&limit=6`);
        setSearchResults(data.leads ?? []);
        setSearchOpen(true);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) setNotifsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLead.name || !newLead.phone) { toast.error('Name and phone are required'); return; }
    setCreating(true);
    try {
      const data = await api.post<{ lead: { leadId: string } }>('/leads', newLead);
      toast.success(`Lead ${data.lead.leadId} created`);
      setNewLead({ name: '', phone: '', email: '', source: '', projectType: '', location: '' });
      setShowNewLead(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const toggleSection = (label: string) =>
    setCollapsed((c) => ({ ...c, [label]: !c[label] }));

  const isActive = (to: string) => {
    const path = to.split('?')[0];
    return location.pathname === path || (path !== '/' && location.pathname.startsWith(path));
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 flex flex-col h-full overflow-y-auto">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-100 shrink-0">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-bold">D</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 leading-tight">Interiors by DeX</p>
              <p className="text-[10px] text-gray-400 font-medium tracking-wide uppercase">CRM</p>
            </div>
          </Link>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 py-3 px-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-1">
              <button
                onClick={() => toggleSection(group.label)}
                className="w-full flex items-center justify-between px-2 py-1 mb-0.5"
              >
                <span className="text-[10px] font-semibold text-gray-400 tracking-wider">{group.label}</span>
                <span className="text-gray-300 text-xs">{collapsed[group.label] ? '›' : '⌄'}</span>
              </button>
              {!collapsed[group.label] && (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item.to);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                          active
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-base w-4 text-center">{item.icon}</span>
                        <span>{item.label}</span>
                        {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-500" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* User / logout */}
        {user && (
          <div className="shrink-0 border-t border-gray-100 px-3 py-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                <span className="text-brand-700 text-xs font-bold">{user.name[0]?.toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">{user.name}</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                  {user.role}
                </span>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors text-left"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center gap-3 shrink-0">
          {/* Search */}
          <div className="relative flex-1 max-w-md" ref={searchRef}>
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50 focus-within:bg-white focus-within:border-brand-300 focus-within:ring-1 focus-within:ring-brand-200 transition-all">
              <span className="pl-3 text-gray-400 text-sm">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                placeholder="Search name, phone, Lead ID…"
                className="flex-1 bg-transparent px-2 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
              />
              {search && (
                <button onClick={() => { setSearch(''); setSearchResults([]); setSearchOpen(false); }}
                  className="pr-2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                {searchResults.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => { navigate(`/leads/${lead.id}`); setSearch(''); setSearchOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0"
                  >
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <span className="text-gray-500 text-xs font-bold">{lead.name[0]?.toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{lead.name}</p>
                      <p className="text-xs text-gray-400">{lead.leadId} · {lead.stage.replace(/_/g, ' ')}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Notifications bell */}
            <div className="relative" ref={notifsRef}>
              <button
                onClick={() => setNotifsOpen((o) => !o)}
                className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
              >
                <span className="text-lg">🔔</span>
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-brand-500 text-white text-[10px] font-bold px-0.5">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              {notifsOpen && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900">Notifications</p>
                    {unreadCount > 0 && (
                      <span className="text-xs text-brand-600 font-medium">{unreadCount} unread</span>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                    {notifs.length === 0 ? (
                      <p className="text-center text-sm text-gray-400 py-6">No notifications</p>
                    ) : notifs.slice(0, 10).map((n) => (
                      <div key={n.id} className={`px-4 py-3 ${!n.isRead ? 'bg-brand-50' : ''}`}>
                        <p className="text-xs text-gray-800 leading-snug">{n.message}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{fmtRelTime(n.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* New Lead */}
            <button
              onClick={() => setShowNewLead(true)}
              className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
            >
              <span className="text-base leading-none">+</span>
              New Lead
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* New Lead Modal */}
      {showNewLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowNewLead(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">New Lead</h2>
              <button onClick={() => setShowNewLead(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
              {[
                { key: 'name', label: 'Full Name', required: true, placeholder: 'Priya Sharma', span: 2 },
                { key: 'phone', label: 'Phone', required: true, placeholder: '+91 98765 43210' },
                { key: 'email', label: 'Email', required: false, placeholder: 'priya@example.com' },
                { key: 'projectType', label: 'Project Type', required: false, placeholder: '2BHK / Villa' },
                { key: 'location', label: 'Location', required: false, placeholder: 'Whitefield, Bangalore' },
              ].map((f) => (
                <div key={f.key} className={(f as any).span === 2 ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <input
                    value={(newLead as any)[f.key]}
                    onChange={(e) => setNewLead({ ...newLead, [f.key]: e.target.value })}
                    required={f.required}
                    placeholder={f.placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
                <select
                  value={newLead.source}
                  onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                >
                  <option value="">Select source</option>
                  {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowNewLead(false)}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="px-5 py-2 text-sm font-medium bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg transition-colors">
                  {creating ? 'Creating…' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
