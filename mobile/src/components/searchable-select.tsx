import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppText } from "@/components/ui";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

export function SearchableSelect({
  label,
  value,
  options,
  placeholder = "Select",
  disabled = false,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();

    if (!needle) return options;

    return options.filter((option) =>
      option.toLocaleLowerCase().includes(needle),
    );
  }, [options, query]);

  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>

      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={[
          styles.control,
          disabled && styles.disabled,
        ]}
      >
        <AppText
          style={value ? styles.value : styles.placeholder}
          numberOfLines={1}
        >
          {value || placeholder}
        </AppText>

        <Ionicons
          name="chevron-down"
          size={18}
          color={colors.muted}
        />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />

          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <AppText variant="heading">{label}</AppText>
                <AppText variant="caption">
                  Search or choose from the list.
                </AppText>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
                style={styles.close}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={colors.forestDeep}
                />
              </Pressable>
            </View>

            <View style={styles.search}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.muted}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${label.toLowerCase()}`}
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                style={styles.input}
              />
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: item === value,
                  }}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    item === value && styles.optionSelected,
                  ]}
                >
                  <AppText style={styles.optionText}>
                    {item}
                  </AppText>

                  {item === value ? (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={colors.forestDeep}
                    />
                  ) : null}
                </Pressable>
              )}
              ListEmptyComponent={
                <AppText variant="caption" style={styles.empty}>
                  No matching location.
                </AppText>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },

  control: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.control,
    backgroundColor: colors.elevated,
  },

  disabled: {
    backgroundColor: colors.surface,
  },

  value: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
  },

  placeholder: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
  },

  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },

  sheet: {
    height: "75%",
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
  },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },

  headerText: {
    flex: 1,
    gap: 2,
  },

  close: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.elevated,
  },

  search: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.control,
    backgroundColor: colors.elevated,
  },

  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
  },

  option: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },

  optionSelected: {
    backgroundColor: colors.cream,
  },

  optionText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
  },

  empty: {
    paddingVertical: spacing.xl,
    textAlign: "center",
  },
});
