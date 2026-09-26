import { AudienceHero } from "@/components/marketing/audience-hero";
import { RentLedgerFragment } from "@/components/marketing/product-fragments";

export function PropertyOwnersHero() {
  return (
    <AudienceHero
      audience="For owners, landlords and property managers"
      fragment={<RentLedgerFragment />}
      lede="Every building, unit, tenant, lease, rent payment and repair on one record — so you know who has paid, what is overdue and what needs fixing without chasing spreadsheets and WhatsApp threads."
      primary={{ label: "Start with NesAfric", href: "/register", event: "join_free_click", placement: "property_owners_hero" }}
      secondary={{ label: "See the Ghana launch", href: "/ghana" }}
      title="Know what every unit owes, and what it needs."
    />
  );
}
