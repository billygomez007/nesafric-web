import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkspaces } from "@/api/account-queries";
import { ApiError } from "@/api/client";
import { useMarketplaceProvider } from "@/api/service-queries";
import {
  createServiceEnquiry,
  requestServiceQuote,
} from "@/api/services";
import type { PublicProvider } from "@/api/types";
import {
  usePmMaintenance,
  usePmProperties,
} from "@/api/workspace-queries";
import { useSession } from "@/auth/session";
import { Checkbox } from "@/components/checkbox";
import { Chip } from "@/components/chip";
import { QueryState } from "@/components/query-state";
import {
  AppText,
  Button,
  Card,
  Loading,
  Notice,
  StateMessage,
  TextField,
} from "@/components/ui";
import {
  serviceRequestErrorMessage,
  TERMINAL_MAINTENANCE,
  validateServiceRequest,
  type ServiceRequestErrors,
  type ServiceRequestForm,
} from "@/services/request";
import { colors, spacing } from "@/theme/tokens";

type Outcome =
  | { quote: "none" | "requested" }
  | { quote: "failed"; message: string };

export default function RequestServiceScreen() {
  const { providerId, categoryId, quote } =
    useLocalSearchParams<{
      providerId: string;
      categoryId?: string;
      quote?: string;
    }>();

  const providerQuery = useMarketplaceProvider(providerId);
  const provider = providerQuery.data?.provider;
  const { status } = useSession();

  if (!provider) {
    if (
      providerQuery.error instanceof ApiError
      && providerQuery.error.status === 404
    ) {
      return (
        <StateMessage
          title="Provider no longer listed"
          message="This provider isn't on the NesAfric marketplace right now, so it can't receive requests."
        />
      );
    }

    return (
      <QueryState
        isPending={providerQuery.isPending}
        error={providerQuery.error}
        onRetry={() => providerQuery.refetch()}
      />
    );
  }

  if (status === "restoring") return <Loading />;

  if (status === "signedOut") {
    return <SignInRequired provider={provider} />;
  }

  return (
    <SignedInRequest
      provider={provider}
      initialCategoryId={categoryId}
      wantsQuote={quote === "1"}
    />
  );
}

function SignInRequired({ provider }: { provider: PublicProvider }) {
  return (
    <View style={styles.center}>
      <AppText variant="heading" style={styles.centerText}>
        Sign in to request {provider.displayName}
      </AppText>

      <AppText variant="caption" style={styles.centerText}>
        Sign in to send a private service request. You do not need a property
        management workspace to request a service provider.
      </AppText>

      <Button
        label="Sign in"
        onPress={() => router.push("/sign-in")}
        testID="request-sign-in"
      />

      <Button
        label="Not now"
        variant="secondary"
        onPress={() => router.back()}
      />
    </View>
  );
}

function SignedInRequest({
  provider,
  initialCategoryId,
  wantsQuote,
}: {
  provider: PublicProvider;
  initialCategoryId?: string;
  wantsQuote: boolean;
}) {
  const workspacesQuery = useWorkspaces();

  if (!workspacesQuery.data) {
    return (
      <QueryState
        isPending={workspacesQuery.isPending}
        error={workspacesQuery.error}
        onRetry={() => workspacesQuery.refetch()}
      />
    );
  }

  return (
    <RequestForm
      provider={provider}
      organisations={workspacesQuery.data.propertyOsOrganisations ?? []}
      initialCategoryId={initialCategoryId}
      wantsQuote={wantsQuote}
    />
  );
}

