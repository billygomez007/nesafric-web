import { useLocalSearchParams } from "expo-router";

import { InboxScreen } from "@/workspace/screens/inbox";

export default function Inbox() {
  const { professionalId, tab } = useLocalSearchParams<{ professionalId: string; tab?: string }>();
  return <InboxScreen kind="professional" id={professionalId} tab={tab} />;
}
