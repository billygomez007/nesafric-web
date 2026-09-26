import { AudienceHero } from "@/components/marketing/audience-hero";
import { LeadInboxFragment } from "@/components/marketing/product-fragments";

export function ProfessionalsHero() {
  return (
    <AudienceHero
      audience="For agents, brokers, brokerages and real estate companies"
      fragment={<LeadInboxFragment />}
      lede="Publish to the NesAfric marketplace, answer every enquiry, book viewings and keep your team on the same pipeline — whether you work alone or run a full brokerage."
      note="Free for marketplace professionals during the Ghana launch."
      primary={{ label: "Join free", href: "/register", event: "join_free_click", placement: "professionals_hero" }}
      secondary={{ label: "Browse the marketplace", href: "/marketplace/properties", event: "marketplace_visit_click", placement: "professionals_hero" }}
      title="Your listings, leads and viewings in one place."
    />
  );
}
