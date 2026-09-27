import { router } from "expo-router";

import { useProListings } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { AppText } from "@/components/ui";
import { formatMoney, humanise } from "@/marketplace/format";
import { StatusPill, useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, QuerySection, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

function price(listing: { amountMinor: string | null; currencyCode: string; listingType: string; frequency: string | null }) {
  if (!listing.amountMinor) return null;
  const amount = formatMoney(listing.amountMinor, listing.currencyCode);
  return listing.listingType === "RENT" && listing.frequency ? `${amount} · ${humanise(listing.frequency)}` : amount;
}

/** The profile's own listings. Published ones open their public page; editing happens on the website. */
export default function ListingsTab() {
  const { scope } = useWorkspaceGate("professional", useWorkspaceParam("professional"));
  const listings = useProListings(scope?.id ?? null);
  if (!scope) return null;
  return (
    <WorkspaceScroll refreshing={listings.isRefetching} onRefresh={() => void listings.refetch()}>
      <QuerySection query={listings} what="listings">
        {(page) =>
          page.items.length === 0 ? (
            <EmptyCard message="No listings yet. Create them on nesafric.com." testID="listings-empty" />
          ) : (
            <>
              {page.total > page.items.length ? <AppText variant="caption">{`Showing the latest ${page.items.length} of ${page.total} listings.`}</AppText> : null}
              <RowGroup>
                {page.items.map((listing, index) => (
                  <ListRow
                    key={listing.id}
                    icon="home-outline"
                    title={listing.title}
                    detail={[humanise(listing.listingType), price(listing)].filter(Boolean).join(" · ")}
                    meta={humanise(listing.verificationStatus)}
                    trailing={<StatusPill status={listing.status} />}
                    onPress={listing.status === "PUBLISHED" ? () => router.push({ pathname: "/listing/[id]", params: { id: listing.id } }) : undefined}
                    testID={`pro-listing-${listing.id}`}
                    last={index === page.items.length - 1}
                  />
                ))}
              </RowGroup>
            </>
          )
        }
      </QuerySection>
    </WorkspaceScroll>
  );
}
