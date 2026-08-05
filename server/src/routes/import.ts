import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';

export const importRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|csv)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only .xlsx and .csv files are accepted'));
  },
});

// ── Column name normaliser ─────────────────────────────────────────────────────
function normalise(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const COLUMN_MAP: Record<string, string> = {
  leadid: 'leadId', name: 'name', phone: 'phone', phone2: 'phone2',
  email: 'email', source: 'source', stage: 'stage',
  designername: 'designerName', blname: 'blName',
  projecttype: 'projectType', estimatedvalue: 'estimatedValue',
  location: 'location', createdat: 'createdAt',
};

const VALID_STAGES = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY',
  'PROPOSAL_PRESENTED', 'PROPOSAL_DISCUSSION', 'ONBOARDING',
  'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS', 'INACTIVE', 'ON_HOLD',
];

async function parseRows(file: Express.Multer.File): Promise<Record<string, string>[]> {
  if (file.originalname.endsWith('.csv')) {
    const text = file.buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
    return lines.slice(1).map((line) => {
      const vals = line.split(',').map((v) => v.trim().replace(/"/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      return row;
    });
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const ws = workbook.worksheets[0];
    const headers: string[] = [];
    const rows: Record<string, string>[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) {
        row.eachCell((cell) => headers.push(String(cell.value ?? '')));
        return;
      }
      const r: Record<string, string> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        r[headers[colNum - 1]] = String(cell.value ?? '').trim();
      });
      rows.push(r);
    });
    return rows;
  }
}

// ── POST /api/leads/import ────────────────────────────────────────────────────
importRouter.post('/', verifyToken, requireRole('BL', 'BRANCH_HEAD'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const dryRun = req.query.dryRun === 'true';

    const rawRows = await parseRows(req.file);

    // Normalise header keys
    const rows = rawRows.map((row) => {
      const norm: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        const mapped = COLUMN_MAP[normalise(k)];
        if (mapped) norm[mapped] = v;
      }
      return norm;
    }).filter((r) => r.name && r.phone);

    // Pre-load existing phones + emails + designers + BLs
    const phones = rows.map((r) => r.phone).filter(Boolean);
    const emails = rows.map((r) => r.email).filter(Boolean);
    const [existingLeads, designers, bls] = await Promise.all([
      prisma.lead.findMany({
        where: { OR: [{ phone: { in: phones } }, { email: { in: emails } }] },
        select: { phone: true, email: true, leadId: true },
      }),
      prisma.user.findMany({ where: { role: { in: ['DESIGNER', 'CRE'] } }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { role: 'BL' }, select: { id: true, name: true } }),
    ]);
    const existingPhoneSet = new Set(existingLeads.map((l) => l.phone));
    const existingEmailSet = new Set(existingLeads.map((l) => l.email).filter((e): e is string => !!e));
    const designerMap = new Map(designers.map((d) => [d.name.toLowerCase(), d.id]));
    const blMap = new Map(bls.map((b) => [b.name.toLowerCase(), b.id]));

    // Get last counter value
    const counterRow = await prisma.leadCounter.findUnique({ where: { id: 1 } });
    let nextNum = (counterRow?.lastNum ?? 0) + 1;

    const preview: any[] = [];
    const errors: string[] = [];
    let importedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      if (!r.name || !r.phone) {
        errors.push(`Row ${rowNum}: name and phone are required`);
        continue;
      }

      if (existingPhoneSet.has(r.phone) || (r.email && existingEmailSet.has(r.email))) {
        skippedCount++;
        preview.push({ row: rowNum, status: 'DUPLICATE', phone: r.phone, name: r.name });
        continue;
      }

      // Guard against duplicates within the same file (same phone/email twice).
      existingPhoneSet.add(r.phone);
      if (r.email) existingEmailSet.add(r.email);

      const stage = r.stage && VALID_STAGES.includes(r.stage.toUpperCase())
        ? r.stage.toUpperCase()
        : 'MQL';
      const designerId = r.designerName ? designerMap.get(r.designerName.toLowerCase()) : undefined;
      const blId = r.blName ? blMap.get(r.blName.toLowerCase()) : undefined;

      if (r.designerName && !designerId) {
        errors.push(`Row ${rowNum}: Designer "${r.designerName}" not found`);
      }

      const leadId = `X${String(nextNum).padStart(4, '0')}`;
      nextNum++;

      preview.push({
        row: rowNum, status: 'WILL_IMPORT',
        name: r.name, phone: r.phone, email: r.email || null,
        source: r.source || null, stage, leadId,
        designerId: designerId || null, blId: blId || null,
        estimatedValue: r.estimatedValue ? parseFloat(r.estimatedValue) : null,
      });

      if (!dryRun) {
        try {
          await prisma.lead.create({
            data: {
              leadId,
              name: r.name, phone: r.phone,
              email: r.email || undefined,
              source: r.source || undefined,
              stage: stage as any,
              projectType: r.projectType || undefined,
              location: r.location || undefined,
              estimatedValue: r.estimatedValue ? parseFloat(r.estimatedValue) : undefined,
              assignedDesignerId: designerId || undefined,
              assignedBLId: blId || undefined,
              createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
            },
          });
          importedCount++;
        } catch (e: any) {
          errors.push(`Row ${rowNum}: ${e.message}`);
        }
      }
    }

    if (!dryRun && importedCount > 0) {
      // Update counter
      await prisma.leadCounter.upsert({
        where: { id: 1 },
        create: { id: 1, lastNum: nextNum - 1 },
        update: { lastNum: nextNum - 1 },
      });
      await logActivity(req.user!.id, 'BULK_IMPORT', undefined, { imported: importedCount, skipped: skippedCount });
    }

    res.json({
      dryRun,
      total: rows.length,
      imported: dryRun ? 0 : importedCount,
      skipped: skippedCount,
      errors,
      preview: dryRun ? preview : undefined,
    });
  } catch (err: any) {
    console.error('[import]', err.message);
    res.status(500).json({ error: err.message });
  }
});
