import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";

import type { PublicListing } from "@/api/types";
import { useSaved } from "@/marketplace/saved";
import { colors } from "@/theme/tokens";

export function SaveButton({ listing, size = 20 }: { listing: PublicListing; size?: number }) {
  const { isSaved, toggle } = useSaved();
  const saved = isSaved(listing.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? `Remove ${listing.title} from saved` : `Save ${listing.title}`}
      accessibilityState={{ selected: saved }}
      hitSlop={8}
      onPress={() => toggle(listing)}
      style={styles.button}
      testID={`save-${listing.id}`}
    >
      <Ionicons name={saved ? "heart" : "heart-outline"} size={size} color={saved ? colors.gold : colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
});
