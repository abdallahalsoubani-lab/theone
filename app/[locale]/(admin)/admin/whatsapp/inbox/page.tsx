/**
 * Admin mirror of the WhatsApp Inbox (P64 #12b). The page body lives at
 * /secretary/whatsapp (Prompt 49, SECRETARY + ADMIN); this route renders the
 * SAME page inside the admin shell so the owner reaches it from the admin
 * sidebar. All in-page navigation is query-string relative (`?c=…`), so it
 * stays on this route.
 */
export const dynamic = 'force-dynamic';

export { default } from '@/app/[locale]/(staff)/secretary/whatsapp/page';
