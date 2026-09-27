import { useLocalSearchParams } from "expo-router";

import { ReportProblemScreen } from "@/tenant/screens/report";

export default function ReportProblem() {
  const { tenancyId } = useLocalSearchParams<{ tenancyId: string }>();
  return <ReportProblemScreen tenancyId={tenancyId} />;
}
