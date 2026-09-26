import { router, Stack } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, NETWORK_ERROR } from "@/api/client";
import { createTenantMaintenanceRequest, type TenantMaintenanceRequest } from "@/api/tenant";
import { useRecordNewRequest, useTenancy } from "@/api/tenant-queries";
import { useSession } from "@/auth/session";
import { Chip } from "@/components/chip";
import { AppText, Button, Card, Notice, StateMessage, TextField } from "@/components/ui";
import {
  emptyMaintenanceForm,
  leaseLabel,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  toMaintenanceInput,
  validateMaintenance,
  type MaintenanceErrors,
  type MaintenanceForm,
} from "@/tenant/maintenance";
import { TenancyUnavailable } from "@/tenant/tenancy-state";
import { colors, spacing } from "@/theme/tokens";

const FIELDS = ["title", "description", "category"] as const;

/**
 * Report a repair for a home the user rents (POST /api/maintenance/requests as the linked tenant).
 * The server re-checks the tenant link and the current lease. One submission at a time; after an
 * unclear failure (offline, timeout, server error) the tenant must confirm before sending again,
 * because the first attempt may have been received.
 */
export function ReportProblemScreen({ tenancyId }: { tenancyId: string | undefined }) {
  const { api } = useSession();
  const insets = useSafeAreaInsets();
  const { tenancies, tenancy } = useTenancy(tenancyId);
  const recordNewRequest = useRecordNewRequest();
  const [form, setForm] = useState<MaintenanceForm>(() => emptyMaintenanceForm(tenancy));
  const [errors, setErrors] = useState<MaintenanceErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unclear, setUnclear] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<TenantMaintenanceRequest | null>(null);
  const inFlight = useRef(false);

  if (!tenancy) return <TenancyUnavailable tenancies={tenancies} />;
  if (!tenancy.leases.length) {
    return <StateMessage title="Repairs can’t be reported here" message={`There’s no current lease linked to your account. Contact ${tenancy.organisation.name} directly.`} />;
  }
  // The single lease is known once the tenancy has loaded (the form may have been created before).
  const leaseId = form.leaseId ?? (tenancy.leases.length === 1 ? tenancy.leases[0].id : null);
  const update = (patch: Partial<MaintenanceForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setUnclear(false);
  };

  async function submit() {
    if (inFlight.current || !tenancy) return;
    const current = { ...form, leaseId };
    const nextErrors = validateMaintenance(current);
    setErrors(nextErrors);
    setFormError(null);
    const input = toMaintenanceInput(tenancy, current);
    if (Object.keys(nextErrors).length || !input) return;

    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await createTenantMaintenanceRequest(api, tenancy, input);
      recordNewRequest(tenancy, result);
      setCreated(result);
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || error.code === NETWORK_ERROR || error.status >= 500;
      if (error instanceof ApiError && error.issues.length) {
        const fieldErrors: MaintenanceErrors = {};
        for (const issue of error.issues) if ((FIELDS as readonly string[]).includes(issue.path)) fieldErrors[issue.path as (typeof FIELDS)[number]] = issue.message;
        setErrors(fieldErrors);
      }
      setUnclear(uncertain);
      setFormError(
        uncertain
          ? "We couldn’t confirm that your report reached NesAfric. Check Your repair requests before sending it again."
          : error instanceof ApiError && error.code === "TENANT_LEASE_REQUIRED"
            ? "This home no longer has a current lease on your account, so the report wasn’t sent."
            : error instanceof ApiError && error.status === 403
              ? "Your account can’t report repairs for this home. Contact your landlord or property manager."
              : error instanceof Error
                ? error.message
                : "Something went wrong. Please try again.",
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <View style={[styles.screen, styles.done]}>
        <Stack.Screen options={{ title: "Report a problem" }} />
        <Card style={styles.doneCard}>
          <AppText variant="title">Problem reported</AppText>
          <AppText>
            {tenancy.organisation.name} has your report “{created.title}”. You can follow its progress under Your repair requests.
          </AppText>
          <AppText variant="caption">For anything dangerous, such as a gas smell, sparks or flooding, also call your landlord or the emergency services.</AppText>
          <Button
            label="View request"
            testID="view-created-request"
            onPress={() => router.replace({ pathname: "/home/[tenancyId]/request/[requestId]", params: { tenancyId: tenancy.tenantOrganisationId, requestId: created.id } })}
          />
          <Button label="Done" variant="secondary" onPress={() => router.back()} testID="report-done" />
        </Card>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Report a problem" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {formError ? <Notice tone={unclear ? "warning" : "danger"} message={formError} /> : null}

        {tenancy.leases.length > 1 ? (
          <View style={styles.choices}>
            <AppText variant="label">Which home?</AppText>
            <View style={styles.chips}>
              {tenancy.leases.map((lease) => (
                <Chip key={lease.id} label={leaseLabel(lease)} selected={leaseId === lease.id} onPress={() => update({ leaseId: lease.id })} />
              ))}
            </View>
            {errors.leaseId ? <AppText style={styles.error}>{errors.leaseId}</AppText> : null}
          </View>
        ) : (
          <View>
            <AppText variant="label">Home</AppText>
            <AppText variant="caption">{leaseLabel(tenancy.leases[0])}</AppText>
          </View>
        )}

        <View style={styles.choices}>
          <AppText variant="label">What kind of problem?</AppText>
          <View style={styles.chips}>
            {MAINTENANCE_CATEGORIES.map((category) => (
              <Chip key={category.value} label={category.label} selected={form.category === category.value} onPress={() => update({ category: category.value })} />
            ))}
          </View>
          {errors.category ? <AppText style={styles.error}>{errors.category}</AppText> : null}
        </View>

        <TextField label="Short title" value={form.title} onChangeText={(title) => update({ title })} maxLength={200} placeholder="e.g. Kitchen tap is leaking" error={errors.title} testID="maintenance-title" />
        <TextField
          label="What’s happening?"
          value={form.description}
          onChangeText={(description) => update({ description })}
          multiline
          numberOfLines={5}
          maxLength={10_000}
          style={styles.description}
          placeholder="Where is it, when did it start, and is it getting worse?"
          error={errors.description}
          testID="maintenance-description"
        />

        <View style={styles.choices}>
          <AppText variant="label">How urgent is it?</AppText>
          <View style={styles.chips}>
            {MAINTENANCE_PRIORITIES.map((priority) => (
              <Chip key={priority.value} label={priority.label} selected={form.priority === priority.value} onPress={() => update({ priority: priority.value })} />
            ))}
          </View>
          <AppText variant="caption">{MAINTENANCE_PRIORITIES.find((priority) => priority.value === form.priority)?.hint}</AppText>
        </View>

        <AppText variant="caption">Photos can’t be added from the app yet. Your landlord or property manager may ask you for some.</AppText>
        <Button label={unclear ? "Send anyway" : "Send report"} onPress={submit} loading={submitting} testID="submit-maintenance" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  choices: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  description: { minHeight: 120, textAlignVertical: "top", paddingTop: spacing.md },
  error: { color: colors.danger, fontSize: 13 },
  done: { justifyContent: "center", padding: spacing.xl },
  doneCard: { gap: spacing.md, padding: spacing.xl },
});
