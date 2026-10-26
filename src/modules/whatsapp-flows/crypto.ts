import { constants, createCipheriv, createDecipheriv, createHmac, createPrivateKey, privateDecrypt, timingSafeEqual, type KeyObject } from "node:crypto";

/**
 * Meta WhatsApp Flows data-exchange encryption. Each request carries a fresh AES-128 key encrypted
 * with NesAfric's RSA public key (registered on the phone number), the payload encrypted with
 * AES-128-GCM, and an IV. The response is encrypted with the same key and the IV with every bit
 * flipped. A request that cannot be decrypted is answered with HTTP 421, which makes the WhatsApp
 * client fetch the current public key and retry.
 */
export class FlowDecryptionError extends Error {}

export type DecryptedFlowRequest = { body: Record<string, unknown>; aesKey: Buffer; iv: Buffer };

let cachedKey: { pem: string; key: KeyObject } | null = null;

/** WHATSAPP_FLOWS_PRIVATE_KEY (PEM; literal \n accepted) and optional WHATSAPP_FLOWS_PRIVATE_KEY_PASSPHRASE. */
export function flowsPrivateKey(env: Record<string, string | undefined> = process.env): KeyObject | null {
  const pem = env.WHATSAPP_FLOWS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!pem) return null;
  if (cachedKey?.pem === pem) return cachedKey.key;
  const key = createPrivateKey({ key: pem, format: "pem", passphrase: env.WHATSAPP_FLOWS_PRIVATE_KEY_PASSPHRASE || undefined });
  cachedKey = { pem, key };
  return key;
}

export function decryptFlowRequest(payload: unknown, privateKey: KeyObject): DecryptedFlowRequest {
  const { encrypted_aes_key: wrappedKey, encrypted_flow_data: data, initial_vector: vector } = (payload ?? {}) as Record<string, unknown>;
  if (typeof wrappedKey !== "string" || typeof data !== "string" || typeof vector !== "string") throw new FlowDecryptionError("Not an encrypted Flows request.");
  try {
    const aesKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(wrappedKey, "base64"));
    const iv = Buffer.from(vector, "base64");
    const encrypted = Buffer.from(data, "base64");
    if (aesKey.length !== 16 || encrypted.length < 17) throw new Error("bad lengths");
    const decipher = createDecipheriv("aes-128-gcm", aesKey, iv);
    decipher.setAuthTag(encrypted.subarray(-16));
    const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString("utf8");
    const body = JSON.parse(plain) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { body: body as Record<string, unknown>, aesKey, iv };
  } catch {
    throw new FlowDecryptionError("The Flows request could not be decrypted.");
  }
}

export function encryptFlowResponse(response: unknown, aesKey: Buffer, iv: Buffer) {
  const flipped = Buffer.from(iv.map((byte) => ~byte & 0xff));
  const cipher = createCipheriv("aes-128-gcm", aesKey, flipped);
  return Buffer.concat([cipher.update(JSON.stringify(response), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}

/** X-Hub-Signature-256 over the raw body with the Meta app secret. */
export function validFlowSignature(rawBody: string, header: string | null, appSecret: string | undefined) {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const actual = Buffer.from(header.slice(7));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
