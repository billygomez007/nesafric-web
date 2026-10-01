import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  createDraftTenancy,
  createPmTenant,
  createPmTenantAccessInvitation,
  toMinorUnits,
  updatePmTenant,
  type TenancyInput,
  type TenantInput,
} from "@/api/workspace-actions";
import {
  usePmProperties,
  usePmProperty,
  usePmTenant,
} from "@/api/workspace-queries";
import { useSession } from "@/auth/session";
import { Checkbox } from "@/components/checkbox";
import { ListRow, RowGroup } from "@/components/list-row";
import { AppText, Button, Notice, TextField } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors } from "@/theme/tokens";
import {
  ChoiceField,
  describeError,
  FieldRow,
  FormError,
  FormScreen,
  FormSection,
  isIsoDate,
  RecordState,
  today,
  useInvalidateWorkspace,
} from "@/workspace/forms";
import { useWorkspaceGate } from "@/workspace/inbox-ui";

const EMPTY_TENANT: TenantInput = {
  legalName: "",
  preferredName: "",
  email: "",
  phone: "",
};
const RENT_PERIODS = [
  ["MONTHLY", "Monthly"],
  ["QUARTERLY", "Quarterly"],
  ["ANNUAL", "Yearly"],
] as const;

type Placement = Omit<TenancyInput, "propertyId"> & { propertyId: string };

type TenantAccessDelivery = {
  email: "QUEUED" | "SKIPPED" | "FAILED";
  sms: "SENT" | "SKIPPED" | "FAILED";
};

function tenantAccessDeliveryMessage(delivery: TenantAccessDelivery) {
  const emailSent = delivery.email === "QUEUED";
  const smsSent = delivery.sms === "SENT";

  if (emailSent && smsSent) {
    return "Tenant access code sent by email and SMS.";
  }

  if (emailSent) {
    return delivery.sms === "FAILED"
      ? "Tenant access code sent by email, but SMS delivery failed."
      : "Tenant access code sent by email.";
  }

  if (smsSent) {
    return delivery.email === "FAILED"
      ? "Tenant access code sent by SMS, but email delivery failed."
      : "Tenant access code sent by SMS.";
  }

  if (delivery.email === "FAILED" || delivery.sms === "FAILED") {
    return "Tenant access code was created, but delivery failed.";
  }

  return "Tenant access code was created, but no email address or phone number was available for delivery.";
}

