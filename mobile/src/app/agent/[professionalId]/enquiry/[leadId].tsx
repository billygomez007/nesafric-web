import { useLocalSearchParams } from "expo-router";

import { EnquiryScreen } from "@/workspace/screens/enquiry";

export default function Enquiry() {
  const { professionalId, leadId } = useLocalSearchParams<{ professionalId: string; leadId: string }>();
  return <EnquiryScreen kind="professional" id={professionalId} leadId={leadId} />;
}
