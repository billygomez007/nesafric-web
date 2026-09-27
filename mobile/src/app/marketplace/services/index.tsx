import { Redirect } from "expo-router";
import { useEffect } from "react";

import { setMarketplaceMode } from "@/marketplace/mode";

/**
 * `/marketplace/services` — the same address as the website's Service Providers marketplace. In
 * the app that marketplace lives on Home behind the Properties | Service Providers selector.
 */
export default function ServicesMarketplaceLink() {
  useEffect(() => setMarketplaceMode("services"), []);
  return <Redirect href="/" />;
}
