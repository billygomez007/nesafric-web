import { router } from "expo-router";

import { useProListings } from "@/api/workspace-queries";
import { ListRow, RowGroup } from "@/components/list-row";
import { AppText, Button } from "@/components/ui";
import { formatMoney, humanise } from "@/marketplace/format";
import { priceUnitSuffix } from "@/marketplace/price-units";
import { StatusPill, useWorkspaceGate } from "@/workspace/inbox-ui";
import { EmptyCard, QuerySection, useWorkspaceParam, WorkspaceScroll } from "@/workspace/shell";

function price(listing: { amountMinor: string | null; currencyCode: string; listingType: string; frequency: string | null }) {
  if (!listing.amountMinor) return null;
  return `${formatMoney(listing.amountMinor, listing.currencyCode)}${priceUnitSuffix(listing.listingType, listing.frequency)}`;
}

/**
 * The profile's own listings, managed in the app: Add listing opens the native editor; a draft,
 * returned or paused listing opens the editor, a live one opens its public page, and one in review
 * opens the editor read-only.
 */
export default function ListingsTab() {
  const { scope } = useWorkspaceGate("professional", useWorkspaceParam("professional"));
  const listings = useProListings(scope?.id ?? null);
  if (!scope) return null;
  const openEditor = (listingId?: string) =>
    listingId
      ? router.push({ pathname: "/agent/[professionalId]/listing/[listingId]", params: { professionalId: scope.id, listingId } })
      : router.push({ pathname: "/agent/[professionalId]/listing/new", params: { professionalId: scope.id } });
  return (
    <WorkspaceScroll refreshing={listings.isRefetching} onRefresh={() => void listings.refetch()}>
      <Button label="Add listing" onPress={() => openEditor()} testID="add-listing" />
      <QuerySection query={listings} what="listings">
        {(page) =>
          page.items.length === 0 ? (
            <EmptyCard message="No listings yet. Add your first listing — it stays private until NesAfric approves it." testID="listings-empty" />
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
                    onPress={listing.status === "PUBLISHED" ? () => router.push({ pathname: "/listing/[id]", params: { id: listing.id } }) : () => openEditor(listing.id)}
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
