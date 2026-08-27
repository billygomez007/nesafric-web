"use client";

import { useEffect, useState } from "react";
import { VoiceCallsWorkspace } from "@/components/voice-calls-workspace";

export function MarketplaceVoiceWorkspace({ professionalId }: { professionalId: string }) {
  const [backingOrganisationId, setBackingOrganisationId] = useState("");
  useEffect(() => {
    fetch(`/api/marketplace-professionals/${professionalId}`).then(async (response) => {
      if (response.ok) setBackingOrganisationId((await response.json()).backingOrganisationId);
    });
  }, [professionalId]);
  if (!backingOrganisationId) return <p className="text-slate-600">Loading…</p>;
  return <VoiceCallsWorkspace organisationId={backingOrganisationId} />;
}
