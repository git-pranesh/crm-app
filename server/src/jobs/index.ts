import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const queues = {
  reminders: new Queue('reminders', { connection }),
  slaChecks: new Queue('sla-checks', { connection }),
  emails: new Queue('emails', { connection }),
  notifications: new Queue('notifications', { connection }),
};

export { Queue, Worker };
