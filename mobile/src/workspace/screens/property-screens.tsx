import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { createPmProperty, createPmUnit, updatePmProperty, updatePmUnit, type PropertyInput, type UnitInput } from "@/api/workspace-actions";
import { usePmProperty } from "@/api/workspace-queries";
import { useSession } from "@/auth/session";
import { ListRow, RowGroup } from "@/components/list-row";
import { AppText, Button, StateMessage, TextField } from "@/components/ui";
import { humanise } from "@/marketplace/format";
import { colors, spacing } from "@/theme/tokens";
import { ChoiceField, FieldRow, FormError, FormScreen, FormSection, RecordState, useInvalidateWorkspace } from "@/workspace/forms";
import { useWorkspaceGate } from "@/workspace/inbox-ui";

/** Same categories as the website's Add property form. */
export const PROPERTY_CATEGORIES = [
  ["Residential", "Residential"],
  ["Commercial", "Commercial"],
  ["Industrial", "Industrial"],
  ["Land", "Land"],
  ["Hospitality", "Hospitality"],
  ["Mixed-use", "Mixed-use"],
] as const;

export const UNIT_STATUSES = [
  ["AVAILABLE", "Available"],
  ["OCCUPIED", "Occupied"],
  ["RESERVED", "Reserved"],
  ["MAINTENANCE", "Maintenance"],
  ["INACTIVE", "Inactive"],
] as const;

const EMPTY_PROPERTY: PropertyInput = { name: "", referenceNumber: "", category: "Residential", city: "", addressLine1: "" };
const EMPTY_UNIT: UnitInput = { name: "", unitType: "", floor: "", bedrooms: "", bathrooms: "", status: "AVAILABLE" };

const propertyRoute = (organisationId: string, propertyId: string) => ({ pathname: "/workspace/[organisationId]/property/[propertyId]" as const, params: { organisationId, propertyId } });

/**
 * Add or edit a property in a property management workspace (`POST`/`PATCH /api/properties`).
 * The server checks the member's `property.create` / `property.update` permission and the plan's
 * property limit; a refusal is shown as-is.
 */
