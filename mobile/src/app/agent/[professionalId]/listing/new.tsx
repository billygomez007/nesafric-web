import { useLocalSearchParams } from "expo-router";

import { ListingEditorScreen } from "@/workspace/screens/listing-editor";

export default function NewListing() {
  const { professionalId } = useLocalSearchParams<{ professionalId: string }>();
  return <ListingEditorScreen professionalId={professionalId} listingId={null} />;
}
