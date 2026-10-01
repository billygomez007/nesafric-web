import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useApi } from "@/api/provider";
import { useSession } from "@/auth/session";
import {
  createProListing,
  removeListingPhoto,
  setListingCover,
  submitProListing,
  updateProListing,
  uploadListingPhoto,
  type EditableListing,
  type ListingAuthority,
  type ListingDraft,
  type ListingEvidence,
} from "@/api/workspace-actions";
import { useProListing } from "@/api/workspace-queries";
import { Checkbox } from "@/components/checkbox";
import { Chip } from "@/components/chip";
import { SearchableSelect } from "@/components/searchable-select";
import { AppText, Button, Notice, TextField } from "@/components/ui";
import { resolveMediaUrl } from "@/marketplace/format";
import {
  GHANA_REGIONS,
  districtsForRegion,
  placesForDistrict,
} from "@/marketplace/ghana-locations";
import {
  AMENITIES,
  EDITABLE_LISTING_STATUSES,
  EVIDENCE_TYPES,
  FURNISHING,
  LISTING_AUTHORITIES,
  LISTING_INTENTS,
  MAX_LISTING_PHOTOS,
  PROPERTY_TYPES,
  RESIDENTIAL_TYPES,
  SUBMITTABLE_LISTING_STATUSES,
} from "@/marketplace/listing-options";
import { isBookableCategory } from "@/marketplace/listing-categories";
import { PRICE_UNIT_LABELS, priceUnitsFor } from "@/marketplace/price-units";
import { colors, radii, spacing } from "@/theme/tokens";
import { ChoiceField, describeError, FieldRow, FormError, FormScreen, FormSection, isIsoDate, RecordState, today, useInvalidateWorkspace } from "@/workspace/forms";
import { StatusPill, useWorkspaceGate } from "@/workspace/inbox-ui";
import { pickListingPhotos, type PickedPhoto } from "@/workspace/photos";

const EMPTY: ListingDraft = {
  listingType: "RENT",
  category: "APARTMENT",
  title: "",
  description: "",
  price: "",
  priceUnit: "MONTHLY",
  availableFrom: today(),
  bedrooms: "",
  bathrooms: "",
  sizeSqm: "",
  landSizeSqm: "",
  furnishing: "",
  negotiable: false,
  region: "",
  city: "",
  district: "",
  locality: "",
  amenities: [],
  listingAuthority: "OWNER_SELF",
};

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function majorUnits(minor: string | null) {
  if (!minor) return "";
  const padded = minor.padStart(3, "0");
  const fraction = padded.slice(-2);
  return `${padded.slice(0, -2).replace(/^0+(?=\d)/, "")}${fraction === "00" ? "" : `.${fraction}`}`;
}

export function draftFromListing(listing: EditableListing): ListingDraft {
  return {
    listingType: listing.listingType,
    category: listing.category,
    title: listing.title,
    description: listing.publicDescription,
    price: majorUnits(listing.priceMinor),
    priceUnit: listing.frequency ?? "",
    availableFrom: listing.availableFrom.slice(0, 10),
    bedrooms: text(listing.bedrooms),
    maxGuests: text(listing.maxGuests ?? null),
    minimumNights: text(listing.minimumNights ?? null),
    bathrooms: text(listing.bathrooms),
    sizeSqm: text(listing.sizeSqm),
    landSizeSqm: text(listing.landSizeSqm),
    furnishing: listing.furnishing ?? "",
    negotiable: listing.negotiable,
    region: listing.region ?? "",
    city: listing.city ?? "",
    district: listing.district ?? "",
    locality: listing.locality ?? "",
    amenities: listing.amenities,
    listingAuthority: listing.listingAuthority ?? "OWNER_SELF",
  };
}

type Errors = Partial<Record<keyof ListingDraft, string>>;

