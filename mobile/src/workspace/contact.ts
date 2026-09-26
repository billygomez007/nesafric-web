/**
 * Contact details on an enquiry are free text typed by the enquirer. Offer Call / Email only when
 * the value is plausibly dialable / addressable, so a tap never opens the dialer with junk.
 */
export function usablePhone(value: string | null | undefined) {
  if (!value) return null;
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  const digits = compact.replace(/^\+/, "");
  return digits.length >= 9 && digits.length <= 15 ? compact : null;
}

export function usableEmail(value: string | null | undefined) {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
