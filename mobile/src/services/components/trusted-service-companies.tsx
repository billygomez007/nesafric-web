import { Image } from "expo-image";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useProviderCollection } from "@/api/service-queries";
import { AppText } from "@/components/ui";
import { HOME_GUTTER } from "@/home/components/layout";
import { SectionHeading } from "@/home/components/section-heading";
import { resolveMediaUrl } from "@/marketplace/format";
import { openProvider, openProviderSearch } from "@/services/navigation";
import { useApi } from "@/api/provider";
import { colors, fonts, radii } from "@/theme/tokens";

export function TrustedServiceCompanies() {
  const { apiUrl } = useApi();
  const query = useProviderCollection({ providerType: "COMPANY" }, 24);

  const companies = (query.data?.items ?? []).filter(
    (provider) =>
      provider.type === "COMPANY"
      && provider.verification === "VERIFIED"
      && Boolean(provider.logo?.url),
  );

  if (!companies.length) return null;

  return (
    <View style={styles.section}>
      <SectionHeading
        size="small"
        title="Trusted by leading service companies"
        action={{
          label: "See all",
          onPress: () => openProviderSearch({ providerType: "COMPANY" }),
        }}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
        accessibilityLabel="Verified service companies"
      >
        {companies.map((company) => (
          <Pressable
            key={company.id}
            accessibilityRole="link"
            accessibilityLabel={`${company.displayName}, verified service company`}
            onPress={() => openProvider(company.id)}
            style={({ pressed }) => [
              styles.tile,
              pressed && styles.pressed,
            ]}
          >
            <Image
              source={{
                uri: resolveMediaUrl(company.logo!.url, apiUrl),
              }}
              style={styles.logo}
              contentFit="contain"
              accessibilityIgnoresInvertColors
            />
            <AppText style={styles.name} numberOfLines={1}>
              {company.displayName}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },

  rail: {
    paddingHorizontal: HOME_GUTTER,
    gap: 10,
  },

  tile: {
    width: 132,
    height: 92,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    gap: 6,
  },

  pressed: {
    opacity: 0.82,
  },

  logo: {
    width: 88,
    height: 48,
  },

  name: {
    width: "100%",
    textAlign: "center",
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    color: colors.forestDeep,
  },
});
