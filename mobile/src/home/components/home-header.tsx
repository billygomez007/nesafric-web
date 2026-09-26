import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, spacing } from "@/theme/tokens";

/** NesAfric logo (the real brand asset) and the account shortcut. */
export function HomeHeader() {
  return (
    <View style={styles.bar}>
      <Image source={require("../../../assets/images/nesafric-logo.png")} style={styles.logo} contentFit="contain" accessibilityLabel="NesAfric" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account"
        hitSlop={8}
        onPress={() => router.navigate("/account")}
        style={({ pressed }) => [styles.account, pressed && styles.pressed]}
      >
        <Ionicons name="person-outline" size={22} color={colors.forest} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  logo: { width: 136, height: 44 },
  account: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: { backgroundColor: colors.surface },
});
