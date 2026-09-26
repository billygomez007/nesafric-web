import { useLocalSearchParams } from "expo-router";

import { ViewingScreen } from "@/workspace/screens/viewing";

export default function Viewing() {
  const { organisationId, viewingId } = useLocalSearchParams<{ organisationId: string; viewingId: string }>();
  return <ViewingScreen kind="organisation" id={organisationId} viewingId={viewingId} />;
}
