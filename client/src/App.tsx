import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './lib/api';
import LeadDetail from './pages/LeadDetail';

function Home() {
  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ status: string; timestamp: string }>('/health')
      .then(setHealth)
      .catch(() => setError('Server not reachable'));
  }, []);

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

        <div className="text-sm text-gray-500">
          <p className="mb-2">Demo: navigate to a lead detail page</p>
          <Link
            to="/leads/demo-lead-id"
            className="inline-block bg-brand-500 text-white px-4 py-2 rounded-lg hover:bg-brand-600 transition-colors"
          >
            Open Lead Detail Demo →
          </Link>
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
        <Route path="/leads/:leadId" element={<LeadDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
