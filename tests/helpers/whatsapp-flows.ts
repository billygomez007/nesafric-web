import { createCipheriv, createDecipheriv, createHmac, generateKeyPairSync, publicEncrypt, constants, randomBytes } from "node:crypto";

/** An RSA key pair like the one registered with Meta for Flows. */
export function flowsKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  return { privateKey, publicKey };
}

/**
 * Plays the WhatsApp client: encrypts a data-exchange request to NesAfric's public key, signs it
 * with the app secret, and decrypts the endpoint's answer.
 */
export function flowsClient(publicKey: string, appSecret: string) {
  return {
    request(body: Record<string, unknown>) {
      const aesKey = randomBytes(16);
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final(), cipher.getAuthTag()]);
      const raw = JSON.stringify({
        encrypted_aes_key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey).toString("base64"),
        encrypted_flow_data: encrypted.toString("base64"),
        initial_vector: iv.toString("base64"),
      });
      const signature = `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;
      const decrypt = (base64: string) => {
        const data = Buffer.from(base64, "base64");
        const decipher = createDecipheriv("aes-128-gcm", aesKey, Buffer.from(iv.map((byte) => ~byte & 0xff)));
        decipher.setAuthTag(data.subarray(-16));
        return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString("utf8")) as { screen?: string; data: Record<string, unknown> };
      };
      return { raw, signature, decrypt };
    },
  };
}
