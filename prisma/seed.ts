/**
 * Interiors by DeX CRM — Seed Script
 *
 * Run with: cd server && pnpm run db:seed
 *
 * Creates:
 *  - 1 Branch Head (admin) Supabase Auth account
 *  - Corresponding User record in the CRM database
 *  - LeadCounter initialised at 0 (next lead = X0001)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const prisma = new PrismaClient();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const BRANCH_HEAD = {
  name: 'Branch Head Admin',
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@interiorsbydex.com',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe@123',
};

async function main() {
  console.log('🌱 Starting seed…');

  // ── 1. LeadCounter ────────────────────────────────────────────────────────
  await prisma.leadCounter.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, lastNum: 0 },
  });
  console.log('  ✓ LeadCounter initialised');

  // ── 2. Branch Head Supabase Auth account ─────────────────────────────────
  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === BRANCH_HEAD.email);

  let supabaseId: string;

  if (existing) {
    supabaseId = existing.id;
    console.log(`  ✓ Supabase user already exists (${BRANCH_HEAD.email})`);
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: BRANCH_HEAD.email,
      password: BRANCH_HEAD.password,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new Error(`Failed to create Supabase user: ${error?.message}`);
    }

    supabaseId = data.user.id;
    console.log(`  ✓ Supabase user created (${BRANCH_HEAD.email})`);
  }

  // ── 3. CRM User record ────────────────────────────────────────────────────
  const user = await prisma.user.upsert({
    where: { supabaseId },
    update: { name: BRANCH_HEAD.name, role: 'BRANCH_HEAD', isActive: true },
    create: {
      supabaseId,
      name: BRANCH_HEAD.name,
      email: BRANCH_HEAD.email,
      role: 'BRANCH_HEAD',
      isActive: true,
    },
  });

  console.log(`  ✓ CRM user upserted — id: ${user.id}, role: ${user.role}`);

  console.log('\n✅ Seed complete.');
  console.log(`\n   Login: ${BRANCH_HEAD.email}`);
  console.log(`   Pass:  ${BRANCH_HEAD.password}`);
  console.log('\n   ⚠️  Change the password immediately after first login.\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
