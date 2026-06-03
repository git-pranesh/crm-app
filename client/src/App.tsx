import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
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
import FeedbackForm from './pages/FeedbackForm';

function Home() {
  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ status: string; timestamp: string }>('/health')
      .then(setHealth)
      .catch(() => setError('Server not reachable'));
  }, []);

  const navLinks = [
    { to: '/leads', label: 'Leads', icon: '👤', desc: 'All leads — create, filter, manage' },
    { to: '/dashboard', label: 'Dashboard', icon: '📊', desc: 'Pipeline, SLA, conversion analytics' },
    { to: '/reports', label: 'Reports', icon: '📈', desc: '14 report types + CSV export' },
    { to: '/inbox', label: 'WhatsApp Inbox', icon: '💬', desc: 'Role-scoped conversations' },
    { to: '/admin', label: 'Admin Panel', icon: '⚙️', desc: 'Users, report schedules, health' },
  ];

  return (
    <div className="min-h-screen bg-brand-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 sm:p-10 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-brand-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">D</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Interiors by DeX</h1>
          <p className="text-gray-400 text-sm">CRM Platform</p>
        </div>

        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm font-mono mb-6">
          {error ? (
            <p className="text-red-500">{error}</p>
          ) : health ? (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-600 font-medium">online</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-500 text-xs">{new Date(health.timestamp).toLocaleTimeString('en-IN')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
              <span className="text-gray-400">Connecting…</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center gap-3 w-full bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-200 px-4 py-3 rounded-xl transition-colors"
            >
              <span className="text-lg shrink-0">{link.icon}</span>
              <div className="text-left flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{link.label}</p>
                <p className="text-xs text-gray-400 truncate">{link.desc}</p>
              </div>
              <span className="text-gray-300 text-sm shrink-0">→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

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
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/leads" element={<LeadList />} />
          <Route path="/leads/:leadId" element={<LeadDetail />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/feedback/:token" element={<FeedbackForm />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
