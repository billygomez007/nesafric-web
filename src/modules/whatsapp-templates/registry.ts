/**
 * NesAfric WhatsApp Utility templates (Phase 1), U01-U30. This file is the version-controlled
 * source of truth for what is submitted to Meta and what is sent; Meta's status for each template
 * lives in `WhatsAppTemplateState` and is joined in by the status report.
 *
 * Content: every body here is a DRAFT written against the brief, because the NesAfric Utility
 * Template Catalogue text was not available when this was built. Drafts cannot be submitted
 * (`submit` refuses them): replace each body with the catalogue's exact text, keep the
 * placeholders in step with `params`, and change `content` to "FINAL" before submission.
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
  content: "DRAFT" | "FINAL";
  /** Why a reviewer should look at this one before it is submitted. */
  reviewFlag?: string;
};

const p = (name: string, sample: string, max: number, source: TemplateParam["source"] = "system"): TemplateParam => ({ name, sample, max, source });
const NAME = (sample: string) => p("recipient_name", sample, 60, "customer");
const LISTING = (sample: string) => p("listing_title", sample, 80, "customer");

type Draft = Omit<UtilityTemplate, "version" | "language" | "category" | "content"> & { version?: number };
const draft = (template: Draft): UtilityTemplate => ({ version: 1, language: "en", category: "UTILITY", content: "DRAFT", ...template });