/** Checks the app can make before sending; the server validates everything again. */
export function validateListingDraft(draft: ListingDraft): Errors {
  const errors: Errors = {};
  if (draft.title.trim().length < 3) errors.title = "Enter a title of at least 3 characters.";
  if (draft.description.trim().length < 20) errors.description = "Describe the property in at least 20 characters.";
  if (!/^\d[\d,]*(\.\d{1,2})?$/.test(draft.price.trim())) errors.price = "Enter the price, e.g. 1200 or 1200.50.";
  if (draft.listingType === "RENT" && !draft.priceUnit) errors.priceUnit = "Choose how the rent is charged.";
  if (!isIsoDate(draft.availableFrom)) errors.availableFrom = "Use the date format YYYY-MM-DD.";
  for (const field of ["bedrooms", "bathrooms", "sizeSqm", "landSizeSqm"] as const) {
    if (draft[field].trim() && !(Number(draft[field]) >= 0)) errors[field] = "Enter a number.";
  }
  return errors;
}

/**
 * Native Add/Edit listing for a real estate professional. Uses the website's listing endpoints:
 * a new listing is saved as a private draft, photos are uploaded to it, and it goes live only after
 * it is submitted and approved by NesAfric review. The server checks the professional membership
 * and that the listing belongs to this professional on every call.
 */
