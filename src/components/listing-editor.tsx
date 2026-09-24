"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  filesToSelectedImages,
  MAX_LISTING_IMAGES,
  releaseSelectedImage,
  type SelectedListingImage,
  uploadListingImages,
} from "@/lib/listing-image-upload";

type Property = { id: string; name: string; referenceNumber: string };
type Unit = { id: string; name: string; unitType: string | null; bedrooms: number | null; bathrooms: number | null; sizeSqm: string | null };
type Listing = { id: string; propertyId: string; unitId: string | null; listingType: string; category: string; title: string; publicDescription: string; askingAmountMinor: string | null; rentAmountMinor: string | null; currencyCode: string; frequency: string | null; availableFrom: string; bedrooms: number | null; bathrooms: string | null; sizeSqm: string | null; landSizeSqm: string | null; toilets: number | null; parkingSpaces: number | null; furnishing: string | null; propertyCondition: string | null; negotiable: boolean; yearBuilt: number | null; countryCode: string; region: string | null; city: string | null; district: string | null; locality: string | null; publicLocationLabel: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; showContactEmail: boolean; showContactPhone: boolean; enquiryEnabled: boolean; privateNotes: string | null; amenities: { key: string; label: string; category: string | null }[]; media: { type: string; publicUrl: string; title: string | null; altText: string | null; sortOrder: number }[] };

