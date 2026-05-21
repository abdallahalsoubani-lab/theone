// Server-only barrel. Modules that need impersonation state in *Edge*
// runtime code (middleware, edge handlers) MUST import directly from
// './token' — that file is jose-only and bundles cleanly for Edge.
export { readImpersonationCookie } from './cookie';
export type { EffectiveSession, EffectiveUser } from './session';
export { getEffectiveSession } from './session';
export type { ImpersonationClaims } from './token';
export { IMPERSONATION_COOKIE, IMPERSONATION_TTL_SECONDS, verifyImpersonationToken } from './token';
