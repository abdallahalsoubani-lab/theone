import { db } from '@/lib/db';

async function main() {
  const users = await db.user.findMany({
    where: { deletedAt: null },
    orderBy: [{ role: 'asc' }, { email: 'asc' }],
    select: {
      email: true,
      role: true,
      fullNameEn: true,
      fullNameAr: true,
      passwordHash: true,
    },
  });
  for (const u of users) {
    console.log(
      `${u.role.padEnd(10)} ${(u.email ?? '(no email)').padEnd(32)} ${u.fullNameEn.padEnd(22)} pw=${u.passwordHash ? 'set' : 'NULL'}`,
    );
  }
  await db.$disconnect();
}

main();
