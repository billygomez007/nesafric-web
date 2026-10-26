/**
 * WhatsApp admin access for an existing platform principal. Run by an operator with database
 * access; never exposed through WhatsApp or HTTP.
 *
 *   tsx scripts/whatsapp-admin.ts link   --name "Realtegic Properties" --phone +233231582898   (PIN on stdin)
 *   tsx scripts/whatsapp-admin.ts revoke --name "Realtegic Properties"                         (kill switch)
 *
 * `link` connects the WhatsApp number to that principal's account and sets the admin PIN (6 digits,
 * read from stdin, stored hashed). `revoke` clears the PIN and any unlock: WhatsApp admin stops at
 * once for that principal (the number stays linked as an ordinary account).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { db } from "@/platform/database/client";
import { hashPassword } from "@/platform/auth/passwords";
import { whatsappRecipientE164 } from "@/modules/whatsapp-assistant/outbound";
import { recordPlatformAudit } from "@/modules/platform-admin/service";

const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };

async function principalNamed(name: string | undefined) {
  if (!name) throw new Error("--name is required (the account's display name).");
  const matches = await db.platformPrincipal.findMany({ where: { user: { displayName: name } }, include: { user: { select: { id: true, displayName: true } } } });
  if (matches.length !== 1) throw new Error(`Expected exactly one platform principal named "${name}", found ${matches.length}.`);
  const principal = matches[0];
  if (principal.status !== "ACTIVE") throw new Error(`${name} is not an active platform principal.`);
  return principal;
}

async function main() {
  if (command === "link") {
    const principal = await principalNamed(option("name"));
    if (principal.role !== "SUPER_ADMIN") throw new Error(`${principal.user.displayName} is ${principal.role}, not SUPER_ADMIN.`);
    const phone = whatsappRecipientE164(option("phone") ?? "");
    if (!phone) throw new Error("--phone must be a valid WhatsApp number, e.g. +233231582898.");
    const pin = readFileSync(0, "utf8").trim();
    if (!/^\d{6}$/.test(pin) || /^(\d)\1{5}$/.test(pin) || ["123456", "654321", "012345"].includes(pin)) throw new Error("The PIN must be 6 digits and not trivial (no 111111 or 123456).");
    const other = await db.channelIdentity.findUnique({ where: { channel_address: { channel: "WHATSAPP", address: phone } } });
    if (other?.userId && other.userId !== principal.userId) throw new Error(`${phone} is linked to another account; unlink it first.`);
    const pinHash = await hashPassword(pin);
    await db.$transaction(async (tx) => {
      await tx.channelIdentity.upsert({
        where: { channel_address: { channel: "WHATSAPP", address: phone } },
        update: { userId: principal.userId, verifiedAt: new Date(), verificationMethod: "ADMIN" },
        create: { channel: "WHATSAPP", address: phone, userId: principal.userId, verifiedAt: new Date(), verificationMethod: "ADMIN" },
      });
      await tx.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappPinHash: pinHash, whatsappPinFailures: 0, whatsappPinLockedUntil: null, whatsappUnlockedUntil: null } });
    });
    await recordPlatformAudit(principal, "platform_admin.whatsapp_admin_linked", "platform_principal", principal.id, undefined, { phoneLast4: phone.slice(-4) });
    console.log(`Linked ${phone.slice(0, 4)}…${phone.slice(-4)} to ${principal.user.displayName} (SUPER_ADMIN) and set the WhatsApp admin PIN.`);
    return;
  }
  if (command === "revoke") {
    const principal = await principalNamed(option("name"));
    await db.platformPrincipal.update({ where: { id: principal.id }, data: { whatsappPinHash: null, whatsappPinFailures: 0, whatsappPinLockedUntil: null, whatsappUnlockedUntil: null } });
    await recordPlatformAudit(principal, "platform_admin.whatsapp_admin_revoked", "platform_principal", principal.id);
    console.log(`WhatsApp admin is off for ${principal.user.displayName}.`);
    return;
  }
  throw new Error("Usage: whatsapp-admin.ts link --name <display name> --phone <number>  |  revoke --name <display name>");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
