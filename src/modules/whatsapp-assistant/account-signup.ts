/**
 * Creating a NesAfric account inside WhatsApp, the moment an option needs one (listing, business
 * registration, applications). The account is created for this WhatsApp number, which Meta
 * attests, so no password, website or code is needed; then the chosen option continues.
 */
export const ACCOUNT_NAME_PROMPT = "To continue, I'll create your free NesAfric account right here. It takes a few seconds and uses this WhatsApp number to sign in, so there is no password and no website.\n\nWhat is your full name?";

export const ACCOUNT_IN_USE = "This WhatsApp number already belongs to a NesAfric account. Reply link to connect it with a one-time code, then choose the option again.";

export const accountReady = (displayName: string) => `✅ Your NesAfric account is ready, ${displayName.trim().split(/\s+/)[0]}. This WhatsApp number is your sign-in.`;

export function validAccountName(body: string) {
  const name = body.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 100 && /\p{L}/u.test(name) && !/https?:\/\/|@|\d{6,}/.test(name) ? name : null;
}
