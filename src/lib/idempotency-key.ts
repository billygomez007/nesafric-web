/**
 * Client-side `Idempotency-Key` for public form submissions. The key is reused only while the
 * submitted body is identical (a retry after a timeout or a double click); any change to the form
 * contents mints a new key, because the server rejects a key reused for a different submission.
 */
export type IdempotencySlot = { body: string; key: string } | null;

function randomKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function idempotencyKeyFor(slot: { current: IdempotencySlot }, body: string) {
  if (slot.current?.body !== body) slot.current = { body, key: randomKey() };
  return slot.current.key;
}
