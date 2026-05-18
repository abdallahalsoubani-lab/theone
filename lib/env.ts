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

  // Database (Prompt 2 begins using this)
  DATABASE_URL: z.string().url().optional(),

  // Redis (Prompt 8 begins using this)
  REDIS_URL: z.string().url().optional(),

  // S3 / MinIO (Prompt 6/7 begin using this)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // WhatsApp provider (Prompt 8). `console` is the dev default — every send
  // writes a structured payload to stderr and no network IO is performed.
  // `twilio` and `meta` activate the real provider implementations and
  // require the matching credential block below.
  WHATSAPP_PROVIDER: z.enum(['console', 'twilio', 'meta']).default('console'),

  // Twilio credentials — required when WHATSAPP_PROVIDER=twilio. The
  // sandbox sender is shared (+14155238886); production accounts use a
  // dedicated Twilio WhatsApp number. See docs/whatsapp/setup-twilio.md.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  // Meta Cloud API credentials — required when WHATSAPP_PROVIDER=meta. See
  // docs/whatsapp/setup-meta.md for the Business Manager walkthrough.
  META_WHATSAPP_PHONE_ID: z.string().optional(),
  META_WHATSAPP_TOKEN: z.string().optional(),
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
