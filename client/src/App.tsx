import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { api } from './lib/api';
import ErrorBoundary from './components/ui/ErrorBoundary';
import LeadDetail from './pages/LeadDetail';
import LeadList from './pages/LeadList';
import Inbox from './pages/Inbox';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Admin from './pages/Admin';
import Login from './pages/Login';
import Tasks from './pages/Tasks';
import FeedbackForm from './pages/FeedbackForm';
import AcceptInvite from './pages/AcceptInvite';

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function getStoredUser(): { id: string; name: string; email: string; role: string } | null {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_user');
  window.location.href = '/login';
}

// ── Auth Guard ────────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('crm_token');
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

// ── Top nav (shown on all authenticated pages) ────────────────────────────────

const NAV_ITEMS = [
  { to: '/leads', label: 'Leads', icon: '👤' },
  { to: '/tasks', label: 'Tasks', icon: '✅' },
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/inbox', label: 'Inbox', icon: '💬' },
  { to: '/admin', label: 'Admin', icon: '⚙️' },
];

function TopNav() {
  const user = getStoredUser();
  const location = useLocation();

  const roleColor: Record<string, string> = {
    CRE: 'bg-indigo-100 text-indigo-700',
    BL: 'bg-purple-100 text-purple-700',
    DESIGNER: 'bg-blue-100 text-blue-700',
    BRANCH_HEAD: 'bg-amber-100 text-amber-700',
  };

  return (
    <nav className="bg-white border-b border-gray-100 px-4 py-2 flex items-center gap-2 sticky top-0 z-40">
      <Link to="/" className="flex items-center gap-2 mr-4 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center">
          <span className="text-white text-xs font-bold">D</span>
        </div>
        <span className="text-sm font-semibold text-gray-800 hidden sm:block">DeX CRM</span>
      </Link>

      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-brand-50 text-brand-600 border border-brand-200'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {user && (
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleColor[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
            {user.role}
          </span>
          <span className="text-xs text-gray-600 hidden md:block max-w-[120px] truncate" title={user.name}>
            {user.name}
          </span>
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}

// ── Layout wrapper for authenticated pages ─────────────────────────────────────

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      <main>{children}</main>
    </div>
  );
}

// ── Home redirect ─────────────────────────────────────────────────────────────

function Home() {
  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ status: string; timestamp: string }>('/health')
      .then(setHealth)
      .catch(() => setError('Server not reachable'));
  }, []);

  return (
    <div className="flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center">
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm font-mono mb-6">
          {error ? (
            <p className="text-red-500">{error}</p>
          ) : health ? (
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-600 font-medium">online</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-500 text-xs">{new Date(health.timestamp).toLocaleTimeString('en-IN')}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
              <span className="text-gray-400">Connecting…</span>
            </div>
          )}
        </div>
        <Link to="/leads" className="block w-full bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
          Go to Leads →
        </Link>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: { background: '#1f2937', color: '#f9fafb', fontSize: '14px', borderRadius: '10px' },
            success: { iconTheme: { primary: '#22c55e', secondary: '#f9fafb' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#f9fafb' } },
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/feedback/:token" element={<FeedbackForm />} />
          <Route path="/accept-invite/:token" element={<AcceptInvite />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <AuthLayout>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/inbox" element={<Inbox />} />
                    <Route path="/leads" element={<LeadList />} />
                    <Route path="/leads/:leadId" element={<LeadDetail />} />
                    <Route path="/tasks" element={<Tasks />} />
                    <Route path="/admin" element={<Admin />} />
                  </Routes>
                </AuthLayout>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
