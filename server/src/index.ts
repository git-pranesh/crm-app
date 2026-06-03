import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { callsRouter } from './routes/calls.js';
import { tasksRouter, myTasksRouter } from './routes/tasks.js';
import { meetingsRouter, meetingStatusRouter } from './routes/meetings.js';
import { notificationsRouter } from './routes/notifications.js';
import { scheduleMidnightJob } from './jobs/midnightOverdueTask.js';
import './jobs/emailWorker.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);

// Lead sub-resources
app.use('/api/leads/:leadId/calls', callsRouter);
app.use('/api/leads/:leadId/tasks', tasksRouter);
app.use('/api/leads/:leadId/meetings', meetingsRouter);

// Standalone task routes
app.use('/api/tasks', myTasksRouter);

// Meeting status update
app.use('/api/meetings', meetingStatusRouter);

// Notifications
app.use('/api/notifications', notificationsRouter);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`CRM Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);

  if (process.env.REDIS_URL && process.env.REDIS_URL !== 'redis://localhost:6379') {
    try {
      await scheduleMidnightJob();
    } catch (e) {
      console.warn('[jobs] Could not schedule midnight job (Redis may not be available):', e);
    }
  } else {
    console.log('[jobs] Skipping midnight job schedule — Redis not configured');
  }
});

export default app;
