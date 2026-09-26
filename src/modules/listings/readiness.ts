/** A reason a listing is not ready to go to NesAfric review, phrased for the person fixing it. */
export type ListingReadinessProblem = { field: string; message: string };

type Amount = { toString(): string } | string | number | null | undefined;

/**
 * What a listing still needs before it can be reviewed (and therefore published). Pure so the
 * professional's listings page, the "Submit for review" action and the platform review screen all
 * apply the same rules. Publication-only rules (verification, asset availability, duplicate active
 * listing) stay in the listing service's `ensurePublicationReady`.
 */
export function listingReadinessProblems(listing: {
  title: string; publicDescription?: string | null; listingType: string;
  askingAmountMinor?: Amount; rentAmountMinor?: Amount;
  city?: string | null; locality?: string | null; publicLocationLabel?: string | null;
  media?: Array<{ type: string }>;
}): ListingReadinessProblem[] {
  const problems: ListingReadinessProblem[] = [];
  if (!(listing.media ?? []).some(({ type }) => type === "PHOTO")) problems.push({ field: "media", message: "Add at least one photo." });
  if (!listing.title.trim()) problems.push({ field: "title", message: "Add a title." });
  if (!listing.publicDescription?.trim()) problems.push({ field: "publicDescription", message: "Add a description." });
  const price = listing.listingType === "RENT" ? listing.rentAmountMinor : listing.askingAmountMinor;
  if (price == null || !(Number(price.toString()) > 0)) problems.push({ field: "price", message: listing.listingType === "RENT" ? "Add the rent." : "Add the asking price." });
  if (![listing.city, listing.locality, listing.publicLocationLabel].some((value) => value?.trim())) problems.push({ field: "location", message: "Add the property's location." });
  return problems;
}
