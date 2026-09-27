import { useLocalSearchParams } from "expo-router";

import { InboxScreen } from "@/workspace/screens/inbox";

export default function Inbox() {
  const { organisationId, tab } = useLocalSearchParams<{ organisationId: string; tab?: string }>();
  return <InboxScreen kind="organisation" id={organisationId} tab={tab} />;
}