function newReference() {
  return `LSE-${today().replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

const emptyPlacement = (): Placement => ({
  propertyId: "",
  unitId: null,
  referenceNumber: newReference(),
  startDate: today(),
  endDate: "",
  rent: "",
  rentFrequency: "MONTHLY",
});

function validateTenant(form: TenantInput) {
  const errors: Partial<Record<keyof TenantInput, string>> = {};
  if (form.legalName.trim().length < 2)
    errors.legalName = "Enter the tenant's full legal name.";
  if (
    form.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  )
    errors.email = "Enter a valid email address.";
  return errors;
}

function validatePlacement(placement: Placement) {
  const errors: Partial<Record<keyof Placement, string>> = {};
  if (!placement.propertyId) errors.propertyId = "Choose the property.";
  if (placement.referenceNumber.trim().length < 2)
    errors.referenceNumber = "Enter a lease reference.";
  if (!isIsoDate(placement.startDate))
    errors.startDate = "Use the date format YYYY-MM-DD.";
  if (placement.endDate.trim() && !isIsoDate(placement.endDate.trim()))
    errors.endDate = "Use the date format YYYY-MM-DD.";
  if (!toMinorUnits(placement.rent)) errors.rent = "Enter the rent, e.g. 2500.";
  return errors;
}

/**
 * Where the tenant lives: property, optional unit and draft lease terms. The property and unit lists
 * come from this workspace only, and the server re-checks that property, unit and tenant all belong
 * to it before creating the lease.
 */
function PlacementFields({
  organisationId,
  placement,
  onChange,
  errors,
}: {
  organisationId: string;
  placement: Placement;
  onChange: (patch: Partial<Placement>) => void;
  errors: Partial<Record<keyof Placement, string>>;
}) {
  const properties = usePmProperties(organisationId);
  const property = usePmProperty(organisationId, placement.propertyId || null);
  const propertyOptions = (properties.data ?? []).map(
    (item) => [item.id, item.name] as const,
  );
  const unitOptions = [
    ["", "Whole property"] as const,
    ...(property.data?.units ?? []).map(
      (unit) => [unit.id, unit.name] as const,
    ),
  ];
  return (
    <>
      {properties.isPending ? (
        <AppText variant="caption">Loading properties…</AppText>
      ) : null}
      {properties.data && propertyOptions.length === 0 ? (
        <AppText variant="caption">
          Add a property first, then place tenants in it.
        </AppText>
      ) : null}
      {propertyOptions.length ? (
        <ChoiceField
          label="Property"
          options={propertyOptions}
          value={placement.propertyId}
          onChange={(propertyId) => onChange({ propertyId, unitId: null })}
          error={errors.propertyId}
          testID="placement-property"
        />
      ) : null}
      {placement.propertyId && property.data ? (
        <ChoiceField
          label="Unit"
          options={unitOptions}
          value={placement.unitId ?? ""}
          onChange={(unitId) => onChange({ unitId: unitId || null })}
          testID="placement-unit"
        />
      ) : null}
      <TextField
        label="Lease reference"
        value={placement.referenceNumber}
        onChangeText={(referenceNumber) => onChange({ referenceNumber })}
        error={errors.referenceNumber}
        autoCapitalize="characters"
      />
      <FieldRow>
        <TextField
          label="Start (YYYY-MM-DD)"
          value={placement.startDate}
          onChangeText={(startDate) => onChange({ startDate })}
          error={errors.startDate}
          autoCapitalize="none"
        />
        <TextField
          label="End (optional)"
          value={placement.endDate}
          onChangeText={(endDate) => onChange({ endDate })}
          error={errors.endDate}
          autoCapitalize="none"
          placeholder="YYYY-MM-DD"
        />
      </FieldRow>
      <TextField
        label="Rent (GHS)"
        value={placement.rent}
        onChangeText={(rent) => onChange({ rent })}
        error={errors.rent}
        keyboardType="decimal-pad"
        testID="placement-rent"
      />
      <ChoiceField
        label="Rent is paid"
        options={RENT_PERIODS}
        value={placement.rentFrequency}
        onChange={(rentFrequency) => onChange({ rentFrequency })}
      />
      <AppText variant="caption">
        This creates a draft lease. Execute it on nesafric.com when the
        paperwork is signed.
      </AppText>
    </>
  );
}

/** Add a tenant (`POST /api/tenants`), optionally placing them in a property/unit with a draft lease. */
export function NewTenantScreen({
  organisationId,
}: {
  organisationId: string | undefined;
}) {
  const { gate, workspaceId } = useWorkspaceGate(
    "organisation",
    organisationId,
  );
  const { api } = useSession();
  const invalidate = useInvalidateWorkspace("organisation", workspaceId);
  const [form, setForm] = useState<TenantInput>(EMPTY_TENANT);
  const [place, setPlace] = useState(false);
  const [placement, setPlacement] = useState<Placement>(emptyPlacement);
  const [errors, setErrors] = useState<
    Partial<Record<keyof TenantInput, string>>
  >({});
  const [placementErrors, setPlacementErrors] = useState<
    Partial<Record<keyof Placement, string>>
  >({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  const update = (patch: Partial<TenantInput>) =>
    setForm((current) => ({ ...current, ...patch }));

  async function save() {
    const found = validateTenant(form);
    const foundPlacement = place ? validatePlacement(placement) : {};
    setErrors(found);
    setPlacementErrors(foundPlacement);
    setError(null);
    if (Object.keys(found).length || Object.keys(foundPlacement).length) return;
    setSaving(true);
    try {
      const created = await createPmTenant(api, workspaceId!, form);
      const tenantId = created.relationship.id;
      let placementError: string | null = null;
      let accessNotice: string | null = null;
      let createdLeaseId: string | undefined;
      if (place) {
        try {
          const createdLease = await createDraftTenancy(
            api,
            workspaceId!,
            tenantId,
            placement,
          );
          createdLeaseId = createdLease.id;
        } catch (cause) {
          placementError = describeError(cause);
        }
      }

      // Generate and deliver the tenant access code automatically.
      // When the landlord selected a property, wait until the tenancy
      // was created successfully so the invitation resolves to that
      // property when the tenant redeems it.
      if (
        (form.email.trim() || form.phone.trim()) &&
        (!place || !placementError)
      ) {
        try {
          const accessInvitation = await createPmTenantAccessInvitation(
            api,
            workspaceId!,
            tenantId,
            createdLeaseId,
          );
          const deliveryMessage = tenantAccessDeliveryMessage(
            accessInvitation.delivery,
          );
          if (
            accessInvitation.delivery.email === "FAILED" ||
            accessInvitation.delivery.sms === "FAILED" ||
            (
              accessInvitation.delivery.email === "SKIPPED" &&
              accessInvitation.delivery.sms === "SKIPPED"
            )
          ) {
            accessNotice = deliveryMessage;
          }
        } catch (cause) {
          const inviteError = describeError(cause);
          accessNotice = `Tenant access code was not sent: ${inviteError}`;
        }
      }

      await invalidate();
      router.replace({
        pathname: "/workspace/[organisationId]/tenant/[tenantId]",
        params: {
          organisationId: workspaceId!,
          tenantId,
          ...(placementError ? { placementError } : {}),
          ...(accessNotice ? { accessNotice } : {}),
        },
      });
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormScreen testID="tenant-form">
      <FormError error={error} />
      <FormSection
        title="Tenant"
        hint="Contact details are used for rent reminders and notices from this workspace."
      >
        <TextField
          label="Full legal name"
          value={form.legalName}
          onChangeText={(legalName) => update({ legalName })}
          error={errors.legalName}
          testID="tenant-legal-name"
        />
        <TextField
          label="Preferred name (optional)"
          value={form.preferredName}
          onChangeText={(preferredName) => update({ preferredName })}
        />
        <TextField
          label="Email (optional)"
          value={form.email}
          onChangeText={(email) => update({ email })}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          testID="tenant-email"
        />
        <TextField
          label="Phone (optional)"
          value={form.phone}
          onChangeText={(phone) => update({ phone })}
          keyboardType="phone-pad"
        />
      </FormSection>
      <FormSection title="Property">
        <Checkbox
          checked={place}
          onChange={setPlace}
          label="Place this tenant in a property now"
          testID="tenant-place"
        />
        {place ? (
          <PlacementFields
            organisationId={workspaceId!}
            placement={placement}
            onChange={(patch) =>
              setPlacement((current) => ({ ...current, ...patch }))
            }
            errors={placementErrors}
          />
        ) : null}
      </FormSection>
      <Button
        label="Add tenant"
        variant="dark"
        onPress={() => void save()}
        loading={saving}
        testID="tenant-save"
      />
    </FormScreen>
  );
}

/** A tenant: edit their details, see their tenancies, and place them in a property. */
export function TenantDetailScreen({
  organisationId,
  tenantId,
  placementError,
  accessNotice,
}: {
  organisationId: string | undefined;
  tenantId: string | undefined;
  placementError?: string;
  accessNotice?: string;
}) {
  const { gate, workspaceId } = useWorkspaceGate(
    "organisation",
    organisationId,
  );
  const { api } = useSession();
  const invalidate = useInvalidateWorkspace("organisation", workspaceId);
  const tenant = usePmTenant(workspaceId, tenantId ?? null);
  const [form, setForm] = useState<TenantInput>(EMPTY_TENANT);
  const [errors, setErrors] = useState<
    Partial<Record<keyof TenantInput, string>>
  >({});
  const [placing, setPlacing] = useState(Boolean(placementError));
  const [placement, setPlacement] = useState<Placement>(emptyPlacement);
  const [placementErrors, setPlacementErrors] = useState<
    Partial<Record<keyof Placement, string>>
  >({});
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "place" | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const data = tenant.data;
    if (data && !loaded.current) {
      loaded.current = true;
      setForm({
        legalName: data.legalName,
        preferredName: data.preferredName ?? "",
        email: data.email ?? "",
        phone: data.phone ?? "",
      });
    }
  }, [tenant.data]);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  if (!tenant.data) return <RecordState noun="tenant" query={tenant} />;
  const data = tenant.data;
  const update = (patch: Partial<TenantInput>) =>
    setForm((current) => ({ ...current, ...patch }));

  async function save() {
    const found = validateTenant(form);
    setErrors(found);
    setError(null);
    setNotice(null);
    if (Object.keys(found).length) return;
    setBusy("save");
    try {
      await updatePmTenant(api, workspaceId!, data.id, form);
      await invalidate();
      setNotice("Tenant details saved.");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function place() {
    const found = validatePlacement(placement);
    setPlacementErrors(found);
    setError(null);
    setNotice(null);
    if (Object.keys(found).length) return;
    setBusy("place");
    try {
      const createdLease = await createDraftTenancy(
        api,
        workspaceId!,
        data.id,
        placement,
      );

      let accessNotice = "";
      if (data.email || data.phone) {
        try {
          const accessInvitation = await createPmTenantAccessInvitation(
            api,
            workspaceId!,
            data.id,
            createdLease.id,
          );
          accessNotice = ` ${tenantAccessDeliveryMessage(
            accessInvitation.delivery,
          )}`;
        } catch (cause) {
          accessNotice = ` Tenant access code was not sent: ${describeError(cause)}`;
        }
      }

      await invalidate();
      setPlacing(false);
      setPlacement(emptyPlacement());
      setNotice(
        `Draft lease created.${accessNotice} Execute it on nesafric.com when it is signed.`,
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  return (
    <FormScreen testID="tenant-detail">
      {placementError ? (
        <Notice
          tone="warning"
          message={`The tenant was added, but the lease was not created: ${placementError}`}
        />
      ) : null}
      {accessNotice ? (
        <Notice tone="warning" message={accessNotice} />
      ) : null}
      {notice ? <Notice tone="info" message={notice} /> : null}
      <FormError error={error} />
      <FormSection title="Tenancies">
        {data.tenancies.length ? (
          <RowGroup>
            {data.tenancies.map((tenancy, index) => (
              <ListRow
                key={tenancy.leaseId}
                icon="document-text-outline"
                title={[tenancy.property, tenancy.unit]
                  .filter(Boolean)
                  .join(" · ")}
                detail={tenancy.referenceNumber}
                meta={humanise(tenancy.status)}
                last={index === data.tenancies.length - 1}
                testID={`tenancy-${tenancy.leaseId}`}
              />
            ))}
          </RowGroup>
        ) : (
          <AppText variant="caption">Not placed in a property yet.</AppText>
        )}
        {placing ? (
          <>
            <PlacementFields
              organisationId={workspaceId!}
              placement={placement}
              onChange={(patch) =>
                setPlacement((current) => ({ ...current, ...patch }))
              }
              errors={placementErrors}
            />
            <Button
              label="Create draft lease"
              onPress={() => void place()}
              loading={busy === "place"}
              disabled={Boolean(busy)}
              testID="tenant-place-save"
            />
          </>
        ) : (
          <Button
            label="Place in a property"
            variant="secondary"
            onPress={() => setPlacing(true)}
            testID="tenant-place-open"
          />
        )}
      </FormSection>
      <FormSection title="Details">
        <TextField
          label="Full legal name"
          value={form.legalName}
          onChangeText={(legalName) => update({ legalName })}
          error={errors.legalName}
          testID="tenant-legal-name"
        />
        <TextField
          label="Preferred name (optional)"
          value={form.preferredName}
          onChangeText={(preferredName) => update({ preferredName })}
        />
        <TextField
          label="Email (optional)"
          value={form.email}
          onChangeText={(email) => update({ email })}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextField
          label="Phone (optional)"
          value={form.phone}
          onChangeText={(phone) => update({ phone })}
          keyboardType="phone-pad"
        />
        <Button
          label="Save details"
          variant="dark"
          onPress={() => void save()}
          loading={busy === "save"}
          disabled={Boolean(busy)}
          testID="tenant-save"
        />
      </FormSection>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
