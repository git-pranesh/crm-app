import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { leadsRouter } from './routes/leads.js';
import { callsRouter } from './routes/calls.js';
import { tasksRouter, myTasksRouter } from './routes/tasks.js';
import { meetingsRouter, meetingStatusRouter } from './routes/meetings.js';
import { notificationsRouter } from './routes/notifications.js';
import { whatsappRouter, leadWhatsAppRouter } from './routes/whatsapp.js';
import { emailRouter } from './routes/email.js';
import { slaRouter } from './routes/sla.js';
import { feedbackRouter } from './routes/feedback.js';
import { dashboardRouter } from './routes/dashboard.js';
import { reportsRouter } from './routes/reports.js';
import { offersRouter, leadOfferRouter } from './routes/offers.js';
import { discountsRouter, leadDiscountRouter } from './routes/discounts.js';
import { leadWebhooksRouter } from './routes/leadWebhooks.js';
import { quotesRouter, usersDiscountRouter } from './routes/quotes.js';
import { importRouter } from './routes/import.js';
import { adminRouter } from './routes/admin.js';
import { callWebhookRouter } from './routes/callWebhook.js';
import { callsStandaloneRouter } from './routes/calls.js';
import { googleFormWebhookRouter, questionnaireRouter } from './routes/questionnaire.js';
import { acceptInviteRouter } from './routes/acceptInvite.js';
import { dipChecklistRouter } from './routes/dipChecklist.js';
import { pdObChecklistRouter } from './routes/pdObChecklist.js';
import { obObmChecklistRouter } from './routes/obObmChecklist.js';
import { calendarRouter } from './routes/calendar.js';
import { projectsRouter } from './routes/projects.js';
import { filesRouter } from './routes/files.js';
import { configRouter } from './routes/config.js';
import { scheduleMidnightJob } from './jobs/midnightOverdueTask.js';
import { scheduleSLACheck } from './jobs/slaCheck.js';
import { scheduleReportJobs } from './jobs/reportScheduler.js';
import { schedulePerformanceRecalc } from './jobs/performanceRecalc.js';
import { startTaskReminderLoop } from './services/taskReminders.js';
import './jobs/emailWorker.js';
import './jobs/performanceRecalc.js';

const app = express();
const PORT = process.env.PORT ?? 3001;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for iframe support

app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many auth attempts — please wait 15 minutes' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Raw body for Meta webhook signature verification ──────────────────────────
app.use('/api/leads/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    (req as any).rawBody = req.body;
    req.body = JSON.parse(req.body.toString('utf-8'));
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(generalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', healthRouter);
app.use('/api/auth', authLimiter, authRouter);

// Webhooks (rate-limited separately)
app.use('/api/leads/webhook', webhookLimiter, leadWebhooksRouter);
app.use('/api/calls/webhook', webhookLimiter, callWebhookRouter);
app.use('/api/integrations/google-form-webhook', webhookLimiter, googleFormWebhookRouter);

// Public invite acceptance (no auth)
app.use('/api/accept-invite', acceptInviteRouter);

// Standalone calls (recording URL)
app.use('/api/calls', callsStandaloneRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/config', configRouter);

// Leads CRUD
app.use('/api/leads', leadsRouter);

// Lead sub-resources
app.use('/api/leads/:leadId/calls', callsRouter);
app.use('/api/leads/:leadId/tasks', tasksRouter);
app.use('/api/leads/:leadId/meetings', meetingsRouter);
app.use('/api/leads/:leadId/whatsapp', leadWhatsAppRouter);
app.use('/api/leads/:leadId/offer', leadOfferRouter);
app.use('/api/leads/:leadId/discount-request', leadDiscountRouter);
app.use('/api/leads/:leadId/questionnaire', questionnaireRouter);
app.use('/api/leads/:leadId/dip-checklist', dipChecklistRouter);
app.use('/api/leads/:leadId/pd-ob-checklist', pdObChecklistRouter);
app.use('/api/leads/:leadId/ob-obm-checklist', obObmChecklistRouter);
app.use('/api/leads/:leadId/files', filesRouter);

// Bulk import
app.use('/api/leads/import', importRouter);

// Standalone task routes
app.use('/api/tasks', myTasksRouter);

// Meeting status update
app.use('/api/meetings', meetingStatusRouter);

// Notifications
app.use('/api/notifications', notificationsRouter);

// WhatsApp
app.use('/api/whatsapp', whatsappRouter);

// Email preview/draft
app.use('/api/email', emailRouter);

// SLA
app.use('/api/sla', slaRouter);

// Dashboard
app.use('/api/dashboard', dashboardRouter);

// Reports
app.use('/api/reports', reportsRouter);

// Offers
app.use('/api/offers', offersRouter);

// Discount requests
app.use('/api/discount-requests', discountsRouter);

// Users
app.use('/api/users/:id/discount-authority', usersDiscountRouter);

// Admin panel (Branch Head only)
app.use('/api/admin', adminRouter);

// Calendar
app.use('/api/calendar', calendarRouter);

// Projects (delivery)
app.use('/api/projects', projectsRouter);

// Public feedback form (no auth)
app.use('/api/feedback', feedbackRouter);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server:error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`CRM Server running on port ${PORT}`);
  console.log(`BASE_URL: ${BASE_URL}`);

  const redisConfigured =
    process.env.REDIS_URL && !process.env.REDIS_URL.includes('localhost');

  if (redisConfigured) {
    try {
      await scheduleMidnightJob();
      await scheduleSLACheck();
      await scheduleReportJobs();
      await schedulePerformanceRecalc();
    } catch (e) {
      console.warn('[jobs] Could not schedule background jobs:', e);
    }
  } else {
    console.log('[jobs] Skipping background job schedule — Redis not configured');
  }

  // Task due reminders — in-process loop, independent of Redis
  startTaskReminderLoop();
});

export default app;
