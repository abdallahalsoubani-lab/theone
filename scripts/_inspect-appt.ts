import { db } from '@/lib/db';

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('pass appointmentId');
  const appt = await db.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      startsAt: true,
      status: true,
      patientId: true,
      therapists: { select: { therapistId: true } },
    },
  });
  console.log('APPT:', JSON.stringify(appt, null, 2));
  const msgs = await db.whatsAppMessage.findMany({
    where: { appointmentId: id },
    orderBy: { sentAt: 'asc' },
    select: {
      id: true,
      status: true,
      providerMessageId: true,
      failureReason: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      body: true,
      direction: true,
      templateId: true,
      recipientPhone: true,
    },
  });
  console.log('MESSAGES FOR APPT:', JSON.stringify(msgs, null, 2));
  await db.$disconnect();
}

main();
