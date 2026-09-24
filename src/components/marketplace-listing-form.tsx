"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_LISTING_IMAGES = 12;

export function MarketplaceListingForm({ professionalId }: { professionalId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([""]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const purpose = String(form.get("purpose"));
    const price = String(Math.round(Number(form.get("price")) * 100));
    const availableFrom = String(form.get("availableFrom"));

    const propertyImages = imageUrls
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, MAX_LISTING_IMAGES);

    if (propertyImages.length === 0) {
      setBusy(false);
      setError("Add at least one property image.");
      return;
    }

    const title = String(form.get("title"));

    const common = {
      category: String(form.get("category")),
      title,
      publicDescription: String(form.get("description")),
      currencyCode: "GHS",
      availableFrom,
      countryCode: "GH",
      city: String(form.get("city")),
      media: propertyImages.map((publicUrl, index) => ({
        type: "PHOTO" as const,
        publicUrl,
        title: index === 0 ? "Cover photo" : `Property photo ${index + 1}`,
        altText: `${title} — photo ${index + 1}`,
        sortOrder: index,
      })),
      amenities: [],
    };

    const body = {
      asset: {
        name: common.title,
        category: common.category,
        purpose,
        currencyCode: "GHS",
        priceMinor: price,
        countryCode: "GH",
        city: common.city,
        mediaUrls: propertyImages,
        amenities: [],
        availableFrom,
        authorityEvidenceReady: false,
        ...(form.get("developmentUnitId")
          ? { developmentUnitId: String(form.get("developmentUnitId")) }
          : {}),
      },
      listing: {
        ...common,
        listingType: purpose,
        ...(purpose === "RENT"
          ? { rentAmountMinor: price, frequency: "MONTHLY" }
          : { askingAmountMinor: price }),
      },
      listingAuthority: String(form.get("listingAuthority")),
    };

    const response = await fetch(
      `/api/marketplace-professionals/${professionalId}/listings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const result = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(result.error?.message ?? "Unable to create listing.");
      return;
    }

    router.push(`/pro/${professionalId}/listings`);
    router.refresh();
  }

  const input = "rounded-xl border border-hairline px-3 py-2";

  return (
    <form className="grid max-w-3xl gap-5" onSubmit={submit}>
      <div>
        <h1 className="text-2xl font-semibold">New standalone listing</h1>
        <p className="mt-1 text-sm text-muted">
          Create marketplace inventory without adding a NesAfric-managed property.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <input
        className={input}
        name="title"
        placeholder="Property title"
        required
      />

      <textarea
        className={input}
        minLength={20}
        name="description"
        placeholder="Public description"
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <input
          className={input}
          name="category"
          placeholder="Category (e.g. apartment)"
          required
        />

        <select className={input} name="purpose">
          <option value="RENT">For rent</option>
          <option value="SALE">For sale</option>
        </select>

        <input
          className={input}
          min="0"
          name="price"
          placeholder="Price (GHS)"
          required
          step="0.01"
          type="number"
        />

        <input
          className={input}
          name="availableFrom"
          type="date"
          required
        />

        <input
          className={input}
          name="city"
          placeholder="City"
          required
        />

        <select className={input} name="listingAuthority">
          <option value="BROKERAGE_AUTHORIZED">Brokerage authorised</option>
          <option value="MANAGING_AGENT">Managing agent</option>
          <option value="OWNER_SELF">Owner self</option>
          <option value="DEVELOPER">Developer</option>
          <option value="THIRD_PARTY_AUTHORIZED">Third-party authorised</option>
        </select>

        <input
          className={`${input} sm:col-span-2`}
          name="developmentUnitId"
          placeholder="Development unit ID (optional)"
        />
      </div>

      <fieldset className="rounded-2xl border border-hairline bg-white p-5">
        <legend className="px-2 text-sm font-semibold">
          Property images
        </legend>

        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">
              Add up to 12 images
            </p>
            <p className="mt-1 text-xs text-muted">
              Add clear photos of the exterior, rooms, kitchen, bathrooms and important property features.
              The first image becomes the marketplace cover image.
            </p>
          </div>

          <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted">
            {imageUrls.filter((url) => url.trim()).length}/{MAX_LISTING_IMAGES}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {imageUrls.map((url, index) => (
            <div
              key={index}
              className="rounded-xl border border-hairline bg-surface/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-muted">
                  {index === 0 ? "Cover image" : `Image ${index + 1}`}
                </span>

                {imageUrls.length > 1 && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-red-700 hover:underline"
                    onClick={() =>
                      setImageUrls((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>

              <input
                className="w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm"
                type="url"
                placeholder="https://example.com/property-photo.jpg"
                value={url}
                onChange={(event) =>
                  setImageUrls((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
                required={index === 0}
              />

              {url.trim() && (
                <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Property preview ${index + 1}`}
                    className="h-44 w-full object-cover"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {imageUrls.length < MAX_LISTING_IMAGES && (
          <button
            type="button"
            className="mt-4 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-semibold transition hover:bg-surface"
            onClick={() =>
              setImageUrls((current) => [...current, ""])
            }
          >
            + Add another image
          </button>
        )}

        {imageUrls.length === MAX_LISTING_IMAGES && (
          <p className="mt-4 text-xs font-medium text-muted">
            Maximum of 12 property images reached.
          </p>
        )}
      </fieldset>

      <button
        className="rounded-lg bg-forest px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
        disabled={busy}
      >
        {busy ? "Creating…" : "Create draft listing"}
      </button>
    </form>
  );
}
