import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import {
  useProviderCollection,
  useServiceCategories,
} from "@/api/service-queries";
import type { ServiceCategory } from "@/api/types";
import { AppText, Button } from "@/components/ui";
import { FeaturedAdsCarousel } from "@/home/components/featured-ads-carousel";
import { HOME_GUTTER } from "@/home/components/layout";
import { SectionHeading } from "@/home/components/section-heading";
import { orderCategories } from "@/services/format";
import { openProviderSearch } from "@/services/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";
import { categoryIcon, CategoryTiles } from "./category-tiles";
import { InlineState } from "./inline-state";
import { ProviderCard } from "./provider-card";
import { TrustedServiceCompanies } from "./trusted-service-companies";

const HOME_PROVIDERS = 5;

/**
 * The eight primary categories approved for the Service Marketplace landing page.
 * The complete taxonomy remains available through each parent's subcategories/search;
 * the three later parent groups are deliberately not shown in this first rail.
 */
const PRIMARY_CATEGORY_KEYS = [
  "property_services_construction_building_works",
  "property_services_repairs_maintenance",
  "property_services_cleaning_property_care",
  "property_services_landscaping_outdoor",
  "property_services_energy_power_utilities",
  "property_services_security_access_safety",
  "property_services_interior_design_fitout",
  "property_services_architecture_engineering",
] as const;

