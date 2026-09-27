# Preview test fixtures (mobile account/workspace acceptance)

Staging-only data in the isolated Preview for branch `mobile/account-gateway-workspaces`. Production is not involved: this Preview uses its own Prisma Postgres database and Tigris buckets through branch-scoped Vercel variables. **Remove all of this once iPhone/Android acceptance is complete.**

## Accounts (`@preview.nesafric.test`, one shared private password kept outside the repo)

| Account | Purpose |
| --- | --- |
| `customer` | marketplace only |
| `landlord` | Property Management: "Preview Portfolio" (1 property, 1 unit, 1 tenant, 1 maintenance request) |
| `professional` | Professional workspace: "Preview Realty" (1 draft listing) |
| `provider` | Service Provider workspace: "Preview Plumbing" |
| `multi` | all three kinds: "Multi Portfolio", "Multi Realty", "Multi Services" |
| `second` | second user for sign-out / privacy checks |
| `admin` | staging `SUPER_ADMIN`, used only to verify and publish fixtures |
| `horizon`, `cedar`, `coastline`, `ashanti` | owners of the fictional companies below |
| `returnto-*` | left over from the `register?returnTo=` checks |

## Marketplace fixtures
Every fixture went through the normal APIs: owner creates, NesAfric admin verifies and publishes. All names are fictional.

- **Companies:** verified, with a logo, and published in Homepage Media in this order:
  1. Horizon Homes Ghana (Brokerage)
  2. Cedar Property Group (Real estate company)
  3. Coastline Developments (Developer)
  4. Ashanti Living (Property marketing company)
- **Listings:** 6 published and verified, each with 3 illustrated photos (one cover). Descriptions say "Preview test listing — not a real property".
  - Apartment for rent in Osu
  - House for sale in East Legon
  - Land for sale in Oyibi
  - Townhouse for rent in Cantonments
  - Office for rent in Airport City
  - Apartment for sale in Kumasi
- **Carousel:** three NesAfric-owned `MARKETPLACE_PRIMARY` campaigns, "Preview test campaign 1–3", with desktop, mobile and native creative.
- **Images:** synthetic illustrations watermarked "NesAfric Preview · test image". They are stored in the staging public bucket, which was made public-read.
- **`STORAGE_PUBLIC_BASE_URL`:** set for this branch to the bucket's virtual-hosted URL, because Tigris serves anonymous reads only on that URL form. Fixture URLs already stored were rewritten to it in the staging database.

## Removal
1. Delete the branch-scoped Preview variables for `mobile/account-gateway-workspaces` in Vercel.
2. Delete the Prisma Postgres databases `nesafric-mobile-gateway-preview-use1` and `nesafric-mobile-gateway-preview` (unused), and the buckets `nesafric-preview-public` and `nesafric-preview-private`.