function RequestForm({
  provider,
  organisations,
  initialCategoryId,
  wantsQuote,
}: {
  provider: PublicProvider;
  organisations: { id: string; name: string }[];
  initialCategoryId?: string;
  wantsQuote: boolean;
}) {
  const { api } = useSession();
  const insets = useSafeAreaInsets();

  const quoteOrganisationId =
    wantsQuote && organisations.length === 1
      ? organisations[0].id
      : null;

  const [form, setForm] = useState<ServiceRequestForm>({
    organisationId: quoteOrganisationId,
    categoryId: provider.categories.some(
      (category) => category.id === initialCategoryId,
    )
      ? initialCategoryId!
      : provider.categories.length === 1
        ? provider.categories[0].id
        : null,
    propertyId: null,
    maintenanceRequestId: null,
    message: "",
    requestQuote: wantsQuote && Boolean(quoteOrganisationId),
  });

  const [errors, setErrors] = useState<ServiceRequestErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const properties = usePmProperties(form.organisationId);
  const maintenance = usePmMaintenance(form.organisationId);

  const openMaintenance = (maintenance.data ?? []).filter(
    (request) => !TERMINAL_MAINTENANCE.includes(request.status),
  );

  const set = (patch: Partial<ServiceRequestForm>) =>
    setForm((current) => ({ ...current, ...patch }));

  async function submit() {
    if (submitting) return;

    const found = validateServiceRequest(form);
    setErrors(found);
    setSubmitError(null);

    if (Object.keys(found).length) return;

    setSubmitting(true);
    const message = form.message.trim();
    const organisationId = form.organisationId ?? undefined;

    try {
      const enquiry = await createServiceEnquiry(
        api,
        organisationId,
        {
          providerId: provider.id,
          categoryId: form.categoryId!,
          propertyId:
            form.maintenanceRequestId
              ? undefined
              : form.propertyId ?? undefined,
          maintenanceRequestId:
            form.maintenanceRequestId ?? undefined,
          message,
        },
      );

      if (!form.requestQuote) {
        setOutcome({ quote: "none" });
        return;
      }

      if (!organisationId || !form.maintenanceRequestId) {
        setSubmitError(
          "A formal quotation needs a property workspace and maintenance request.",
        );
        return;
      }

      try {
        await requestServiceQuote(
          api,
          organisationId,
          enquiry.id,
          message,
        );

        setOutcome({ quote: "requested" });
      } catch (error) {
        setOutcome({
          quote: "failed",
          message: serviceRequestErrorMessage(error),
        });
      }
    } catch (error) {
      setSubmitError(serviceRequestErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome) {
    return (
      <View style={styles.center} testID="request-sent">
        <AppText variant="heading" style={styles.centerText}>
          Request sent to {provider.displayName}
        </AppText>

        <AppText variant="caption" style={styles.centerText}>
          The provider can now see your private request on NesAfric.
        </AppText>

        {outcome.quote === "requested" ? (
          <Notice
            tone="info"
            message="A formal quotation was requested for your maintenance job."
          />
        ) : null}

        {outcome.quote === "failed" ? (
          <Notice
            tone="warning"
            message={`Your request was sent, but the quotation request wasn't: ${outcome.message}`}
          />
        ) : null}

        <Button label="Done" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: spacing.xxl + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <AppText variant="label">{provider.displayName}</AppText>
          <AppText variant="caption">
            Your request stays private between you and this provider.
          </AppText>
        </Card>

        {organisations.length ? (
          <Group title="Request for">
            <Chip
              label="Personal request"
              selected={form.organisationId === null}
              onPress={() =>
                set({
                  organisationId: null,
                  propertyId: null,
                  maintenanceRequestId: null,
                  requestQuote: false,
                })
              }
            />

            {organisations.map((organisation) => (
              <Chip
                key={organisation.id}
                label={organisation.name}
                selected={form.organisationId === organisation.id}
                onPress={() =>
                  set({
                    organisationId: organisation.id,
                    propertyId: null,
                    maintenanceRequestId: null,
                  })
                }
              />
            ))}
          </Group>
        ) : null}

        <Group title="Service" error={errors.categoryId}>
          {provider.categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              selected={form.categoryId === category.id}
              onPress={() => set({ categoryId: category.id })}
            />
          ))}
        </Group>

        {form.organisationId && openMaintenance.length ? (
          <Group title="Maintenance request (optional)">
            {openMaintenance.map((request) => (
              <Chip
                key={request.id}
                label={
                  request.place
                    ? `${request.title} · ${request.place}`
                    : request.title
                }
                selected={form.maintenanceRequestId === request.id}
                onPress={() => {
                  const selected =
                    form.maintenanceRequestId === request.id;

                  set({
                    maintenanceRequestId: selected ? null : request.id,
                    propertyId: null,
                    requestQuote:
                      selected ? false : form.requestQuote,
                  });
                }}
              />
            ))}
          </Group>
        ) : null}

        {form.organisationId
          && !form.maintenanceRequestId
          && properties.data?.length ? (
            <Group title="Property (optional)">
              {properties.data.map((property) => (
                <Chip
                  key={property.id}
                  label={property.name}
                  selected={form.propertyId === property.id}
                  onPress={() =>
                    set({
                      propertyId:
                        form.propertyId === property.id
                          ? null
                          : property.id,
                    })
                  }
                />
              ))}
            </Group>
          ) : null}

        <TextField
          label="What do you need done?"
          value={form.message}
          onChangeText={(message) => set({ message })}
          placeholder="Describe the service you need, where you need it and when."
          multiline
          textAlignVertical="top"
          style={styles.message}
          error={errors.message}
          maxLength={10_000}
        />

        {form.organisationId ? (
          <Checkbox
            checked={form.requestQuote}
            onChange={(requestQuote) => set({ requestQuote })}
            label="Also request a formal quotation (needs a maintenance request)"
            error={errors.requestQuote}
            testID="request-quote"
          />
        ) : null}

        {submitError ? <Notice message={submitError} /> : null}

        <Button
          label="Send request"
          onPress={submit}
          loading={submitting}
          testID="send-service-request"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Group({
  title,
  error,
  children,
}: {
  title: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.group}>
      <AppText variant="label">{title}</AppText>
      <View style={styles.chips}>{children}</View>
      {error ? <AppText style={styles.error}>{error}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },

  body: {
    padding: spacing.xl,
    gap: spacing.lg,
  },

  center: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.background,
  },

  centerText: {
    textAlign: "center",
  },

  group: {
    gap: spacing.sm,
  },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },

  error: {
    color: colors.danger,
    fontSize: 13,
  },

  message: {
    minHeight: 120,
    paddingTop: spacing.md,
  },
});
