import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Button } from "@/components/ui";
import { openAdvancedSearch } from "@/marketplace/navigation";
import { colors, fonts, radii } from "@/theme/tokens";
import { HOME_GUTTER } from "./layout";
import { useReduceMotion } from "./logo-rail";

/**
 * Whether AI property search is live. Nothing behind it exists yet — no recording, no speech
 * recognition, no model — so the sheet says so instead of pretending.
 *
 * The planned flow, each step replacing a branch of `AssistantStatus` below:
 *   idle → listening (microphone) → transcribing (speech-to-text) → understanding (natural
 *   language → structured `SearchFilters`) → results (recommended listings, opened with
 *   `openSearch` / the listing screen).
 */
export const AI_SEARCH_AVAILABLE = false;

type AssistantStatus = { kind: "idle" } | { kind: "unavailable" };

const EXAMPLE_QUERY = "3-bedroom house in East Legon under GH₵3 million";

/** Height of the floating pill plus its gap above the tab bar — Home pads its content by this. */
export const AI_BUTTON_CLEARANCE = 48 + 16 + 16;

/**
 * Floating "Speak to AI" entry point for Home. It sits above the tab bar in a `box-none` layer,
 * so only the pill itself receives touches; everything around it scrolls and taps as before.
 * Its one animation (a soft entrance) runs on the native driver and is skipped with Reduce Motion.
 */
export function AiPropertyAssistant() {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReduceMotion();
  const [entrance] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    const animation = Animated.timing(entrance, { toValue: 1, duration: 260, delay: 400, useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [entrance, reduceMotion]);

  return (
    <>
      <View style={styles.layer} testID="speak-to-ai-layer">
        <Animated.View
          style={{
            opacity: entrance,
            transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Speak to AI"
            accessibilityHint="Opens AI property search"
            onPress={() => setOpen(true)}
            hitSlop={6}
            style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
            testID="speak-to-ai"
          >
            <MaterialCommunityIcons name="microphone" size={20} color="#ffffff" />
            <AppText style={styles.pillLabel}>Speak to AI</AppText>
          </Pressable>
        </Animated.View>
      </View>
      <AiSearchSheet visible={open} onClose={() => setOpen(false)} reduceMotion={reduceMotion} />
    </>
  );
}

function AiSearchSheet({ visible, onClose, reduceMotion }: { visible: boolean; onClose: () => void; reduceMotion: boolean }) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<AssistantStatus>({ kind: "idle" });
  // The backdrop fades (Modal) while only the sheet rises, on the native driver.
  const [rise] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      rise.setValue(1);
      return;
    }
    rise.setValue(0);
    const animation = Animated.timing(rise, { toValue: 1, duration: 240, useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, rise, visible]);
  const close = () => {
    setStatus({ kind: "idle" });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityElementsHidden importantForAccessibility="no" />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
            { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] },
          ]}
          accessibilityViewIsModal
          accessibilityLabel="AI property search"
          testID="ai-search-sheet"
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <AppText accessibilityRole="header" style={styles.title}>Find property with AI</AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={10} style={styles.close}>
              <MaterialCommunityIcons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <AppText style={styles.body}>Tell NesAfric what kind of property you&apos;re looking for.</AppText>

          <View style={styles.example} accessibilityLabel={`For example: ${EXAMPLE_QUERY}`}>
            <AppText style={styles.exampleLabel}>For example</AppText>
            <AppText style={styles.exampleText}>“{EXAMPLE_QUERY}”</AppText>
          </View>

          <View style={styles.micArea}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={AI_SEARCH_AVAILABLE ? "Start voice search" : "Voice search, coming soon"}
              onPress={() => setStatus({ kind: "unavailable" })}
              style={({ pressed }) => [styles.mic, pressed && styles.micPressed]}
              testID="ai-mic"
            >
              <MaterialCommunityIcons name="microphone-outline" size={34} color={colors.forest} />
            </Pressable>
            <AppText style={styles.micCaption} accessibilityLiveRegion="polite">
              {status.kind === "unavailable"
                ? "AI voice search is coming soon. Nothing was recorded — for now, use Search or Advanced Search."
                : "AI voice search is coming soon."}
            </AppText>
          </View>

          <Button
            label="Use Advanced Search"
            variant="secondary"
            onPress={() => {
              close();
              openAdvancedSearch();
            }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Fills the screen above the tab bar but passes every touch through except the pill's own.
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "box-none", justifyContent: "flex-end", alignItems: "flex-end", paddingRight: HOME_GUTTER, paddingBottom: 16 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    paddingLeft: 16,
    paddingRight: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.forest,
    shadowColor: "#002f2b",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  pillPressed: { backgroundColor: colors.forestDeep },
  pillLabel: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, color: "#ffffff" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 32, 29, 0.38)" },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: HOME_GUTTER,
    paddingTop: 8,
    gap: 14,
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.hairline },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 21, lineHeight: 27, color: colors.forestDeep },
  close: { width: 44, height: 44, marginRight: -10, alignItems: "center", justifyContent: "center" },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.muted, marginTop: -8 },
  example: { borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, padding: 12, gap: 2 },
  exampleLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.4, color: colors.muted, textTransform: "uppercase" },
  exampleText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink },
  micArea: { alignItems: "center", gap: 10, paddingVertical: 6 },
  mic: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  micPressed: { opacity: 0.8 },
  micCaption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: "center", maxWidth: 300 },
});
