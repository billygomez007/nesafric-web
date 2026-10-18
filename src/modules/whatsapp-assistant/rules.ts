import { AppError } from "@/platform/errors";
import { db } from "@/platform/database/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { categoryLabels, NETWORK_CATEGORY_KEYS, parseNetworkCategory } from "@/modules/provider-network/categories";
import { createRoutingRule, listRoutingRules, setRoutingRulePaused, updateRoutingRule } from "@/modules/maintenance-routing/rules";
import { formatMinor, parseAmountMinor } from "./onboarding/parse";
import type { AssistantState } from "./schemas";

type RulesState = NonNullable<AssistantState["rules"]>;
type Linked = { user: { id: string; displayName: string } } | null;
export type RulesResult = { state: AssistantState; reply: string };

const empty = (): RulesState => ({ organisationChoices: [], listed: [], propertyChoices: [], providerChoices: [], draft: { backups: [] } });
const MODE_TEXT = { PRE_AUTHORIZED: "repair up to a limit", INSPECTION_ONLY: "inspect only", QUOTE_REQUIRED: "quote first", APPROVAL_REQUIRED: "ask me first", ESCALATE: "alert me, send nobody" } as const;
const MODE_BY_CHOICE = { "1": "PRE_AUTHORIZED", "2": "INSPECTION_ONLY", "3": "QUOTE_REQUIRED", "4": "APPROVAL_REQUIRED", "5": "ESCALATE" } as const;
const COMMAND = /^(rules|my rules|add rule)$|^(pause|resume) rule ([1-9]\d?)$|^(pause|resume) (?:automatic )?([a-z ]+?) dispatch$|^set limit rule ([1-9]\d?) (.+)$/;

/** Rule commands are exact phrases; they take precedence over free-text repair reports. */
export const isRuleCommand = (command: string) => COMMAND.test(command);

