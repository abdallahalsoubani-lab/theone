import { redirect } from 'next/navigation';

import { auth } from '@/auth';

import { RolePlaceholder } from '../../../_role-placeholder/RolePlaceholder';

export default async function SecretaryCalendar({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  return <RolePlaceholder name={session.user.fullNameEn} ownedBy="Prompt 7 (Calendar)" />;
}
