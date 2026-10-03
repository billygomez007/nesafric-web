import { useMemo, type ReactElement } from "react";
import { FlatList, RefreshControl, StyleSheet } from "react-native";

import { useProviderCollection } from "@/api/service-queries";
import { HOME_SECTION_GAP } from "@/home/components/layout";
import { ServiceProvidersSection } from "@/services/components/services-home";
import { colors } from "@/theme/tokens";
import {
  ALL_PROVIDERS_SHOWN,
  ALL_PROVIDERS_SIZE,
  AVAILABLE_NOW,
  COMPANIES,
  INDIVIDUALS,
  popularProviderCities,
  popularServices,
  serviceCollection,
  TOP_RATED,
  type ProviderCollection,
} from "./collections";
import { ProviderCitiesSection, ProviderCollectionSection } from "./section";

type FeedItem =
  | { key: string; type: "all" }
  | { key: string; type: "cities" }
  | { key: string; type: "collection"; collection: ProviderCollection };

/**
 * The Service Providers Home feed: the same shape as the Properties discovery feed. One vertical,
 * virtualised list of shelves under the header.
 *
 * Loading: only the first page of providers is fetched up front. It drives the always-on
 * "Service providers" shelf, the city tiles and which services get a shelf of their own. Every
 * other shelf fetches inside its own section, and the list mounts sections only as they approach
 * the screen, so lower shelves cost nothing on a slow connection until someone scrolls. A shelf
 * with too few providers, or whose request fails, is left out.
 */
export function ServicesDiscoveryFeed({ header, refreshing, onRefresh, bottomInset }: { header: ReactElement; refreshing: boolean; onRefresh: () => void; bottomInset: number }) {
  const first = useProviderCollection({}, ALL_PROVIDERS_SIZE);
  const providers = useMemo(() => first.data?.items ?? [], [first.data]);
  const services = useMemo(() => popularServices(providers), [providers]);
  const cities = useMemo(() => popularProviderCities(providers), [providers]);

  const items = useMemo<FeedItem[]>(() => {
    const collection = (c: ProviderCollection): FeedItem => ({ key: c.key, type: "collection", collection: c });
    const [firstService, ...otherServices] = services.map(serviceCollection);
    return [
      { key: "all", type: "all" },
      collection(TOP_RATED),
      collection(AVAILABLE_NOW),
      ...(firstService ? [collection(firstService)] : []),
      { key: "cities", type: "cities" },
      collection(COMPANIES),
      ...otherServices.map(collection),
      collection(INDIVIDUALS),
    ];
  }, [services]);

  function renderItem({ item }: { item: FeedItem }) {
    switch (item.type) {
      case "all":
        return <ServiceProvidersSection query={first} shown={ALL_PROVIDERS_SHOWN} />;
      case "cities":
        return <ProviderCitiesSection cities={cities} />;
      case "collection":
        return <ProviderCollectionSection collection={item.collection} />;
    }
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={styles.header}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
      initialNumToRender={4}
      maxToRenderPerBatch={2}
      windowSize={5}
      testID="services-home-feed"
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 4 },
  header: { gap: HOME_SECTION_GAP, marginBottom: HOME_SECTION_GAP + 8 },
});
