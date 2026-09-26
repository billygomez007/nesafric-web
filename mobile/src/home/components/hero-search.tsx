import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { AppText } from "@/components/ui";
import { openSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";

/** Hero heading and the free-text search, which hands off to the existing Search tab. */
export function HeroSearch() {
  const [q, setQ] = useState("");
  return (
    <View style={styles.hero}>
      <AppText accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.title}>
        Find your perfect property
      </AppText>
      <View style={styles.searchBox}>
        <MaterialCommunityIcons name="magnify" size={22} color={colors.muted} />
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
  hero: { paddingHorizontal: HOME_GUTTER, gap: 12 },
  title: { fontFamily: fonts.bold, fontSize: 25, lineHeight: 31, letterSpacing: -0.4, color: colors.forestDeep },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 42,
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
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.ink, paddingVertical: 0 },
});
