import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { hashPassword } from './password.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(707617291)`;
      if (await tx.adminUser.count() !== 0) throw new Error('An administrator already exists; initialization was not performed');
      await tx.adminUser.create({ data: { username: 'admin', passwordHash } });
    });
    console.log(`Username: admin\nPassword: ${password}\nThis password is shown once. Store it securely.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Failed to create administrator'); process.exitCode = 1; });
