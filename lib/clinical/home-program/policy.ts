import type { HomeProgramStatus } from '@prisma/client';

/**
 * P-2 (Prompt 43) — the submit-button availability rule, extracted pure so
 * the UI and the tests share one truth with the server-side guard in
 * `submitHomeProgram` (which rejects PENDING_APPROVAL / APPROVED): a
 * therapist submits from DRAFT or CHANGES_REQUESTED only. Client-safe — no
 * db import (the panel is a client component).
 */
export function canSubmitHomeProgram(status: HomeProgramStatus): boolean {
  return status === 'DRAFT' || status === 'CHANGES_REQUESTED';
}