async function managedOrganisations(userId: string) {
  const memberships = await db.organisationMember.findMany({
    where: { userId, status: "ACTIVE", archivedAt: null, organisation: { archivedAt: null } },
    include: { organisation: { select: { id: true, name: true, defaultCurrencyCode: true } }, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    orderBy: { createdAt: "asc" }, take: 9,
  });
  return memberships.filter((membership) => membershipHasPermission(membership.roles, PERMISSIONS.maintenanceManage)).map(({ organisation }) => organisation);
}

async function listReply(userId: string, state: AssistantState): Promise<RulesResult> {
  const organisations = await managedOrganisations(userId);
  if (!organisations.length) return { state, reply: "You don't manage any properties on NesAfric yet. Reply register to set them up." };
  const listed: RulesState["listed"] = [];
  const sections: string[] = [];
  for (const organisation of organisations) {
    const rules = await listRoutingRules(userId, organisation.id);
    const names = new Map((await db.providerOrganisation.findMany({ where: { landlordOrganisationId: organisation.id }, include: { provider: { select: { displayName: true } } } })).map((entry) => [entry.id, entry.provider.displayName]));
    const lines = rules.map((rule) => {
      listed.push({ id: rule.id, organisationId: organisation.id, name: rule.name });
      const scope = rule.unit ? `${rule.property?.name}, ${rule.unit.name}` : rule.property?.name ?? "all properties";
      const who = rule.primaryProviderOrganisationId ? names.get(rule.primaryProviderOrganisationId) ?? "unknown" : "nobody";
      return `${listed.length}. ${categoryLabels([rule.category])} at ${scope} → ${who}${rule.backupProviderOrganisationIds.length ? ` (+${rule.backupProviderOrganisationIds.length} backup)` : ""}, ${MODE_TEXT[rule.authorizationMode]}${rule.spendingCapMinor ? ` up to ${formatMinor(rule.spendingCapMinor, organisation.defaultCurrencyCode)}` : ""}${rule.pausedAt ? ", PAUSED" : !rule.autoDispatch ? ", manual" : ""}`;
    });
    sections.push(`${organisation.name}\n${lines.join("\n") || "No maintenance rules yet."}`);
  }
  return { state: { ...state, rules: { ...(state.rules ?? empty()), listed: listed.slice(0, 30) } }, reply: `${sections.join("\n\n")}\n\nReply add rule, pause rule 1, resume rule 1, set limit rule 1 500, or pause plumbing dispatch.` };
}

function describeAction(action: NonNullable<RulesState["action"]>, names: Map<string, string>, currency = "GHS") {
  const which = action.ids.map((entry) => names.get(entry.id) ?? "a rule").join(", ");
  if (action.kind === "pause") return `pause ${which}. New problems will not be sent to anyone automatically; you will be alerted instead`;
  if (action.kind === "resume") return `resume ${which}. Matching problems will be sent automatically again`;
  return action.capMinor === "0" ? `make ${which} ask for a quote before any paid work` : `let providers under ${which} go ahead with repairs up to ${formatMinor(action.capMinor!, currency)} without asking you`;
}

/**
 * Landlord routing-rule commands. Every change that affects what happens automatically is read
 * back in plain words and applied only after an explicit confirm, so a misunderstanding never
 * silently changes a rule. Returns null when the message is not for this flow.
 */
export async function advanceRules(command: string, body: string, linked: Linked, state: AssistantState, reset: () => AssistantState): Promise<RulesResult | null> {
  const rules = state.rules ?? empty();
  const inFlow = state.workflow === "rules";
  const match = inFlow ? null : COMMAND.exec(command);
  if (!inFlow && !match) return null;
  if (!linked) return { state, reply: "Link this WhatsApp number to your NesAfric account first. Reply link." };
  const userId = linked.user.id;
  const done = (reply: string): RulesResult => ({ state: { ...reset(), rules: { ...empty(), listed: rules.listed } }, reply });
  if (inFlow && (command === "cancel" || command === "menu")) return done("Cancelled. No rule was changed.");

  if (match) {
    if (match[1] === "rules" || match[1] === "my rules") return listReply(userId, state);
    if (match[1] === "add rule") {
      const organisations = await managedOrganisations(userId);
      if (!organisations.length) return { state, reply: "You don't manage any properties on NesAfric yet." };
      const next: RulesState = { ...empty(), listed: rules.listed, organisationChoices: organisations.map(({ id }) => id) };
      if (organisations.length > 1) return { state: { ...state, workflow: "rules", rules: { ...next, step: "organisation" } }, reply: `Which business is this rule for?\n${organisations.map((organisation, index) => `${index + 1}. ${organisation.name}`).join("\n")}` };
      return { state: { ...state, workflow: "rules", rules: { ...next, organisationId: organisations[0].id, step: "category" } }, reply: categoryPrompt };
    }
    const names = new Map(rules.listed.map((entry) => [entry.id, entry.name]));
    let action: NonNullable<RulesState["action"]> | null = null;
    if (match[2]) {
      const entry = rules.listed[Number(match[3]) - 1];
      if (!entry) return { state, reply: "Reply rules to see the numbered list first, then use those numbers." };
      action = { kind: match[2] as "pause" | "resume", ids: [{ id: entry.id, organisationId: entry.organisationId }] };
    } else if (match[4]) {
      const category = parseNetworkCategory(match[5]);
      if (!category) return { state, reply: `I don't know the work type "${match[5]}". Use one of: ${NETWORK_CATEGORY_KEYS.join(", ").replace(/_/g, " ")}.` };
      const organisations = await managedOrganisations(userId);
      const found = await db.maintenanceRoutingRule.findMany({ where: { organisationId: { in: organisations.map(({ id }) => id) }, category, archivedAt: null, pausedAt: match[4] === "pause" ? null : { not: null } }, select: { id: true, organisationId: true, name: true } });
      if (!found.length) return { state, reply: `You have no ${match[4] === "pause" ? "active" : "paused"} ${categoryLabels([category])} rules.` };
      found.forEach((rule) => names.set(rule.id, rule.name));
      action = { kind: match[4] as "pause" | "resume", ids: found.map(({ id, organisationId }) => ({ id, organisationId })) };
    } else if (match[6]) {
      const entry = rules.listed[Number(match[6]) - 1];
      const capMinor = parseAmountMinor(match[7]);
      if (!entry || !capMinor) return { state, reply: "Use: set limit rule 1 500 (after reply rules), or 0 to always ask for a quote." };
      action = { kind: "set_cap", ids: [{ id: entry.id, organisationId: entry.organisationId }], capMinor };
    }
    const currency = (await db.organisation.findUnique({ where: { id: action!.ids[0].organisationId }, select: { defaultCurrencyCode: true } }))?.defaultCurrencyCode ?? "GHS";
    return { state: { ...state, workflow: "rules", rules: { ...rules, step: "confirm_action", action: action! } }, reply: `Please confirm: ${describeAction(action!, names, currency)}.\nReply confirm, or cancel.` };
  }

  const organisationId = rules.organisationId;
  switch (rules.step) {
    case "confirm_action": {
      if (command !== "confirm" || !rules.action) return { state, reply: "Reply confirm to go ahead, or cancel." };
      try {
        for (const entry of rules.action.ids) {
          if (rules.action.kind === "set_cap") await updateRoutingRule(userId, entry.organisationId, entry.id, rules.action.capMinor === "0" ? { authorizationMode: "QUOTE_REQUIRED", spendingCapMinor: null } : { authorizationMode: "PRE_AUTHORIZED", spendingCapMinor: rules.action.capMinor });
          else await setRoutingRulePaused(userId, entry.organisationId, entry.id, rules.action.kind === "pause");
        }
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return done(`Not changed: ${error.message}`);
        throw error;
      }
      return done("Done. Reply rules to see them.");
    }
    case "organisation": {
      const id = rules.organisationChoices[Number(command) - 1];
      if (!id) return { state, reply: "Reply with the number of the business." };
      return { state: { ...state, rules: { ...rules, organisationId: id, step: "category" } }, reply: categoryPrompt };
    }
    case "category": {
      const category = parseNetworkCategory(command);
      if (!category) return { state, reply: categoryPrompt };
      const properties = await db.property.findMany({ where: { organisationId, archivedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 30 });
      const next = { ...rules, propertyChoices: properties, draft: { ...rules.draft, category } };
      if (properties.length <= 1) return providerStep({ ...next, draft: { ...next.draft, propertyId: null } }, state);
      return { state: { ...state, rules: { ...next, step: "property" } }, reply: `Which property? Reply all, or one number:\n${properties.map((property, index) => `${index + 1}. ${property.name}`).join("\n")}` };
    }
    case "property": {
      const picked = command === "all" ? null : rules.propertyChoices[Number(command) - 1]?.id;
      if (picked === undefined) return { state, reply: "Reply all, or a property number from the list." };
      return providerStep({ ...rules, draft: { ...rules.draft, propertyId: picked } }, state);
    }
    case "primary": {
      const picked = rules.providerChoices[Number(command) - 1];
      if (!picked) return { state, reply: "Reply with the number of the provider." };
      const others = rules.providerChoices.filter((choice) => choice.id !== picked.id);
      const next = { ...rules, draft: { ...rules.draft, primary: picked.id } };
      if (!others.length) return { state: { ...state, rules: { ...next, step: "mode" } }, reply: modePrompt };
      return { state: { ...state, rules: { ...next, step: "backups" } }, reply: `Backups if ${picked.name} declines or does not answer? Reply numbers in order (for example 2,3), or none:\n${rules.providerChoices.map((choice, index) => `${index + 1}. ${choice.name}`).join("\n")}` };
    }
    case "backups": {
      let backups: string[] = [];
      if (command !== "none") {
        const picks = command.split(",").map((part) => rules.providerChoices[Number(part.trim()) - 1]);
        if (!picks.length || picks.some((pick) => !pick || pick.id === rules.draft.primary)) return { state, reply: "Reply provider numbers (not the main one), or none." };
        backups = [...new Set(picks.map((pick) => pick!.id))];
      }
      return { state: { ...state, rules: { ...rules, step: "mode", draft: { ...rules.draft, backups } } }, reply: modePrompt };
    }
    case "mode": {
      const mode = MODE_BY_CHOICE[command as keyof typeof MODE_BY_CHOICE];
      if (!mode) return { state, reply: modePrompt };
      const next = { ...rules, draft: { ...rules.draft, mode } };
      if (mode === "PRE_AUTHORIZED") return { state: { ...state, rules: { ...next, step: "cap" } }, reply: "Up to what amount may the provider go ahead without asking you? Send an amount, for example 500." };
      return { state: { ...state, rules: { ...next, step: "timeout" } }, reply: timeoutPrompt };
    }
    case "cap": {
      const capMinor = parseAmountMinor(body);
      if (!capMinor || capMinor === "0") return { state, reply: "Send an amount greater than 0, for example 500." };
      return { state: { ...state, rules: { ...rules, step: "timeout", draft: { ...rules.draft, capMinor } } }, reply: timeoutPrompt };
    }
    case "timeout": {
      const minutes = command === "default" ? 60 : /^\d{1,5}$/.test(command) ? Number(command) : NaN;
      if (!(minutes >= 5 && minutes <= 10_080)) return { state, reply: timeoutPrompt };
      const draft = { ...rules.draft, timeoutMinutes: minutes };
      const currency = (await db.organisation.findUnique({ where: { id: organisationId }, select: { defaultCurrencyCode: true } }))?.defaultCurrencyCode ?? "GHS";
      const name = (id?: string) => rules.providerChoices.find((choice) => choice.id === id)?.name ?? "nobody";
      const property = draft.propertyId ? rules.propertyChoices.find((choice) => choice.id === draft.propertyId)?.name : "all properties";
      return {
        state: { ...state, rules: { ...rules, step: "confirm_add", draft } },
        reply: `Please confirm the rule:\n${categoryLabels([draft.category!])} problems at ${property}\nSend to: ${name(draft.primary)}${draft.backups.length ? `, then ${draft.backups.map(name).join(", ")}` : ""}\nThey may: ${MODE_TEXT[draft.mode!]}${draft.capMinor ? ` (up to ${formatMinor(draft.capMinor, currency)})` : ""}\nWait ${minutes} minutes for an answer before trying the next one.\n\nReply confirm, or cancel.`,
      };
    }
    case "confirm_add": {
      if (command !== "confirm") return { state, reply: "Reply confirm to save the rule, or cancel." };
      const draft = rules.draft;
      try {
        await createRoutingRule(userId, organisationId!, {
          name: `${categoryLabels([draft.category!])} ${draft.propertyId ? `at ${rules.propertyChoices.find((choice) => choice.id === draft.propertyId)?.name}` : "everywhere"}`.slice(0, 120),
          propertyId: draft.propertyId ?? null, category: draft.category, primaryProviderOrganisationId: draft.primary ?? null, backupProviderOrganisationIds: draft.backups,
          autoDispatch: draft.mode !== "APPROVAL_REQUIRED" && draft.mode !== "ESCALATE", authorizationMode: draft.mode, spendingCapMinor: draft.capMinor ?? null, responseTimeoutMinutes: draft.timeoutMinutes,
        });
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return done(`Not saved: ${error.message}`);
        throw error;
      }
      return done("Rule saved. New matching problems will follow it. Reply rules to see your rules.");
    }
  }
  return done("Reply rules to manage your maintenance rules.");
}

async function providerStep(rules: RulesState, state: AssistantState): Promise<RulesResult> {
  const members = await db.providerOrganisation.findMany({ where: { landlordOrganisationId: rules.organisationId, status: "ACTIVE", consentedAt: { not: null }, scopeCategories: { has: rules.draft.category! } }, include: { provider: { select: { displayName: true } } }, orderBy: { consentedAt: "asc" }, take: 30 });
  if (!members.length) {
    const draft = { ...rules.draft, mode: "ESCALATE" as const };
    return { state: { ...state, rules: { ...rules, step: "timeout", draft, providerChoices: [] } }, reply: `No provider in your network has accepted ${categoryLabels([rules.draft.category!])} work yet, so this rule will alert you instead of sending anyone. Reply add provider later to invite one.\n\n${timeoutPrompt}` };
  }
  const providerChoices = members.map((member) => ({ id: member.id, name: member.provider.displayName }));
  return { state: { ...state, rules: { ...rules, step: "primary", providerChoices } }, reply: `Who should get these jobs first?\n${providerChoices.map((choice, index) => `${index + 1}. ${choice.name}`).join("\n")}` };
}

const categoryPrompt = `Which kind of problem is this rule for? For example plumbing. Options: ${NETWORK_CATEGORY_KEYS.join(", ").replace(/_/g, " ")}. Reply cancel to stop.`;
const modePrompt = "What may the provider do without asking you?\n1. Repair, up to an amount you set\n2. Inspect only, then quote\n3. Quote before any paid work\n4. Nothing: ask me before sending anyone\n5. Send nobody: alert me only";
const timeoutPrompt = "How many minutes should a provider have to accept before the next one is tried? Reply a number (5 to 10080), or default for 60.";
