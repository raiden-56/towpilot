/**
 * Secure first-admin bootstrap for a fresh production database.
 *
 *   BOOTSTRAP_ADMIN_PASSWORD='…' npm run bootstrap:admin -- --email owner@company.in --phone 98xxxxxxxx --name "Owner Name"
 *
 * - Refuses to run if any administrator already exists (no backdoor accounts).
 * - Password comes from the environment (never a CLI argument, so it is not in shell history);
 *   if absent, a strong one-time password is generated and printed once.
 * - Syncs roles/permissions first.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { syncCatalogue, syncRoles } from '../lib/reference.js';

const prisma = new PrismaClient();

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.toLowerCase();
  const phoneRaw = arg('phone');
  const name = arg('name');
  if (!email || !phoneRaw || !name) throw new Error('Usage: --email <email> --phone <10-digit mobile> --name "<full name>"');
  const phone = phoneRaw.startsWith('+') ? phoneRaw : `+91${phoneRaw.replace(/\D/g, '').slice(-10)}`;
  if (!/^\+91[6-9]\d{9}$/.test(phone)) throw new Error('Invalid Indian mobile number');

  await syncRoles(prisma);
  await syncCatalogue(prisma);
  const existing = await prisma.user.count({ where: { roles: { some: { role: { key: 'admin' } } } } });
  if (existing > 0) throw new Error('An administrator already exists. Use the admin console to add more staff.');

  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(18).toString('base64url');
    generated = true;
  }
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');

  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'admin' } });
  const user = await prisma.user.create({
    data: {
      fullName: name,
      email,
      phone,
      passwordHash: await bcrypt.hash(password, 12),
      roles: { create: { roleId: role.id } },
      workerProfile: { create: { employeeCode: 'EMP0001', employmentType: 'SALARIED', verificationStatus: 'APPROVED' } },
    },
  });
  await prisma.auditLog.create({ data: { actorUserId: user.id, action: 'bootstrap.first_admin', entityType: 'user', entityId: user.id } });
  console.log(`✔ First administrator created: ${email}`);
  if (generated) console.log(`One-time password (shown once, change it after first login via password reset): ${password}`);
}

main()
  .catch((e) => {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
