"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readApiResponse } from "@/lib/api-response";
import {
  describeUploadOutcome,
  type ListingImageUploadResult,
  MAX_LISTING_IMAGES,
  partitionSelectedImages,
  releaseSelectedImage,
  type SelectedListingImage,
  uploadListingImagePhotos,
} from "@/lib/listing-image-upload";
import { formatMegabytes, MAX_LISTING_PHOTO_SOURCE_BYTES } from "@/lib/listing-media-rules";


const PROPERTY_TYPES = [
  ["APARTMENT", "Apartment"],
  ["HOUSE", "House"],
  ["TOWNHOUSE", "Townhouse"],
  ["VILLA", "Villa"],
  ["LAND", "Land"],
  ["OFFICE", "Office"],
  ["SHOP", "Shop / Retail"],
  ["WAREHOUSE", "Warehouse"],
  ["COMMERCIAL", "Commercial space"],
  ["GUEST_HOUSE", "Guest house"],
] as const;

const AMENITIES = [
  "Air conditioning",
  "Swimming pool",
  "Security service",
  "CCTV",
  "Gated community",
  "Parking",
  "Garage",
  "Generator",
  "Backup power",
  "Water reservoir",
  "Borehole",
  "Garden",
  "Balcony",
  "Roof terrace",
  "Boys quarters",
  "Internet",
  "DSTV / Satellite TV",
  "Fitted kitchen",
  "Cooker",
  "Refrigerator",
  "Microwave",
  "Washing machine",
  "Elevator",
  "Gym",
  "Playground",
  "Pet friendly",
] as const;

/** The subset of GET /api/marketplace-professionals/[id]/listings/[listingId] the edit form uses. */
export type EditableMarketplaceListing = {
  id: string;
  status: string;
  listingType: string;
  category: string;
  title: string;
  publicDescription: string;
  askingAmountMinor: string | null;
  rentAmountMinor: string | null;
  frequency: string | null;
  availableFrom: string;
  bedrooms: number | null;
  bathrooms: string | number | null;
  toilets: number | null;
  sizeSqm: string | number | null;
  landSizeSqm: string | number | null;
  parkingSpaces: number | null;
  furnishing: string | null;
  propertyCondition: string | null;
  negotiable: boolean;
  yearBuilt: number | null;
  region: string | null;
  city: string | null;
  district: string | null;
  locality: string | null;
  publicLocationLabel: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  showContactEmail: boolean;
  showContactPhone: boolean;
  listingAuthority: string | null;
  amenities: { label: string }[];
  media: { id: string; type: string; publicUrl: string; isCover: boolean; altText: string | null }[];
  marketplaceAsset: { authorityEvidenceReady: boolean; developmentUnitId: string | null } | null;
};

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

