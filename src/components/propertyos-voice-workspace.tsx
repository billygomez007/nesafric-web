"use client";

import { useEffect, useState } from "react";
import { VoiceCallsWorkspace } from "@/components/voice-calls-workspace";

export function PropertyOsVoiceWorkspace() {
  const [organisationId, setOrganisationId] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => { setOrganisationId(localStorage.getItem("propertyos.activeOrganisationId") ?? ""); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (!organisationId) return <p className="text-slate-600">Loading…</p>;
  return <VoiceCallsWorkspace organisationId={organisationId} />;
}
