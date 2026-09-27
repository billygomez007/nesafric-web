import { useLocalSearchParams } from "expo-router";

import { ViewingScreen } from "@/workspace/screens/viewing";

export default function Viewing() {
  const { professionalId, viewingId } = useLocalSearchParams<{ professionalId: string; viewingId: string }>();
  return <ViewingScreen kind="professional" id={professionalId} viewingId={viewingId} />;
}
