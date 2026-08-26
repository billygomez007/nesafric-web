import "dotenv/config";

// Deterministic, credential-free defaults for the automated test suite: the in-memory storage
// adapter avoids disk I/O and cross-run cleanup, and every other Phase 19 provider-neutral
// adapter already falls back to its deterministic/internal mode when its env vars are unset.
process.env.STORAGE_PROVIDER ??= "memory";
