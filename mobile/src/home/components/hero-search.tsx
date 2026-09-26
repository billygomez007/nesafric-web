import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { AppText } from "@/components/ui";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

/** Hero heading and the free-text search, which hands off to the existing Search tab. */
export function HeroSearch() {
  const [q, setQ] = useState("");
  return (
    <View style={styles.hero}>
      <AppText accessibilityRole="header" style={styles.title}>
        Find your perfect property
      </AppText>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Area, city or property"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          accessibilityLabel="Search by area, city or property"
          onSubmitEditing={() => openSearch({ q: q.trim() })}
          style={styles.input}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  title: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.4, color: colors.forest },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.elevated,
    shadowColor: "#102d2a",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.ink, paddingVertical: spacing.sm },
});
