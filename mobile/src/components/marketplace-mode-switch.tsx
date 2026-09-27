import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, StyleSheet, View } from "react-native";

import { useMarketplaceMode, type MarketplaceMode } from "@/marketplace/mode";
import { colors, fonts, radii } from "@/theme/tokens";
import { AppText } from "./ui";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const OPTIONS: { mode: MarketplaceMode; label: string; icon: IconName }[] = [
  { mode: "properties", label: "Properties", icon: "home-city-outline" },
  { mode: "services", label: "Service Providers", icon: "account-hard-hat-outline" },
];

/**
 * Properties | Service Providers — the two NesAfric marketplaces, switched in place. Bound to the
 * shared marketplace mode (Home and Search) unless `value`/`onChange` are given, as Saved does for
 * its own sections without changing where Home and Search are.
 */
export function MarketplaceModeSwitch({
  style,
  value,
  onChange,
  label = "Marketplace",
  testIDPrefix = "marketplace-mode",
}: {
  style?: object;
  value?: MarketplaceMode;
  onChange?: (mode: MarketplaceMode) => void;
  label?: string;
  testIDPrefix?: string;
}) {
  const shared = useMarketplaceMode();
  const mode = value ?? shared.mode;
  const setMode = onChange ?? shared.setMode;
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.track, style]}>
      {OPTIONS.map((option) => {
        const selected = option.mode === mode;
        return (
          <Pressable
            key={option.mode}
            testID={`${testIDPrefix}-${option.mode}`}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => setMode(option.mode)}
            style={({ pressed }) => [styles.segment, selected && styles.selected, pressed && !selected && styles.pressed]}
          >
            <MaterialCommunityIcons name={option.icon} size={17} color={selected ? colors.white : colors.forestDeep} />
            <AppText numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.label, selected && styles.labelSelected]}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    padding: 3,
    gap: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  selected: { backgroundColor: colors.forest },
  pressed: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.forestDeep },
  labelSelected: { color: colors.white },
});
