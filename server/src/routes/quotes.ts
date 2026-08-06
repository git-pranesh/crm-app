import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { isAuthorizedForLead } from '../lib/leadAuth.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const quotesRouter = Router();
export const usersDiscountRouter = Router({ mergeParams: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const QUOTE_FILES_BUCKET = 'crm-quote-files'; // private bucket — task #89
const ALLOWED_QUOTE_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const ALLOWED_QUOTE_EXTS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'xls', 'xlsx']);

// Max discount per role (%)
const DISCOUNT_AUTHORITY: Record<string, number> = {
  DESIGNER: 5,
  CRE: 10,
  BL: 20,
  BRANCH_HEAD: 30,
};

// ── GET /api/users/:id/discount-authority ─────────────────────────────────────
// Called by the Quote Builder before allowing discount submission
usersDiscountRouter.get('/', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { role: true, name: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ userId: req.params.id, role: user.role, maxDiscountPct: DISCOUNT_AUTHORITY[user.role] ?? 5 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/quotes/callback — Quote Builder posts back when quote created ───
quotesRouter.post('/callback', async (req, res) => {
  try {
    const { leadId: leadRef, amount, discountPct, quoteRef } = req.body as {
      leadId?: string; amount?: number; discountPct?: number; quoteRef?: string;
    };

    if (!leadRef || !amount) {
      res.status(400).json({ error: 'leadId and amount are required' });
      return;
    }

    // leadId can be X#### format or the UUID id
    const lead = await prisma.lead.findFirst({
      where: { OR: [{ leadId: leadRef }, { id: leadRef }] },
    });
    if (!lead) { res.status(404).json({ error: `Lead not found: ${leadRef}` }); return; }

    const quote = await prisma.quote.create({
      data: {
        leadId: lead.id,
        quoteBuilderRef: quoteRef,
        amount,
        discountPct: discountPct ?? 0,
        status: 'DRAFT',
      },
    });

    // Update lead estimated value
    await prisma.lead.update({
      where: { id: lead.id },
      data: { estimatedValue: amount },
    });

    const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID;
    if (SYSTEM_USER_ID) {
      await logActivity(SYSTEM_USER_ID, 'QUOTE_RECEIVED', lead.id, {
        quoteRef, amount, discountPct,
      }).catch((e) => console.warn('[quotes:callback:activity]', e.message));
    }

    res.status(201).json({ quote, lead: { id: lead.id, leadId: lead.leadId } });
  } catch (err: any) {
    console.error('[quotes:callback]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:leadId/quotes — list quotes for a lead ───────────────────
// Scoped like every other lead-scoped resource (task #89): DESIGNER/CRE only
// see quotes for leads assigned to them, BL only their team's, mirroring
// isAuthorizedForLead used by files.ts/leads.ts.
quotesRouter.get('/lead/:leadId', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.leadId },
      select: { id: true, assignedDesignerId: true, assignedBLId: true },
    });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!(await isAuthorizedForLead(lead, user))) {
      res.status(403).json({ error: 'Not authorised to view quotes for this lead' });
      return;
    }

    const quotes = await prisma.quote.findMany({
      where: { leadId: req.params.leadId },
      include: { files: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });

    // Hydrate fresh signed URLs for each attachment (never store long-lived
    // URLs — mirrors files.ts/calls.ts).
    const storageClient = supabaseAdmin;
    const quotesWithSignedFiles = await Promise.all(
      quotes.map(async (q) => ({
        ...q,
        files: !storageClient
          ? q.files.map((f) => ({ ...f, signedUrl: undefined }))
          : await Promise.all(
              q.files.map(async (f) => {
                const { data } = await storageClient.storage
                  .from(QUOTE_FILES_BUCKET)
                  .createSignedUrl(f.storagePath, 60 * 60);
                return { ...f, signedUrl: data?.signedUrl };
              }),
            ),
      })),
    );

    res.json({ quotes: quotesWithSignedFiles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/quotes/:id/files — attach the actual quote document ────────────
// Real file attachment, not a link (task #89): stored in the private
// crm-quote-files bucket, same pattern as LeadFile/CallAttachment.
quotesRouter.post('/:id/files', verifyToken, upload.single('file') as any, async (req, res) => {
  try {
    const user = req.user!;
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { lead: { select: { id: true, assignedDesignerId: true, assignedBLId: true } } },
    });
    if (!quote) { res.status(404).json({ error: 'Quote not found' }); return; }
    if (!(await isAuthorizedForLead(quote.lead, user))) {
      res.status(403).json({ error: 'Not authorised to attach files to this quote' });
      return;
    }

    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_QUOTE_MIMES.has(file.mimetype) || !ALLOWED_QUOTE_EXTS.has(ext)) {
      res.status(400).json({ error: 'Unsupported file type. Allowed: PDF, images, Excel.' });
      return;
    }
    if (!supabaseAdmin) { res.status(500).json({ error: 'Storage not configured' }); return; }

    await supabaseAdmin.storage.createBucket(QUOTE_FILES_BUCKET, { public: false }).catch(() => {});

    const storagePath = `${quote.leadId}/${quote.id}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(QUOTE_FILES_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploadError) { res.status(500).json({ error: uploadError.message }); return; }

    const record = await prisma.quoteFile.create({
      data: { quoteId: quote.id, fileName: file.originalname, storagePath, uploadedById: user.id },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    const { data: signed } = await supabaseAdmin.storage.from(QUOTE_FILES_BUCKET).createSignedUrl(storagePath, 60 * 60);

    await logActivity(user.id, 'QUOTE_FILE_ATTACHED', quote.leadId, {
      quoteId: quote.id, fileId: record.id, fileName: file.originalname,
    }).catch(() => {});

    res.status(201).json({ file: { ...record, signedUrl: signed?.signedUrl } });
  } catch (err: any) {
    console.error('[quotes:files:upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});
