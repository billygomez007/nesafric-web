import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { FLOW_KEYS } from "./registry";

/**
 * flow_token: the only identity a Flows data-exchange request carries (Meta does not send the
 * phone number). It is issued by NesAfric when a Flow message is sent and binds the Flow, the
 * WhatsApp address it was sent to, the official organisation and any context the Flow is about
 * (for example the listing being booked). Signed with a key derived from SESSION_SECRET and valid
 * for a limited time. Nothing inside it is trusted beyond "NesAfric sent this Flow to this number":
 * every handler re-checks the account, listing and permissions on each request.
 */
const claimsSchema = z.object({
  v: z.literal(1),
  f: z.enum(FLOW_KEYS),
  a: z.string().regex(/^\+\d{8,15}$/),
  o: z.string().uuid(),
  /** Context ids chosen by NesAfric, never by the person: listing, provider. */
  l: z.string().uuid().optional(),
  p: z.string().uuid().optional(),
  n: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  e: z.number().int(),
});
export type FlowClaims = z.infer<typeof claimsSchema>;

export const FLOW_TOKEN_TTL_MS = 24 * 60 * 60_000;

function signingKey(env: Record<string, string | undefined> = process.env) {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is required to sign WhatsApp Flow tokens.");
  return createHmac("sha256", secret).update("nesafric:whatsapp-flow-token:v1").digest();
}

const sign = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("base64url");

export function issueFlowToken(input: { flow: FlowClaims["f"]; address: string; organisationId: string; listingId?: string; providerId?: string; now?: Date }) {
  const claims: FlowClaims = {
    v: 1, f: input.flow, a: `+${input.address.replace(/^\+/, "")}`, o: input.organisationId,
    ...(input.listingId ? { l: input.listingId } : {}), ...(input.providerId ? { p: input.providerId } : {}),
    n: randomBytes(12).toString("base64url"), e: (input.now ?? new Date()).getTime() + FLOW_TOKEN_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claimsSchema.parse(claims))).toString("base64url");
  return `nf1.${payload}.${sign(payload)}`;
}

/** The verified claims, or null for a forged, altered, expired or foreign token. */
export function verifyFlowToken(token: unknown, now = new Date()): FlowClaims | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [version, payload, signature, extra] = token.split(".");
  if (version !== "nf1" || !payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return claims.e > now.getTime() ? claims : null;
  } catch {
    return null;
  }
}

/**
 * A Flow that finishes on the endpoint (the SUCCESS response) hands its outcome to the chat in
 * the inbound `nfm_reply`. The outcome is signed here, so the chat only acts on outcomes NesAfric
 * itself produced for this flow_token.
 */
export function signOutcome(token: string, outcome: Record<string, string>) {
  return createHmac("sha256", signingKey()).update(`${token}\n${JSON.stringify(Object.entries(outcome).sort())}`).digest("base64url");
}

export function verifyOutcome(token: string, outcome: Record<string, string>, receipt: unknown) {
  if (typeof receipt !== "string") return false;
  const expected = Buffer.from(signOutcome(token, outcome));
  const actual = Buffer.from(receipt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