export function MarketplaceListingForm({
  professionalId,
  listing: existing,
}: {
  professionalId: string;
  /** When present the form edits this listing in place instead of creating a new one. */
  listing?: EditableMarketplaceListing;
}) {
  const router = useRouter();
  const editing = Boolean(existing);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState(existing?.category ?? "APARTMENT");
  const [purpose, setPurpose] = useState(existing?.listingType ?? "RENT");
  const [images, setImages] = useState<SelectedListingImage[]>([]);
  const [existingMedia, setExistingMedia] = useState(existing?.media ?? []);
  const [mediaBusy, setMediaBusy] = useState(false);
  // The listing this form writes to. Set once the draft exists, so a retry or a second save
  // updates that same listing — never a duplicate.
  const [listingId, setListingId] = useState<string | null>(existing?.id ?? null);
  const [uploadState, setUploadState] = useState<Record<string, { status: "uploading" | "failed"; message?: string }>>({});
  const [uploadNotice, setUploadNotice] = useState("");
  // A cover chosen among photos not uploaded yet; applied once that photo is uploaded.
  const [pendingCoverKey, setPendingCoverKey] = useState<string | null>(null);
  const [amenities, setAmenities] = useState<string[]>(existing?.amenities.map((amenity) => amenity.label) ?? []);
  const totalImages = existingMedia.length + images.length;
  const existingPrice = existing ? existing.rentAmountMinor ?? existing.askingAmountMinor : null;

  const isResidential = useMemo(
    () =>
      ["APARTMENT", "HOUSE", "TOWNHOUSE", "VILLA", "GUEST_HOUSE"].includes(
        category,
      ),
    [category],
  );

  const isLand = category === "LAND";

  function toggleAmenity(amenity: string) {
    setAmenities((current) =>
      current.includes(amenity)
        ? current.filter((value) => value !== amenity)
        : [...current, amenity],
    );
  }


  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const remaining = MAX_LISTING_IMAGES - existingMedia.length - images.length;

    if (remaining <= 0) {
      setError(`A property can contain up to ${MAX_LISTING_IMAGES} images.`);
      return;
    }

    // Every acceptable photo is kept; each unacceptable one is named with its reason.
    const { accepted, rejected } = partitionSelectedImages(files);
    const kept = accepted.slice(0, remaining);
    accepted.slice(remaining).forEach(releaseSelectedImage);
    setImages((current) => [...current, ...kept]);
    const problems = [...rejected];
    if (accepted.length > remaining) {
      problems.push(`Only ${remaining} more image${remaining === 1 ? "" : "s"} could be added. Maximum is ${MAX_LISTING_IMAGES}.`);
    }
    setError(problems.join(" "));
  }

  function removeImage(key: string) {
    setImages((current) => {
      const selected = current.find((image) => image.key === key);
      if (selected) releaseSelectedImage(selected);
      return current.filter((image) => image.key !== key);
    });
    setUploadState(({ [key]: _removed, ...rest }) => rest);
    if (pendingCoverKey === key) setPendingCoverKey(null);
  }

  async function refreshExistingMedia(id: string) {
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings/${id}`);
    const result = await readApiResponse<{ media?: EditableMarketplaceListing["media"] }>(response, "Unable to load photos.");
    if (result.ok && result.data?.media) setExistingMedia(result.data.media);
  }

  /**
   * Uploads photos to the listing one at a time. Successful photos move into "Current photos"
   * straight away; failed ones stay listed with their reason so they can be retried alone.
   * Returns the per-photo results.
   */
  async function uploadPending(id: string, pending: SelectedListingImage[], title: string) {
    setUploadState((current) => ({ ...current, ...Object.fromEntries(pending.map((image) => [image.key, { status: "uploading" as const }])) }));
    const results = await uploadListingImagePhotos({
      listingId: id,
      professionalId,
      title,
      images: pending,
      firstPosition: existingMedia.length + 1,
      onResult: (result) => {
        if (result.ok) {
          setImages((current) => current.filter((image) => {
            if (image.key !== result.key) return true;
            releaseSelectedImage(image);
            return false;
          }));
          setUploadState(({ [result.key]: _done, ...rest }) => rest);
        } else {
          setUploadState((current) => ({ ...current, [result.key]: { status: "failed", message: result.message } }));
        }
      },
    });
    await applyPendingCover(id, results);
    await refreshExistingMedia(id);
    return results;
  }

  async function applyPendingCover(id: string, results: ListingImageUploadResult[]) {
    if (!pendingCoverKey) return;
    const chosen = results.find((result) => result.key === pendingCoverKey);
    if (!chosen) return;
    if (!chosen.ok || !chosen.media) {
      setUploadNotice("The photo you chose as the cover didn't upload, so the first uploaded photo is the cover for now. Retry it, then choose it again.");
      return;
    }
    const response = await fetch(`/api/marketplace-professionals/${professionalId}/listings/${id}/media/${chosen.media.id}/cover`, { method: "POST" });
    const result = await readApiResponse(response, "Unable to set the cover photo.");
    if (!result.ok) setUploadNotice(result.message ?? "Unable to set the cover photo.");
    setPendingCoverKey(null);
  }

  async function retryFailedPhotos() {
    if (!listingId) return;
    const failed = images.filter((image) => uploadState[image.key]?.status === "failed");
    if (!failed.length) return;
    setBusy(true);
    setError("");
    setUploadNotice("");
    const results = await uploadPending(listingId, failed, existing?.title ?? "Property");
    setBusy(false);
    const outcome = describeUploadOutcome(results, "saved");
    setUploadNotice(outcome ? outcome.replace("Your changes were saved, but", "Still") : "All photos are uploaded.");
  }

  async function changeExistingMedia(mediaId: string, action: "remove" | "cover") {
    if (!listingId) return;
    setMediaBusy(true);
    setError("");
    const base = `/api/marketplace-professionals/${professionalId}/listings/${listingId}/media/${mediaId}`;
    const response = await fetch(action === "remove" ? base : `${base}/cover`, { method: action === "remove" ? "DELETE" : "POST" });
    const result = await readApiResponse<{ media?: EditableMarketplaceListing["media"] }>(response, "Unable to update photos.");
    setMediaBusy(false);
    if (!result.ok) {
      setError(result.message ?? "Unable to update photos.");
      return;
    }
    // Choosing an uploaded photo replaces any cover picked among photos not uploaded yet.
    if (action === "cover") setPendingCoverKey(null);
    setExistingMedia(result.data?.media ?? []);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const form = new FormData(event.currentTarget);

    const title = String(form.get("title"));
    const priceMinor = String(
      Math.round(Number(form.get("price") || 0) * 100),
    );

    if (!totalImages) {
      setBusy(false);
      setError("Add at least one property image.");
      return;
    }

    const numberOrNull = (name: string) => {
      const value = String(form.get(name) ?? "").trim();
      return value ? Number(value) : null;
    };

    const textOrNull = (name: string) => {
      const value = String(form.get(name) ?? "").trim();
      return value || null;
    };

    const availableFrom = String(form.get("availableFrom"));

    const listing = {
      listingType: purpose,
      category,
      title,
      publicDescription: String(form.get("description")),
      currencyCode: "GHS",

      askingAmountMinor: purpose === "SALE" ? priceMinor : null,
      rentAmountMinor: purpose === "RENT" ? priceMinor : null,
      frequency:
        purpose === "RENT"
          ? String(form.get("frequency") || "MONTHLY")
          : null,

      availableFrom,

      bedrooms: isResidential ? numberOrNull("bedrooms") : null,
      bathrooms: isResidential ? numberOrNull("bathrooms") : null,
      toilets: isResidential ? numberOrNull("toilets") : null,

      sizeSqm: !isLand ? numberOrNull("sizeSqm") : null,
      landSizeSqm: numberOrNull("landSizeSqm"),

      parkingSpaces: numberOrNull("parkingSpaces"),

      furnishing:
        isResidential || ["OFFICE", "SHOP", "COMMERCIAL"].includes(category)
          ? textOrNull("furnishing")
          : null,

      propertyCondition: !isLand
        ? textOrNull("propertyCondition")
        : null,

      negotiable: form.get("negotiable") === "on",
      yearBuilt: !isLand ? numberOrNull("yearBuilt") : null,

      countryCode: "GH",
      region: textOrNull("region"),
      city: textOrNull("city"),
      district: textOrNull("district"),
      locality: textOrNull("locality"),
      publicLocationLabel: textOrNull("publicLocationLabel"),

      contactName: textOrNull("contactName"),
      contactEmail: textOrNull("contactEmail"),
      contactPhone: textOrNull("contactPhone"),
      showContactEmail: form.get("showContactEmail") === "on",
      showContactPhone: form.get("showContactPhone") === "on",
      enquiryEnabled: true,

      amenities: amenities.map((label) => ({
        key: label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        label,
      })),

      media: [],
    };

    const body = {
      asset: {
        name: title,
        category,
        purpose,
        currencyCode: "GHS",
        priceMinor,
        countryCode: "GH",
        region: textOrNull("region"),
        city: textOrNull("city"),
        district: textOrNull("district"),
        locality: textOrNull("locality"),
        publicLocationLabel: textOrNull("publicLocationLabel"),
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        sizeSqm: listing.sizeSqm,
        amenities,
        furnishing: listing.furnishing,
        mediaUrls: [],
        availableFrom,
        authorityEvidenceReady:
          form.get("authorityEvidenceReady") === "on",
        ...(form.get("developmentUnitId")
          ? {
              developmentUnitId: String(form.get("developmentUnitId")),
            }
          : {}),
      },

      listing,

      listingAuthority: String(form.get("listingAuthority")),
    };

    // Once the draft exists (editing, or created by an earlier attempt), save onto it.
    const target = listingId;
    if (target) {
      // The development unit is fixed once a listing exists.
      delete (body.asset as { developmentUnitId?: string }).developmentUnitId;
    }

    setUploadNotice("");
    const response = await fetch(
      target
        ? `/api/marketplace-professionals/${professionalId}/listings/${target}/details`
        : `/api/marketplace-professionals/${professionalId}/listings`,
      {
        method: target ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const result = await readApiResponse<{ id: string }>(response, target ? "Unable to save changes." : "Unable to create listing.");

    if (!result.ok || !result.data?.id) {
      setBusy(false);
      setError(result.message ?? (target ? "Unable to save changes." : "Unable to create listing."));
      return;
    }

    const savedId = result.data.id;
    const created = !target;
    setListingId(savedId);

    if (images.length) {
      const results = await uploadPending(savedId, images, title);
      const outcome = describeUploadOutcome(results, created && !editing ? "created" : "saved");
      if (outcome) {
        // Nothing is lost: the draft and every uploaded photo are kept; only the failed photos
        // stay here to retry — and saving again updates this same draft.
        setBusy(false);
        setUploadNotice(`${outcome} The failed photos are listed below — retry them, or remove them and continue.`);
        return;
      }
    }

    setBusy(false);
    router.push(`/pro/${professionalId}/listings`);
    router.refresh();
  }

  const input =
    "mt-1 w-full rounded-xl border border-hairline bg-white px-3 py-2.5 text-sm";

  return (
    <form className="grid max-w-4xl gap-6" onSubmit={submit}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Marketplace inventory
        </p>
        <h1 className="mt-1 text-3xl font-semibold">
          {editing ? "Edit property" : "Add a property"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {editing
            ? "Update the property details and photos. Changes are saved to this listing; it keeps its current status."
            : "Complete the property information below. You can save the listing as a draft before submitting it for publication."}
        </p>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-hairline bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          1. Property basics
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Property title
            <input
              className={input}
              name="title"
              defaultValue={text(existing?.title)}
              placeholder="Luxury 4 bedroom house at East Legon"
              required
            />
          </label>

          <label className="text-sm font-medium">
            Property type
            <select
              className={input}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {PROPERTY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium">
            Listing purpose
            <select
              className={input}
              name="purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            >
              <option value="RENT">For rent</option>
              <option value="SALE">For sale</option>
            </select>
          </label>

          <label className="text-sm font-medium sm:col-span-2">
            Property description
            <textarea
              className={input}
              minLength={20}
              name="description"
              defaultValue={text(existing?.publicDescription)}
              placeholder="Describe the property, its location, condition and standout features..."
              required
              rows={6}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          2. Location
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium">
            Country
            <input className={input} value="Ghana" disabled />
          </label>

          <label className="text-sm font-medium">
            Region
            <input
              className={input}
              name="region"
              defaultValue={text(existing?.region)}
              placeholder="Greater Accra"
            />
          </label>

          <label className="text-sm font-medium">
            City
            <input
              className={input}
              name="city"
              defaultValue={text(existing?.city)}
              placeholder="Accra"
              required
            />
          </label>

          <label className="text-sm font-medium">
            District
            <input
              className={input}
              name="district"
              defaultValue={text(existing?.district)}
              placeholder="Ayawaso West"
            />
          </label>

          <label className="text-sm font-medium">
            Locality / neighbourhood
            <input
              className={input}
              name="locality"
              defaultValue={text(existing?.locality)}
              placeholder="East Legon"
            />
          </label>

          <label className="text-sm font-medium">
            Public location
            <input
              className={input}
              name="publicLocationLabel"
              defaultValue={text(existing?.publicLocationLabel)}
              placeholder="East Legon, Accra"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          3. Property details
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isResidential && (
            <>
              <label className="text-sm font-medium">
                Bedrooms
                <input
                  className={input}
                  min="0"
                  name="bedrooms"
              defaultValue={text(existing?.bedrooms)}
                  type="number"
                />
              </label>

              <label className="text-sm font-medium">
                Bathrooms
                <input
                  className={input}
                  min="0"
                  name="bathrooms"
              defaultValue={text(existing?.bathrooms == null ? null : Number(existing.bathrooms))}
                  step="0.5"
                  type="number"
                />
              </label>

              <label className="text-sm font-medium">
                Toilets / washrooms
                <input
                  className={input}
                  min="0"
                  name="toilets"
              defaultValue={text(existing?.toilets)}
                  type="number"
                />
              </label>
            </>
          )}

          {!isLand && (
            <label className="text-sm font-medium">
              Building / floor size (m²)
              <input
                className={input}
                min="1"
                name="sizeSqm"
              defaultValue={text(existing?.sizeSqm == null ? null : Number(existing.sizeSqm))}
                type="number"
              />
            </label>
          )}

          <label className="text-sm font-medium">
            Land size (m²)
            <input
              className={input}
              min="1"
              name="landSizeSqm"
              defaultValue={text(existing?.landSizeSqm == null ? null : Number(existing.landSizeSqm))}
              type="number"
            />
          </label>

          <label className="text-sm font-medium">
            Parking spaces
            <input
              className={input}
              min="0"
              name="parkingSpaces"
              defaultValue={text(existing?.parkingSpaces)}
              type="number"
            />
          </label>

          {!isLand && (
            <>
              <label className="text-sm font-medium">
                Property condition
                <select className={input} defaultValue={text(existing?.propertyCondition)} name="propertyCondition">
                  <option value="">Select condition</option>
                  <option value="NEW">New</option>
                  <option value="NEWLY_RENOVATED">
                    Newly renovated
                  </option>
                  <option value="EXCELLENT">Excellent</option>
                  <option value="GOOD">Good</option>
                  <option value="NEEDS_RENOVATION">
                    Needs renovation
                  </option>
                </select>
              </label>

              <label className="text-sm font-medium">
                Year built
                <input
                  className={input}
                  min="1800"
                  max="2200"
                  name="yearBuilt"
              defaultValue={text(existing?.yearBuilt)}
                  type="number"
                />
              </label>
            </>
          )}

          {!isLand && (
            <label className="text-sm font-medium">
              Furnishing
              <select className={input} defaultValue={text(existing?.furnishing)} name="furnishing">
                <option value="">Select furnishing</option>
                <option value="FURNISHED">Furnished</option>
                <option value="SEMI_FURNISHED">
                  Semi-furnished
                </option>
                <option value="UNFURNISHED">Unfurnished</option>
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          4. Amenities
        </p>

        <p className="mt-2 text-sm text-muted">
          Select all features available at this property.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {AMENITIES.map((amenity) => (
            <label
              key={amenity}
              className="flex items-center gap-3 rounded-xl border border-hairline p-3 text-sm"
            >
              <input
                checked={amenities.includes(amenity)}
                onChange={() => toggleAmenity(amenity)}
                type="checkbox"
              />
              {amenity}
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              5. Property photos
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              Upload up to 12 photos
            </h2>
            <p className="mt-1 text-sm text-muted">
              Choose photos directly from your phone or computer. The photo marked
              COVER is the listing&apos;s main image everywhere on NesAfric — choose any photo.
            </p>
          </div>

          <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold">
            {totalImages}/{MAX_LISTING_IMAGES}
          </span>
        </div>

        <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-hairline bg-surface/40 px-6 py-10 text-center transition hover:bg-surface">
          <span className="text-base font-semibold">
            Click to upload property photos
          </span>

          <span className="mt-1 text-sm text-muted">
            JPG, PNG or WebP · up to {formatMegabytes(MAX_LISTING_PHOTO_SOURCE_BYTES)} each · large photos are resized automatically
          </span>

          <span className="mt-3 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white">
            Choose photos
          </span>

          <input
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={totalImages >= MAX_LISTING_IMAGES}
            multiple
            onChange={addImages}
            type="file"
          />
        </label>

        {uploadNotice && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
            <p>{uploadNotice}</p>
            {listingId && images.some((image) => uploadState[image.key]?.status === "failed") && (
              <button className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white disabled:bg-surface disabled:text-muted" disabled={busy} onClick={() => void retryFailedPhotos()} type="button">
                {busy ? "Retrying…" : "Retry failed photos"}
              </button>
            )}
          </div>
        )}

        {existingMedia.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-semibold">Current photos</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {existingMedia.map((media, index) => {
                const isCover = media.isCover && !pendingCoverKey;
                return (
                  <div className={`overflow-hidden rounded-xl border bg-white ${isCover ? "border-forest ring-2 ring-forest/30" : "border-hairline"}`} key={media.id}>
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element -- listing photos are served from the storage provider's public URL */}
                      <img alt={media.altText ?? `Property photo ${index + 1}`} className="h-44 w-full object-cover" src={media.publicUrl} />
                      {isCover && <CoverBadge />}
                    </div>
                    <div className="flex items-center justify-between gap-3 p-3">
                      <p className="truncate text-xs font-semibold">{isCover ? "Cover photo" : `Photo ${index + 1}`}</p>
                      <div className="flex shrink-0 gap-3">
                        {!isCover && media.type === "PHOTO" && (
                          <button className="text-xs font-semibold text-forest disabled:text-muted" disabled={mediaBusy || busy} onClick={() => void changeExistingMedia(media.id, "cover")} type="button">
                            Set as cover
                          </button>
                        )}
                        <button className="text-xs font-semibold text-red-700 disabled:text-muted" disabled={mediaBusy || busy} onClick={() => void changeExistingMedia(media.id, "remove")} type="button">
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {images.length > 0 && <p className="mt-5 text-sm font-semibold">New photos to upload</p>}
          </div>
        )}

        {images.length > 0 && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => {
              const state = uploadState[image.key];
              // Until one is chosen, the first new photo is the cover only when none exists yet.
              const isCover = pendingCoverKey ? pendingCoverKey === image.key : index === 0 && !existingMedia.some((media) => media.isCover);
              return (
                <div
                  key={image.key}
                  className={`overflow-hidden rounded-xl border bg-white ${state?.status === "failed" ? "border-red-300" : isCover ? "border-forest ring-2 ring-forest/30" : "border-hairline"}`}
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={`Property preview ${index + 1}`}
                      className={`h-44 w-full object-cover ${state?.status === "uploading" ? "opacity-60" : ""}`}
                      src={image.previewUrl}
                    />
                    {isCover && <CoverBadge />}
                  </div>

                  <div className="grid gap-2 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">
                          {isCover ? "Cover photo" : `Photo ${existingMedia.length + index + 1}`}
                          {state?.status === "uploading" && <span className="ml-2 font-normal text-muted">Uploading…</span>}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted">{image.file.name}</p>
                      </div>
                      <div className="flex shrink-0 gap-3">
                        {!isCover && (
                          <button className="text-xs font-semibold text-forest disabled:text-muted" disabled={busy} onClick={() => setPendingCoverKey(image.key)} type="button">
                            Set as cover
                          </button>
                        )}
                        <button className="text-xs font-semibold text-red-700 disabled:text-muted" disabled={state?.status === "uploading"} onClick={() => removeImage(image.key)} type="button">
                          Remove
                        </button>
                      </div>
                    </div>
                    {state?.status === "failed" && <p className="text-xs text-red-800" role="alert">{state.message ?? "This photo didn't upload."}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          6. Pricing & availability
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium">
            Price (GHS)
            <input
              className={input}
              min="0"
              name="price"
              defaultValue={existingPrice ? String(Number(existingPrice) / 100) : ""}
              required
              step="0.01"
              type="number"
            />
          </label>

          {purpose === "RENT" && (
            <label className="text-sm font-medium">
              Payment frequency
              <select className={input} defaultValue={existing?.frequency ?? "MONTHLY"} name="frequency">
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annual</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </label>
          )}

          <label className="text-sm font-medium">
            Available from
            <input
              className={input}
              name="availableFrom"
              defaultValue={existing ? existing.availableFrom.slice(0, 10) : undefined}
              required
              type="date"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-3 text-sm">
          <input defaultChecked={existing?.negotiable ?? false} name="negotiable" type="checkbox" />
          Price is negotiable
        </label>
      </section>

      <section className="rounded-2xl border border-hairline bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          7. Contact & listing authority
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Contact name
            <input
              className={input}
              name="contactName"
              defaultValue={text(existing?.contactName)}
              placeholder="Public contact person"
            />
          </label>

          <label className="text-sm font-medium">
            Contact phone
            <input
              className={input}
              name="contactPhone"
              defaultValue={text(existing?.contactPhone)}
              placeholder="+233..."
            />
          </label>

          <label className="text-sm font-medium">
            Contact email
            <input
              className={input}
              name="contactEmail"
              defaultValue={text(existing?.contactEmail)}
              type="email"
            />
          </label>

          <label className="text-sm font-medium">
            Your authority to list this property
            <select className={input} defaultValue={existing?.listingAuthority ?? "OWNER_SELF"} name="listingAuthority">
              <option value="OWNER_SELF">Property owner</option>
              <option value="PROPERTY_MANAGER">
                Property manager
              </option>
              <option value="MANAGING_AGENT">
                Managing agent
              </option>
              <option value="BROKERAGE_AUTHORIZED">
                Broker / agency
              </option>
              <option value="DEVELOPER">Developer</option>
              <option value="THIRD_PARTY_AUTHORIZED">
                Authorised third party
              </option>
            </select>
          </label>

          {!editing && (
            <label className="text-sm font-medium sm:col-span-2">
              Development unit ID
              <input
                className={input}
                name="developmentUnitId"
                placeholder="Optional"
              />
            </label>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-3 text-sm">
            <input defaultChecked={existing?.showContactPhone ?? false} name="showContactPhone" type="checkbox" />
            Show phone number publicly
          </label>

          <label className="flex items-center gap-3 text-sm">
            <input defaultChecked={existing?.showContactEmail ?? false} name="showContactEmail" type="checkbox" />
            Show email publicly
          </label>

          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <input
              defaultChecked={existing?.marketplaceAsset?.authorityEvidenceReady ?? false} name="authorityEvidenceReady"
              type="checkbox"
            />
            I confirm that I have authority to market this property
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          8. Review & save
        </p>

        <h2 className="mt-2 text-lg font-semibold">
          {editing ? "Your changes update this listing" : "Your listing will be created as a draft"}
        </h2>

        <p className="mt-2 text-sm text-muted">
          Review the property information before submitting it for
          verification and publication on the NesAfric marketplace.
        </p>
      </section>

      <button
        className="rounded-xl bg-forest px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
        disabled={busy}
      >
        {busy ? (listingId ? "Saving…" : "Creating property…") : editing ? "Save changes" : listingId ? "Save draft" : "Create draft property"}
      </button>
    </form>
  );
}

function CoverBadge() {
  return (
    <span className="absolute left-2 top-2 rounded-full bg-forest px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm">
      Cover
    </span>
  );
}
