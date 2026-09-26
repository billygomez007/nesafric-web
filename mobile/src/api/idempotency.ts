import { randomUUID } from "expo-crypto";

/**
 * `Idempotency-Key` for guest form submissions. Reused only while the submitted payload is
 * identical (a retry after a timeout or an unclear network failure); any change to the form
 * contents mints a new key, because the server rejects a key reused for a different submission.
 */
export type IdempotencySlot = { body: string; key: string } | null;

export function idempotencyKeyFor(slot: { current: IdempotencySlot }, payload: unknown) {
  const body = JSON.stringify(payload);
  if (slot.current?.body !== body) slot.current = { body, key: randomUUID() };
  return slot.current.key;
}
