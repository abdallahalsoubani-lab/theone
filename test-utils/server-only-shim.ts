// Vitest alias for `server-only`. The real package throws on client
// imports as a guardrail; under tests there's no client/server split
// so this is a harmless empty module.
export {};
