import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useApi } from "@/api/provider";
import { BRAND } from "@/brand";
import { AppText, Card } from "@/components/ui";
import { colors, radii, spacing } from "@/theme/tokens";

/**
 * Account entry point (brief §6). Sign-in and account creation arrive with Phase 1B once the mobile
 * session design is approved, so this screen does not show sign-in buttons that can't work yet.
 */
export default function AccountScreen() {
  const { apiUrl } = useApi();
  const version = Constants.expoConfig?.version ?? "";

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="title">Account</AppText>
        <Card style={styles.intro}>
          <AppText variant="heading">Sign-in is coming soon</AppText>
          <AppText variant="caption">
            You don’t need an account to browse, save properties on this device, or contact a lister. Soon you’ll be able to sign in with your
            NesAfric account to sync saves and manage your properties, listings or services.
          </AppText>
        </Card>

        <View style={styles.group}>
          <Row icon="help-buoy-outline" label="Help & support" detail={BRAND.contact.support} onPress={() => Linking.openURL(`mailto:${BRAND.contact.support}`)} />
          <Row icon="call-outline" label="Call us" detail={BRAND.contact.phoneDisplay} onPress={() => Linking.openURL(`tel:${BRAND.contact.phoneTel}`)} />
          <Row icon="shield-checkmark-outline" label="Privacy policy" onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/privacy`)} />
          <Row icon="document-text-outline" label="Terms of service" onPress={() => WebBrowser.openBrowserAsync(`${apiUrl}/terms`)} />
        </View>

        <AppText variant="caption" style={styles.version}>
          NesAfric {version}
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, detail, onPress }: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Ionicons name={icon} size={22} color={colors.forest} />
      <View style={styles.rowText}>
        <AppText variant="label">{label}</AppText>
        {detail ? <AppText variant="caption">{detail}</AppText> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  intro: { gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.gold },
  group: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { flex: 1, gap: 2 },
  version: { textAlign: "center" },
});
