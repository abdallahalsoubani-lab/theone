import type { LocalizedError } from '@/lib/db';

/** Intake service failure carrying a localized error (re-exported by ./services). */
export class IntakeError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'IntakeError';
  }
}
