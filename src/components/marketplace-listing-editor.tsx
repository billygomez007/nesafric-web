"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MarketplaceListingForm, type EditableMarketplaceListing } from "@/components/marketplace-listing-form";

type LoadedListing = EditableMarketplaceListing & { marketplaceAssetId: string | null };

const EDITABLE = ["DRAFT", "REJECTED", "PAUSED"];

const STATUS_EXPLANATION: Record<string, string> = {
  PENDING_REVIEW: "This listing is waiting for review, so it can't be edited right now. Once it's reviewed you can pause it to make changes.",
  PUBLISHED: "This listing is live on the marketplace. Pause it from the Listings page to make changes, then publish it again.",
  RESERVED: "This listing is reserved and can't be edited.",
  RENTED: "This listing has been let or sold and can't be edited.",
  ARCHIVED: "This listing is archived and can't be edited.",
};

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}

/** Loads a professional's listing and shows the edit form only when the listing can be edited. */
export function MarketplaceListingEditor({ professionalId, listingId }: { professionalId: string; listingId: string }) {
  const [listing, setListing] = useState<LoadedListing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/marketplace-professionals/${professionalId}/listings/${listingId}`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setListing(body);
      else setError(body.error?.message ?? "This listing could not be loaded.");
    }).catch(() => setError("This listing could not be loaded."));
  }, [professionalId, listingId]);

  const back = (
    <Link className="text-sm font-semibold text-forest hover:underline" href={`/pro/${professionalId}/listings`}>
      <span aria-hidden="true">←</span> Back to listings
    </Link>
  );

  if (error) return <div className="grid max-w-3xl gap-4">{back}<Notice message={error} title="Listing unavailable" /></div>;
  if (!listing) return <p className="text-muted" role="status">Loading listing…</p>;

  if (!listing.marketplaceAssetId) {
    return (
      <div className="grid max-w-3xl gap-4">
        {back}
        <Notice message="This listing comes from a managed PropertyOS property. Edit it from that property instead." title="Edit this listing from its property" />
      </div>
    );
  }

  if (!EDITABLE.includes(listing.status)) {
    return (
      <div className="grid max-w-3xl gap-4">
        {back}
        <Notice message={STATUS_EXPLANATION[listing.status] ?? "This listing can't be edited in its current status."} title="This listing can't be edited right now" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {back}
      <MarketplaceListingForm listing={listing} professionalId={professionalId} />
    </div>
  );
}