export function ServicesHome() {
  const categoriesQuery = useServiceCategories();
  const providersQuery = useProviderCollection({}, HOME_PROVIDERS);
  const [text, setText] = useState("");
  const [selectedParent, setSelectedParent] =
    useState<ServiceCategory | null>(null);

  const ordered = useMemo(
    () => orderCategories(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const explicitParents = useMemo(
    () => ordered.filter((category) => category.parentId === null),
    [ordered],
  );

  const hierarchical = explicitParents.length > 0;

  const primaryCategories = useMemo(() => {
    if (!hierarchical) {
      // Backwards compatibility for older/local fixtures that predate the hierarchy.
      return ordered.slice(0, 8);
    }

    const byKey = new Map(
      explicitParents.map((category) => [category.key, category]),
    );

    return PRIMARY_CATEGORY_KEYS.flatMap((key) => {
      const category = byKey.get(key);
      return category ? [category] : [];
    });
  }, [explicitParents, hierarchical, ordered]);

  const subcategories = useMemo(
    () =>
      selectedParent
        ? orderCategories(
            ordered.filter(
              (category) => category.parentId === selectedParent.id,
            ),
          )
        : [],
    [ordered, selectedParent],
  );

  function selectCategory(category: ServiceCategory) {
    if (hierarchical && category.parentId === null) {
      setSelectedParent(category);
      return;
    }

    setSelectedParent(null);
    openProviderSearch({ service: category.key });
  }

  function submit() {
    const q = text.trim();
    if (q) openProviderSearch({ q });
  }

  const providers = providersQuery.data?.items ?? [];
  const total = providersQuery.data?.pagination.total ?? 0;

  return (
    <>
      <View style={styles.hero}>
        <AppText accessibilityRole="header" style={styles.title}>
          Find your perfect professional
        </AppText>

        <View style={styles.searchBox}>
          <MaterialCommunityIcons
            name="magnify"
            size={22}
            color={colors.muted}
          />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Search plumbers, electricians, cleaners…"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            accessibilityLabel="Search service providers"
            onSubmitEditing={submit}
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View>
          {!categoriesQuery.data ? (
            <View style={styles.gutter}>
              <InlineState
                loading={categoriesQuery.isPending}
                error={categoriesQuery.error}
                onRetry={() => categoriesQuery.refetch()}
                testID="service-categories-state"
              />
            </View>
          ) : !primaryCategories.length ? (
            <View style={styles.gutter}>
              <InlineState
                emptyTitle="No services listed yet"
                emptyMessage="Service categories will appear here once NesAfric publishes them."
              />
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.primaryRail}
              accessibilityLabel="Major service categories"
            >
              {Array.from(
                { length: Math.ceil(primaryCategories.length / 2) },
                (_, columnIndex) => {
                  const categories = primaryCategories.slice(
                    columnIndex * 2,
                    columnIndex * 2 + 2,
                  );

                  return (
                    <View
                      key={`service-category-column-${columnIndex}`}
                      style={styles.primaryColumn}
                    >
                      {categories.map((category) => (
                        <Pressable
                          key={category.id}
                          accessibilityRole="button"
                          accessibilityLabel={category.name}
                          testID={`service-category-${category.key}`}
                          onPress={() => selectCategory(category)}
                          style={({ pressed }) => [
                            styles.primaryCard,
                            pressed && styles.primaryCardPressed,
                          ]}
                        >
                          <View style={styles.primaryIcon}>
                            <MaterialCommunityIcons
                              name={categoryIcon(category.key)}
                              size={20}
                              color={colors.forestDeep}
                            />
                          </View>

                          <AppText style={styles.primaryLabel} numberOfLines={2}>
                            {category.name}
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  );
                },
              )}
            </ScrollView>
          )}
        </View>
      </View>

      <FeaturedAdsCarousel />

      <TrustedServiceCompanies />

      <View style={styles.section}>
        <SectionHeading
          title="Service providers"
          subtitle="Discover professionals and companies available on NesAfric."
          action={
            providers.length
              ? {
                  label: "See all",
                  onPress: () => openProviderSearch(),
                }
              : undefined
          }
        />

        <View style={[styles.gutter, styles.providers]}>
          {!providersQuery.data ? (
            <InlineState
              loading={providersQuery.isPending}
              error={providersQuery.error}
              onRetry={() => providersQuery.refetch()}
              testID="service-providers-state"
            />
          ) : !providers.length ? (
            <InlineState
              testID="service-providers-empty"
              emptyTitle="No service providers listed yet"
              emptyMessage="Service providers will appear here once they publish a marketplace profile."
            />
          ) : (
            <>
              {providers.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              ))}

              {total > providers.length ? (
                <Button
                  label={`See all ${total.toLocaleString()} providers`}
                  variant="dark"
                  onPress={() => openProviderSearch()}
                />
              ) : null}
            </>
          )}
        </View>
      </View>

      <Modal
        visible={Boolean(selectedParent)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedParent(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close service categories"
            onPress={() => setSelectedParent(null)}
          />

          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleWrap}>
                <AppText accessibilityRole="header" style={styles.sheetTitle}>
                  {selectedParent?.name}
                </AppText>
                <AppText style={styles.sheetSubtitle}>
                  Choose the service you need.
                </AppText>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setSelectedParent(null)}
                style={styles.closeButton}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={colors.forestDeep}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              {subcategories.length ? (
                <CategoryTiles
                  categories={subcategories}
                  onSelect={selectCategory}
                />
              ) : (
                <InlineState
                  emptyTitle="No subcategories listed yet"
                  emptyMessage="Services will appear here once NesAfric publishes them."
                />
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: HOME_GUTTER,
    gap: 6,
  },

  title: {
    fontFamily: fonts.bold,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.4,
    color: colors.forestDeep,
  },

  lead: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.muted,
    marginBottom: 6,
  },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    shadowColor: "#102d2a",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: 0,
  },

  section: {
    gap: 10,
  },

  gutter: {
    paddingHorizontal: HOME_GUTTER,
  },

  primaryRail: {
    paddingHorizontal: HOME_GUTTER,
    gap: 8,
  },

  primaryColumn: {
    width: 178,
    gap: 8,
  },

  primaryCard: {
    width: "100%",
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
    borderRadius: radii.shell,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
  },

  primaryCardPressed: {
    backgroundColor: colors.surface,
  },

  primaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
  },

  primaryLabel: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 17,
    color: colors.forestDeep,
  },

  providers: {
    gap: 12,
  },

  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },

  sheet: {
    maxHeight: "78%",
    paddingTop: 10,
    paddingBottom: spacing.xxl,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
  },

  sheetHandle: {
    width: 42,
    height: 4,
    alignSelf: "center",
    marginBottom: 12,
    borderRadius: 2,
    backgroundColor: colors.hairline,
  },

  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: HOME_GUTTER,
    paddingBottom: 14,
    gap: 12,
  },

  sheetTitleWrap: {
    flex: 1,
    gap: 2,
  },

  sheetTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.forestDeep,
  },

  sheetSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
    color: colors.muted,
  },

  closeButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.elevated,
  },

  sheetContent: {
    paddingHorizontal: HOME_GUTTER,
    paddingBottom: spacing.xxl,
  },
});
