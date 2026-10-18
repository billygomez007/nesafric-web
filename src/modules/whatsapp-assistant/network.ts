import { AppError } from "@/platform/errors";
import { db } from "@/platform/database/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { normalizePhone } from "@/platform/identity/phone";
import { categoryLabels, NETWORK_CATEGORY_KEYS, parseNetworkCategory } from "@/modules/provider-network/categories";
import { inviteNetworkProvider, listNetwork, pendingInvitationsFor, providerJobsForUser, reassignNetworkScope, respondToInvitation, updateNetworkProvider } from "@/modules/provider-network/service";
import { parseAmountMinor, formatMinor } from "./onboarding/parse";
import { whatsappAddress } from "./identity";
import type { AssistantState } from "./schemas";

type NetworkState = NonNullable<AssistantState["network"]>;
export type NetworkResult = { state: AssistantState; reply: string };
type Linked = { user: { id: string; displayName: string } } | null;

const emptyNetwork = (): NetworkState => ({ organisationChoices: [], listed: [], propertyChoices: [], draft: { categories: [], propertyIds: [] } });
const YES = /^(yes|y|1)$/;
const NO = /^(no|n|2)$/;

async function organisationsWith(userId: string, permission: string) {
  const memberships = await db.organisationMember.findMany({
    where: { userId, status: "ACTIVE", archivedAt: null, organisation: { archivedAt: null } },
    include: { organisation: { select: { id: true, name: true, defaultCurrencyCode: true } }, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    orderBy: { createdAt: "asc" },
    take: 9,
  });
  return memberships.filter((membership) => membershipHasPermission(membership.roles, permission)).map(({ organisation }) => organisation);
}

/**
 * Provider side, before anything else: an invited number answering ACCEPT / DECLINE (typed or
 * tapped on the template's quick-reply buttons), listing its invitations, and its own jobs.
 * Returns null when the message is not for this flow.
 */
export async function handleProviderMessage(phone: string, command: string, linked: Linked, state: AssistantState): Promise<NetworkResult | null> {
  const address = whatsappAddress(phone);
  const answer = /^(accept|decline|join|refuse)(?:\s+([1-9]))?$/.exec(command);
  if (answer || command === "invites" || command === "invitations") {
    const invitations = await pendingInvitationsFor(address);
    if (!invitations.length) return answer ? { state, reply: "There is no open invitation for this number." } : { state, reply: "You have no open invitations." };
    const list = invitations.map((invitation, index) => `${index + 1}. ${invitation.landlordOrganisation.name}: ${categoryLabels(invitation.scopeCategories)}`).join("\n");
    if (!answer) return { state, reply: `Open invitations:\n${list}\n\nReply accept 1 or decline 1.` };
    const index = answer[2] ? Number(answer[2]) - 1 : invitations.length === 1 ? 0 : -1;
    if (!invitations[index]) return { state, reply: `You have several invitations:\n${list}\n\nReply accept with a number, for example accept 1.` };
    const accept = answer[1] === "accept" || answer[1] === "join";
    try {
      await respondToInvitation(invitations[index].id, address, accept);
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return { state, reply: "This invitation is no longer open." };
      throw error;
    }
    const organisation = invitations[index].landlordOrganisation.name;
    return {
      state,
      reply: accept
        ? `You have joined the maintenance network of ${organisation} for ${categoryLabels(invitations[index].scopeCategories)}. Each job will be sent here with its details, and you can accept or decline it. You only see the jobs you are sent. Reply jobs to see them, or STOP to stop messages.`
        : `You declined ${organisation}'s invitation. They will not send you work through NesAfric.`,
    };
  }
  if (command === "jobs" || command === "my jobs") {
    if (!linked) return { state, reply: "This number is not linked to a provider account yet. Accept an invitation first, or reply link." };
    const { providers, jobs } = await providerJobsForUser(linked.user.id);
    if (!providers.length) return { state, reply: "This account has no provider profile." };
    if (!jobs.length) return { state, reply: "You have no open jobs." };
    return { state, reply: "Your open jobs:\n" + jobs.map((job, index) => `${index + 1}. ${job.workOrder.title} at ${job.workOrder.property.name}${job.workOrder.unit ? `, ${job.workOrder.unit.name}` : ""} for ${job.landlordOrganisation.name} (${job.status === "PENDING" ? "awaiting your answer" : "accepted"}${job.workOrder.maintenanceRequest.priority === "EMERGENCY" ? ", emergency" : ""})`).join("\n") };
  }
  return null;
}

const describeAction = (action: NonNullable<NetworkState["action"]>, names: Map<string, string>) => {
  const name = names.get(action.id) ?? "this provider";
  switch (action.kind) {
    case "suspend": return `suspend ${name}. They will receive no new jobs until resumed`;
    case "resume": return `resume ${name}`;
    case "remove": return `remove ${name} from your network. Their past jobs stay in your records`;
    case "reassign": return `move all of ${name}'s work categories to ${names.get(action.toId!) ?? "the other provider"}`;
    case "auto_on": return `let jobs be sent to ${name} automatically, within your rules`;
    case "auto_off": return `stop sending jobs to ${name} automatically. You will choose each time`;
  }
};

async function listReply(userId: string, state: AssistantState): Promise<NetworkResult> {
  const organisations = await organisationsWith(userId, PERMISSIONS.providerRead);
  if (!organisations.length) return { state, reply: "You don't manage any properties on NesAfric yet. Reply register to set them up." };
  const listed: NetworkState["listed"] = [];
  const sections: string[] = [];
  for (const organisation of organisations) {
    const network = await listNetwork(userId, organisation.id);
    const lines = network.entries.map((entry) => {
      listed.push({ id: entry.id, organisationId: organisation.id, name: entry.provider.displayName });
      const status = entry.status === "BLOCKED" ? "suspended" : !entry.consentedAt ? "not confirmed by provider" : "active";
      return `${listed.length}. ${entry.provider.displayName}: ${categoryLabels(entry.scopeCategories) || "no categories"}, ${status}${entry.autoDispatchAllowed ? ", automatic jobs on" : ""}${entry.spendingLimitMinor ? `, up to ${formatMinor(entry.spendingLimitMinor, organisation.defaultCurrencyCode)}` : ""}`;
    });
    const invites = network.invitations.map((invitation) => `• ${invitation.displayName}: invited${invitation.deliveryFailureReason ? ` (not sent: ${invitation.deliveryFailureReason})` : ", waiting for their answer"}`);
    sections.push(`${organisation.name}\n${[...lines, ...invites].join("\n") || "No providers yet."}`);
  }
  return {
    state: { ...state, network: { ...(state.network ?? emptyNetwork()), listed: listed.slice(0, 30) } },
    reply: `${sections.join("\n\n")}\n\nReply add provider, or suspend / resume / remove provider 1, auto on / auto off provider 1, reassign provider 1 to 2.`,
  };
}

const ACTION = /^(suspend|resume|remove|auto on|auto off) provider ([1-9]\d?)$|^reassign provider ([1-9]\d?) to ([1-9]\d?)$/;

/**
 * Landlord side. Material changes (suspend, remove, reassign, automatic dispatch) are shown back
 * and need an explicit confirm; the invitation flow ends with a summary and confirm too.
 */
export async function advanceNetwork(command: string, body: string, linked: Linked, state: AssistantState, reset: () => AssistantState): Promise<NetworkResult | null> {
  const network = state.network ?? emptyNetwork();
  const inFlow = state.workflow === "network";
  if (!inFlow && command !== "providers" && command !== "my providers" && command !== "add provider" && !ACTION.test(command)) return null;
  if (!linked) return { state, reply: "Link this WhatsApp number to your NesAfric account first. Reply link." };
  const userId = linked.user.id;
  if (inFlow && (command === "cancel" || command === "menu")) return { state: { ...reset(), network: { ...emptyNetwork(), listed: network.listed } }, reply: "Cancelled. Nothing was changed." };

  if (!inFlow && (command === "providers" || command === "my providers")) return listReply(userId, state);

  const action = ACTION.exec(command);
  if (!inFlow && action) {
    const pick = (value: string) => network.listed[Number(value) - 1];
    const from = pick(action[2] ?? action[3]);
    const to = action[4] ? pick(action[4]) : undefined;
    if (!from || (action[4] && (!to || to.organisationId !== from.organisationId))) return { state, reply: "Reply providers to see the numbered list first, then use those numbers." };
    const kinds = { suspend: "suspend", resume: "resume", remove: "remove", "auto on": "auto_on", "auto off": "auto_off" } as const;
    const kind: NonNullable<NetworkState["action"]>["kind"] = action[1] ? kinds[action[1] as keyof typeof kinds] : "reassign";
    const pending: NonNullable<NetworkState["action"]> = { kind, id: from.id, organisationId: from.organisationId, toId: to?.id };
    const names = new Map(network.listed.map((entry) => [entry.id, entry.name]));
    return { state: { ...state, workflow: "network", network: { ...network, step: "confirm_action", action: pending } }, reply: `Please confirm: ${describeAction(pending, names)}.\nReply confirm, or cancel.` };
  }

  if (!inFlow && command === "add provider") {
    const organisations = await organisationsWith(userId, PERMISSIONS.providerManage);
    if (!organisations.length) return { state, reply: "You don't manage any properties on NesAfric yet. Reply register to set them up." };
    const next: NetworkState = { ...emptyNetwork(), listed: network.listed, organisationChoices: organisations.map(({ id }) => id) };
    if (organisations.length > 1) return { state: { ...state, workflow: "network", network: { ...next, step: "organisation" } }, reply: `Which business is this provider for?\n${organisations.map((organisation, index) => `${index + 1}. ${organisation.name}`).join("\n")}` };
    return { state: { ...state, workflow: "network", network: { ...next, organisationId: organisations[0].id, step: "details" } }, reply: detailsPrompt };
  }
  if (!inFlow) return null;

  switch (network.step) {
    case "confirm_action": {
      if (command !== "confirm" || !network.action) return { state, reply: "Reply confirm to go ahead, or cancel." };
      const { kind, id, organisationId, toId } = network.action;
      try {
        if (kind === "reassign") await reassignNetworkScope(userId, organisationId, id, toId!);
        else await updateNetworkProvider(userId, organisationId, id, kind === "auto_on" ? { autoDispatchAllowed: true } : kind === "auto_off" ? { autoDispatchAllowed: false } : { status: kind === "suspend" ? "BLOCKED" : kind === "remove" ? "ARCHIVED" : "ACTIVE" });
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return { state: { ...reset(), network: { ...emptyNetwork(), listed: network.listed } }, reply: `Not changed: ${error.message}` };
        throw error;
      }
      return { state: { ...reset(), network: { ...emptyNetwork(), listed: network.listed } }, reply: "Done. Reply providers to see your network." };
    }
    case "organisation": {
      const id = network.organisationChoices[Number(command) - 1];
      if (!id) return { state, reply: "Reply with the number of the business." };
      return { state: { ...state, network: { ...network, organisationId: id, step: "details" } }, reply: detailsPrompt };
    }
    case "details": {
      const [name, rawPhone, ...rawCategories] = body.split(",").map((part) => part.trim());
      const phone = normalizePhone(rawPhone);
      const categories = rawCategories.map(parseNetworkCategory);
      if (!name || name.length < 2 || name.length > 160 || !phone || !categories.length || categories.some((category) => !category)) return { state, reply: `I could not read that.\n${detailsPrompt}` };
      const properties = await db.property.findMany({ where: { organisationId: network.organisationId, archivedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 30 });
      const next = { ...network, step: "properties" as const, propertyChoices: properties, draft: { ...network.draft, displayName: name, phone, categories: [...new Set(categories as string[])] } };
      if (properties.length <= 1) return { state: { ...state, network: { ...next, step: "auto" } }, reply: autoPrompt };
      return { state: { ...state, network: next }, reply: `Which properties should ${name} serve? Reply all, or the numbers separated by commas:\n${properties.map((property, index) => `${index + 1}. ${property.name}`).join("\n")}` };
    }
    case "properties": {
      let propertyIds: string[] = [];
      if (command !== "all") {
        const picks = command.split(",").map((part) => network.propertyChoices[Number(part.trim()) - 1]);
        if (!picks.length || picks.some((pick) => !pick)) return { state, reply: "Reply all, or property numbers from the list separated by commas." };
        propertyIds = [...new Set(picks.map((pick) => pick!.id))];
      }
      return { state: { ...state, network: { ...network, step: "auto", draft: { ...network.draft, propertyIds } } }, reply: autoPrompt };
    }
    case "auto": {
      if (!YES.test(command) && !NO.test(command)) return { state, reply: autoPrompt };
      return { state: { ...state, network: { ...network, step: "limit", draft: { ...network.draft, autoDispatch: YES.test(command) } } }, reply: "What is the most a job sent to this provider may cost without asking you first? Send an amount, or 0 to approve every cost yourself." };
    }
    case "limit": {
      const limitMinor = parseAmountMinor(body);
      if (!limitMinor) return { state, reply: "Send an amount such as 500, or 0." };
      const currency = (await db.organisation.findUnique({ where: { id: network.organisationId }, select: { defaultCurrencyCode: true } }))?.defaultCurrencyCode ?? "GHS";
      const draft = { ...network.draft, limitMinor };
      const properties = draft.propertyIds.length ? network.propertyChoices.filter((property) => draft.propertyIds.includes(property.id)).map((property) => property.name).join(", ") : "all your properties";
      return {
        state: { ...state, network: { ...network, step: "confirm_add", draft } },
        reply: `Please confirm the invitation:\n${draft.displayName}, ${draft.phone}\nWork: ${categoryLabels(draft.categories)}\nProperties: ${properties}\nAutomatic jobs: ${draft.autoDispatch ? "yes" : "no"}\nWithout your approval: ${limitMinor === "0" ? "nothing, always ask" : `up to ${formatMinor(limitMinor, currency)}`}\n\nThey will be asked on WhatsApp to accept before any job is sent. Reply confirm, or cancel.`,
      };
    }
    case "confirm_add": {
      if (command !== "confirm") return { state, reply: "Reply confirm to send the invitation, or cancel." };
      const draft = network.draft;
      try {
        const invitation = await inviteNetworkProvider(userId, network.organisationId!, {
          displayName: draft.displayName, phone: draft.phone, scopeCategories: draft.categories, propertyIds: draft.propertyIds,
          autoDispatchAllowed: Boolean(draft.autoDispatch), spendingLimitMinor: draft.limitMinor && draft.limitMinor !== "0" ? draft.limitMinor : null, source: "WHATSAPP",
        });
        const reply = invitation.deliveryFailureReason
          ? `Invitation saved for ${draft.displayName}, but it could not be sent yet: ${invitation.deliveryFailureReason} They are not part of your network until they accept.`
          : `Invitation sent to ${draft.displayName}. They join your network only when they reply ACCEPT. Reply providers to check.`;
        return { state: { ...reset(), network: { ...emptyNetwork(), listed: network.listed } }, reply };
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return { state: { ...reset(), network: { ...emptyNetwork(), listed: network.listed } }, reply: `Not sent: ${error.message}` };
        throw error;
      }
    }
  }
  return { state: { ...reset(), network: { ...emptyNetwork(), listed: network.listed } }, reply: "Reply providers to manage your maintenance network." };
}

const detailsPrompt = `Send the provider as: name, phone, work. For example:\nKwame Plumbing, 0201234567, plumber\nWork can be one or more of: ${NETWORK_CATEGORY_KEYS.join(", ").replace(/_/g, " ")}. Reply cancel to stop.`;
const autoPrompt = "May NesAfric send this provider jobs automatically when they match your rules? Reply yes or no. You can change this later.";
