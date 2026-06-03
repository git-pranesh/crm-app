import { useEffect, useState } from 'react';

function App() {
  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError('Server not reachable'));
  }, []);

  return (
    <div className="min-h-screen bg-brand-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-brand-500 flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl font-bold">D</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Interiors by DeX</h1>
        <p className="text-gray-500 mb-8">CRM — Foundation</p>

        <div className="rounded-xl bg-gray-50 p-4 text-left text-sm font-mono">
          {error ? (
            <p className="text-red-500">{error}</p>
          ) : health ? (
            <>
              <p>
                <span className="text-gray-400">status: </span>
                <span className="text-green-600 font-semibold">{health.status}</span>
              </p>
              <p>
                <span className="text-gray-400">timestamp: </span>
                <span className="text-brand-600">{health.timestamp}</span>
              </p>
            </>
          ) : (
            <p className="text-gray-400 animate-pulse">Connecting to server…</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