export const UTILITY_TEMPLATES: readonly UtilityTemplate[] = [
  // Customer property enquiries
  draft({
    key: "U01", name: "nesafric_enquiry_received", group: "CUSTOMER_ENQUIRIES", title: "Enquiry received",
    body: "Hello {{1}}, we have received your enquiry about {{2}}. Your reference is {{3}}. The agent or landlord will reply to you on WhatsApp or by phone.",
    params: [NAME("Ama"), LISTING("2-bedroom apartment in East Legon"), p("enquiry_reference", "EQ-7K4P2Q", 20)],
    trigger: { event: "marketplace.lead_created", condition: "Enquiry made on the website with WhatsApp updates ticked. Enquiries made on WhatsApp are answered in the chat." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U02", name: "nesafric_viewing_confirmed", group: "CUSTOMER_ENQUIRIES", title: "Viewing confirmed",
    body: "Hello {{1}}, your viewing of {{2}} is confirmed for {{3}}. The property is in {{4}}. If you can no longer attend, please reply to this message.",
    params: [NAME("Kwame"), LISTING("3-bedroom house in Spintex"), p("viewing_time", "Sat, 26 Oct 2026, 10:00 GMT", 40), p("area", "Spintex, Accra", 80, "customer")],
    trigger: { event: "viewing.confirmed", condition: "The agent or landlord confirms a time." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U03", name: "nesafric_viewing_rescheduled", group: "CUSTOMER_ENQUIRIES", title: "Viewing rescheduled",
    body: "Hello {{1}}, your viewing of {{2}} has been moved to {{3}}. If the new time does not suit you, please reply to this message.",
    params: [NAME("Kwame"), LISTING("3-bedroom house in Spintex"), p("viewing_time", "Wed, 28 Oct 2026, 16:30 GMT", 40)],
    trigger: { event: "viewing.rescheduled", condition: "The agent or landlord moves a viewing." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U04", name: "nesafric_viewing_cancelled", group: "CUSTOMER_ENQUIRIES", title: "Viewing cancelled",
    body: "Hello {{1}}, your viewing of {{2}} has been cancelled. Reason: {{3}}. Reply to this message if you would like to arrange another time.",
    params: [NAME("Kwame"), LISTING("3-bedroom house in Spintex"), p("reason", "the property has been let", 120, "customer")],
    trigger: { event: "listing.viewing_status_changed", condition: "Status changes to CANCELLED." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U05", name: "nesafric_viewing_request_received", group: "CUSTOMER_ENQUIRIES", title: "Viewing request received",
    body: "Hello {{1}}, we have received your request to view {{2}}. Your reference is {{3}}. We will message you here once the time is confirmed.",
    params: [NAME("Esi"), LISTING("Studio apartment in Osu"), p("viewing_reference", "VW-3M8D1R", 20)],
    trigger: { event: "viewing.requested", condition: "Viewing requested on the website with WhatsApp updates ticked. Requests made on WhatsApp are answered in the chat." },
    recipient: "PROPERTY_SEEKER", optIn: ["ENQUIRY_OPT_IN"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U06", name: "nesafric_application_status_update", group: "CUSTOMER_ENQUIRIES", title: "Rental application update",
    body: "Hello {{1}}, the status of your rental application for {{2}} is now {{3}}. You can see the details and any next steps in your NesAfric account.",
    params: [NAME("Yaw"), LISTING("2-bedroom apartment in Tema Community 25"), p("application_status", "under review", 40)],
    trigger: { event: "rental_application.status_changed", condition: "The landlord moves the application to a new status." },
    recipient: "PROPERTY_SEEKER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Rental applications emit no domain event and applicants record no WhatsApp opt-in yet." },
  }),

  // Agent and broker onboarding
  draft({
    key: "U07", name: "nesafric_business_profile_created", group: "AGENT_ONBOARDING", title: "Business profile created",
    body: "Hello {{1}}, your business profile {{2}} has been created on NesAfric. To get verified, upload your verification documents in your NesAfric dashboard.",
    params: [NAME("Kofi"), p("business_name", "Golden Key Realty", 80, "customer")],
    trigger: { event: "marketplace_professional.created", condition: "An agent or broker creates a business profile." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U08", name: "nesafric_business_verification_approved", group: "AGENT_ONBOARDING", title: "Business verification approved",
    body: "Hello {{1}}, the verification of {{2}} on NesAfric has been approved. Your profile and listings now show as verified.",
    params: [NAME("Kofi"), p("business_name", "Golden Key Realty", 80, "customer")],
    trigger: { event: "marketplace_professional.verification_reviewed", condition: "A NesAfric reviewer sets the profile to VERIFIED." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U09", name: "nesafric_business_verification_action_required", group: "AGENT_ONBOARDING", title: "Business verification needs action",
    body: "Hello {{1}}, the verification of {{2}} could not be approved. Reason: {{3}}. Please update your documents in your NesAfric dashboard and submit them again.",
    params: [NAME("Kofi"), p("business_name", "Golden Key Realty", 80, "customer"), p("reason", "the business registration certificate is not readable", 160, "customer")],
    trigger: { event: "marketplace_professional.verification_reviewed", condition: "A NesAfric reviewer sets the profile to REJECTED." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U10", name: "nesafric_listing_submitted", group: "AGENT_ONBOARDING", title: "Listing submitted for review",
    body: "Hello {{1}}, your listing {{2}} has been submitted for review. Reference: {{3}}. We will message you here when the review is complete.",
    params: [NAME("Abena"), LISTING("4-bedroom townhouse in Cantonments"), p("listing_reference", "LS-9F2C7A", 20)],
    trigger: { event: "listing.pending_review", condition: "A listing moves to PENDING_REVIEW." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U11", name: "nesafric_listing_review_completed", group: "AGENT_ONBOARDING", title: "Listing review completed",
    body: "Hello {{1}}, the review of your listing {{2}} is complete. Outcome: {{3}}. You can see the details in your NesAfric dashboard.",
    params: [NAME("Abena"), LISTING("4-bedroom townhouse in Cantonments"), p("outcome", "approved and published", 160, "customer")],
    trigger: { event: "listing.published | listing.rejected", condition: "A listing leaves PENDING_REVIEW, decided by someone other than its creator." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),

  // Landlord and property manager onboarding
  draft({
    key: "U12", name: "nesafric_property_ownership_received", group: "LANDLORD_ONBOARDING", title: "Ownership details received",
    body: "Hello {{1}}, we have received the ownership details for {{2}}. Our team will review them and message you here with the outcome.",
    params: [NAME("Akosua"), p("property_name", "Adenta Court", 80, "customer")],
    trigger: { event: "portfolio_verification.created", condition: "A landlord registers a property claim." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Claims are only created by the landlord's own onboarding, which confirms in the WhatsApp chat or on screen; no event is emitted." },
  }),
  draft({
    key: "U13", name: "nesafric_workspace_activated", group: "LANDLORD_ONBOARDING", title: "Workspace activated",
    body: "Hello {{1}}, your NesAfric workspace {{2}} is now active. You can add properties, units and tenants in your dashboard, or reply menu here.",
    params: [NAME("Akosua"), p("workspace_name", "Mensah Properties", 80, "customer")],
    trigger: { event: "organisation.created", condition: "A landlord or property-management workspace is created. Not sent while the owner is already chatting with NesAfric (WhatsApp onboarding confirms in the chat)." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U14", name: "nesafric_property_ownership_verified", group: "LANDLORD_ONBOARDING", title: "Ownership verified",
    body: "Hello {{1}}, your ownership details for {{2}} have been verified. You can now manage this property fully on NesAfric.",
    params: [NAME("Akosua"), p("property_name", "Adenta Court", 80, "customer")],
    trigger: { event: "portfolio_verification.verified", condition: "A NesAfric reviewer verifies the claim." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U15", name: "nesafric_property_ownership_action_required", group: "LANDLORD_ONBOARDING", title: "Ownership needs action",
    body: "Hello {{1}}, we could not verify the ownership details for {{2}}. Reason: {{3}}. Please contact NesAfric support to provide more information.",
    params: [NAME("Akosua"), p("property_name", "Adenta Court", 80, "customer"), p("reason", "the name on the document does not match the account", 160, "customer")],
    trigger: { event: "portfolio_verification.rejected", condition: "A NesAfric reviewer rejects the claim." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U16", name: "nesafric_team_invitation", group: "LANDLORD_ONBOARDING", title: "Team invitation",
    body: "Hello {{1}}, {{2}} has invited you to join the {{3}} workspace on NesAfric. Open the invitation sent to your email address to accept it.",
    params: [NAME("Efua"), p("inviter_name", "Akosua Mensah", 60, "customer"), p("workspace_name", "Mensah Properties", 80, "customer")],
    trigger: { event: "member.invited", condition: "A workspace owner invites a team member." },
    recipient: "WORKSPACE_MEMBER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Invitations are addressed by email only; there is no phone number or opt-in for the invitee." },
  }),

  // Tenant management
  draft({
    key: "U17", name: "nesafric_tenant_invitation", group: "TENANT_MANAGEMENT", title: "Tenant invitation",
    body: "Hello {{1}}, {{2}} has invited you to connect your tenancy at {{3}} on NesAfric. Your access code was sent to you separately. To continue, tap Link account, confirm your identity and then send your access code here.",
    params: [NAME("Kojo"), p("landlord_name", "Mensah Properties", 80, "customer"), p("property_name", "Adenta Court, Unit 4B", 80, "customer")],
    buttons: [{ type: "QUICK_REPLY", text: "Link account" }],
    trigger: { event: "tenant.access_invitation_created", condition: "Landlord creates a tenant access invitation for a tenancy that records WhatsApp consent and is not yet connected to an account." },
    recipient: "TENANT", optIn: ["TENANT_CONSENT_RECORDED"], wiring: { status: "WIRED" },
    reviewFlag: "Recipient number is supplied by the landlord. Sent only when the landlord recorded the tenant's WhatsApp consent; the access code is never included.",
  }),
  draft({
    key: "U18", name: "nesafric_tenancy_connected", group: "TENANT_MANAGEMENT", title: "Tenancy connected",
    body: "Hello {{1}}, your NesAfric account is now connected to your tenancy with {{2}}. You can report repairs and view your tenancy details by replying menu here.",
    params: [NAME("Kojo"), p("landlord_name", "Mensah Properties", 80, "customer")],
    trigger: { event: "tenant.access_invitation_redeemed", condition: "The tenant redeems the access code. Not sent while the tenant is already chatting with NesAfric." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U19", name: "nesafric_lease_ready_to_sign", group: "TENANT_MANAGEMENT", title: "Lease ready to sign",
    body: "Hello {{1}}, your lease for {{2}} is ready for your signature. Please review and sign it in your NesAfric tenant account.",
    params: [NAME("Kojo"), p("property_name", "Adenta Court, Unit 4B", 80, "customer")],
    trigger: { event: "signature.request_created", condition: "A signature request is created for the tenant." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Signature requests already notify by email with a signing link; the WhatsApp recipient mapping for lease parties is not built yet." },
  }),
  draft({
    key: "U20", name: "nesafric_lease_fully_signed", group: "TENANT_MANAGEMENT", title: "Lease fully signed",
    body: "Hello {{1}}, all parties have signed the lease for {{2}}. A copy is available in your NesAfric tenant account.",
    params: [NAME("Kojo"), p("property_name", "Adenta Court, Unit 4B", 80, "customer")],
    trigger: { event: "lease.fully_signed", condition: "The last signature is recorded." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Lease-party to WhatsApp recipient mapping is not built yet." },
  }),
  draft({
    key: "U21", name: "nesafric_payment_recorded", group: "TENANT_MANAGEMENT", title: "Payment recorded",
    body: "Hello {{1}}, we have recorded your payment of {{2}} for {{3}}. Your receipt is available in your NesAfric tenant account.",
    params: [NAME("Kojo"), p("amount", "GHS 2,500.00", 30), p("property_name", "Adenta Court, Unit 4B", 80, "customer")],
    trigger: { event: "receipt.issued", condition: "A receipt is issued for a tenant payment." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Payment receipts already go out through the reminder/notification pipeline; wiring needs a dedupe decision with that pipeline." },
  }),
  draft({
    key: "U22", name: "nesafric_tenancy_details_updated", group: "TENANT_MANAGEMENT", title: "Tenancy details updated",
    body: "Hello {{1}}, the details of your tenancy at {{2}} have been updated by {{3}}. You can view the full details in your NesAfric tenant account.",
    params: [NAME("Kojo"), p("property_name", "Adenta Court, Unit 4B", 80, "customer"), p("landlord_name", "Mensah Properties", 80, "customer")],
    trigger: { event: "lease.amended", condition: "The landlord amends the lease." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Lease-party to WhatsApp recipient mapping is not built yet." },
  }),

  // Property operations
  draft({
    key: "U23", name: "nesafric_repair_request_received", group: "PROPERTY_OPERATIONS", title: "Repair request received",
    body: "Hello {{1}}, we have received your repair request {{2}} for {{3}}: {{4}}. We will keep you updated here.",
    params: [NAME("Kojo"), p("request_reference", "NM-1042", 20), p("property_name", "Adenta Court, Unit 4B", 80, "customer"), p("issue", "leaking kitchen tap", 120, "customer")],
    trigger: { event: "maintenance.requested", condition: "A repair request for a tenancy is created on the web or mobile app. Reports made on WhatsApp are answered in the chat." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U24", name: "nesafric_repair_request_update", group: "PROPERTY_OPERATIONS", title: "Repair request update",
    body: "Hello {{1}}, there is an update on your repair request {{2}} for {{3}}. Status: {{4}}. We will message you here when there is more progress.",
    params: [NAME("Kojo"), p("request_reference", "NM-1042", 20), p("property_name", "Adenta Court, Unit 4B", 80, "customer"), p("status", "work has started", 60)],
    trigger: { event: "maintenance.started | maintenance.rejected | maintenance.cancelled", condition: "Requests handled by the automatic provider network are skipped: providers' updates already reach the tenant." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U25", name: "nesafric_repair_request_completed", group: "PROPERTY_OPERATIONS", title: "Repair request completed",
    body: "Hello {{1}}, your repair request {{2}} for {{3}} has been marked as completed. If the problem is not fixed, please reply to this message.",
    params: [NAME("Kojo"), p("request_reference", "NM-1042", 20), p("property_name", "Adenta Court, Unit 4B", 80, "customer")],
    trigger: { event: "maintenance.completed", condition: "Requests handled by the automatic provider network are skipped: the provider's completion message already reaches the tenant." },
    recipient: "TENANT", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U26", name: "nesafric_new_repair_request", group: "PROPERTY_OPERATIONS", title: "New repair request (landlord)",
    body: "New repair request {{1}} at {{2}}: {{3}}. Priority: {{4}}. Reply menu to view and manage it here.",
    params: [p("request_reference", "NM-1042", 20), p("property_name", "Adenta Court, Unit 4B", 80, "customer"), p("issue", "leaking kitchen tap", 120, "customer"), p("priority", "normal", 20)],
    trigger: { event: "maintenance.requested", condition: "Landlord or manager on the property's workspace." },
    recipient: "LANDLORD_OR_MANAGER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Landlords already receive escalations and the daily digest for new requests (staff notifications); wiring this would duplicate them." },
  }),
  draft({
    key: "U27", name: "nesafric_listing_status_changed", group: "PROPERTY_OPERATIONS", title: "Listing status changed",
    body: "Hello {{1}}, the status of your listing {{2}} has changed to {{3}}. You can update the listing in your NesAfric dashboard.",
    params: [NAME("Abena"), LISTING("4-bedroom townhouse in Cantonments"), p("listing_status", "paused", 30)],
    trigger: { event: "listing.status_changed", condition: "Changed by someone other than the listing's creator (for example a suspension)." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Review outcomes are covered by U11; other changes are made by the creator themselves and would be noise." },
  }),

  // Account and document activity
  draft({
    key: "U28", name: "nesafric_document_received", group: "ACCOUNT_ACTIVITY", title: "Document received",
    body: "Hello {{1}}, we have received your document {{2}} for {{3}}. We will message you here when the review is complete.",
    params: [NAME("Abena"), p("document_name", "title deed", 60, "customer"), p("subject", "4-bedroom townhouse in Cantonments", 80, "customer")],
    trigger: { event: "listing.verification_submitted", condition: "Verification evidence is submitted." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Submission is the recipient's own action and is confirmed on screen; enable once documents can be submitted on WhatsApp." },
  }),
  draft({
    key: "U29", name: "nesafric_document_review_completed", group: "ACCOUNT_ACTIVITY", title: "Document review completed",
    body: "Hello {{1}}, the review of the documents for {{2}} is complete. Result: {{3}}. You can see the details in your NesAfric dashboard.",
    params: [NAME("Abena"), p("subject", "4-bedroom townhouse in Cantonments", 80, "customer"), p("result", "verified", 160, "customer")],
    trigger: { event: "listing.verification_verified | listing.verification_rejected", condition: "A reviewer decides the listing's verification evidence." },
    recipient: "AGENT_OR_BROKER", optIn: ["LINKED_ACCOUNT"], wiring: { status: "WIRED" },
  }),
  draft({
    key: "U30", name: "nesafric_workspace_access_changed", group: "ACCOUNT_ACTIVITY", title: "Workspace access changed",
    body: "Hello {{1}}, your access to the {{2}} workspace on NesAfric has changed. Your role is now {{3}}. If you did not expect this, contact your workspace administrator.",
    params: [NAME("Efua"), p("workspace_name", "Mensah Properties", 80, "customer"), p("role", "property manager", 40)],
    trigger: { event: "member.role_changed", condition: "A workspace administrator changes a member's role." },
    recipient: "WORKSPACE_MEMBER", optIn: ["LINKED_ACCOUNT"],
    wiring: { status: "NOT_WIRED", reason: "Role changes emit no domain event yet." },
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