export function ListingEditorScreen({ professionalId, listingId }: { professionalId: string | undefined; listingId: string | null }) {
  const { gate, workspaceId } = useWorkspaceGate("professional", professionalId);
  // Authenticated client of the signed-in session; `useApi` supplies only the public API origin.
  const { api } = useSession();
  const { apiUrl } = useApi();
  const invalidate = useInvalidateWorkspace("professional", workspaceId);
  const existing = useProListing(workspaceId, listingId);
  const [draft, setDraft] = useState<ListingDraft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [staged, setStaged] = useState<PickedPhoto[]>([]);
  const [photoNotes, setPhotoNotes] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<{ type: ListingEvidence["type"] | ""; reference: string }>({ type: "", reference: "" });
  const [busy, setBusy] = useState<"save" | "photos" | "submit" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const listing = existing.data;
  useEffect(() => {
    // Fill the form once per listing, never over the person's unsaved edits on a refetch.
    if (listing && loadedFor.current !== listing.id) {
      loadedFor.current = listing.id;
      setDraft(draftFromListing(listing));
    }
  }, [listing]);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  if (listingId && !listing) return <RecordState noun="listing" query={existing} />;

  const editable = !listing || EDITABLE_LISTING_STATUSES.has(listing.status);
  const photos = listing?.photos ?? [];
  const remaining = MAX_LISTING_PHOTOS - photos.length - staged.length;
  const update = (patch: Partial<ListingDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const residential = RESIDENTIAL_TYPES.has(draft.category);
  const land = draft.category === "LAND";
  // Hotels and short stays are nightly rentals with stay details (the server insists on it too).
  const stay = isBookableCategory(draft.category);
  const units = priceUnitsFor(draft.listingType, draft.category);
  const unitOptions: (readonly [string, string])[] = [...(draft.listingType === "SALE" && !stay ? [["", "Total price"] as const] : []), ...units.map((unit) => [unit, PRICE_UNIT_LABELS[unit]] as const)];

  const regionNames = GHANA_REGIONS.map((region) => region.name);
  const districts = districtsForRegion(draft.region);
  const districtNames = districts.map((district) => district.name);
  const localityNames = placesForDistrict(draft.region, draft.district);

  function setCategory(category: string) {
    if (isBookableCategory(category)) return update({ category, listingType: "RENT", priceUnit: "PER_NIGHT" });
    // Leaving a stay: back to an ordinary rent unit.
    update({ category, ...(draft.priceUnit === "PER_NIGHT" ? { priceUnit: draft.listingType === "RENT" ? "MONTHLY" : "" } : {}) });
  }

  function setIntent(listingType: "RENT" | "SALE") {
    if (stay) return;
    // A sale keeps only a per-quantity unit (else it is a total price); a rental always needs one.
    const keep = listingType === "RENT" ? draft.priceUnit || "MONTHLY" : priceUnitsFor("SALE").includes(draft.priceUnit as never) ? draft.priceUnit : "";
    update({ listingType, priceUnit: keep });
  }

  async function uploadAll(targetId: string, queue: PickedPhoto[]) {
    const failed: PickedPhoto[] = [];
    const notes: string[] = [];
    for (const photo of queue) {
      try {
        await uploadListingPhoto(api, workspaceId!, targetId, photo);
      } catch (cause) {
        failed.push(photo);
        notes.push(`${photo.fileName}: ${describeError(cause)}`);
      }
    }
    setStaged(failed);
    setPhotoNotes(notes);
    return failed.length === 0;
  }

  async function save() {
    const found = validateListingDraft(draft);
    setErrors(found);
    setError(null);
    setNotice(null);
    if (Object.keys(found).length) return;
    setBusy("save");
    try {
      const saved = listing ? await updateProListing(api, workspaceId!, listing.id, draft) : await createProListing(api, workspaceId!, draft);
      const photosOk = staged.length ? await uploadAll(saved.id, staged) : true;
      await invalidate();
      if (!listing) {
        router.replace({ pathname: "/agent/[professionalId]/listing/[listingId]", params: { professionalId: workspaceId!, listingId: saved.id } });
        return;
      }
      setNotice(photosOk ? "Changes saved." : "Changes saved, but some photos were not uploaded. Try adding them again.");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function addPhotos() {
    setPhotoNotes([]);
    const picked = await pickListingPhotos(Math.max(remaining, 0));
    if (!picked.photos.length) {
      setPhotoNotes(picked.rejected);
      return;
    }
    if (!listing) {
      // Uploaded right after the draft is first saved.
      setStaged((current) => [...current, ...picked.photos]);
      setPhotoNotes(picked.rejected);
      return;
    }
    setBusy("photos");
    await uploadAll(listing.id, picked.photos);
    setPhotoNotes((notes) => [...picked.rejected, ...notes]);
    await invalidate();
    setBusy(null);
  }

  async function photoAction(mediaId: string, action: "cover" | "remove") {
    if (!listing) return;
    setBusy("photos");
    setError(null);
    try {
      if (action === "cover") await setListingCover(api, workspaceId!, listing.id, mediaId);
      else await removeListingPhoto(api, workspaceId!, listing.id, mediaId);
      await invalidate();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!listing) return;
    setBusy("submit");
    setError(null);
    setNotice(null);
    try {
      const reference = evidence.reference.trim();
      await submitProListing(api, workspaceId!, listing.id, evidence.type && reference ? { type: evidence.type, reference } : undefined);
      await invalidate();
      setNotice("Submitted for review. NesAfric checks every listing before it goes live.");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  return (
    <FormScreen testID="listing-editor">
      {listing ? (
        <View style={styles.status}>
          <StatusPill status={listing.status} />
          <AppText variant="caption">Verification: {listing.verificationStatus.toLowerCase().replace(/_/g, " ")}</AppText>
        </View>
      ) : null}
      {listing?.reviewNote ? <Notice tone="warning" message={`Returned by NesAfric review: ${listing.reviewNote}`} /> : null}
      {!editable ? <Notice tone="info" message={listing?.status === "PENDING_REVIEW" ? "This listing is in review. You can edit it again if NesAfric returns it." : "Pause this listing on the website before editing it."} /> : null}
      {notice ? <Notice tone="info" message={notice} /> : null}
      <FormError error={error} />

      <FormSection title="Property">
        <ChoiceField label="Listing type" options={LISTING_INTENTS} value={draft.listingType} onChange={setIntent} testID="listing-intent" />
        <ChoiceField label="Property type" options={PROPERTY_TYPES} value={draft.category} onChange={setCategory} testID="listing-category" />
        <TextField label="Title" value={draft.title} onChangeText={(title) => update({ title })} error={errors.title} editable={editable} testID="listing-title" />
        <TextField label="Description" value={draft.description} onChangeText={(description) => update({ description })} error={errors.description} multiline style={styles.multiline} editable={editable} testID="listing-description" />
      </FormSection>

      <FormSection title="Price" hint="The price unit is how the price is charged. Property size is entered separately below.">
        <TextField label="Price (GHS)" value={draft.price} onChangeText={(price) => update({ price })} error={errors.price} keyboardType="decimal-pad" editable={editable} testID="listing-price" />
        <ChoiceField label="Price unit" options={unitOptions} value={draft.priceUnit} onChange={(priceUnit) => update({ priceUnit })} error={errors.priceUnit} testID="listing-price-unit" />
        <Checkbox checked={draft.negotiable} onChange={(negotiable) => update({ negotiable })} label="Price is negotiable" />
        <TextField label="Available from (YYYY-MM-DD)" value={draft.availableFrom} onChangeText={(availableFrom) => update({ availableFrom })} error={errors.availableFrom} autoCapitalize="none" editable={editable} testID="listing-available-from" />
      </FormSection>

      {stay ? (
        <FormSection title="Stay details" hint="Guests send booking requests for this listing; nothing is confirmed until you accept one.">
          <FieldRow>
            <TextField label="Maximum guests" value={draft.maxGuests ?? ""} onChangeText={(maxGuests) => update({ maxGuests })} keyboardType="number-pad" editable={editable} testID="listing-max-guests" />
            <TextField label="Minimum nights" value={draft.minimumNights ?? ""} onChangeText={(minimumNights) => update({ minimumNights })} keyboardType="number-pad" editable={editable} testID="listing-minimum-nights" />
          </FieldRow>
        </FormSection>
      ) : null}

      <FormSection title="Details">
        {residential ? (
          <FieldRow>
            <TextField label="Bedrooms" value={draft.bedrooms} onChangeText={(bedrooms) => update({ bedrooms })} error={errors.bedrooms} keyboardType="number-pad" editable={editable} />
            <TextField label="Bathrooms" value={draft.bathrooms} onChangeText={(bathrooms) => update({ bathrooms })} error={errors.bathrooms} keyboardType="decimal-pad" editable={editable} />
          </FieldRow>
        ) : null}
        <FieldRow>
          {!land ? <TextField label="Floor area (m²)" value={draft.sizeSqm} onChangeText={(sizeSqm) => update({ sizeSqm })} error={errors.sizeSqm} keyboardType="decimal-pad" editable={editable} testID="listing-size" /> : null}
          <TextField label="Land size (m²)" value={draft.landSizeSqm} onChangeText={(landSizeSqm) => update({ landSizeSqm })} error={errors.landSizeSqm} keyboardType="decimal-pad" editable={editable} />
        </FieldRow>
        {residential ? <ChoiceField label="Furnishing" options={FURNISHING} value={draft.furnishing} onChange={(furnishing) => update({ furnishing: furnishing === draft.furnishing ? "" : furnishing })} /> : null}
        <View style={styles.field}>
          <AppText variant="label">Amenities</AppText>
          <View style={styles.chips}>
            {AMENITIES.map((amenity) => (
              <Chip
                key={amenity}
                label={amenity}
                selected={draft.amenities.includes(amenity)}
                onPress={() => update({ amenities: draft.amenities.includes(amenity) ? draft.amenities.filter((item) => item !== amenity) : [...draft.amenities, amenity] })}
              />
            ))}
          </View>
        </View>
      </FormSection>

      <FormSection
        title="Location"
        hint="Choose the Ghana region, district / municipality and local area. The exact street address is not published."
      >
        <SearchableSelect
          label="Country"
          value="Ghana"
          options={["Ghana"]}
          disabled
          onChange={() => undefined}
          testID="listing-country"
        />

        <SearchableSelect
          label="Region"
          value={draft.region}
          options={regionNames}
          disabled={!editable}
          placeholder="Choose a region"
          testID="listing-region"
          onChange={(region) =>
            update({
              region,
              city: "",
              district: "",
              locality: "",
            })
          }
        />

        <SearchableSelect
          label="District / Municipality"
          value={draft.district}
          options={districtNames}
          disabled={!editable || !draft.region}
          placeholder={
            draft.region
              ? "Choose a district / municipality"
              : "Choose a region first"
          }
          testID="listing-district"
          onChange={(district) =>
            update({
              district,
              city: "",
              locality: "",
            })
          }
        />

        <SearchableSelect
          label="Location / Area"
          value={draft.locality}
          options={localityNames}
          disabled={!editable || !draft.district}
          placeholder={
            draft.district
              ? "Choose a location"
              : "Choose a district first"
          }
          testID="listing-locality"
          onChange={(locality) =>
            update({
              locality,
              city: locality,
            })
          }
        />
      </FormSection>

      <FormSection title="Your authority" hint="Your professional relationship to this property. NesAfric may ask for proof during review.">
        <ChoiceField label="I am listing as" options={LISTING_AUTHORITIES} value={draft.listingAuthority} onChange={(listingAuthority) => update({ listingAuthority: listingAuthority as ListingAuthority })} />
      </FormSection>

      <FormSection title="Photos" hint={`Up to ${MAX_LISTING_PHOTOS} photos. The first photo is the cover unless you choose another.`}>
        <View style={styles.photos}>
          {photos.map((photo) => (
            <View key={photo.id} style={styles.photo} testID={`listing-photo-${photo.id}`}>
              <Image source={{ uri: resolveMediaUrl(photo.publicUrl, apiUrl) }} style={styles.photoImage} contentFit="cover" accessibilityIgnoresInvertColors />
              {photo.isCover ? <AppText style={styles.cover}>Cover</AppText> : null}
              {editable ? (
                <View style={styles.photoActions}>
                  {!photo.isCover ? <IconAction icon="star-outline" label="Make cover photo" onPress={() => void photoAction(photo.id, "cover")} /> : null}
                  <IconAction icon="trash-outline" label="Remove photo" onPress={() => void photoAction(photo.id, "remove")} />
                </View>
              ) : null}
            </View>
          ))}
          {staged.map((photo) => (
            <View key={photo.key} style={styles.photo}>
              <Image source={{ uri: photo.uri }} style={styles.photoImage} contentFit="cover" accessibilityIgnoresInvertColors />
              <AppText style={styles.cover}>{listing ? "Not uploaded" : "Uploads on save"}</AppText>
            </View>
          ))}
        </View>
        {photoNotes.map((note) => (
          <AppText key={note} style={styles.photoError}>{note}</AppText>
        ))}
        {editable ? (
          <Button label={busy === "photos" ? "Uploading photos…" : "Add photos"} variant="secondary" onPress={() => void addPhotos()} loading={busy === "photos"} disabled={remaining <= 0 || Boolean(busy)} testID="listing-add-photos" />
        ) : null}
        {listing && staged.length ? <Button label="Retry photo upload" variant="secondary" onPress={() => void (async () => { setBusy("photos"); await uploadAll(listing.id, staged); await invalidate(); setBusy(null); })()} testID="listing-retry-photos" /> : null}
      </FormSection>

      {editable ? <Button label={listing ? "Save changes" : "Save draft"} variant="dark" onPress={() => void save()} loading={busy === "save"} disabled={Boolean(busy)} testID="listing-save" /> : null}

      {listing && SUBMITTABLE_LISTING_STATUSES.has(listing.status) ? (
        <FormSection title="Submit for review" hint="Add a reference to the document that authorises you to market this property, such as a mandate number. NesAfric reviews it before the listing goes live.">
          <ChoiceField label="Evidence type" options={EVIDENCE_TYPES} value={evidence.type} onChange={(type) => setEvidence((current) => ({ ...current, type }))} />
          <TextField label="Evidence reference" value={evidence.reference} onChangeText={(reference) => setEvidence((current) => ({ ...current, reference }))} testID="listing-evidence-reference" />
          <Button label="Submit for review" onPress={() => void submit()} loading={busy === "submit"} disabled={Boolean(busy)} testID="listing-submit" />
        </FormSection>
      ) : null}
    </FormScreen>
  );
}

function IconAction({ icon, label, onPress }: { icon: "star-outline" | "trash-outline"; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.iconAction, pressed && styles.iconActionPressed]}>
      <Ionicons name={icon} size={18} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  multiline: { minHeight: 120, textAlignVertical: "top", paddingTop: spacing.md },
  field: { gap: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photo: { width: 104, height: 104, borderRadius: radii.control, overflow: "hidden", backgroundColor: colors.cream },
  photoImage: { width: "100%", height: "100%" },
  cover: { position: "absolute", left: 6, top: 6, paddingHorizontal: 6, borderRadius: radii.control, backgroundColor: "rgba(0,22,20,0.8)", color: colors.white, fontSize: 11, lineHeight: 18 },
  photoActions: { position: "absolute", right: 4, bottom: 4, flexDirection: "row", gap: 4 },
  iconAction: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,22,20,0.75)" },
  iconActionPressed: { backgroundColor: "rgba(0,22,20,0.95)" },
  photoError: { color: colors.danger, fontSize: 13 },
});
