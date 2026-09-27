import { useLocalSearchParams } from "expo-router";

import { EnquiryScreen } from "@/workspace/screens/enquiry";

export default function Enquiry() {
  const { organisationId, leadId } = useLocalSearchParams<{ organisationId: string; leadId: string }>();
  return <EnquiryScreen kind="organisation" id={organisationId} leadId={leadId} />;
}
