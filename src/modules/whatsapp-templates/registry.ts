/**
 * NesAfric WhatsApp Utility templates (Phase 1), U01-U30. This file is the version-controlled
 * source of truth for what is submitted to Meta and what is sent; Meta's status for each template
 * lives in `WhatsAppTemplateState` and is joined in by the status report.
 *
 * Content: every name and body is the approved NesAfric Utility Template Catalogue text, copied
 * exactly (docs/whatsapp-utility-catalogue.md). `content` says whether it may be submitted:
 * FINAL passed every local check; NEEDS_REVIEW is the catalogue text but failed a check (the
 * reason is in `reviewFlag`) and `submit` refuses it until someone approves a change. Never edit a
 * body here without the catalogue changing first.
 *
 * Changing an approved template: never edit its body in place. Bump `version` (the Meta name gains
 * a `_v<n>` suffix) and submit the new one; the old version keeps sending until the new one is
 * approved, because sending checks the content hash of the version in the registry.
 */

export type TemplateGroup =
  | "CUSTOMER_ENQUIRIES"
  | "AGENT_ONBOARDING"
  | "LANDLORD_ONBOARDING"
  | "TENANT_MANAGEMENT"
  | "PROPERTY_OPERATIONS"
  | "ACCOUNT_ACTIVITY";

export type RecipientRole = "PROPERTY_SEEKER" | "AGENT_OR_BROKER" | "LANDLORD_OR_MANAGER" | "TENANT" | "WORKSPACE_MEMBER";

/**
 * What lets NesAfric message this person on WhatsApp outside a conversation they started:
 * - ENQUIRY_OPT_IN: they ticked "send updates on WhatsApp" on the enquiry, or made it on WhatsApp.
 * - LINKED_ACCOUNT: they linked this number to their NesAfric account with a one-time code.
 * - TENANT_CONSENT_RECORDED: the landlord recorded on the tenancy that the tenant agreed to
 *   WhatsApp contact (`TenantOrganisation.communicationWhatsappAllowed`). Invitation only.
 * STOP always wins over every basis.
 */
export type OptInBasis = "ENQUIRY_OPT_IN" | "LINKED_ACCOUNT" | "TENANT_CONSENT_RECORDED";

export type TemplateParam = {
  /** Stable name used by callers; the position in `params` is the placeholder number. */
  name: string;
  /** Realistic example submitted to Meta with the template. */
  sample: string;
  /** "customer": typed by a user (names, titles): links and phone numbers are removed. */
  source: "customer" | "system";
  max: number;
};

export type UtilityTemplate = {
  key: string;
  /** Meta name for version 1; later versions add `_v<version>`. */
  name: string;
  version: number;
  language: "en";
  category: "UTILITY";
  group: TemplateGroup;
  title: string;
  body: string;
  params: TemplateParam[];
  /** Quick replies arrive as text and must match an existing WhatsApp command. */
  buttons?: Array<{ type: "QUICK_REPLY"; text: string }>;
  trigger: { event: string; condition: string };
  recipient: RecipientRole;
  optIn: OptInBasis[];
  wiring: { status: "WIRED" } | { status: "NOT_WIRED"; reason: string };
  /** FINAL: catalogue text that passed every check. NEEDS_REVIEW: catalogue text that failed one. */
  content: "DRAFT" | "NEEDS_REVIEW" | "FINAL";
  /** Why a reviewer should look at this one before it is submitted. */
  reviewFlag?: string;
};

const p = (name: string, sample: string, max: number, source: TemplateParam["source"] = "system"): TemplateParam => ({ name, sample, max, source });
const NAME = (sample: string) => p("recipient_name", sample, 60, "customer");
const PROPERTY = (sample: string) => p("property_name", sample, 80, "customer");
const REFERENCE = (sample: string) => p("reference", sample, 20);
const DATE = (sample: string) => p("date", sample, 30);
const TIME = (sample: string) => p("time", sample, 20);
const STATUS = (sample: string) => p("status", sample, 60);

