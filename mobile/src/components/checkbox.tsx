import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "@/theme/tokens";
import { AppText } from "./ui";

export function Checkbox({ checked, onChange, label, error, testID }: { checked: boolean; onChange: (checked: boolean) => void; label: string; error?: string; testID?: string }) {
  return (
    <View style={styles.wrap}>
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        onPress={() => onChange(!checked)}
        style={styles.row}
        hitSlop={4}
      >
        <View style={[styles.box, checked && styles.boxChecked, error && !checked ? styles.boxError : null]}>
          {checked ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
        </View>
        <AppText style={styles.label}>{label}</AppText>
      </Pressable>
      {error ? <AppText style={styles.error}>{error}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  box: {
    width: 24,
    height: 24,
    marginTop: 1,
    borderRadius: radii.control / 2,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.elevated,
  },
  boxChecked: { backgroundColor: colors.forest, borderColor: colors.forest },
  boxError: { borderColor: colors.danger },
  label: { flex: 1, fontSize: 15, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13, marginLeft: 36 },
});
