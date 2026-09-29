import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { idempotencyKeyFor, type IdempotencySlot } from "@/api/idempotency";
import { requestBooking } from "@/api/marketplace";
import { useApi } from "@/api/provider";
import { useListing } from "@/api/queries";
import type { BookingRequested } from "@/api/types";
import { QueryState } from "@/components/query-state";
import { AppText, Button, Card, Notice, TextField } from "@/components/ui";
import { addDays, dayLabel, emptyBooking, guestsLabel, stayLimits, toBookingInput, upcomingDays, validateBooking, type BookingErrors, type BookingForm } from "@/marketplace/booking";
import { formatListingPrice } from "@/marketplace/format";
import { stayLabel } from "@/marketplace/listing-categories";
import { colors, fonts, radii, spacing } from "@/theme/tokens";

/**
 * Hotel / short-stay booking request (no account needed): POST /api/public/listings/:id/bookings.
 * The property confirms or declines it later; nothing here says the stay is confirmed.
 */
export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApi();
  const insets = useSafeAreaInsets();
  const listingQuery = useListing(id);
  const listing = listingQuery.data?.listing;

  const [form, setForm] = useState<BookingForm | null>(null);
  const [errors, setErrors] = useState<BookingErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<BookingRequested | null>(null);
  const inFlight = useRef(false);
  // Same key for an identical retry (no duplicate request after a timeout); new key if the form changes.
  const bookingKey = useRef<IdempotencySlot>(null);
  const days = useMemo(() => upcomingDays(new Date()), []);

  if (!listing) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Request booking" }} />
        <QueryState isPending={listingQuery.isPending} error={listingQuery.error} onRetry={() => listingQuery.refetch()} />
      </View>
    );
  }

  const state = form ?? emptyBooking(listing);
  const limits = stayLimits(listing);
  const update = (patch: Partial<BookingForm>) => setForm({ ...state, ...patch });
  const nightly = listing.pricing.frequency === "PER_NIGHT" ? formatListingPrice(listing) : null;
  const kind = stayLabel(listing.category) ?? "property";

  async function submit() {
    if (inFlight.current || !listing) return;
    const nextErrors = validateBooking(state, listing);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const input = toBookingInput(state);
      setSent(await requestBooking(api, listing.id, input, idempotencyKeyFor(bookingKey, input)));
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.code === "PUBLIC_WRITE_RATE_LIMITED"
          ? "You’ve sent several requests in a short time. Please wait a few minutes and try again."
          : error instanceof Error
            ? error.message
            : "Your booking request wasn’t sent. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <View style={[styles.screen, styles.done]}>
        <Stack.Screen options={{ title: "Request booking" }} />
        <Card style={styles.doneCard} testID="booking-sent">
          <AppText variant="title">Booking request sent</AppText>
          <AppText>Your booking request has been sent to the property. It isn’t confirmed yet: {sent.listingTitle} will confirm or decline it, and we’ll email you.</AppText>
          <Detail label="Property" value={sent.listingTitle} />
          <Detail label="Check-in" value={dayLabel(sent.checkIn)} />
          <Detail label="Check-out" value={dayLabel(sent.checkOut)} />
          <Detail label="Guests" value={guestsLabel(sent.adults, sent.children)} />
          <Detail label="Reference" value={sent.reference} />
          <Button label="Done" onPress={() => router.back()} testID="booking-done" />
        </Card>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Request booking" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View>
          <AppText variant="label">{listing.title}</AppText>
          <AppText variant="caption">
            {kind}
            {nightly ? ` · ${listing.category.toUpperCase() === "HOTEL" ? "from " : ""}${nightly}` : ""}
          </AppText>
        </View>
        <AppText variant="caption">No account needed. The property confirms or declines your request.</AppText>
        {formError ? <Notice message={formError} /> : null}

        <View style={styles.group}>
          <AppText variant="label">Check-in</AppText>
          <FlatList
            horizontal
            data={days}
            keyExtractor={(day) => day.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.days}
            accessibilityLabel="Check-in day"
            renderItem={({ item }) => {
              const selected = state.checkIn === item.key;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Check in ${dayLabel(item.key)}`}
                  accessibilityState={{ selected }}
                  onPress={() => update({ checkIn: item.key })}
                  style={[styles.day, selected && styles.daySelected]}
                  testID={`check-in-${item.key}`}
                >
                  <AppText style={[styles.dayWeek, selected && styles.dayTextSelected]}>{item.weekday}</AppText>
                  <AppText style={[styles.dayNumber, selected && styles.dayTextSelected]}>{item.day}</AppText>
                  <AppText style={[styles.dayWeek, selected && styles.dayTextSelected]}>{item.month}</AppText>
                </Pressable>
              );
            }}
          />
          {errors.checkIn ? <AppText style={styles.error}>{errors.checkIn}</AppText> : null}
        </View>

        <Stepper label="Nights" value={state.nights} min={limits.minimumNights} max={limits.maxNights} onChange={(nights) => update({ nights })} testID="nights" />
        <AppText variant="caption" testID="check-out-summary">
          {state.checkIn ? `Check-out ${dayLabel(addDays(state.checkIn, state.nights))}` : "Choose a check-in day"}
          {limits.minimumNights > 1 ? ` · ${limits.minimumNights}-night minimum` : ""}
          {listing.stay?.checkInTime ? ` · check-in from ${listing.stay.checkInTime}` : ""}
          {listing.stay?.checkOutTime ? ` · check-out by ${listing.stay.checkOutTime}` : ""}
        </AppText>
        {errors.nights ? <AppText style={styles.error}>{errors.nights}</AppText> : null}

        <Stepper label="Adults" value={state.adults} min={1} max={limits.maxGuests} onChange={(adults) => update({ adults })} testID="adults" />
        <Stepper label="Children" value={state.children} min={0} max={limits.maxGuests} onChange={(children) => update({ children })} testID="children" />
        {listing.stay?.maxGuests ? <AppText variant="caption">Up to {listing.stay.maxGuests} guests.</AppText> : null}
        {errors.guests ? <AppText style={styles.error}>{errors.guests}</AppText> : null}

        <TextField label="Full name" value={state.name} onChangeText={(name) => update({ name })} autoComplete="name" textContentType="name" error={errors.name} testID="booking-name" />
        <TextField label="Email" value={state.email} onChangeText={(email) => update({ email })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={errors.email} testID="booking-email" />
        <TextField label="Phone (optional)" value={state.phone} onChangeText={(phone) => update({ phone })} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="e.g. 024 123 4567" error={errors.phone} />
        <TextField label="Special requests (optional)" value={state.specialRequest} onChangeText={(specialRequest) => update({ specialRequest })} multiline numberOfLines={3} style={styles.message} error={errors.specialRequest} />
        {listing.stay?.houseRules ? (
          <View style={styles.group}>
            <AppText variant="label">House rules</AppText>
            <AppText variant="caption">{listing.stay.houseRules}</AppText>
          </View>
        ) : null}

        <Button label="Request booking" onPress={submit} loading={submitting} testID="submit-booking" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Stepper({ label, value, min, max, onChange, testID }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; testID: string }) {
  return (
    <View style={styles.stepper}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.stepperControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${label.toLowerCase()}`} accessibilityState={{ disabled: value <= min }} disabled={value <= min} hitSlop={6} onPress={() => onChange(value - 1)} style={[styles.stepButton, value <= min && styles.stepDisabled]} testID={`${testID}-less`}>
          <AppText style={styles.stepSign}>−</AppText>
        </Pressable>
        <AppText style={styles.stepValue} accessibilityLabel={`${label}: ${value}`} testID={`${testID}-value`}>{value}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel={`More ${label.toLowerCase()}`} accessibilityState={{ disabled: value >= max }} disabled={value >= max} hitSlop={6} onPress={() => onChange(value + 1)} style={[styles.stepButton, value >= max && styles.stepDisabled]} testID={`${testID}-more`}>
          <AppText style={styles.stepSign}>+</AppText>
        </Pressable>
      </View>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="label">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  group: { gap: spacing.sm },
  days: { gap: spacing.sm, paddingVertical: 2 },
  day: { width: 58, paddingVertical: spacing.sm, alignItems: "center", borderRadius: radii.panel, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated },
  daySelected: { borderColor: colors.action, backgroundColor: colors.action },
  dayWeek: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  dayNumber: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23, color: colors.ink },
  dayTextSelected: { color: colors.white },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.elevated, alignItems: "center", justifyContent: "center" },
  stepDisabled: { backgroundColor: colors.surface },
  stepSign: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24, color: colors.ink },
  stepValue: { minWidth: 28, textAlign: "center", fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  message: { minHeight: 88, textAlignVertical: "top", paddingTop: spacing.md },
  error: { color: colors.danger, fontSize: 13 },
  done: { padding: spacing.xl, justifyContent: "center" },
  doneCard: { gap: spacing.md },
  detail: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
});
