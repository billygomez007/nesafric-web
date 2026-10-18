import { absoluteUrl } from "@/platform/brand";
import { AppError } from "@/platform/errors";
import { maskPhone, normalizePhone } from "@/platform/identity/phone";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { db } from "@/platform/database/client";
import { requestOtp, verifyOtp } from "@/modules/identity/otp";
import { linkedWhatsAppUser, linkWhatsAppIdentity, whatsappAddress } from "../identity";
import { abandonDraft, findOpenDraft, saveDraft, startDraft, type Draft } from "./draft";
import { commitDraft, type CommitSummary } from "./commit";
import { formatErrors, formatMinor, parseAmountMinor, parseProviders, parseTenants, parseUnits, parseUnitType, PROVIDER_CATEGORIES, UNIT_TYPES, type LineError } from "./parse";

export type OnboardingInput = { phone: string; messageId: string; body: string; kind: string; organisationId: string; defaultCountry: string; defaultCurrency: string };
export type OnboardingResult = { reply: string; /** Leave the onboarding workflow (saved, discarded or finished). */ exit?: boolean; redactInbound?: boolean };

/** Organisations this user may add properties to. */
async function manageableOrganisations(userId: string) {
  const memberships = await db.organisationMember.findMany({
    where: { userId, status: "ACTIVE", archivedAt: null, organisation: { archivedAt: null } },
    include: { organisation: { select: { id: true, name: true } }, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    orderBy: { createdAt: "asc" },
    take: 9,
  });
  return memberships.filter((membership) => membershipHasPermission(membership.roles, PERMISSIONS.propertyCreate)).map(({ organisation }) => organisation);
}

type Dependencies = {
  linkedUser: typeof linkedWhatsAppUser;
  requestOtp: typeof requestOtp;
  verifyOtp: typeof verifyOtp;
  link: typeof linkWhatsAppIdentity;
  commit: (draft: Draft, userId: string) => Promise<CommitSummary>;
  organisations: typeof manageableOrganisations;
  drafts: { find: typeof findOpenDraft; start: typeof startDraft; save: typeof saveDraft; abandon: typeof abandonDraft };
};
const defaults: Dependencies = { linkedUser: linkedWhatsAppUser, requestOtp, verifyOtp, link: linkWhatsAppIdentity, commit: commitDraft, organisations: manageableOrganisations, drafts: { find: findOpenDraft, start: startDraft, save: saveDraft, abandon: abandonDraft } };

const YES = /^(yes|y|1|ok|sure)$/;
const NO = /^(no|n|2|later|skip|not now)$/;
const MAX_CODE_FAILURES = 5;

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const unitCount = (draft: Draft) => draft.data.properties.reduce((sum, property) => sum + property.buildings.reduce((count, building) => count + building.units.length, 0), 0);
const currentProperty = (draft: Draft) => draft.data.properties[draft.data.cursor.property];
const currentBuilding = (draft: Draft) => currentProperty(draft)?.buildings[draft.data.cursor.building];
const unitPrefix = (draft: Draft) => {
  const building = currentBuilding(draft);
  return building?.name ? `${building.name} ` : "Unit ";
};

export function promptFor(draft: Draft, phone: string): string {
  const data = draft.data;
  const property = currentProperty(draft);
  const building = currentBuilding(draft);
  switch (draft.step) {
    case "role": return "Let's set up your properties on NesAfric. Are you:\n1. A landlord (you own the properties)\n2. A property manager (you manage them for the owners)\n\nYour progress is saved as you go. Reply pause at any time to continue later.";
    case "name": return "What is your full name?";
    case "account_code": return data.challengeId ? `Reply with the 6-digit code I sent by text message to ${maskPhone(whatsappAddress(phone))}. Reply resend for a new code.` : "Reply resend to get a 6-digit code by text message.";
    case "organisation": return data.organisationChoices.length
      ? `Add the properties to:\n${data.organisationChoices.map((choice, index) => `${index + 1}. ${choice.name}`).join("\n")}\n${data.organisationChoices.length + 1}. A new business — or just send its name.`
      : "What name should your properties be managed under? For example: Owusu Homes. Reply me to use your own name.";
    case "property_name": return `Property ${data.cursor.property + 1}: what is it called? For example: Palm Court Apartments.`;
    case "property_city": return `Which town or area is ${property?.name} in?`;
    case "property_address": return `What is the street address or nearest landmark of ${property?.name}? Reply skip to leave it out.`;
    case "buildings": return `Is ${property?.name} one building, or several blocks?\nReply 1 for one building, or send the block names separated by commas, for example: Block A, Block B.`;
    case "units": return `Units in ${building?.name ?? property?.name}: send the number of units to number them automatically (${unitPrefix(draft)}1, ${unitPrefix(draft)}2…), or list them one per line as: unit name, type, bedrooms. For example:\nA1, apartment, 2\nA2, studio`;
    case "unit_type": return `What type are these ${plural(building?.units.length ?? 0, "unit")}? Reply one of: ${UNIT_TYPES.join(", ")} — or skip.`;
    case "more_properties": return `Saved ${property?.name}: ${plural(property?.buildings.length ?? 0, "building")}, ${plural(property?.buildings.reduce((sum, item) => sum + item.units.length, 0) ?? 0, "unit")}. Add another property? Reply yes or no.`;
    case "tenants_offer": return "Do you want to add your current tenants now? Reply yes, or later to skip.";
    case "tenants": return `Send one tenant per line as:\nunit, full name, phone, rent, frequency, start date, end date\nFor example:\nA1, Kofi Mensah, 0241234567, 1500, monthly, 2026-01-01, 2026-12-31\nUse - if you don't know the phone. The end date is optional.${data.properties.length > 1 ? " With several properties, write the unit as Property/Unit, for example Palm Court/A1." : ""}\nTenants are not contacted or given access by this step. Reply done when finished.`;
    case "reminders": return "Should NesAfric remind tenants 60 and 30 days before their lease ends? Reply yes or no.";
    case "providers_offer": return "Do you already work with plumbers, electricians or other maintenance professionals? Reply yes to add them, or no.";
    case "providers": return `Send one per line as: name, phone, category. For example:\nKwame Plumbing, 0201234567, plumber\nCategories: ${PROVIDER_CATEGORIES.join(", ")}.\nEach one is asked on WhatsApp to accept before any job is sent. Reply done when finished.`;
    case "approval_limit": return `Up to what amount may a routine repair go ahead without asking you first? Send an amount in ${data.currencyCode} (for example 500), or 0 to approve every repair yourself.`;
    case "emergency_contact": return "Who should get urgent maintenance alerts, such as a burst pipe or an electrical fault? Reply me, or send another phone number.";
    case "review": return reviewSummary(draft);
  }
}

function reviewSummary(draft: Draft) {
  const data = draft.data;
  const organisation = data.existingOrganisationId ? data.organisationChoices.find((choice) => choice.id === data.existingOrganisationId)?.name : data.organisationName;
  const properties = data.properties.map((property, index) => `${index + 1}. ${property.name}, ${property.city ?? ""}: ${plural(property.buildings.length, "building")}, ${plural(property.buildings.reduce((sum, building) => sum + building.units.length, 0), "unit")}`).join("\n");
  return [
    "Please check your details:",
    `${data.role === "MANAGER" ? "Property manager" : "Landlord"}: ${data.displayName ?? "your NesAfric account"}`,
    `Managed under: ${organisation}`,
    properties,
    `Tenants: ${data.tenants.length}`,
    `Lease-expiry reminders: ${data.leaseExpiryReminders ? "on" : "off"}`,
    `Maintenance professionals: ${data.providers.length}`,
    `Repairs without your approval: ${data.approvalLimitMinor === "0" || !data.approvalLimitMinor ? "none, always ask" : `up to ${formatMinor(data.approvalLimitMinor, data.currencyCode)}`}`,
    `Urgent alerts to: ${data.emergencyContact === "me" || !data.emergencyContact ? "you" : data.emergencyContact}`,
    "",
    "Reply confirm to save, add property, add tenants, or discard.",
  ].join("\n");
}

function successReply(summary: CommitSummary, draft: Draft) {
  const data = draft.data;
  return [
    `Saved. ${summary.organisationName}: ${plural(summary.properties, "property", "properties")}, ${plural(summary.units, "unit")}, ${plural(summary.tenants, "tenant")}.`,
    summary.draftLeases ? `• ${plural(summary.draftLeases, "lease")} saved as drafts with the rent terms you sent. A lease becomes active once its execution is completed in your account: ${absoluteUrl("/leases")}` : null,
    `• ${data.role === "MANAGER" ? "Your authority to manage" : "Your ownership of"} ${summary.properties === 1 ? "this property is" : "these properties is"} pending verification by NesAfric. Upload proof (title deed, tenancy agreement or management contract) at ${absoluteUrl("/properties")}. Until it is reviewed the properties are marked unverified.`,
    summary.reminders ? "• Lease-expiry reminders are on (60 and 30 days before)." : null,
    data.providers.length ? (summary.providerInviteProblem
      ? `• ${plural(data.providers.length, "maintenance professional")} saved as invitations, but they could not be sent yet: ${summary.providerInviteProblem} Nobody has been contacted.`
      : `• Invitations sent to ${plural(data.providers.length, "maintenance professional")}. Each joins your network only by replying ACCEPT; no work order is sent before that. Reply providers to check.`) : null,
    "• Automatic maintenance dispatch is not switched on yet. Your approval limit and alert contact are saved for when it is.",
    "\nReply account to see your portfolio, or menu for other options.",
  ].filter(Boolean).join("\n");
}

/** After the last building of the current property, or the next building's units. */
function afterBuilding(draft: Draft) {
  const property = currentProperty(draft)!;
  if (draft.data.cursor.building + 1 < property.buildings.length) {
    draft.data.cursor.building += 1;
    draft.step = "units";
  } else {
    draft.step = "more_properties";
  }
}

function resolveTenantUnits(draft: Draft, tenants: ReturnType<typeof parseTenants>["tenants"]) {
  const errors: LineError[] = [];
  const resolved: Draft["data"]["tenants"] = [];
  const taken = new Set(draft.data.tenants.map((tenant) => `${tenant.propertyIndex}:${tenant.unitName.toLowerCase()}`));
  tenants.forEach((tenant, index) => {
    const [propertyName, unitName] = tenant.unitRef.includes("/") ? tenant.unitRef.split("/", 2).map((part) => part.trim()) : [null, tenant.unitRef];
    const matches = draft.data.properties.flatMap((property, propertyIndex) =>
      propertyName && property.name.toLowerCase() !== propertyName.toLowerCase() ? [] :
        property.buildings.flatMap((building) => building.units.filter((unit) => unit.name.toLowerCase() === unitName.toLowerCase()).map((unit) => ({ propertyIndex, unitName: unit.name }))));
    if (!matches.length) return errors.push({ line: index + 1, text: tenant.unitRef, reason: `No unit called ${tenant.unitRef} in this onboarding.` });
    if (matches.length > 1) return errors.push({ line: index + 1, text: tenant.unitRef, reason: `${tenant.unitRef} matches several properties. Write it as Property/Unit.` });
    const key = `${matches[0].propertyIndex}:${matches[0].unitName.toLowerCase()}`;
    if (taken.has(key)) return errors.push({ line: index + 1, text: tenant.unitRef, reason: `${tenant.unitRef} already has a tenant in this onboarding.` });
    taken.add(key);
    resolved.push({ legalName: tenant.legalName, phone: tenant.phone, rentAmountMinor: tenant.rentAmountMinor, rentFrequency: tenant.rentFrequency, startDate: tenant.startDate, endDate: tenant.endDate, ...matches[0] });
  });
  return { resolved, errors };
}

async function startAccountCode(draft: Draft, input: OnboardingInput, dependencies: Dependencies): Promise<string> {
  try {
    const sent = await dependencies.requestOtp({ mode: "register", channel: "sms", identifier: whatsappAddress(input.phone) });
    draft.data.challengeId = sent.challengeId;
    draft.data.codeFailures = 0;
    draft.step = "account_code";
    return `Thanks, ${draft.data.displayName}. To confirm this number I sent a 6-digit code by text message to ${sent.destination}. Reply with the code here. NesAfric staff will never ask you for it.`;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    draft.data.challengeId = undefined;
    draft.step = "account_code";
    return error.status === 429 ? `${error.message} Reply resend when ready.` : "Text-message codes are unavailable right now. Your progress is saved; reply resend in a few minutes.";
  }
}

async function enterOrganisationStep(draft: Draft, userId: string, dependencies: Dependencies) {
  draft.data.organisationChoices = (await dependencies.organisations(userId)).map(({ id, name }) => ({ id, name }));
  draft.step = "organisation";
}

/**
 * Landlord and property-manager onboarding on the official number. Every answer is parsed by
 * deterministic code and saved to the draft immediately; nothing becomes a domain record until
 * the person confirms the summary. The account behind the draft is proven with an SMS code to
 * the WhatsApp number before any record is created.
 */
export async function advanceOnboarding(input: OnboardingInput, dependencies: Dependencies = defaults): Promise<OnboardingResult> {
  const address = whatsappAddress(input.phone);
  const linked = await dependencies.linkedUser(input.phone);
  let draft = await dependencies.drafts.find(address);
  if (!draft) {
    draft = await dependencies.drafts.start(address, linked?.user.id ?? null, { countryCode: input.defaultCountry, currencyCode: input.defaultCurrency });
    return { reply: promptFor(draft, input.phone) };
  }
  // A retried job re-reads the same message: answer with the current step, change nothing.
  if (draft.lastMessageId === input.messageId) return { reply: promptFor(draft, input.phone), redactInbound: draft.step === "account_code" };

  const body = input.body.trim();
  const command = body.toLowerCase();
  const save = async (reply: string, extra: Omit<OnboardingResult, "reply"> = {}) => {
    await dependencies.drafts.save(draft!, input.messageId);
    return { reply, ...extra };
  };
  const redactInbound = draft.step === "account_code";

  if (command === "pause" || command === "menu") return save("Your onboarding is saved. Reply register at any time to continue where you left off.", { exit: true, redactInbound });
  if (command === "discard") {
    await dependencies.drafts.abandon(draft.id);
    return { reply: "Your onboarding draft is deleted. Nothing was saved to NesAfric. Reply register to start again.", exit: true, redactInbound };
  }
  if (input.kind !== "text") return save(`Please reply with text for this step. Photos and documents can be added later in your account.\n\n${promptFor(draft, input.phone)}`);
  if (command === "help" || command === "register" || command === "resume") return save(promptFor(draft, input.phone), { redactInbound });

  const data = draft.data;
  // A draft started by one account is never finished as another: the number's current verified
  // link must be the same account, otherwise the draft restarts its account step.
  if (draft.userId && linked && linked.user.id !== draft.userId) {
    await dependencies.drafts.abandon(draft.id);
    return { reply: "This onboarding was started by a different account and has been discarded. Reply register to start again.", exit: true };
  }
  const userId = draft.userId ?? linked?.user.id ?? null;
  switch (draft.step) {
    case "role": {
      const role = /^(1|landlord|owner)$/.test(command) ? "LANDLORD" : /^(2|manager|property manager|agent)$/.test(command) ? "MANAGER" : null;
      if (!role) return save(promptFor(draft, input.phone));
      data.role = role;
      if (userId) {
        draft.userId = userId;
        data.displayName = linked?.user.displayName ?? data.displayName;
        await enterOrganisationStep(draft, userId, dependencies);
      } else {
        draft.step = "name";
      }
      return save(promptFor(draft, input.phone));
    }
    case "name": {
      if (body.length < 2 || body.length > 100 || !/\p{L}/u.test(body)) return save("Please send your full name (2 to 100 characters).");
      data.displayName = body;
      return save(await startAccountCode(draft, input, dependencies));
    }
    case "account_code": {
      if (command === "resend" || !data.challengeId) return save(await startAccountCode(draft, input, dependencies), { redactInbound: true });
      if (!/^\d{6}$/.test(body)) return save("Send the 6-digit code, or reply resend for a new one.", { redactInbound: true });
      try {
        // Creates the account when none uses this number; signs into it when one does.
        const { user } = await dependencies.verifyOtp({ challengeId: data.challengeId, channel: "sms", identifier: address, code: body, displayName: data.displayName });
        await dependencies.link(input.phone, user.id, "SMS_OTP", input.organisationId);
        draft.userId = user.id;
        data.displayName = user.displayName;
        data.challengeId = undefined;
        await enterOrganisationStep(draft, user.id, dependencies);
        return save(`Number confirmed. Signed in as ${user.displayName}.\n\n${promptFor(draft, input.phone)}`, { redactInbound: true });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if (error.code === "OTP_INVALID") {
          data.codeFailures += 1;
          if (data.codeFailures >= MAX_CODE_FAILURES) { data.challengeId = undefined; return save("Too many incorrect codes. Reply resend for a new code.", { redactInbound: true }); }
          return save("That code is incorrect. Check it and send it again, or reply resend.", { redactInbound: true });
        }
        if (error.code === "OTP_EXPIRED") { data.challengeId = undefined; return save("That code has expired. Reply resend for a new one.", { redactInbound: true }); }
        return save(error.status < 500 ? error.message : "I could not check the code right now. Please send it again in a moment.", { redactInbound: true });
      }
    }
    case "organisation": {
      const choice = /^\d$/.test(body) ? Number(body) : null;
      if (choice && choice >= 1 && choice <= data.organisationChoices.length) {
        data.existingOrganisationId = data.organisationChoices[choice - 1].id;
        data.organisationName = undefined;
      } else if (choice === data.organisationChoices.length + 1) {
        return save("What should the new business be called?");
      } else {
        const name = command === "me" ? data.displayName ?? "" : body;
        if (name.length < 2 || name.length > 160) return save("Please send a name between 2 and 160 characters.");
        data.organisationName = name;
        data.existingOrganisationId = undefined;
      }
      data.cursor = { property: data.properties.length, building: 0 };
      draft.step = "property_name";
      return save(promptFor(draft, input.phone));
    }
    case "property_name": {
      if (body.length < 2 || body.length > 200) return save("Please send a property name between 2 and 200 characters.");
      if (data.properties.some((property) => property.name.toLowerCase() === command)) return save("You already added a property with that name. Please send a different name.");
      if (data.properties.length >= 20) { draft.step = "tenants_offer"; return save(`You can add up to 20 properties here; add more later in your account.\n\n${promptFor(draft, input.phone)}`); }
      data.properties.push({ name: body, buildings: [] });
      data.cursor = { property: data.properties.length - 1, building: 0 };
      draft.step = "property_city";
      return save(promptFor(draft, input.phone));
    }
    case "property_city": {
      if (body.length < 2 || body.length > 100) return save("Please send the town or area (2 to 100 characters).");
      currentProperty(draft)!.city = body;
      draft.step = "property_address";
      return save(promptFor(draft, input.phone));
    }
    case "property_address": {
      if (body.length > 250) return save("Please keep the address under 250 characters, or reply skip.");
      if (command !== "skip") currentProperty(draft)!.addressLine1 = body;
      draft.step = "buildings";
      return save(promptFor(draft, input.phone));
    }
    case "buildings": {
      const property = currentProperty(draft)!;
      if (/^(1|one)$/.test(command)) {
        property.buildings = [{ name: null, units: [] }];
      } else {
        const names = body.split(",").map((name) => name.trim()).filter(Boolean);
        if (names.length < 2 || names.length > 20 || names.some((name) => name.length > 120) || new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
          return save("Reply 1 for one building, or send 2 to 20 different block names separated by commas.");
        }
        property.buildings = names.map((name) => ({ name, units: [] }));
      }
      data.cursor.building = 0;
      draft.step = "units";
      return save(promptFor(draft, input.phone));
    }
    case "units": {
      const property = currentProperty(draft)!;
      const parsed = parseUnits(body, unitPrefix(draft));
      if (parsed.errors.length || !parsed.units.length) return save(`Nothing was saved for this building:\n${formatErrors(parsed.errors) || "No units found."}\n\n${promptFor(draft, input.phone)}`);
      const otherNames = new Set(property.buildings.filter((_, index) => index !== data.cursor.building).flatMap((building) => building.units.map((unit) => unit.name.toLowerCase())));
      const clash = parsed.units.find((unit) => otherNames.has(unit.name.toLowerCase()));
      if (clash) return save(`${clash.name} is already used in another building of ${property.name}. Unit names must be different within a property.`);
      if (unitCount(draft) - (currentBuilding(draft)?.units.length ?? 0) + parsed.units.length > 2000) return save("That is more units than can be added here. Add large portfolios in your account.");
      currentBuilding(draft)!.units = parsed.units;
      if (parsed.autoNamed) draft.step = "unit_type"; else afterBuilding(draft);
      return save(promptFor(draft, input.phone));
    }
    case "unit_type": {
      const unitType = command === "skip" ? undefined : parseUnitType(command);
      if (unitType === null) return save(promptFor(draft, input.phone));
      if (unitType) currentBuilding(draft)!.units = currentBuilding(draft)!.units.map((unit) => ({ ...unit, unitType }));
      afterBuilding(draft);
      return save(promptFor(draft, input.phone));
    }
    case "more_properties": {
      if (YES.test(command)) { data.cursor = { property: data.properties.length, building: 0 }; draft.step = "property_name"; }
      else if (NO.test(command)) draft.step = "tenants_offer";
      return save(promptFor(draft, input.phone));
    }
    case "tenants_offer": {
      if (YES.test(command)) draft.step = "tenants";
      else if (NO.test(command)) draft.step = "reminders";
      return save(promptFor(draft, input.phone));
    }
    case "tenants": {
      if (command === "done") { draft.step = "reminders"; return save(promptFor(draft, input.phone)); }
      const parsed = parseTenants(body);
      const resolved = resolveTenantUnits(draft, parsed.tenants);
      const errors = [...parsed.errors, ...resolved.errors].sort((a, b) => a.line - b.line);
      if (errors.length || !resolved.resolved.length) return save(`Nothing was saved from that message:\n${formatErrors(errors) || "No tenants found."}\nPlease correct the lines and send them again, or reply done.`);
      if (data.tenants.length + resolved.resolved.length > 500) return save("You can add up to 500 tenants here; add more later in your account.");
      data.tenants.push(...resolved.resolved);
      return save(`Added ${plural(resolved.resolved.length, "tenant")} (${data.tenants.length} in total). Send more lines, or reply done.`);
    }
    case "reminders": {
      if (YES.test(command)) data.leaseExpiryReminders = true;
      else if (NO.test(command)) data.leaseExpiryReminders = false;
      else return save(promptFor(draft, input.phone));
      draft.step = "providers_offer";
      return save(promptFor(draft, input.phone));
    }
    case "providers_offer": {
      if (YES.test(command)) draft.step = "providers";
      else if (NO.test(command)) draft.step = "approval_limit";
      return save(promptFor(draft, input.phone));
    }
    case "providers": {
      if (command === "done") { draft.step = "approval_limit"; return save(promptFor(draft, input.phone)); }
      const parsed = parseProviders(body);
      if (parsed.errors.length || !parsed.providers.length) return save(`Nothing was saved from that message:\n${formatErrors(parsed.errors) || "No professionals found."}\nPlease correct the lines and send them again, or reply done.`);
      if (data.providers.length + parsed.providers.length > 50) return save("You can add up to 50 professionals here.");
      data.providers.push(...parsed.providers);
      return save(`Added ${plural(parsed.providers.length, "professional")} (${data.providers.length} in total). Send more lines, or reply done.`);
    }
    case "approval_limit": {
      const amount = parseAmountMinor(body);
      if (!amount) return save(promptFor(draft, input.phone));
      data.approvalLimitMinor = amount;
      draft.step = "emergency_contact";
      return save(promptFor(draft, input.phone));
    }
    case "emergency_contact": {
      if (command === "me") data.emergencyContact = "me";
      else {
        const phone = normalizePhone(body);
        if (!phone) return save("That is not a valid mobile number. Reply me, or send a number such as 024 123 4567.");
        data.emergencyContact = phone;
      }
      draft.step = "review";
      return save(promptFor(draft, input.phone));
    }
    case "review": {
      if (command === "add property") { data.cursor = { property: data.properties.length, building: 0 }; draft.step = "property_name"; return save(promptFor(draft, input.phone)); }
      if (command === "add tenants") { draft.step = "tenants"; return save(promptFor(draft, input.phone)); }
      if (command !== "confirm") return save(promptFor(draft, input.phone));
      if (!userId || (draft.userId && linked?.user.id !== draft.userId)) { draft.step = data.displayName ? "account_code" : "name"; return save(`Your account is not confirmed on this number.\n\n${promptFor(draft, input.phone)}`); }
      if (!data.properties.length || data.properties.some((property) => !property.buildings.length || property.buildings.some((building) => !building.units.length))) {
        return save("Every property needs at least one unit before saving. Reply add property, or discard.");
      }
      await dependencies.drafts.save(draft, input.messageId);
      try {
        const summary = await dependencies.commit(draft, userId);
        return { reply: successReply(summary, draft), exit: true };
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return { reply: `Not saved yet: ${error.message}\nYour draft is kept. Fix this, then reply confirm again, or discard.` };
        throw error;
      }
    }
  }
  return save(promptFor(draft, input.phone));
}

