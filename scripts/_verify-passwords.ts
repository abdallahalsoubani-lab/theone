import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';

const ATTEMPTS: Array<[string, string]> = [
  ['admin@theone.pt', 'Admin@123'],
  ['dr.sara@theone.pt', 'Doctor@123'],
  ['reception@theone.pt', 'Reception@123'],
  ['ahmad@theone.pt', 'Therapist@123'],
  ['layan@theone.pt', 'Therapist@123'],
  ['omar@theone.pt', 'Therapist@123'],
  ['sara.k@example.com', 'Patient@123'],
];

async function main() {
  for (const [email, password] of ATTEMPTS) {
    const u = await db.user.findFirst({
      where: { email },
      select: { passwordHash: true },
    });
    if (!u?.passwordHash) {
      console.log(`${email.padEnd(28)} → NO HASH`);
      continue;
    }
    const ok = await bcrypt.compare(password, u.passwordHash);
    console.log(`${email.padEnd(28)} → ${ok ? 'OK   ' : 'WRONG'}  (${password})`);
  }
  await db.$disconnect();
}

main();
