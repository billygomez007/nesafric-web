import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { colors } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";

/** NesAfric logo (the real brand asset) and the account shortcut. */
export function HomeHeader() {
  return (
    <View style={styles.bar}>
      <Image source={require("../../../assets/images/nesafric-logo.png")} style={styles.logo} contentFit="contain" contentPosition="left" accessibilityLabel="NesAfric" />
      <Pressable accessibilityRole="button" accessibilityLabel="Account" hitSlop={10} onPress={() => router.navigate("/account")} style={({ pressed }) => pressed && styles.pressed}>
        <MaterialCommunityIcons name="account-circle-outline" size={36} color={colors.forestDeep} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: HOME_GUTTER, paddingTop: 0, marginBottom: -4 },
  logo: { width: 158, height: 46 },
  pressed: { opacity: 0.6 },
});