export function ListingEditor({ listingId }: { listingId?: string }) {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [listingType, setListingType] = useState("RENT");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<SelectedListingImage[]>([]);
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) { const timer = setTimeout(() => setError("Choose an organisation."), 0); return () => clearTimeout(timer); }
    Promise.all([fetch("/api/dashboard", { headers: { "x-organisation-id": organisationId } }), listingId ? fetch(`/api/listings/${listingId}`, { headers: { "x-organisation-id": organisationId } }) : Promise.resolve(null)]).then(async ([dashboardResponse, listingResponse]) => {
      if (!dashboardResponse.ok) throw new Error("Unable to load properties.");
      setProperties((await dashboardResponse.json()).properties);
      if (listingResponse) {
        if (!listingResponse.ok) throw new Error((await listingResponse.json()).error?.message ?? "Unable to load listing.");
        const value = await listingResponse.json();
        setListing(value);
        setPropertyId(value.propertyId);
        setListingType(value.listingType);
      }
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load listing editor."));
  }, [listingId]);
  useEffect(() => {
    if (!propertyId) return;
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return;
    fetch(`/api/properties?id=${propertyId}`, { headers: { "x-organisation-id": organisationId } }).then(async (response) => {
      if (!response.ok) throw new Error("Unable to load property units.");
      const property = await response.json();
      setUnits([...property.units, ...property.buildings.flatMap((building: { units: Unit[] }) => building.units)]);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load units."));
  }, [propertyId]);
  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const existingPhotoCount =
      listing?.media.filter((item) => item.type === "PHOTO").length ?? 0;

    const remaining =
      MAX_LISTING_IMAGES - existingPhotoCount - images.length;

    if (remaining <= 0) {
      setError("A property can contain up to 12 images.");
      event.target.value = "";
      return;
    }

    try {
      const selected = filesToSelectedImages(
        files.slice(0, remaining),
      );

      setImages((current) => [...current, ...selected]);
      setError("");

      if (files.length > remaining) {
        setError(
          `Only ${remaining} more image${remaining === 1 ? "" : "s"} could be added. Maximum is 12.`,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to add selected images.",
      );
    }

    event.target.value = "";
  }

  function removeSelectedImage(index: number) {
    setImages((current) => {
      const selected = current[index];

      if (selected) {
        releaseSelectedImage(selected);
      }

      return current.filter(
        (_, itemIndex) => itemIndex !== index,
      );
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation.");
    const data = new FormData(event.currentTarget);
    const amenityLabels = String(data.get("amenities") || "").split(",").map((value) => value.trim()).filter(Boolean);
    const payload = {
      propertyId, unitId: data.get("unitId") || null, listingType, category: data.get("category"), title: data.get("title"), publicDescription: data.get("publicDescription"),
      askingAmountMinor: listingType === "SALE" ? String(Math.round(Number(data.get("amount")) * 100)) : null, rentAmountMinor: listingType === "RENT" ? String(Math.round(Number(data.get("amount")) * 100)) : null,
      currencyCode: data.get("currencyCode"), frequency: listingType === "RENT" ? data.get("frequency") : null, availableFrom: data.get("availableFrom"),
      bedrooms: data.get("bedrooms") ? Number(data.get("bedrooms")) : null, bathrooms: data.get("bathrooms") ? Number(data.get("bathrooms")) : null, sizeSqm: data.get("sizeSqm") ? Number(data.get("sizeSqm")) : null,
      toilets: data.get("toilets") ? Number(data.get("toilets")) : null,
      parkingSpaces: data.get("parkingSpaces") ? Number(data.get("parkingSpaces")) : null,
      landSizeSqm: data.get("landSizeSqm") ? Number(data.get("landSizeSqm")) : null,
      furnishing: data.get("furnishing") || null,
      propertyCondition: data.get("propertyCondition") || null,
      negotiable: data.get("negotiable") === "on",
      yearBuilt: data.get("yearBuilt") ? Number(data.get("yearBuilt")) : null,
      countryCode: data.get("countryCode"), region: data.get("region") || null, city: data.get("city") || null, district: data.get("district") || null, locality: data.get("locality") || null, publicLocationLabel: data.get("publicLocationLabel") || null,
      contactName: data.get("contactName") || null, contactEmail: data.get("contactEmail") || null, contactPhone: data.get("contactPhone") || null, showContactEmail: data.get("showContactEmail") === "on", showContactPhone: data.get("showContactPhone") === "on", enquiryEnabled: data.get("enquiryEnabled") === "on", privateNotes: data.get("privateNotes") || null,
      amenities: amenityLabels.map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), label })),
      ...(listingId ? {} : { media: [] }),
    };
    setSaving(true); setError("");
    const response = await fetch(listingId ? `/api/listings/${listingId}` : "/api/listings", { method: listingId ? "PATCH" : "POST", headers: { "content-type": "application/json", "x-organisation-id": organisationId }, body: JSON.stringify(payload) });
    if (!response.ok) { setError((await response.json()).error?.message ?? "Unable to save listing."); setSaving(false); return; }
    const saved = await response.json();

    if (images.length) {
      try {
        await uploadListingImages({
          listingId: saved.id,
          organisationId,
          title: String(data.get("title") || "Property"),
          images,
        });
      } catch (cause) {
        setSaving(false);
        setError(
          cause instanceof Error
            ? `${cause.message} The property draft was saved, but one or more photos were not uploaded.`
            : "The property draft was saved, but its photos could not be uploaded.",
        );
        return;
      }
    }

    images.forEach(releaseSelectedImage);
    router.push(`/listings/${saved.id}`);
  }
  if (listingId && !listing && !error) return <p className="rounded-xl border border-hairline border-hairline bg-white p-6 text-muted">Loading listing...</p>;
  const value = listing;
  return <form className="grid gap-5 rounded-2xl border border-hairline bg-white p-6 shadow-sm" onSubmit={save}><div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium">Managed property<select className="mt-1 w-full rounded-xl border border-hairline p-3" required value={propertyId} onChange={(event) => { setPropertyId(event.target.value); setUnits([]); }}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name} ({property.referenceNumber})</option>)}</select></label><label className="text-sm font-medium">Unit <span className="font-normal text-muted">(optional)</span><select className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.unitId ?? ""} name="unitId"><option value="">Whole property</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="text-sm font-medium">Listing type<select className="mt-1 w-full rounded-xl border border-hairline p-3" value={listingType} onChange={(event) => setListingType(event.target.value)}><option value="RENT">Rental</option><option value="SALE">Sale</option></select></label></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Title<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.title ?? ""} minLength={3} name="title" required /></label><label className="text-sm font-medium">Property category<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.category ?? ""} name="category" placeholder="Apartment, house, office..." required /></label></div><label className="text-sm font-medium">Public description<textarea className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.publicDescription ?? ""} minLength={20} name="publicDescription" required rows={5} /></label><div className="grid gap-4 md:grid-cols-4"><label className="text-sm font-medium">Amount<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value ? (Number(value.rentAmountMinor ?? value.askingAmountMinor ?? 0) / 100) || "" : ""} min="0.01" name="amount" required step="0.01" type="number" /></label><label className="text-sm font-medium">Currency<input className="mt-1 w-full rounded-xl border border-hairline p-3 uppercase" defaultValue={value?.currencyCode ?? ""} maxLength={3} name="currencyCode" required /></label>{listingType === "RENT" && <label className="text-sm font-medium">Frequency<select className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.frequency ?? "MONTHLY"} name="frequency"><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option><option value="CUSTOM">Custom</option></select></label>}<label className="text-sm font-medium">Available from<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.availableFrom?.slice(0, 10) ?? ""} name="availableFrom" required type="date" /></label></div><div className="grid gap-4 md:grid-cols-3">
