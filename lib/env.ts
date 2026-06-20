import { z } from 'zod';

/**
 * Runtime environment validation.
 *
 * Variables are parsed once at module load. In production a missing/invalid value
 * throws — no booting with broken config. In development we warn and continue so
 * a fresh clone can still run `pnpm dev` against partial `.env.local` files.
 *
 * New variables are added by:
 *   1. Adding to `.env.example` with an inline comment.
 *   2. Extending the schema below.
 *   3. Importing the typed value from `env` rather than reading `process.env` directly.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('Theone.pt'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // Custom-calendar rollout flag (Custom Calendar Phase 1). When 'true', the
  // shared calendar page renders the new custom day view instead of
  // react-big-calendar. Default 'false' → rbc stays active for everyone. A
  // per-request `?calendar=custom|rbc` query param overrides this for QA.
  NEXT_PUBLIC_CUSTOM_CALENDAR: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .default('false'),

  // Database (Prompt 2 begins using this)
  DATABASE_URL: z.string().url().optional(),

  // Redis (Prompt 8 begins using this)
  REDIS_URL: z.string().url().optional(),

  // S3 / MinIO (Prompt 6/7 begin using this; Prompt 10 wires direct uploads)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Public base URL the browser hits to render images / videos. Defaults
  // to `${S3_ENDPOINT}/${S3_BUCKET}` for local MinIO; production sets this
  // to a CDN (CloudFront / Cloudflare) so traffic doesn't terminate at
  // S3 directly.
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  // Home-reminder offset window — defaults to 30 minutes ahead of the
  // scheduled exercise time. Patient-facing copy assumes 30 min.
  HOME_REMINDER_OFFSET_MINUTES: z.coerce.number().int().min(1).max(180).default(30),

  // WhatsApp provider (Prompt 8). `console` is the dev default — every send
  // writes a structured payload to stderr and no network IO is performed.
  // `meta` activates the real Meta Cloud API provider and requires the
  // credential block below.
  WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),

  // Meta Cloud API credentials — required when WHATSAPP_PROVIDER=meta. See
  // docs/whatsapp/setup-meta.md for the Business Manager walkthrough.
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  META_WHATSAPP_APP_SECRET: z.string().optional(),

  // Auth (Prompt 4)
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .default('false'),
  OTP_SENDER: z.enum(['console', 'whatsapp']).default('console'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) {
    return parsed.data;
  }

  const formatted = parsed.error.flatten().fieldErrors;
  if (process.env.NODE_ENV === 'production') {
    console.error('[env] invalid environment configuration', formatted);
    throw new Error('Invalid environment configuration — refusing to start.');
  }

  console.warn('[env] environment validation warnings (development mode — continuing):', formatted);
  return envSchema.parse({
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  });
}

export const env: Env = loadEnv();
