import { z } from 'zod';

import {
  publicAdultSubmissionSchema,
  publicPediatricSubmissionSchema,
} from '@/lib/intake-submissions/schemas';

/**
 * P52 — the tokenized personal-intake submission. Same shape as the public
 * self-service submission (one shared form + schema — no fork), plus the
 * bearer token. The server resolves the patient from the token and IGNORES
 * `profile.fullNameEn` / `profile.phone` entirely: identity is fixed at
 * booking time and can never be overwritten through this payload. Every
 * other profile field (DOB, gender, language, address, email) DOES land on
 * the patient file — that is exactly what the link is for.
 */
export const linkAdultSubmissionSchema = publicAdultSubmissionSchema.extend({
  token: z.string().min(20).max(200),
});
export const linkPediatricSubmissionSchema = publicPediatricSubmissionSchema.extend({
  token: z.string().min(20).max(200),
});

export const linkSubmissionSchema = z.discriminatedUnion('type', [
  linkAdultSubmissionSchema,
  linkPediatricSubmissionSchema,
]);
export type LinkSubmissionInput = z.infer<typeof linkSubmissionSchema>;
