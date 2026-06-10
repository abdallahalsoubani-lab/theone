import { db } from '@/lib/db';

async function main() {
  const u = await db.user.findFirst({
    where: { email: 'sara.k@example.com' },
    select: {
      id: true,
      phone: true,
      whatsappReachable: true,
      whatsappLastFailureReason: true,
      whatsappLastFailureAt: true,
      languagePref: true,
      fullNameEn: true,
      fullNameAr: true,
    },
  });
  console.log('SARA:', JSON.stringify(u, null, 2));
  if (!u) return;
  const recent = await db.whatsAppMessage.findMany({
    where: { recipientId: u.id },
    orderBy: { sentAt: 'desc' },
    take: 5,
    select: {
      id: true,
      status: true,
      providerMessageId: true,
      failureReason: true,
      sentAt: true,
      body: true,
      appointmentId: true,
    },
  });
  console.log('RECENT WA MESSAGES:', JSON.stringify(recent, null, 2));
  await db.$disconnect();
}

main();
