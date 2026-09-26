/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Workspaces } from "@/api/account";
import { clearLastWorkspaces, loadLastWorkspace, rememberWorkspace } from "@/auth/workspaces";
import { MARKETPLACE, hasWorkspaceKind, parseIntent, resolveAvailableWorkspaces, resolveInitialWorkspace } from "@/workspace/resolve";

const ORG = { id: "0b8f6a52-5b0c-4a1e-9c1c-000000000001", name: "Golden Coast Properties" };
const PRO = { id: "7a1f0c2e-0000-4000-8000-000000000001", displayName: "Xcel Realty", type: "BROKERAGE", status: "ACTIVE", verificationStatus: "VERIFIED", slug: "xcel", myRole: "AGENT" };
const PROVIDER = { id: "5c9e0a11-0000-4000-8000-000000000001", displayName: "Kofi Plumbing", type: "INDIVIDUAL", slug: "kofi", verificationStatus: "UNVERIFIED", availabilityStatus: "AVAILABLE", suspended: false };
const all: Workspaces = { propertyOsOrganisations: [ORG], marketplaceProfessionals: [PRO], serviceProviders: [PROVIDER] };
const none: Workspaces = { propertyOsOrganisations: [], marketplaceProfessionals: [], serviceProviders: [] };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("resolveAvailableWorkspaces", () => {
  it("offers only Marketplace when signed out, restoring, or before the server has answered", () => {
    expect(resolveAvailableWorkspaces({ status: "signedOut", workspaces: all })).toEqual([MARKETPLACE]);
    expect(resolveAvailableWorkspaces({ status: "restoring", workspaces: all })).toEqual([MARKETPLACE]);
    expect(resolveAvailableWorkspaces({ status: "signedIn" })).toEqual([MARKETPLACE]);
  });

  it("offers Marketplace only to a customer with no workspaces", () => {
    const available = resolveAvailableWorkspaces({ status: "signedIn", workspaces: none });
    expect(available).toEqual([MARKETPLACE]);
    expect(hasWorkspaceKind(available, "property_management")).toBe(false);
  });

  it("lists Marketplace first, then exactly the server's workspaces", () => {
    const available = resolveAvailableWorkspaces({ status: "signedIn", workspaces: all });
    expect(available.map(({ kind, id }) => [kind, id])).toEqual([
      ["marketplace", null],
      ["property_management", ORG.id],
      ["professional", PRO.id],
      ["service_provider", PROVIDER.id],
    ]);
    expect(available[1].route).toEqual({ pathname: "/workspace/[organisationId]", params: { organisationId: ORG.id } });
    expect(available[2].route).toEqual({ pathname: "/agent/[professionalId]", params: { professionalId: PRO.id } });
    expect(available[3].route).toEqual({ pathname: "/provider/[providerId]", params: { providerId: PROVIDER.id } });
  });

  it("treats a server without the serviceProviders field as having none", () => {
    const legacy = { propertyOsOrganisations: [ORG], marketplaceProfessionals: [] } as Workspaces;
    expect(resolveAvailableWorkspaces({ status: "signedIn", workspaces: legacy }).map((workspace) => workspace.kind)).toEqual(["marketplace", "property_management"]);
  });
});

describe("resolveInitialWorkspace", () => {
  const session = { status: "signedIn" as const, workspaces: all };

  it("continues in the last workspace only while the server still lists it", () => {
    expect(resolveInitialWorkspace(session, { kind: "professional", id: PRO.id }).name).toBe("Xcel Realty");
    expect(resolveInitialWorkspace({ status: "signedIn", workspaces: none }, { kind: "professional", id: PRO.id })).toBe(MARKETPLACE);
  });

  it("never grants anything from the remembered value", () => {
    // Unknown id, right id with the wrong kind, signed out, no value: all Marketplace.
    expect(resolveInitialWorkspace(session, { kind: "property_management", id: "0b8f6a52-5b0c-4a1e-9c1c-0000000000ff" })).toBe(MARKETPLACE);
    expect(resolveInitialWorkspace(session, { kind: "service_provider", id: ORG.id })).toBe(MARKETPLACE);
    expect(resolveInitialWorkspace({ status: "signedOut", workspaces: all }, { kind: "property_management", id: ORG.id })).toBe(MARKETPLACE);
    expect(resolveInitialWorkspace(session, null)).toBe(MARKETPLACE);
  });
});

describe("parseIntent", () => {
  it("accepts only the three gateway intents", () => {
    expect(parseIntent("service_provider")).toBe("service_provider");
    expect(parseIntent("marketplace")).toBeNull();
    expect(parseIntent("admin")).toBeNull();
    expect(parseIntent(["professional"])).toBeNull();
    expect(parseIntent(undefined)).toBeNull();
  });
});

describe("last workspace store", () => {
  it("remembers per user and returns it only while listed", async () => {
    await rememberWorkspace("u1", { kind: "service_provider", id: PROVIDER.id });
    expect(await loadLastWorkspace("u1", all)).toEqual({ kind: "service_provider", id: PROVIDER.id });
    expect(await loadLastWorkspace("u2", all)).toBeNull();

    // No longer listed: ignored and removed.
    expect(await loadLastWorkspace("u1", none)).toBeNull();
    expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).toBeNull();
  });

  it("ignores and removes tampered or corrupt values", async () => {
    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", JSON.stringify({ kind: "platform_admin", id: ORG.id }));
    expect(await loadLastWorkspace("u1", all)).toBeNull();
    expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).toBeNull();

    await AsyncStorage.setItem("nesafric.last-workspace.v2:u1", "{not json");
    expect(await loadLastWorkspace("u1", all)).toBeNull();
  });

  it("migrates the v1 organisation id", async () => {
    await AsyncStorage.setItem("nesafric.last-workspace.v1:u1", ORG.id);
    expect(await loadLastWorkspace("u1", all)).toEqual({ kind: "property_management", id: ORG.id });
    expect(await AsyncStorage.getItem("nesafric.last-workspace.v1:u1")).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem("nesafric.last-workspace.v2:u1"))!)).toEqual({ kind: "property_management", id: ORG.id });
  });

  it("choosing Marketplace forgets the workspace, and sign-out clears every user's value", async () => {
    await rememberWorkspace("u1", { kind: "property_management", id: ORG.id });
    await rememberWorkspace("u1", MARKETPLACE);
    expect(await AsyncStorage.getItem("nesafric.last-workspace.v2:u1")).toBeNull();

    await rememberWorkspace("u1", { kind: "property_management", id: ORG.id });
    await rememberWorkspace("u2", { kind: "professional", id: PRO.id });
    await AsyncStorage.setItem("nesafric.saved-listings.v1", "[]");
    await clearLastWorkspaces();
    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("nesafric.last-workspace."))).toEqual([]);
    expect(await AsyncStorage.getItem("nesafric.saved-listings.v1")).toBe("[]"); // device saves are untouched
  });
});
