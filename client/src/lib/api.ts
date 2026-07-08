const BASE = '/api';

function getToken() {
  return localStorage.getItem('crm_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('crm_token');
      localStorage.removeItem('crm_user');
      window.location.href = '/login';
      throw new Error('Session expired — please sign in again');
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const base = err.error ?? `HTTP ${res.status}`;
    const msg = Array.isArray(err.missing) && err.missing.length
      ? `${base} — missing: ${err.missing.join(', ')}`
      : base;
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── File upload helper ─────────────────────────────────────────────────────────
export async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CallRecord {
  id: string;
  outcome: string;
  duration?: number;
  notes?: string;
  recordingUrl?: string | null;
  createdAt: string;
  loggedBy: { id: string; name: string; role: string };
}

export interface FollowUpTask {
  id: string;
  leadId: string;
  dueDate: string;
  dueTime?: string;
  isCompleted: boolean;
  isOverdue: boolean;
  completedAt?: string;
  createdAt: string;
  assignedTo: { id: string; name: string; role: string };
  lead?: { id: string; leadId: string; name: string; stage: string };
}

export interface Meeting {
  id: string;
  type: 'DQL' | 'PP';
  ppNumber?: number;
  mode: string;
  status: string;
  scheduledAt: string;
  rescheduledReason?: string;
  mom?: string;
  outcome?: string;
  confirmationSent: boolean;
  momSent: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  message: string;
  leadId?: string;
  isRead: boolean;
  createdAt: string;
  lead?: { id: string; leadId: string; name: string };
}