<label className="text-sm font-medium">Bedrooms<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.bedrooms ?? ""} min="0" name="bedrooms" type="number" /></label>
<label className="text-sm font-medium">Bathrooms<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.bathrooms ?? ""} min="0" name="bathrooms" step="0.5" type="number" /></label>
<label className="text-sm font-medium">Toilets<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.toilets ?? ""} min="0" name="toilets" type="number" /></label>
<label className="text-sm font-medium">Building size (m²)<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.sizeSqm ?? ""} min="0" name="sizeSqm" type="number" /></label>
<label className="text-sm font-medium">Land size (m²)<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.landSizeSqm ?? ""} min="0" name="landSizeSqm" type="number" /></label>
<label className="text-sm font-medium">Parking spaces<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.parkingSpaces ?? ""} min="0" name="parkingSpaces" type="number" /></label>
<label className="text-sm font-medium">Furnishing<select className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.furnishing ?? ""} name="furnishing"><option value="">Select</option><option value="FURNISHED">Furnished</option><option value="SEMI_FURNISHED">Semi-furnished</option><option value="UNFURNISHED">Unfurnished</option></select></label>
<label className="text-sm font-medium">Condition<select className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.propertyCondition ?? ""} name="propertyCondition"><option value="">Select</option><option value="NEW">New</option><option value="NEWLY_RENOVATED">Newly renovated</option><option value="EXCELLENT">Excellent</option><option value="GOOD">Good</option><option value="NEEDS_RENOVATION">Needs renovation</option></select></label>
<label className="text-sm font-medium">Year built<input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.yearBuilt ?? ""} min="1800" max="2200" name="yearBuilt" type="number" /></label>
</div>
<label className="flex items-center gap-2 text-sm"><input defaultChecked={value?.negotiable ?? false} name="negotiable" type="checkbox" /> Price is negotiable</label><fieldset className="rounded-xl border border-hairline p-4"><legend className="px-1 text-sm font-semibold">Public location</legend><div className="grid gap-3 md:grid-cols-3"><input className="rounded-xl border border-hairline p-3 text-sm uppercase" defaultValue={value?.countryCode ?? ""} maxLength={2} name="countryCode" placeholder="Country (e.g. GH)" required /><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.region ?? ""} name="region" placeholder="Region / state" /><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.city ?? ""} name="city" placeholder="City" /><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.district ?? ""} name="district" placeholder="District" /><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.locality ?? ""} name="locality" placeholder="Locality" /><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.publicLocationLabel ?? ""} name="publicLocationLabel" placeholder="Public location label" /></div></fieldset><label className="text-sm font-medium">Amenities <span className="font-normal text-muted">(comma-separated)</span><input className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.amenities.map((amenity) => amenity.label).join(", ") ?? ""} name="amenities" placeholder="Parking, security, internet, balcony" /></label><fieldset className="rounded-xl border border-hairline p-4">
  <legend className="px-1 text-sm font-semibold">
    Property images
  </legend>

  <div className="mb-4 flex items-start justify-between gap-4">
    <div>
      <p className="text-sm font-semibold text-ink">
        Upload up to 12 property images
      </p>

      <p className="mt-1 text-xs text-muted">
        Choose images directly from your phone or computer.
        The first image becomes the cover photo.
      </p>
    </div>

    <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted">
      {(listing?.media.filter((item) => item.type === "PHOTO").length ?? 0) + images.length}/12
    </span>
  </div>

  {listing?.media.some((item) => item.type === "PHOTO") && (
    <div className="mb-5 grid gap-3 md:grid-cols-3">
      {listing.media
        .filter((item) => item.type === "PHOTO")
        .map((item, index) => (
          <div
            key={`${item.publicUrl}-${index}`}
            className="overflow-hidden rounded-xl border border-hairline bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={item.altText ?? `Property image ${index + 1}`}
              className="h-36 w-full object-cover"
              src={item.publicUrl}
            />

            <p className="p-2 text-xs font-semibold text-muted">
              {index === 0
                ? "Cover photo"
                : `Photo ${index + 1}`}
            </p>
          </div>
        ))}
    </div>
  )}

  <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-hairline bg-surface/40 px-5 py-8 text-center transition hover:bg-surface">
    <span className="text-sm font-semibold">
      Click to upload photos
    </span>

    <span className="mt-1 text-xs text-muted">
      JPG, PNG or WebP · Maximum 10MB each
    </span>

    <span className="mt-3 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white">
      Choose photos
    </span>

    <input
      accept="image/jpeg,image/png,image/webp"
      className="sr-only"
      multiple
      onChange={addImages}
      type="file"
    />
  </label>

  {images.length > 0 && (
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {images.map((image, index) => (
        <div
          key={`${image.file.name}-${index}`}
          className="overflow-hidden rounded-xl border border-hairline bg-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={`Selected property image ${index + 1}`}
            className="h-36 w-full object-cover"
            src={image.previewUrl}
          />

          <div className="flex items-center justify-between gap-3 p-2">
            <span className="truncate text-xs font-semibold">
              {image.file.name}
            </span>

            <button
              className="shrink-0 text-xs font-semibold text-red-700"
              onClick={() => removeSelectedImage(index)}
              type="button"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  )}
</fieldset><fieldset className="rounded-xl border border-hairline p-4"><legend className="px-1 text-sm font-semibold">Enquiry contact controls</legend><div className="grid gap-3 md:grid-cols-3"><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.contactName ?? ""} name="contactName" placeholder="Public contact name" /><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.contactEmail ?? ""} name="contactEmail" placeholder="Contact email" type="email" /><input className="rounded-xl border border-hairline p-3 text-sm" defaultValue={value?.contactPhone ?? ""} name="contactPhone" placeholder="Contact phone" /></div><div className="mt-3 flex flex-wrap gap-4 text-sm"><label><input defaultChecked={value?.enquiryEnabled ?? true} name="enquiryEnabled" type="checkbox" /> Enquiries enabled</label><label><input defaultChecked={value?.showContactEmail ?? false} name="showContactEmail" type="checkbox" /> Publish email</label><label><input defaultChecked={value?.showContactPhone ?? false} name="showContactPhone" type="checkbox" /> Publish phone</label></div></fieldset><label className="text-sm font-medium">Private management notes<textarea className="mt-1 w-full rounded-xl border border-hairline p-3" defaultValue={value?.privateNotes ?? ""} name="privateNotes" rows={2} /></label>{error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}<button className="rounded-lg bg-forest p-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted" disabled={saving || !propertyId}>{saving ? "Saving..." : listingId ? "Save listing" : "Create draft listing"}</button></form>;
}
