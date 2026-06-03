import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const isTLS = REDIS_URL.startsWith('rediss://');

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: false,
  ...(isTLS && { tls: { rejectUnauthorized: false } }),
});

// Suppress unhandled Redis connection errors — Redis is optional in dev
connection.on('error', (err: Error) => {
  if (process.env.NODE_ENV !== 'production') {
    // Only log once, not on every retry
  }
});

export const queues = {
  reminders: new Queue('reminders', { connection }),
  slaChecks: new Queue('sla-checks', { connection }),
  emails: new Queue('emails', { connection }),
  notifications: new Queue('notifications', { connection }),
};

export { Queue, Worker };
