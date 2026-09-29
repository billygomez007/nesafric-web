import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewProps } from "react-native";

import { colors, radii, spacing } from "@/theme/tokens";
import { AppText } from "./ui";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** A bordered group of rows (settings-style list). */
export function RowGroup({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.group, style]} />;
}

/**
 * One row: optional icon, title, detail and a trailing element. Pressable rows get a chevron and
 * button semantics; plain rows are read as one accessible element.
 */
export function ListRow(props: {
  icon?: IconName;
  title: string;
  detail?: string | null;
  meta?: string | null;
  trailing?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  testID?: string;
  accessibilityHint?: string;
  selected?: boolean;
  /** Visually marks the row (e.g. the kind of workspace the person said they came for). */
  highlighted?: boolean;
}) {
  const { icon, title, detail, meta, trailing, onPress, last = false, testID, accessibilityHint, selected, highlighted = false } = props;
  const label = [title, detail, meta].filter(Boolean).join(", ");
  // Rows in a choice list (switcher) sit the icon in a tile that turns orange when chosen.
  const choice = selected !== undefined;
  const glyph = icon ? <Ionicons name={icon} size={22} color={selected ? colors.action : colors.forest} /> : null;
  const content = (
    <>
      {glyph && choice ? (
        <View style={[styles.tile, selected && styles.tileSelected]} accessibilityElementsHidden importantForAccessibility="no">
          {glyph}
        </View>
      ) : (
        glyph
      )}
      <View style={styles.text}>
        <AppText variant="label">{title}</AppText>
        {detail ? <AppText variant="caption">{detail}</AppText> : null}
        {meta ? <AppText variant="caption">{meta}</AppText> : null}
      </View>
      {trailing}
      {onPress ? <Ionicons name={selected ? "checkmark-circle" : "chevron-forward"} size={selected ? 22 : 18} color={selected ? colors.action : colors.muted} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} testID={testID} style={[styles.row, last && styles.rowLast, highlighted && styles.highlighted]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, last && styles.rowLast, (highlighted || selected) && styles.highlighted, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.hairline, minHeight: 56 },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: colors.surface },
  // Marked or chosen: an orange edge on a white row, never an orange fill.
  highlighted: { borderLeftWidth: 3, borderLeftColor: colors.orange, paddingLeft: spacing.lg - 3 },
  tile: { width: 40, height: 40, borderRadius: radii.panel, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  tileSelected: { backgroundColor: colors.actionTint },
  text: { flex: 1, gap: 2 },
});
