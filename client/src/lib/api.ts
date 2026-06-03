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
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CallRecord {
  id: string;
  outcome: string;
  duration?: number;
  notes?: string;
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
