import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { createEnquiry, requestViewing } from "@/api/marketplace";
import { useApi } from "@/api/provider";
import { useListing } from "@/api/queries";
import { Checkbox } from "@/components/checkbox";
import { Chip } from "@/components/chip";
import { QueryState } from "@/components/query-state";
import { AppText, Button, Card, Notice, TextField } from "@/components/ui";
import {
  deviceTimeZone,
  EMPTY_ENQUIRY,
  MAX_VIEWING_SLOTS,
  toLeadInput,
  upcomingViewingSlots,
  validateEnquiry,
  type EnquiryErrors,
  type EnquiryForm,
} from "@/marketplace/enquiry";
import { formatListingPrice } from "@/marketplace/format";
import { colors, spacing } from "@/theme/tokens";

type Outcome = { kind: "sent"; viewing: boolean } | { kind: "viewingFailed"; message: string };

/**
 * Guest enquiry / viewing request (no account). Uses the existing public endpoints:
 * POST /api/public/listings/:id/leads, then /viewings with the returned lead id.
 */
export default function EnquireScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const viewing = mode === "viewing";
  const { api } = useApi();
  const insets = useSafeAreaInsets();
  const listingQuery = useListing(id);
  const listing = listingQuery.data?.listing;

  const [form, setForm] = useState<EnquiryForm>(EMPTY_ENQUIRY);
  const [errors, setErrors] = useState<EnquiryErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const availableSlots = useMemo(() => upcomingViewingSlots(new Date()), []);

  const update = (patch: Partial<EnquiryForm>) => setForm((current) => ({ ...current, ...patch }));

  function toggleSlot(key: string) {
    setSlots((current) => (current.includes(key) ? current.filter((slot) => slot !== key) : current.length >= MAX_VIEWING_SLOTS ? current : [...current, key]));
  }

  async function submit() {
    if (inFlight.current || !id) return;
    const nextErrors = validateEnquiry(form, { requireSlots: viewing, slotCount: slots.length });
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;

    inFlight.current = true;
    setSubmitting(true);
    try {
      const lead = await createEnquiry(api, id, toLeadInput(form, viewing ? "VIEWING" : "CONTACT"));
      if (viewing) {
        const chosen = availableSlots.filter((slot) => slots.includes(slot.key));
        try {
          await requestViewing(api, id, {
            leadId: lead.id,
            preferredTimes: chosen.map((slot) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), timezone: deviceTimeZone() })),
            requesterNote: form.message.trim() || undefined,
          });
        } catch (error) {
          // The enquiry itself went through; say so instead of inviting a duplicate submission.
          setOutcome({ kind: "viewingFailed", message: error instanceof Error ? error.message : "The viewing request didn't go through." });
          return;
        }
      }
      setOutcome({ kind: "sent", viewing });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length) {
        const fieldErrors: EnquiryErrors = {};
        for (const issue of error.issues) {
          if (issue.path === "name" || issue.path === "phone" || issue.path === "email" || issue.path === "message") fieldErrors[issue.path] = issue.message;
        }
        setErrors(fieldErrors);
      }
      setFormError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const title = viewing ? "Schedule a viewing" : "Contact agent";

  if (!listing) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title }} />
        <QueryState isPending={listingQuery.isPending} error={listingQuery.error} onRetry={() => listingQuery.refetch()} />
      </View>
    );
  }

  if (outcome) {
    return (
      <View style={[styles.screen, styles.done]}>
        <Stack.Screen options={{ title }} />
        <Card style={styles.doneCard}>
          <AppText variant="title">{outcome.kind === "sent" ? (outcome.viewing ? "Viewing request sent" : "Message sent") : "Message sent"}</AppText>
          <AppText>
            {outcome.kind === "sent"
              ? `We've passed your ${outcome.viewing ? "viewing request" : "enquiry"} for "${listing.title}" to the lister. They'll contact you using the details you gave.`
              : `Your enquiry for "${listing.title}" reached the lister, but the viewing times didn't go through (${outcome.message}). Mention your preferred times when they contact you.`}
          </AppText>
          <AppText variant="caption">NesAfric doesn’t guarantee a response time. Never pay a deposit before viewing a property in person.</AppText>
          <Button label="Done" onPress={() => router.back()} testID="enquiry-done" />
        </Card>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View>
          <AppText variant="label">{listing.title}</AppText>
          <AppText variant="caption">{formatListingPrice(listing) ?? "Price on request"}</AppText>
        </View>
        <AppText variant="caption">No account needed. Give a phone number or email so the lister can reply.</AppText>
        {formError ? <Notice message={formError} /> : null}

        <TextField label="Your name" value={form.name} onChangeText={(name) => update({ name })} autoComplete="name" textContentType="name" error={errors.name} />
        <TextField
          label="Phone"
          value={form.phone}
          onChangeText={(phone) => update({ phone })}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder="e.g. 024 123 4567"
          error={errors.phone}
        />
        <TextField
          label="Email (optional if you give a phone)"
          value={form.email}
          onChangeText={(email) => update({ email })}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          error={errors.email}
        />

        {viewing ? (
          <View style={styles.slots}>
            <AppText variant="label">When suits you? (up to {MAX_VIEWING_SLOTS})</AppText>
            <AppText variant="caption">The lister will confirm an exact time with you.</AppText>
            {groupByDay(availableSlots).map(([day, daySlots]) => (
              <View key={day} style={styles.day}>
                <AppText variant="caption" style={styles.dayLabel}>
                  {day}
                </AppText>
                <View style={styles.dayChips}>
                  {daySlots.map((slot) => (
                    <Chip key={slot.key} label={slot.periodLabel} selected={slots.includes(slot.key)} onPress={() => toggleSlot(slot.key)} />
                  ))}
                </View>
              </View>
            ))}
            {errors.slots ? <AppText style={styles.error}>{errors.slots}</AppText> : null}
          </View>
        ) : null}

        <TextField
          label="Message (optional)"
          value={form.message}
          onChangeText={(message) => update({ message })}
          multiline
          numberOfLines={4}
          style={styles.message}
          placeholder={viewing ? "Anything the lister should know?" : "Hi, is this property still available?"}
          error={errors.message}
        />

        <Checkbox
          testID="share-consent"
          checked={form.shareConsent}
          onChange={(shareConsent) => update({ shareConsent })}
          label="I agree that NesAfric may share my name and contact details with this property's lister so they can respond."
          error={errors.shareConsent}
        />
        <Checkbox
          checked={form.marketingConsent}
          onChange={(marketingConsent) => update({ marketingConsent })}
          label="The lister may also contact me about similar properties. (Optional)"
        />

        <Button label={viewing ? "Send viewing request" : "Send message"} onPress={submit} loading={submitting} testID="submit-enquiry" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function groupByDay<T extends { dayLabel: string }>(slots: T[]) {
  const days = new Map<string, T[]>();
  for (const slot of slots) days.set(slot.dayLabel, [...(days.get(slot.dayLabel) ?? []), slot]);
  return [...days.entries()];
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  slots: { gap: spacing.sm },
  day: { gap: spacing.xs },
  dayLabel: { fontFamily: "NotoSans-Bold", color: colors.ink },
  dayChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  message: { minHeight: 96, textAlignVertical: "top", paddingTop: spacing.md },
  error: { color: colors.danger, fontSize: 13 },
  done: { justifyContent: "center", padding: spacing.xl },
  doneCard: { gap: spacing.md, padding: spacing.xl },
});
