/**
 * Human-friendly references derived from real record ids: `NES-PR-1A2B3C4D` is the first eight hex
 * digits of a listing's UUID. Nothing is generated that does not exist — every reference maps back
 * to exactly one stored record, and lookups are always scoped to the requester's own records.
 */
export const REFERENCE_KINDS = {
  PR: "Property listing",
  AG: "Business registration",
  SV: "Service provider registration",
  IQ: "Property inquiry",
  VW: "Viewing request",
  QT: "Service request",
  SP: "Support request",
} as const;

export type ReferenceKind = keyof typeof REFERENCE_KINDS;

export function referenceFor(kind: ReferenceKind, id: string) {
  return `NES-${kind}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function parseReference(raw: string): { kind: ReferenceKind; prefix: string } | null {
  const match = raw.toUpperCase().match(/\bNES-(PR|AG|SV|IQ|VW|QT|SP)-([0-9A-F]{8})\b/);
  if (!match) return null;
  return { kind: match[1] as ReferenceKind, prefix: match[2].toLowerCase() };
}

/** Whether a UUID is the record a reference names. */
export function matchesReference(id: string, prefix: string) {
  return id.replace(/-/g, "").toLowerCase().startsWith(prefix.toLowerCase());
}
