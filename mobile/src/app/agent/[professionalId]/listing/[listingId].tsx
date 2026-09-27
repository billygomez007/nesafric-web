import { useLocalSearchParams } from "expo-router";

import { ListingEditorScreen } from "@/workspace/screens/listing-editor";

export default function EditListing() {
  const { professionalId, listingId } = useLocalSearchParams<{ professionalId: string; listingId: string }>();
  return <ListingEditorScreen professionalId={professionalId} listingId={listingId ?? null} />;
}
