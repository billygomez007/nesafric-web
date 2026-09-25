import { Suspense } from "react";
import { MarketplaceDirectory } from "@/components/marketplace-directory";

export default function MarketplaceProfessionalDirectoryPage() {
  return <Suspense fallback={null}><MarketplaceDirectory /></Suspense>;
}