export function PropertyFormScreen({ organisationId, propertyId }: { organisationId: string | undefined; propertyId: string | null }) {
  const { gate, workspaceId } = useWorkspaceGate("organisation", organisationId);
  const { api } = useSession();
  const invalidate = useInvalidateWorkspace("organisation", workspaceId);
  const existing = usePmProperty(workspaceId, propertyId);
  const [form, setForm] = useState<PropertyInput>(EMPTY_PROPERTY);
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyInput, string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    const property = existing.data;
    if (property && !loaded.current) {
      loaded.current = true;
      setForm({ name: property.name, referenceNumber: property.referenceNumber, category: property.category, city: property.city ?? "", addressLine1: property.addressLine1 ?? "" });
    }
  }, [existing.data]);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  if (propertyId && !existing.data) return <RecordState noun="property" query={existing} />;
  const update = (patch: Partial<PropertyInput>) => setForm((current) => ({ ...current, ...patch }));

  async function save() {
    const found: typeof errors = {};
    if (form.name.trim().length < 2) found.name = "Enter the property name.";
    if (!propertyId && form.referenceNumber.trim().length < 2) found.referenceNumber = "Enter a reference, e.g. OVA-1.";
    setErrors(found);
    setError(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      if (propertyId) {
        await updatePmProperty(api, workspaceId!, propertyId, form);
        await invalidate();
        router.back();
      } else {
        const created = await createPmProperty(api, workspaceId!, form);
        await invalidate();
        router.replace(propertyRoute(workspaceId!, created.id));
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormScreen testID="property-form">
      <FormError error={error} />
      <FormSection title="Property">
        <TextField label="Property name" value={form.name} onChangeText={(name) => update({ name })} error={errors.name} testID="property-name" />
        {propertyId ? (
          <AppText variant="caption">Reference {form.referenceNumber} · Ghana · GHS</AppText>
        ) : (
          <TextField label="Reference number" value={form.referenceNumber} onChangeText={(referenceNumber) => update({ referenceNumber })} error={errors.referenceNumber} autoCapitalize="characters" testID="property-reference" />
        )}
        <ChoiceField label="Category" options={PROPERTY_CATEGORIES} value={form.category} onChange={(category) => update({ category })} />
      </FormSection>
      <FormSection title="Address">
        <TextField label="City" value={form.city} onChangeText={(city) => update({ city })} testID="property-city" />
        <TextField label="Street address" value={form.addressLine1} onChangeText={(addressLine1) => update({ addressLine1 })} />
      </FormSection>
      <Button label={propertyId ? "Save property" : "Add property"} variant="dark" onPress={() => void save()} loading={saving} testID="property-save" />
    </FormScreen>
  );
}

/** A property with its units: edit the property, add a unit, or open a unit to edit it. */
export function PropertyDetailScreen({ organisationId, propertyId }: { organisationId: string | undefined; propertyId: string | undefined }) {
  const { gate, workspaceId } = useWorkspaceGate("organisation", organisationId);
  const property = usePmProperty(workspaceId, propertyId ?? null);
  if (gate) return <View style={styles.screen}>{gate}</View>;
  if (!property.data) return <RecordState noun="property" query={property} />;
  const data = property.data;
  const params = { organisationId: workspaceId!, propertyId: data.id };
  return (
    <FormScreen testID="property-detail">
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header">{data.name}</AppText>
        <AppText variant="caption">{[data.referenceNumber, data.category, data.city, humanise(data.status)].filter(Boolean).join(" · ")}</AppText>
        {data.addressLine1 ? <AppText>{data.addressLine1}</AppText> : null}
      </View>
      <Button label="Edit property" variant="secondary" onPress={() => router.push({ pathname: "/workspace/[organisationId]/property/[propertyId]/edit", params })} testID="property-edit" />
      <FormSection title={`Units (${data.units.length})`}>
        {data.units.length ? (
          <RowGroup>
            {data.units.map((unit, index) => (
              <ListRow
                key={unit.id}
                icon="grid-outline"
                title={unit.name}
                detail={[unit.unitType, unit.bedrooms !== null ? `${unit.bedrooms} bed` : null, unit.floor ? `Floor ${unit.floor}` : null].filter(Boolean).join(" · ") || null}
                meta={humanise(unit.status)}
                onPress={() => router.push({ pathname: "/workspace/[organisationId]/property/[propertyId]/unit/[unitId]", params: { ...params, unitId: unit.id } })}
                testID={`unit-${unit.id}`}
                last={index === data.units.length - 1}
              />
            ))}
          </RowGroup>
        ) : (
          <AppText variant="caption">No units yet. Add units for flats, rooms or shops you let separately.</AppText>
        )}
        <Button label="Add unit" onPress={() => router.push({ pathname: "/workspace/[organisationId]/property/[propertyId]/unit/new", params })} testID="unit-add" />
      </FormSection>
    </FormScreen>
  );
}

/** Add or edit one unit of a property (`POST`/`PATCH /api/properties/:id/units`). */
export function UnitFormScreen({ organisationId, propertyId, unitId }: { organisationId: string | undefined; propertyId: string | undefined; unitId: string | null }) {
  const { gate, workspaceId } = useWorkspaceGate("organisation", organisationId);
  const { api } = useSession();
  const invalidate = useInvalidateWorkspace("organisation", workspaceId);
  const property = usePmProperty(workspaceId, propertyId ?? null);
  const [form, setForm] = useState<UnitInput>(EMPTY_UNIT);
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);
  const unit = unitId ? property.data?.units.find((item) => item.id === unitId) : undefined;

  useEffect(() => {
    if (unit && !loaded.current) {
      loaded.current = true;
      const text = (value: string | number | null) => (value === null ? "" : String(value));
      setForm({ name: unit.name, unitType: text(unit.unitType), floor: text(unit.floor), bedrooms: text(unit.bedrooms), bathrooms: text(unit.bathrooms), status: unit.status });
    }
  }, [unit]);

  if (gate) return <View style={styles.screen}>{gate}</View>;
  if (!property.data) return <RecordState noun="property" query={property} />;
  if (unitId && !unit) return <StateMessage title="This unit isn’t available" message="It may have been removed from this property." />;
  const update = (patch: Partial<UnitInput>) => setForm((current) => ({ ...current, ...patch }));

  async function save() {
    setNameError(form.name.trim() ? undefined : "Enter the unit name, e.g. A2.");
    setError(null);
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (unitId) await updatePmUnit(api, workspaceId!, propertyId!, unitId, form);
      else await createPmUnit(api, workspaceId!, propertyId!, form);
      await invalidate();
      router.back();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormScreen testID="unit-form">
      <AppText variant="caption">{property.data.name}</AppText>
      <FormError error={error} />
      <FormSection title="Unit">
        <TextField label="Unit name" value={form.name} onChangeText={(name) => update({ name })} error={nameError} testID="unit-name" />
        <FieldRow>
          <TextField label="Type (optional)" value={form.unitType} onChangeText={(unitType) => update({ unitType })} placeholder="e.g. 2-bed flat" />
          <TextField label="Floor (optional)" value={form.floor} onChangeText={(floor) => update({ floor })} />
        </FieldRow>
        <FieldRow>
          <TextField label="Bedrooms" value={form.bedrooms} onChangeText={(bedrooms) => update({ bedrooms })} keyboardType="number-pad" />
          <TextField label="Bathrooms" value={form.bathrooms} onChangeText={(bathrooms) => update({ bathrooms })} keyboardType="number-pad" />
        </FieldRow>
        <ChoiceField label="Status" options={UNIT_STATUSES} value={form.status} onChange={(status) => update({ status })} />
      </FormSection>
      <Button label={unitId ? "Save unit" : "Add unit"} variant="dark" onPress={() => void save()} loading={saving} testID="unit-save" />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.xs },
});
