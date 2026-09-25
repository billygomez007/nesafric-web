import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ListingCard } from "@/components/listing-card";
import { AppText, Loading, StateMessage } from "@/components/ui";
import { openSearch } from "@/marketplace/navigation";
import { useSaved } from "@/marketplace/saved";
import { colors, spacing } from "@/theme/tokens";

export default function SavedScreen() {
  const { ready, items } = useSaved();

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <View style={styles.header}>
        <AppText variant="title">Saved</AppText>
        <AppText variant="caption">Saved on this device. Syncing across devices will need an account.</AppText>
      </View>
      {!ready ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.listing.id}
          renderItem={({ item }) => <ListingCard listing={item.listing} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <StateMessage
              title="No saved properties yet"
              message="Tap the heart on any property to keep it here."
              actionLabel="Browse properties"
              onAction={() => openSearch({})}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.xs },
  list: { padding: spacing.xl, paddingTop: spacing.md, gap: spacing.lg, flexGrow: 1 },
});
