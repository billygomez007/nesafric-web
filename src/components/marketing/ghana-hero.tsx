import { AudienceHero } from "@/components/marketing/audience-hero";
import { LeadInboxFragment } from "@/components/marketing/product-fragments";

export function GhanaHero() {
  return (
    <AudienceHero
      audience="Now live in Ghana"
      fragment={<LeadInboxFragment />}
      lede="NesAfric brings listings, leads, viewings, teams, rent and property operations onto one record — built in Accra for the way property works here, and ready for the rest of Africa."
      note="Marketplace professional accounts are free during the Ghana launch."
      primary={{ label: "Join NesAfric free", href: "/register", event: "join_free_click", placement: "ghana_hero" }}
      secondary={{ label: "Browse the marketplace", href: "/marketplace/properties", event: "marketplace_visit_click", placement: "ghana_hero" }}
      title="The operating system for real estate, now in Ghana."
    />
  );
}