type Entry = Omit<UtilityTemplate, "version" | "language" | "category" | "content"> & { version?: number; content?: UtilityTemplate["content"] };
const catalogue = (template: Entry): UtilityTemplate => ({ version: 1, language: "en", category: "UTILITY", content: "FINAL", ...template });

export const UTILITY_TEMPLATES: readonly UtilityTemplate[] = [
  // Category A: customer property enquiries
  catalogue({
    key: "U01", name: "nes_property_enquiry_received", group: "CUSTOMER_ENQUIRIES", title: "Property Enquiry Received",
    body: "Hello {{1}}, your enquiry about property {{2}} has been received by NesAfric. Reference: {{3}}. We will update you when the agent responds.",
    params: [NAME("Ama"), PROPERTY("2-bedroom apartment in East Legon"), REFERENCE("EQ-7K4P2Q")],
    trigger: { event: "marketplace.lead_created", condition: "Enquiry made on the website with WhatsApp updates ticked. Enquiries made on WhatsApp are answered in the chat." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U02", name: "nes_property_viewing_confirmed", group: "CUSTOMER_ENQUIRIES", title: "Property Viewing Confirmed",
    body: "Hello {{1}}, your property viewing for {{2}} is confirmed for {{3}} at {{4}}. Your agent is {{5}}. Reply here if you need assistance.",
    params: [NAME("Kwame"), PROPERTY("3-bedroom house in Spintex"), DATE("Sat, 26 Oct 2026"), TIME("10:00 GMT"), p("agent_name", "Abena Agyei", 60, "customer")],
    trigger: { event: "viewing.confirmed", condition: "The agent or landlord confirms a time." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U03", name: "nes_property_viewing_reminder", group: "CUSTOMER_ENQUIRIES", title: "Property Viewing Reminder",
    body: "Reminder from NesAfric: your viewing for {{1}} is scheduled for {{2}} at {{3}}. Your booking reference is {{4}}. Reply here if you need to change it.",
    params: [PROPERTY("3-bedroom house in Spintex"), DATE("Sat, 26 Oct 2026"), TIME("10:00 GMT"), REFERENCE("VW-3M8D1R")],
    trigger: { event: "viewing.reminder_due", condition: "A confirmed viewing is approaching." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"],
    wiring: { status: "NOT_WIRED", reason: "No business event marks an approaching viewing; this needs a scheduled reminder job over confirmed viewings, not a new event." },
  }),
  catalogue({
    key: "U04", name: "nes_property_viewing_rescheduled", group: "CUSTOMER_ENQUIRIES", title: "Property Viewing Rescheduled",
    body: "Hello {{1}}, your viewing for {{2}} has been rescheduled to {{3}} at {{4}}. Please reply if you need help.",
    params: [NAME("Kwame"), PROPERTY("3-bedroom house in Spintex"), DATE("Wed, 28 Oct 2026"), TIME("16:30 GMT")],
    trigger: { event: "viewing.rescheduled", condition: "The agent or landlord moves a viewing to a new confirmed time." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U05", name: "nes_property_enquiry_response", group: "CUSTOMER_ENQUIRIES", title: "Property Enquiry Response",
    body: "Hello {{1}}, there is an update to your enquiry about {{2}}. Status: {{3}}. Reference: {{4}}. Reply to this message to continue your enquiry.",
    params: [NAME("Ama"), PROPERTY("2-bedroom apartment in East Legon"), STATUS("the agent has responded"), REFERENCE("EQ-7K4P2Q")],
    trigger: { event: "listing.lead_status_changed", condition: "The enquiry moves to CONTACTED, CLOSED or LOST. Viewing and application stages have their own messages." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U06", name: "nes_property_viewing_cancelled", group: "CUSTOMER_ENQUIRIES", title: "Property Viewing Cancelled",
    body: "Hello {{1}}, your viewing for {{2}} scheduled for {{3}} has been cancelled. Reference: {{4}}. Reply here if you need assistance.",
    params: [NAME("Kwame"), PROPERTY("3-bedroom house in Spintex"), p("scheduled_for", "Sat, 26 Oct 2026, 10:00 GMT", 40), REFERENCE("VW-3M8D1R")],
    trigger: { event: "listing.viewing_status_changed", condition: "Status changes to CANCELLED." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),

  // Category B: agent and broker onboarding
  catalogue({
    key: "U07", name: "nes_agent_registration_received", group: "AGENT_ONBOARDING", title: "Agent Registration Received",
    body: "Hello {{1}}, NesAfric has received your {{2}} registration for {{3}}. Your registration reference is {{4}}. We will notify you when the review is complete.",
    params: [NAME("Kofi"), p("registration_type", "agent", 20), p("business_name", "Golden Key Realty", 80, "customer"), REFERENCE("RG-4D7A1C")],
    trigger: { event: "marketplace_professional.created", condition: "An agent or broker creates a business profile. Not sent while they are chatting with NesAfric (WhatsApp registration confirms in the chat)." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U08", name: "nes_agent_verification_approved", group: "AGENT_ONBOARDING", title: "Agent Verification Approved",
    body: "Hello {{1}}, your NesAfric agent or broker verification for {{2}} has been approved. You can now continue managing your business through WhatsApp.",
    params: [NAME("Kofi"), p("business_name", "Golden Key Realty", 80, "customer")],
    trigger: { event: "marketplace_professional.verification_reviewed", condition: "A NesAfric reviewer sets the profile to VERIFIED." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U09", name: "nes_agent_verification_action_required", group: "AGENT_ONBOARDING", title: "Agent Verification Action Required",
    body: "Hello {{1}}, your verification for {{2}} requires additional information: {{3}}. Reply to this message to continue the verification process.",
    params: [NAME("Kofi"), p("business_name", "Golden Key Realty", 80, "customer"), p("required_information", "a readable business registration certificate", 160, "customer")],
    trigger: { event: "marketplace_professional.verification_reviewed", condition: "A NesAfric reviewer sets the profile to REJECTED with what is needed; the agent can register again on WhatsApp." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U10", name: "nes_property_listing_received", group: "AGENT_ONBOARDING", title: "Property Listing Received",
    body: "Hello {{1}}, thank you for listing with NesAfric. We have received your property listing {{2}} and our team will review it. Listing reference: {{3}}. Current status: {{4}}. We will message you when the review is complete.",
    params: [NAME("Abena"), p("property_title", "4-bedroom townhouse in Cantonments", 80, "customer"), REFERENCE("LS-9F2C7A"), STATUS("pending review")],
    trigger: { event: "listing.pending_review", condition: "A listing moves to PENDING_REVIEW. Not sent while the lister is chatting with NesAfric." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U11", name: "nes_property_listing_status", group: "AGENT_ONBOARDING", title: "Property Listing Status",
    body: "Hello {{1}}, the status of your property listing {{2}} has changed to {{3}}. Reference: {{4}}. Reply for assistance.",
    params: [NAME("Abena"), p("property_title", "4-bedroom townhouse in Cantonments", 80, "customer"), STATUS("published"), REFERENCE("LS-9F2C7A")],
    trigger: { event: "listing.published | listing.rejected", condition: "A listing leaves PENDING_REVIEW, decided by someone other than its creator." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),

  // Category C: landlord and property manager onboarding
  catalogue({
    key: "U12", name: "nes_manager_registration_received", group: "LANDLORD_ONBOARDING", title: "Property Manager Registration Received",
    body: "Hello {{1}}, we have received the registration for your property management business {{2}}. Reference: {{3}}. Status: {{4}}. We will let you know when the review is complete.",
    params: [NAME("Akosua"), p("business_name", "Mensah Properties", 80, "customer"), REFERENCE("PM-2B9E4F"), STATUS("active")],
    trigger: { event: "organisation.created", condition: "A property-management business is registered." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Registration has no review step: the workspace is active at once and U13 reports that from the same event. Sending both would message the manager twice." },
  }),
  catalogue({
    key: "U13", name: "nes_workspace_activated", group: "LANDLORD_ONBOARDING", title: "Workspace Activated",
    body: "Hello {{1}}, your NesAfric workspace for {{2}} is now active. You can manage your properties and tenants through WhatsApp.",
    params: [NAME("Akosua"), p("workspace_name", "Mensah Properties", 80, "customer")],
    trigger: { event: "organisation.created", condition: "A landlord or property-management workspace is created. Not sent while the owner is already chatting with NesAfric (WhatsApp onboarding confirms in the chat)." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U14", name: "nes_business_profile_updated", group: "LANDLORD_ONBOARDING", title: "Business Profile Updated",
    body: "Hello {{1}}, the business profile for {{2}} has been updated successfully. Updated information: {{3}}. Reply here if you did not make this change.",
    params: [NAME("Akosua"), p("business_name", "Mensah Properties", 80, "customer"), p("updated_information", "contact phone number and logo", 120)],
    trigger: { event: "marketplace_professional.updated", condition: "An authorised owner or manager updates the business profile." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Profile updates write an audit record but no domain event yet, and the person making the change sees it confirmed on screen." },
  }),
  catalogue({
    key: "U15", name: "nes_property_added", group: "LANDLORD_ONBOARDING", title: "Property Added",
    body: "Hello {{1}}, the property {{2}} has been added to your NesAfric workspace {{3}} and is ready to manage. Property reference: {{4}}. You can add units and tenants at any time.",
    params: [NAME("Akosua"), PROPERTY("Adenta Court"), p("workspace_name", "Mensah Properties", 80, "customer"), p("property_reference", "ADC-01", 40, "customer")],
    trigger: { event: "property.created", condition: "A property is added to the workspace. Not sent while the person who added it is chatting with NesAfric." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U16", name: "nes_property_registration_action_required", group: "LANDLORD_ONBOARDING", title: "Property Registration Action Required",
    body: "Hello {{1}}, additional information is needed to complete registration of property {{2}}. Required information: {{3}}. Reply here to continue.",
    params: [NAME("Akosua"), PROPERTY("Adenta Court"), p("required_information", "a document in the account holder's name", 160, "customer")],
    trigger: { event: "portfolio_verification.rejected", condition: "A NesAfric reviewer cannot verify the property claim and records what is needed." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),

  // Category D: tenant management
  catalogue({
    key: "U17", name: "nes_tenant_invitation", group: "TENANT_MANAGEMENT", title: "Tenant Invitation",
    body: "Hello {{1}}, {{2}} has invited you to join property {{3}} on NesAfric as a tenant. Reply to this message to review and verify your invitation. Reference: {{4}}. If you were not expecting this invitation, you can ignore this message.",
    params: [NAME("Kojo"), p("landlord_name", "Mensah Properties", 80, "customer"), PROPERTY("Adenta Court, Unit 4B"), p("invitation_reference", "TI-8C2F5D", 20)],
    trigger: { event: "tenant.access_invitation_created", condition: "Landlord creates a tenant access invitation for a tenancy that records WhatsApp consent and is not yet connected to an account." },
    recipient: "TENANT", optIn: ["TENANT_CONSENT_RECORDED"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U18", name: "nes_tenant_invitation_accepted", group: "TENANT_MANAGEMENT", title: "Tenant Invitation Accepted",
    body: "Hello {{1}}, good news: your tenant {{2}} has accepted the invitation for property {{3}} on NesAfric. Reference: {{4}}. They can now send repair requests and messages through NesAfric.",
    params: [NAME("Akosua"), p("tenant_name", "Kojo Boateng", 80, "customer"), PROPERTY("Adenta Court, Unit 4B"), p("invitation_reference", "TI-8C2F5D", 20)],
    trigger: { event: "tenant.access_invitation_redeemed", condition: "The tenant redeems the access code after OTP verification. Sent to the landlord or manager who created the invitation." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U19", name: "nes_tenant_link_confirmed", group: "TENANT_MANAGEMENT", title: "Tenant Link Confirmed",
    body: "Hello {{1}}, your tenant profile has been linked to property {{2}}, managed by {{3}}. Reply here for assistance.",
    params: [NAME("Kojo"), PROPERTY("Adenta Court, Unit 4B"), p("manager_name", "Mensah Properties", 80, "customer")],
    trigger: { event: "tenant.access_invitation_redeemed", condition: "The tenant redeems the access code after OTP verification. Not sent while the tenant is chatting with NesAfric (the chat confirms it)." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U20", name: "nes_tenancy_details_updated", group: "TENANT_MANAGEMENT", title: "Tenancy Details Updated",
    body: "Hello {{1}}, your tenancy details for {{2}} have been updated by {{3}}. Update reference: {{4}}. Reply if you have questions.",
    params: [NAME("Kojo"), PROPERTY("Adenta Court, Unit 4B"), p("manager_name", "Mensah Properties", 80, "customer"), REFERENCE("TU-5E1A9B")],
    trigger: { event: "lease.amended", condition: "The landlord records an amendment to a lease that is not a draft (signed lease terms change only by amendment). Sent to each tenant on the lease whose account is connected to the tenancy." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U21", name: "nes_tenant_invitation_reminder", group: "TENANT_MANAGEMENT", title: "Tenant Invitation Reminder",
    body: "Hello {{1}}, your invitation from {{2}} to join property {{3}} on NesAfric is still pending. Reply here to continue. Reference: {{4}}. If you were not expecting this invitation, you can ignore this message.",
    params: [NAME("Kojo"), p("landlord_name", "Mensah Properties", 80, "customer"), PROPERTY("Adenta Court, Unit 4B"), p("invitation_reference", "TI-8C2F5D", 20)],
    trigger: { event: "tenant.access_invitation_reminder_due", condition: "An invitation sent with U17 is still pending." },
    recipient: "TENANT", optIn: ["TENANT_CONSENT_RECORDED"],
    wiring: { status: "NOT_WIRED", reason: "No event marks a pending invitation; this needs a scheduled reminder with a per-invitation limit, and only after U17 was delivered." },
  }),
  catalogue({
    key: "U22", name: "nes_tenant_link_removed", group: "TENANT_MANAGEMENT", title: "Tenant Link Removed",
    body: "Hello {{1}}, your tenant association with property {{2}} has ended effective {{3}}. Contact {{4}} if you believe this is incorrect.",
    params: [NAME("Kojo"), PROPERTY("Adenta Court, Unit 4B"), DATE("31 Oct 2026"), p("contact", "Mensah Properties", 80, "customer")],
    trigger: { event: "lease.terminated | lease.expired", condition: "The lease ends. Effective date: the end date for an expiry, the termination date otherwise. Sent to each tenant on the lease whose account is connected to the tenancy." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),

  // Category E: property operations
  catalogue({
    key: "U23", name: "nes_maintenance_request_received", group: "PROPERTY_OPERATIONS", title: "Maintenance Request Received",
    body: "Hello {{1}}, your maintenance request for property {{2}} has been received by NesAfric. Ticket number: {{3}}. Current status: {{4}}. We will keep you updated on this request.",
    params: [NAME("Kojo"), PROPERTY("Adenta Court, Unit 4B"), p("ticket", "NM-1042", 20), STATUS("received")],
    trigger: { event: "maintenance.requested", condition: "A repair request for a tenancy is created on the web or mobile app. Reports made on WhatsApp are answered in the chat." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U24", name: "nes_maintenance_request_assigned", group: "PROPERTY_OPERATIONS", title: "Maintenance Request Assigned",
    body: "Hello {{1}}, your maintenance request {{2}} has been assigned to {{3}}, who will handle the work. Current status: {{4}}. We will keep you updated on progress.",
    params: [NAME("Kojo"), p("ticket", "NM-1042", 20), p("provider_name", "Kwesi Plumbing Services", 80, "customer"), STATUS("waiting for the provider to accept")],
    trigger: { event: "workorder.assigned", condition: "The landlord assigns a provider to the request's work order. Requests handled by the automatic provider network are skipped: providers' updates already reach the tenant." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U25", name: "nes_maintenance_status_updated", group: "PROPERTY_OPERATIONS", title: "Maintenance Status Updated",
    body: "Hello {{1}}, there is an update on maintenance ticket {{2}} for property {{3}}. The new status is {{4}}. Reply here if you have any questions.",
    params: [NAME("Kojo"), p("ticket", "NM-1042", 20), PROPERTY("Adenta Court, Unit 4B"), STATUS("work has started")],
    trigger: { event: "maintenance.started | maintenance.rejected | maintenance.cancelled", condition: "Sent to the tenant. Requests handled by the automatic provider network are skipped: providers' updates already reach the tenant. Landlords keep their existing escalations and digest." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U26", name: "nes_maintenance_request_completed", group: "PROPERTY_OPERATIONS", title: "Maintenance Request Completed",
    body: "Hello {{1}}, maintenance request {{2}} for property {{3}} has been marked completed. Reply here if the issue is unresolved.",
    params: [NAME("Kojo"), p("ticket", "NM-1042", 20), PROPERTY("Adenta Court, Unit 4B")],
    trigger: { event: "maintenance.completed", condition: "Requests handled by the automatic provider network are skipped: the provider's completion message already reaches the tenant." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U27", name: "nes_property_management_assignment", group: "PROPERTY_OPERATIONS", title: "Property Management Assignment",
    body: "Hello {{1}}, you have been assigned to manage property {{2}} under workspace {{3}}. Assignment reference: {{4}}. You can view the property in your NesAfric account.",
    params: [NAME("Efua"), PROPERTY("Adenta Court"), p("workspace_name", "Mensah Properties", 80, "customer"), REFERENCE("PA-6F3C2E")],
    trigger: { event: "property.manager_assigned", condition: "An authorised administrator assigns a manager to a property." },
    recipient: "WORKSPACE_MEMBER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Property-level manager assignments do not exist as records or events; access is granted per workspace role." },
  }),

  // Category F: account and document activity
  catalogue({
    key: "U28", name: "nes_document_received", group: "ACCOUNT_ACTIVITY", title: "Document Received",
    body: "Hello {{1}}, NesAfric has received your document for {{2}} and our team will review it. Reference: {{3}}. Current status: {{4}}. We will message you when the review is complete.",
    params: [NAME("Abena"), p("document_purpose", "verification of 4-bedroom townhouse in Cantonments", 100, "customer"), REFERENCE("DC-1A7B3E"), STATUS("under review")],
    trigger: { event: "listing.verification_submitted", condition: "Listing verification evidence is submitted. Not sent while the submitter is chatting with NesAfric." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U29", name: "nes_document_review_completed", group: "ACCOUNT_ACTIVITY", title: "Document Review Completed",
    body: "Hello {{1}}, NesAfric has completed the review of your document for {{2}}. Result: {{3}}. Reference: {{4}}. Reply here if you have any questions.",
    params: [NAME("Abena"), p("document_purpose", "verification of 4-bedroom townhouse in Cantonments", 100, "customer"), p("result", "verified", 160, "customer"), REFERENCE("DC-1A7B3E")],
    trigger: { event: "listing.verification_verified | listing.verification_rejected", condition: "A reviewer decides the listing's verification evidence." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  catalogue({
    key: "U30", name: "nes_account_status_updated", group: "ACCOUNT_ACTIVITY", title: "Account Status Updated",
    body: "Hello {{1}}, your NesAfric account or business profile {{2}} has a status update: {{3}}. Reference: {{4}}. Reply if you need assistance.",
    params: [NAME("Kofi"), p("profile_name", "Golden Key Realty", 80, "customer"), STATUS("suspended pending review"), REFERENCE("AS-0C4D8B")],
    trigger: { event: "marketplace_professional.verification_reviewed", condition: "A NesAfric reviewer sets the business profile to SUSPENDED." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
];

export const metaTemplateName = (template: Pick<UtilityTemplate, "name" | "version">) => template.version > 1 ? `${template.name}_v${template.version}` : template.name;

const byKey = new Map(UTILITY_TEMPLATES.map((template) => [template.key, template]));
export function utilityTemplate(key: string) {
  const template = byKey.get(key);
  if (!template) throw new Error(`Unknown WhatsApp utility template ${key}.`);
  return template;
}

export type UtilityTemplateKey = (typeof UTILITY_TEMPLATES)[number]["key"];
