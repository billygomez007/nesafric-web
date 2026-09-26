import { AudienceHero } from "@/components/marketing/audience-hero";
import { DevelopmentInventoryFragment } from "@/components/marketing/product-fragments";

export function DevelopersHero() {
  return (
    <AudienceHero
      audience="For property developers"
      fragment={<DevelopmentInventoryFragment />}
      lede="Show each development and its units, keep availability current floor by floor, sell through the NesAfric marketplace — and move delivered units straight into property management when you're ready."
      note="Free for marketplace professionals during the Ghana launch."
      primary={{ label: "Join free", href: "/register", event: "join_free_click", placement: "developers_hero" }}
      secondary={{ label: "Browse the marketplace", href: "/marketplace/properties", event: "marketplace_visit_click", placement: "developers_hero" }}
      title="Sell every unit, floor by floor."
    />
  );
}
