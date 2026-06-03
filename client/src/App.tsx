import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './lib/api';
import LeadDetail from './pages/LeadDetail';
import Inbox from './pages/Inbox';
import Dashboard from './pages/Dashboard';
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
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/inbox', label: 'WhatsApp Inbox', icon: '💬' },
    { to: '/leads/demo-lead-id', label: 'Lead Detail Demo', icon: '👤' },
  ];

  return (
    <div className="min-h-screen bg-brand-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-brand-500 flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl font-bold">D</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Interiors by DeX</h1>
        <p className="text-gray-500 mb-6">CRM Platform</p>

        <div className="rounded-xl bg-gray-50 p-4 text-left text-sm font-mono mb-6">
          {error ? (
            <p className="text-red-500">{error}</p>
          ) : health ? (
            <>
              <p><span className="text-gray-400">status: </span><span className="text-green-600 font-semibold">{health.status}</span></p>
              <p><span className="text-gray-400">timestamp: </span><span className="text-brand-600">{health.timestamp}</span></p>
            </>
          ) : (
            <p className="text-gray-400 animate-pulse">Connecting…</p>
          )}
        </div>

        <div className="space-y-2">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center gap-3 w-full bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-200 text-gray-700 px-4 py-3 rounded-xl transition-colors text-sm font-medium"
            >
              <span className="text-lg">{link.icon}</span>
              {link.label}
              <span className="ml-auto text-gray-400">→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/leads/:leadId" element={<LeadDetail />} />
        <Route path="/feedback/:token" element={<FeedbackForm />} />
      </Routes>
    </BrowserRouter>
  );
}
