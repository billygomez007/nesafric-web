import "dotenv/config";
import { PrismaClient } from "../src/platform/database/generated/client";
import { PrismaPgWithTransactionRelease } from "../src/platform/database/pg-adapter";
import { GHANA, GHS } from "../src/modules/geography/config";
import { ENTITLEMENTS } from "../src/modules/entitlements/catalog";
import { MARKETPLACE_ENTITLEMENTS } from "../src/modules/marketplace-professionals/catalog";

const prisma = new PrismaClient({ adapter: new PrismaPgWithTransactionRelease({ connectionString: process.env.DATABASE_URL }) });

const permissions = [
  ["organisation.manage_members", "Invite and manage organisation members"],
  ["property.create", "Create properties and related assets"],
  ["property.read", "View properties and related assets"],
  ["property.update", "Update properties and related assets"],
  ["portfolio.create", "Create portfolios"],
  ["audit.read", "View organisation audit history"],
  ["tenant.create", "Create tenant records"],
  ["tenant.read", "View tenant records and history"],
  ["tenant.update", "Update tenant records"],
  ["lease.create", "Create leases"],
  ["lease.read", "View leases and lease history"],
  ["lease.update", "Update lease terms and status"],
  ["reminder.manage", "Manage reminder policies and jobs"],
  ["rent_schedule.manage", "Generate rent obligation schedules"],
  ["payment.read", "View payments, receipts, and rent collection metrics"],
  ["payment.record", "Create payment requests and record payments"],
  ["payment.reverse", "Reverse confirmed payments"],
  ["deposit.read", "View security deposits"],
  ["deposit.record", "Record security deposits"],
  ["ledger.read", "View the immutable property financial ledger"],
  ["maintenance.read", "View maintenance requests, work orders, and metrics"],
  ["maintenance.create", "Create maintenance requests"],
  ["maintenance.manage", "Triage and manage maintenance request lifecycles"],
  ["maintenance.approve", "Approve or reject maintenance estimates"],
  ["maintenance.assign", "Create and assign internal work orders"],
  ["maintenance.cost", "Record work order estimates and actual costs"],
  ["provider.read", "View the organisation provider directory and provider performance"],
  ["provider.manage", "Manage provider directory records and quotation requests"],
  ["provider.verify", "Review provider verification evidence and status"],
  ["provider.quote_record", "Record provider quotations received outside UmoAfric"],
  ["provider.quote_review", "Approve or reject submitted provider quotations"],
  ["provider.assign", "Assign approved providers to work orders"],
  ["provider.rate", "Rate providers after completed work orders"],
  ["marketplace.enquiry.create", "Create marketplace enquiries for the organisation"],
  ["marketplace.enquiry.read", "View organisation marketplace enquiry history"],
  ["marketplace.enquiry.manage", "Manage organisation marketplace enquiries"],
  ["marketplace.quote_request", "Request provider quotations from marketplace enquiries"],
  ["listing.create", "Create managed property and unit listings"],
  ["listing.read", "View organisation listing history"],
  ["listing.manage", "Edit listings and manage listing lifecycle"],
  ["listing.publish", "Approve, publish, reject, pause, reserve, rent, or archive listings"],
  ["listing.verify", "Review listing verification evidence metadata"],
  ["listing.lead.read", "View organisation listing leads"],
  ["listing.lead.manage", "Manage organisation listing leads"],
  ["listing.viewing.read", "View organisation viewing requests"],
  ["listing.viewing.manage", "Assign and manage viewing requests"],
  ["application.create", "Create applicants and rental applications"],
  ["application.read", "View private organisation applicants and rental applications"],
  ["application.review", "Review and decide rental applications"],
  ["application.convert", "Convert approved applications to tenants and draft leases"],
  ["lease.execution.read", "View lease execution, signature, and onboarding records"],
  ["lease.execution.manage", "Manage lease documents, signature requests, and activation"],
  ["lease.execution.sign", "Perform authorised internal lease signature actions"],
  ["move_in.read", "View move-in workflows and inspections"],
  ["move_in.manage", "Manage move-in workflows, inspections, inventory, meters, and keys"],
  ["move_out.read", "View move-out, inspection, settlement, and turnover records"],
  ["move_out.manage", "Manage notices, move-out workflows, inspections, keys, and turnover"],
  ["deposit.settlement.manage", "Create and review deposit settlements and deductions"],
  ["deposit.settlement.approve", "Approve deductions and deposit settlements"],
  ["deposit.refund.record", "Record completed deposit refunds"],
  ["lease.close", "Close leases after move-out requirements are satisfied"],
  ["ai.use", "Use the organisation-scoped UmoAfric AI workspace"],
  ["ai.command_center", "View cross-domain operational command-center metrics and signals"],
  ["ai.propose", "Create approval-gated AI action proposals"],
  ["ai.approve", "Approve or reject authorised AI action proposals"],
  ["job.retry", "Retry eligible failed background jobs"],
  ["ai.autonomy.read", "View AI autonomy policies and activity history"],
  ["ai.autonomy.manage", "Configure organisation AI autonomy policies"],
  ["ai.autonomy.pause", "Pause or reactivate organisation AI automation"],
  ["ai.employee.read", "View organisation AI employees and their work queues"],
  ["ai.employee.manage", "Create and configure organisation AI employees"],
  ["ai.employee.operate", "Operate an AI employee within its configured authority"],
  ["conversation.read", "View organisation conversations, messages, and delivery status"],
  ["conversation.manage", "Send messages, resolve, and close organisation conversations"],
  ["conversation.assign", "Assign or reassign conversations between AI employees and staff"],
  ["communication_channel.manage", "Configure organisation communication channel settings"],
  ["document.read", "Browse the organisation Document Center (uploaded files and generated documents)"],
  ["document.manage", "Archive or restore stored documents across every domain"],
  ["document.template.manage", "Configure organisation document templates (e.g. the lease agreement template)"],
  ["calendar.read", "View organisation calendar events"],
  ["calendar.manage", "Create, update, and cancel organisation calendar events"],
  ["integration.read", "View organisation integration configuration and health, without secrets"],
  ["integration.manage", "Enable, disable, and configure organisation integrations"],
  ["billing.read", "View the organisation's subscription, plan, usage, and invoices"],
  ["billing.manage", "Change the organisation's plan and cancel its subscription"],
] as const;

/**
 * Phase 20 default commercial plans (item 1 + item 2). Deliberately three illustrative tiers with
 * real, deterministic entitlement values — configurable afterwards via the platform-admin
 * console. Prices are seeded in GHS only (the currently supported country's default currency);
 * additional currencies can be added as `PlanPrice` rows without any code change.
 */
const PLANS = [
  {
    key: "starter", name: "Starter", sortOrder: 1,
    description: "For an individual landlord getting started with a small portfolio.",
    prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY" as const, amountMinor: "25000" }, { currencyCode: "GHS", billingCycle: "ANNUAL" as const, amountMinor: "250000" }],
    entitlements: {
      [ENTITLEMENTS.propertiesMax.key]: { kind: "LIMIT" as const, limitValue: 3 },
      [ENTITLEMENTS.unitsMax.key]: { kind: "LIMIT" as const, limitValue: 15 },
      [ENTITLEMENTS.teamMembersMax.key]: { kind: "LIMIT" as const, limitValue: 3 },
      [ENTITLEMENTS.aiEmployeesMax.key]: { kind: "LIMIT" as const, limitValue: 1 },
      [ENTITLEMENTS.aiTokensMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 200_000 },
      [ENTITLEMENTS.aiCostMonthlyNanoMax.key]: { kind: "LIMIT" as const, limitValue: 5_000_000_000 },
      [ENTITLEMENTS.storageBytesMax.key]: { kind: "LIMIT" as const, limitValue: 5 * 1024 * 1024 * 1024 },
      [ENTITLEMENTS.listingsMax.key]: { kind: "LIMIT" as const, limitValue: 5 },
      [ENTITLEMENTS.documentsMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 50 },
      [ENTITLEMENTS.messagesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 500 },
      [ENTITLEMENTS.integrationOperationsMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 100 },
      [ENTITLEMENTS.integrationsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.automationEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.advancedReportingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.aiPropertyManagerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.aiReceptionistTextEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.aiReceptionistVoiceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.maintenanceAiClassificationEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.maintenanceAiDispatchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.maintenanceVoiceDispatchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.predictiveMaintenanceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.portfolioIntelligenceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceOutboundEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceCallVolumeMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [ENTITLEMENTS.voiceRecordingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [ENTITLEMENTS.voiceHumanTransferEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceConcurrentCallsMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
    },
  },
  {
    key: "growth", name: "Growth", sortOrder: 2,
    description: "For a growing property management business with a small team.",
    prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY" as const, amountMinor: "75000" }, { currencyCode: "GHS", billingCycle: "ANNUAL" as const, amountMinor: "750000" }],
    entitlements: {
      [ENTITLEMENTS.propertiesMax.key]: { kind: "LIMIT" as const, limitValue: 20 },
      [ENTITLEMENTS.unitsMax.key]: { kind: "LIMIT" as const, limitValue: 150 },
      [ENTITLEMENTS.teamMembersMax.key]: { kind: "LIMIT" as const, limitValue: 10 },
      [ENTITLEMENTS.aiEmployeesMax.key]: { kind: "LIMIT" as const, limitValue: 5 },
      [ENTITLEMENTS.aiTokensMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 2_000_000 },
      [ENTITLEMENTS.aiCostMonthlyNanoMax.key]: { kind: "LIMIT" as const, limitValue: 50_000_000_000 },
      [ENTITLEMENTS.storageBytesMax.key]: { kind: "LIMIT" as const, limitValue: 50 * 1024 * 1024 * 1024 },
      [ENTITLEMENTS.listingsMax.key]: { kind: "LIMIT" as const, limitValue: 50 },
      [ENTITLEMENTS.documentsMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 500 },
      [ENTITLEMENTS.messagesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 5_000 },
      [ENTITLEMENTS.integrationOperationsMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 1_000 },
      [ENTITLEMENTS.integrationsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.automationEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.advancedReportingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.aiPropertyManagerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.aiReceptionistTextEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.aiReceptionistVoiceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.maintenanceAiClassificationEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.maintenanceAiDispatchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.maintenanceVoiceDispatchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.predictiveMaintenanceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.portfolioIntelligenceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceOutboundEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceCallVolumeMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [ENTITLEMENTS.voiceRecordingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [ENTITLEMENTS.voiceHumanTransferEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [ENTITLEMENTS.voiceConcurrentCallsMax.key]: { kind: "LIMIT" as const, limitValue: 2 },
    },
  },
  {
    key: "scale", name: "Scale", sortOrder: 3,
    description: "For a larger property management company with an unlimited portfolio.",
    prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY" as const, amountMinor: "200000" }, { currencyCode: "GHS", billingCycle: "ANNUAL" as const, amountMinor: "2000000" }],
    entitlements: {
      [ENTITLEMENTS.propertiesMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.unitsMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.teamMembersMax.key]: { kind: "LIMIT" as const, limitValue: 50 },
      [ENTITLEMENTS.aiEmployeesMax.key]: { kind: "LIMIT" as const, limitValue: 20 },
      [ENTITLEMENTS.aiTokensMonthlyMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.aiCostMonthlyNanoMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.storageBytesMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.listingsMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.documentsMonthlyMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.messagesMonthlyMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.integrationOperationsMonthlyMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [ENTITLEMENTS.integrationsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.automationEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.advancedReportingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.aiPropertyManagerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.aiReceptionistTextEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.aiReceptionistVoiceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.maintenanceAiClassificationEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.maintenanceAiDispatchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.maintenanceVoiceDispatchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.predictiveMaintenanceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.portfolioIntelligenceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.voiceOutboundEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.voiceCallVolumeMax.key]: { kind: "LIMIT" as const, limitValue: 200 },
      [ENTITLEMENTS.voiceRecordingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 2_000 },
      [ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 1_000 },
      [ENTITLEMENTS.voiceHumanTransferEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [ENTITLEMENTS.voiceConcurrentCallsMax.key]: { kind: "LIMIT" as const, limitValue: 25 },
    },
  },
] as const;

/**
 * Phase 21A item 8's separate commercial product family. Only `marketplace_free` is priced
 * (GHS 0) at launch — the future paid tiers named in the phase brief (Professional, Brokerage,
 * Enterprise) are intentionally not seeded yet ("do not implement final future pricing now"), but
 * the schema/seed shape already supports adding them without a migration.
 */
const MARKETPLACE_PLANS = [
  {
    key: "marketplace_free", name: "Marketplace Free", sortOrder: 1,
    description: "Free access to the UmoAfric Real Estate Marketplace for agents, brokers, brokerages, real-estate companies, and developers.",
    prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY" as const, amountMinor: "0" }],
    entitlements: {
      [MARKETPLACE_ENTITLEMENTS.activeListingsMax.key]: { kind: "LIMIT" as const, limitValue: 10 },
      [MARKETPLACE_ENTITLEMENTS.teamMembersMax.key]: { kind: "LIMIT" as const, limitValue: 3 },
      [MARKETPLACE_ENTITLEMENTS.developmentsMax.key]: { kind: "LIMIT" as const, limitValue: 2 },
      [MARKETPLACE_ENTITLEMENTS.leadManagementEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.promotedListingsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.featuredProfileEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.advancedAnalyticsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistTextEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistVoiceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiSalesAgentEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiLeadManagerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiListingAssistantEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiInventorySearchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiViewingSchedulerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundFollowupEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundCallsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.voiceCallVolumeMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [MARKETPLACE_ENTITLEMENTS.voiceRecordingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [MARKETPLACE_ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [MARKETPLACE_ENTITLEMENTS.voiceHumanTransferEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.voiceConcurrentCallsMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
    },
  },
  {
    key: "marketplace_pro", name: "Marketplace Pro", sortOrder: 2,
    description: "For an active individual agent or small team bringing more inventory onto the marketplace.",
    prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY" as const, amountMinor: "15000" }, { currencyCode: "GHS", billingCycle: "ANNUAL" as const, amountMinor: "150000" }],
    entitlements: {
      [MARKETPLACE_ENTITLEMENTS.activeListingsMax.key]: { kind: "LIMIT" as const, limitValue: 50 },
      [MARKETPLACE_ENTITLEMENTS.teamMembersMax.key]: { kind: "LIMIT" as const, limitValue: 5 },
      [MARKETPLACE_ENTITLEMENTS.developmentsMax.key]: { kind: "LIMIT" as const, limitValue: 5 },
      [MARKETPLACE_ENTITLEMENTS.leadManagementEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.promotedListingsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.featuredProfileEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.advancedAnalyticsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistTextEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistVoiceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiSalesAgentEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiLeadManagerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiListingAssistantEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiInventorySearchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiViewingSchedulerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundFollowupEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundCallsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.voiceCallVolumeMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [MARKETPLACE_ENTITLEMENTS.voiceRecordingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [MARKETPLACE_ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 0 },
      [MARKETPLACE_ENTITLEMENTS.voiceHumanTransferEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: false },
      [MARKETPLACE_ENTITLEMENTS.voiceConcurrentCallsMax.key]: { kind: "LIMIT" as const, limitValue: 1 },
    },
  },
  {
    key: "marketplace_brokerage", name: "Brokerage", sortOrder: 3,
    description: "For a brokerage or real-estate company running a full sales/leasing team on the marketplace.",
    prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY" as const, amountMinor: "60000" }, { currencyCode: "GHS", billingCycle: "ANNUAL" as const, amountMinor: "600000" }],
    entitlements: {
      [MARKETPLACE_ENTITLEMENTS.activeListingsMax.key]: { kind: "LIMIT" as const, limitValue: 300 },
      [MARKETPLACE_ENTITLEMENTS.teamMembersMax.key]: { kind: "LIMIT" as const, limitValue: 25 },
      [MARKETPLACE_ENTITLEMENTS.developmentsMax.key]: { kind: "LIMIT" as const, limitValue: 20 },
      [MARKETPLACE_ENTITLEMENTS.leadManagementEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.promotedListingsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.featuredProfileEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.advancedAnalyticsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistTextEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistVoiceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiSalesAgentEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiLeadManagerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiListingAssistantEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiInventorySearchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiViewingSchedulerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundFollowupEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundCallsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.voiceCallVolumeMax.key]: { kind: "LIMIT" as const, limitValue: 100 },
      [MARKETPLACE_ENTITLEMENTS.voiceRecordingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 1_000 },
      [MARKETPLACE_ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, limitValue: 500 },
      [MARKETPLACE_ENTITLEMENTS.voiceHumanTransferEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.voiceConcurrentCallsMax.key]: { kind: "LIMIT" as const, limitValue: 10 },
    },
  },
  {
    key: "marketplace_enterprise", name: "Marketplace Enterprise", sortOrder: 4,
    description: "For a major national/international real-estate company or developer with custom automation and policy needs.",
    prices: [{ currencyCode: "GHS", billingCycle: "MONTHLY" as const, amountMinor: "150000" }, { currencyCode: "GHS", billingCycle: "ANNUAL" as const, amountMinor: "1500000" }],
    entitlements: {
      [MARKETPLACE_ENTITLEMENTS.activeListingsMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [MARKETPLACE_ENTITLEMENTS.teamMembersMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [MARKETPLACE_ENTITLEMENTS.developmentsMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [MARKETPLACE_ENTITLEMENTS.leadManagementEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.promotedListingsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.featuredProfileEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.advancedAnalyticsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistTextEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiReceptionistVoiceEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiSalesAgentEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiLeadManagerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiListingAssistantEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiInventorySearchEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiViewingSchedulerEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundFollowupEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.aiOutboundCallsEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.voiceCallVolumeMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [MARKETPLACE_ENTITLEMENTS.voiceRecordingEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [MARKETPLACE_ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
      [MARKETPLACE_ENTITLEMENTS.voiceHumanTransferEnabled.key]: { kind: "BOOLEAN" as const, booleanValue: true },
      [MARKETPLACE_ENTITLEMENTS.voiceConcurrentCallsMax.key]: { kind: "LIMIT" as const, isUnlimited: true },
    },
  },
] as const;

async function main() {
  // `isActive` is asserted explicitly on the update side too (not just relied on as the schema's
  // create-time default): an upsert against a pre-existing, previously-deactivated row must
  // reactivate it, exactly like every plan/price upsert below already does.
  await prisma.country.upsert({ where: { code: GHANA.code }, update: { ...GHANA, isActive: true }, create: { ...GHANA, isActive: true } });
  await prisma.currency.upsert({ where: { code: GHS.code }, update: { ...GHS, isActive: true }, create: { ...GHS, isActive: true } });
  for (const [key, description] of permissions) {
    await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const allPermissions = await prisma.permission.findMany();
  const roles = [
    { key: "organisation_owner", name: "Organisation owner", keys: allPermissions.map(({ key }) => key) },
    { key: "administrator", name: "Administrator", keys: allPermissions.map(({ key }) => key) },
    { key: "property_manager", name: "Property manager", keys: ["property.create", "property.read", "property.update", "portfolio.create", "tenant.create", "tenant.read", "tenant.update", "lease.create", "lease.read", "lease.update", "lease.close", "reminder.manage", "rent_schedule.manage", "payment.read", "payment.record", "payment.reverse", "deposit.read", "deposit.record", "deposit.settlement.manage", "ledger.read", "maintenance.read", "maintenance.create", "maintenance.manage", "maintenance.approve", "maintenance.assign", "maintenance.cost", "provider.read", "provider.manage", "provider.quote_record", "provider.quote_review", "provider.assign", "provider.rate", "marketplace.enquiry.create", "marketplace.enquiry.read", "marketplace.enquiry.manage", "marketplace.quote_request", "listing.create", "listing.read", "listing.manage", "listing.publish", "listing.lead.read", "listing.lead.manage", "listing.viewing.read", "listing.viewing.manage", "application.create", "application.read", "application.review", "application.convert", "lease.execution.read", "lease.execution.manage", "lease.execution.sign", "move_in.read", "move_in.manage", "move_out.read", "move_out.manage", "ai.use", "ai.command_center", "ai.propose", "job.retry", "ai.autonomy.read", "ai.employee.read", "ai.employee.operate", "conversation.read", "conversation.manage", "conversation.assign", "communication_channel.manage", "document.read", "document.manage", "document.template.manage", "calendar.read", "calendar.manage", "integration.read", "integration.manage"] },
    { key: "viewer", name: "Viewer", keys: ["property.read", "tenant.read", "lease.read", "payment.read", "deposit.read", "ledger.read", "maintenance.read", "provider.read", "marketplace.enquiry.read", "listing.read", "listing.lead.read", "listing.viewing.read", "application.read", "lease.execution.read", "move_in.read", "move_out.read", "ai.use", "conversation.read", "document.read", "calendar.read", "integration.read"] },
    // Phase 23: a limited-visibility seat for a company-type Property Service Professional's own
    // team members. Reuses the existing organisation-membership/role architecture rather than a
    // new team model — a company provider's `companyOrganisationId` is a real `Organisation`, and
    // technicians are just members of it. Note: `ownsProvider` still only recognises
    // organisation_owner/administrator for provider-mutating actions (evidence, profile, enquiry
    // responses) — this role currently grants read visibility only; extending action-taking to
    // technicians is deliberately deferred follow-up work.
    { key: "technician", name: "Technician", keys: ["provider.read", "marketplace.enquiry.read"] },
  ];
  for (const definition of roles) {
    const role = await prisma.role.upsert({ where: { key: definition.key }, update: { name: definition.name }, create: { key: definition.key, name: definition.name } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: allPermissions.filter(({ key }) => definition.keys.includes(key)).map(({ id }) => ({ roleId: role.id, permissionId: id })) });
  }
  // Phase 25: Ghana-launch property-services taxonomy, grouped for admin/onboarding navigation.
  // `group`/`sortOrder` are display-only — matching/eligibility logic never reads them, only `key`.
  // Property Services taxonomy.
  //
  // Top-level categories are navigation/grouping nodes only.
  // Leaf categories are selectable services. Existing stable keys are reused
  // wherever their meaning maps cleanly to the approved taxonomy so existing
  // provider-category relationships retain their category IDs.
  const propertyServiceGroups = [
    ["property_services_construction_building_works", "Construction & Building Works", 10],
    ["property_services_repairs_maintenance", "Repairs & Maintenance", 20],
    ["property_services_cleaning_property_care", "Cleaning & Property Care", 30],
    ["property_services_landscaping_outdoor", "Landscaping & Outdoor Services", 40],
    ["property_services_security_access_safety", "Security, Access & Safety", 50],
    ["property_services_energy_power_utilities", "Energy, Power & Utilities", 60],
    ["property_services_interior_design_fitout", "Interior Design & Fit-Out", 70],
    ["property_services_architecture_engineering", "Architecture, Engineering & Technical Services", 80],
    ["property_services_surveying_valuation_planning", "Surveying, Valuation & Planning", 90],
    ["property_services_moving_relocation_storage", "Moving, Relocation & Storage", 100],
    ["property_services_legal_documentation_compliance", "Legal, Documentation & Compliance Services", 110],
  ] as const;

  const legacyGroupByParentKey = {
    property_services_construction_building_works: "BUILDING_CONSTRUCTION",
    property_services_repairs_maintenance: "REPAIRS_MAINTENANCE",
    property_services_cleaning_property_care: "PROPERTY_CARE",
    property_services_landscaping_outdoor: "PROPERTY_CARE",
    property_services_security_access_safety: "SECURITY_SYSTEMS",
    property_services_energy_power_utilities: "SECURITY_SYSTEMS",
    property_services_interior_design_fitout: "DESIGN_PROPERTY_SERVICES",
    property_services_architecture_engineering: "DESIGN_PROPERTY_SERVICES",
    property_services_surveying_valuation_planning: "DESIGN_PROPERTY_SERVICES",
    property_services_moving_relocation_storage: "DESIGN_PROPERTY_SERVICES",
    property_services_legal_documentation_compliance: "OTHER",
  } as const;

  for (const [key, name, sortOrder] of propertyServiceGroups) {
    await prisma.serviceCategory.upsert({
      where: { key },
      update: {
        name,
        parentId: null,
        group: legacyGroupByParentKey[key],
        sortOrder,
        active: true,
        publiclyVisible: true,
        onboardingSelectable: false,
      },
      create: {
        key,
        name,
        parentId: null,
        group: legacyGroupByParentKey[key],
        sortOrder,
        active: true,
        publiclyVisible: true,
        onboardingSelectable: false,
      },
    });
  }

  const parentIdByKey = new Map(
    (
      await prisma.serviceCategory.findMany({
        where: { key: { in: propertyServiceGroups.map(([key]) => key) } },
        select: { id: true, key: true },
      })
    ).map((category) => [category.key, category.id]),
  );

  const categories = [
    // 1. Construction & Building Works
    ["general_contractor", "General Contractors", "property_services_construction_building_works", 10],
    ["building_contractor", "Building Contractors", "property_services_construction_building_works", 20],
    ["masonry", "Masonry & Blockwork", "property_services_construction_building_works", 30],
    ["carpentry", "Carpentry & Joinery", "property_services_construction_building_works", 40],
    ["roofing", "Roofing", "property_services_construction_building_works", 50],
    ["tiling", "Tiling", "property_services_construction_building_works", 60],
    ["painting", "Painting & Decorating", "property_services_construction_building_works", 70],
    ["welding", "Welding & Metal Fabrication", "property_services_construction_building_works", 80],
    ["glass_aluminium", "Glass & Aluminium Works", "property_services_construction_building_works", 90],
    ["steel_works", "Steel Works", "property_services_construction_building_works", 100],
    ["flooring_installation", "Flooring Installation", "property_services_construction_building_works", 110],
    ["scaffolding", "Scaffolding", "property_services_construction_building_works", 120],

    // 2. Repairs & Maintenance
    ["handyman", "General Handyman", "property_services_repairs_maintenance", 10],
    ["plumbing", "Plumbing Repairs", "property_services_repairs_maintenance", 20],
    ["electrical", "Electrical Repairs", "property_services_repairs_maintenance", 30],
    ["hvac", "Air Conditioning / HVAC", "property_services_repairs_maintenance", 40],
    ["appliance", "Appliance Repair", "property_services_repairs_maintenance", 50],
    ["septic_system_maintenance", "Septic System Maintenance", "property_services_repairs_maintenance", 60],
    ["elevator_lift_maintenance", "Elevator / Lift Maintenance", "property_services_repairs_maintenance", 70],

    // 3. Cleaning & Property Care
    ["residential_cleaning", "Residential Cleaning", "property_services_cleaning_property_care", 10],
    ["commercial_cleaning", "Commercial Cleaning", "property_services_cleaning_property_care", 20],
    ["deep_cleaning", "Deep Cleaning", "property_services_cleaning_property_care", 30],
    ["post_construction_cleaning", "Post-Construction Cleaning", "property_services_cleaning_property_care", 40],
    ["move_in_move_out_cleaning", "Move-In / Move-Out Cleaning", "property_services_cleaning_property_care", 50],
    ["carpet_upholstery_cleaning", "Carpet & Upholstery Cleaning", "property_services_cleaning_property_care", 60],
    ["pest_control", "Pest Control & Fumigation", "property_services_cleaning_property_care", 70],

    // 4. Landscaping & Outdoor Services
    ["landscaping", "Landscaping", "property_services_landscaping_outdoor", 10],
    ["gardening", "Gardening", "property_services_landscaping_outdoor", 20],
    ["lawn_maintenance", "Lawn Maintenance", "property_services_landscaping_outdoor", 30],
    ["tree_cutting_pruning", "Tree Cutting & Pruning", "property_services_landscaping_outdoor", 40],
    ["fence_installation", "Fence Installation", "property_services_landscaping_outdoor", 50],
    ["gate_installation", "Gate Installation", "property_services_landscaping_outdoor", 60],
    ["paving_interlocking", "Paving & Interlocking", "property_services_landscaping_outdoor", 70],
    ["outdoor_lighting", "Outdoor Lighting", "property_services_landscaping_outdoor", 80],
    ["pool_construction", "Pool Construction", "property_services_landscaping_outdoor", 90],

    // 5. Security, Access & Safety
    ["security", "Security Guards", "property_services_security_access_safety", 10],
    ["cctv_installation", "CCTV Installation", "property_services_security_access_safety", 20],
    ["alarm_systems", "Alarm Systems", "property_services_security_access_safety", 30],
    ["access_control", "Access Control", "property_services_security_access_safety", 40],
    ["intercom_systems", "Intercom Systems", "property_services_security_access_safety", 50],
    ["electric_fencing", "Electric Fencing", "property_services_security_access_safety", 60],
    ["gate_automation", "Gate Automation", "property_services_security_access_safety", 70],
    ["fire_alarm_systems", "Fire Alarm Systems", "property_services_security_access_safety", 80],
    ["fire_extinguishers_suppression", "Fire Extinguishers & Suppression", "property_services_security_access_safety", 90],

    // 6. Energy, Power & Utilities
    ["solar", "Solar Installation", "property_services_energy_power_utilities", 10],
    ["inverters_ups", "Inverters & UPS", "property_services_energy_power_utilities", 20],
    ["generator_power_backup", "Generator Installation & Maintenance", "property_services_energy_power_utilities", 30],
    ["borehole_water_systems", "Borehole Drilling", "property_services_energy_power_utilities", 40],
    ["water_pumps", "Water Pumps", "property_services_energy_power_utilities", 50],
    ["water_tanks", "Water Tanks", "property_services_energy_power_utilities", 60],
    ["water_treatment", "Water Treatment", "property_services_energy_power_utilities", 70],
    ["septic_sewage_systems", "Septic & Sewage Systems", "property_services_energy_power_utilities", 80],
    ["gas_lpg_systems", "Gas / LPG Systems", "property_services_energy_power_utilities", 90],
    ["ev_charging_installation", "EV Charging Installation", "property_services_energy_power_utilities", 100],

    // 7. Interior Design & Fit-Out
    ["interior_design", "Interior Design", "property_services_interior_design_fitout", 10],
    ["interior_fitout", "Interior Fit-Out", "property_services_interior_design_fitout", 20],
    ["furniture_joinery", "Furniture & Joinery", "property_services_interior_design_fitout", 30],
    ["custom_cabinetry", "Custom Cabinetry", "property_services_interior_design_fitout", 40],
    ["kitchen_installation", "Kitchen Installation", "property_services_interior_design_fitout", 50],
    ["bathroom_fitout", "Bathroom Fit-Out", "property_services_interior_design_fitout", 60],
    ["wardrobes_closets", "Wardrobes & Closets", "property_services_interior_design_fitout", 70],
    ["curtains_blinds", "Curtains & Blinds", "property_services_interior_design_fitout", 80],
    ["flooring", "Flooring", "property_services_interior_design_fitout", 90],
    ["wallpaper", "Wallpaper", "property_services_interior_design_fitout", 100],
    ["decorative_painting", "Decorative Painting", "property_services_interior_design_fitout", 110],
    ["lighting_design", "Lighting Design", "property_services_interior_design_fitout", 120],
    ["office_partitions", "Office Partitions", "property_services_interior_design_fitout", 130],

    // 8. Architecture, Engineering & Technical Services
    ["architecture", "Architects", "property_services_architecture_engineering", 10],
    ["building_designers", "Building Designers", "property_services_architecture_engineering", 20],
    ["structural", "Structural Engineers", "property_services_architecture_engineering", 30],
    ["civil_engineers", "Civil Engineers", "property_services_architecture_engineering", 40],
    ["electrical_engineers", "Electrical Engineers", "property_services_architecture_engineering", 50],
    ["mechanical_mep_engineers", "Mechanical / MEP Engineers", "property_services_architecture_engineering", 60],
    ["geotechnical_engineers", "Geotechnical Engineers", "property_services_architecture_engineering", 70],

    // 9. Surveying, Valuation & Planning
    ["land_surveying", "Land Surveyors", "property_services_surveying_valuation_planning", 10],
    ["quantity_surveying", "Quantity Surveyors", "property_services_surveying_valuation_planning", 20],
    ["property_valuation", "Property Valuers / Estate Surveyors", "property_services_surveying_valuation_planning", 30],

    // 10. Moving, Relocation & Storage
    ["home_moving", "Home Moving", "property_services_moving_relocation_storage", 10],
    ["office_moving", "Office Moving", "property_services_moving_relocation_storage", 20],
    ["packing_services", "Packing Services", "property_services_moving_relocation_storage", 30],
    ["furniture_moving", "Furniture Moving", "property_services_moving_relocation_storage", 40],
    ["furniture_assembly", "Furniture Assembly", "property_services_moving_relocation_storage", 50],
    ["relocation_services", "Relocation Services", "property_services_moving_relocation_storage", 60],
    ["local_haulage", "Local Haulage", "property_services_moving_relocation_storage", 70],
    ["property_clearance", "Property Clearance", "property_services_moving_relocation_storage", 80],
    ["storage_services", "Storage Services", "property_services_moving_relocation_storage", 90],
    ["warehouse_storage", "Warehouse Storage", "property_services_moving_relocation_storage", 100],
    ["equipment_moving", "Equipment Moving", "property_services_moving_relocation_storage", 110],

    // 11. Legal, Documentation & Compliance Services
    ["property_lawyers", "Property Lawyers", "property_services_legal_documentation_compliance", 10],
    ["land_documentation", "Land Documentation", "property_services_legal_documentation_compliance", 20],
    ["building_permit_assistance", "Building Permit Assistance", "property_services_legal_documentation_compliance", 30],
    ["property_due_diligence", "Property Due Diligence", "property_services_legal_documentation_compliance", 40],
    ["land_registration_support", "Land Registration Support", "property_services_legal_documentation_compliance", 50],
  ] as const;

  for (const [key, name, parentKey, sortOrder] of categories) {
    const parentId = parentIdByKey.get(parentKey);
    if (!parentId) throw new Error(`Missing Property Services parent category: ${parentKey}`);

    await prisma.serviceCategory.upsert({
      where: { key },
      update: {
        name,
        parentId,
        group: legacyGroupByParentKey[parentKey],
        sortOrder,
        active: true,
        publiclyVisible: true,
        onboardingSelectable: true,
      },
      create: {
        key,
        name,
        parentId,
        group: legacyGroupByParentKey[parentKey],
        sortOrder,
        active: true,
        publiclyVisible: true,
        onboardingSelectable: true,
      },
    });
  }

  // Keep broad/legacy categories and their provider relationships intact, but do
  // not expose them as choices in the new taxonomy when they cannot be mapped
  // safely to one exact approved leaf.
  const hiddenLegacyCategoryKeys = [
    "locksmith",
    "facility_maintenance",
    "cleaning",
    "pool_maintenance",
    "sanitation",
    "water_tank_pump",
    "moving",
    "photography",
    "property_inspection",
    "other_property_service",
  ] as const;

  await prisma.serviceCategory.updateMany({
    where: { key: { in: [...hiddenLegacyCategoryKeys] } },
    data: {
      publiclyVisible: false,
      onboardingSelectable: false,
    },
  });

  const categoryIdByKey = new Map((await prisma.serviceCategory.findMany({ select: { id: true, key: true } })).map((c) => [c.key, c.id]));

  // Phase 23: Ghana-launch mandatory identity/business document requirements for Property Service
  // Professionals. Country/category/provider-type scoped so future countries or trade-specific
  // credential rules never need a code change — only a new row here (or, eventually, a
  // platform-admin-managed equivalent).
  const providerDocumentRequirements = [
    { countryCode: "GH", categoryKey: null, providerType: "INDIVIDUAL" as const, evidenceType: "GHANA_CARD_FRONT" as const, level: "REQUIRED" as const, label: "Ghana Card (front)", description: "Front of the individual provider's Ghana Card." },
    { countryCode: "GH", categoryKey: null, providerType: "INDIVIDUAL" as const, evidenceType: "GHANA_CARD_BACK" as const, level: "REQUIRED" as const, label: "Ghana Card (back)", description: "Back of the individual provider's Ghana Card." },
    { countryCode: "GH", categoryKey: null, providerType: "COMPANY" as const, evidenceType: "GHANA_CARD_FRONT" as const, level: "REQUIRED" as const, label: "Ghana Card (front) of responsible representative", description: "Front of the Ghana Card belonging to the company's owner, director, or authorised representative." },
    { countryCode: "GH", categoryKey: null, providerType: "COMPANY" as const, evidenceType: "GHANA_CARD_BACK" as const, level: "REQUIRED" as const, label: "Ghana Card (back) of responsible representative", description: "Back of the Ghana Card belonging to the company's owner, director, or authorised representative." },
    { countryCode: "GH", categoryKey: null, providerType: "COMPANY" as const, evidenceType: "BUSINESS_REGISTRATION" as const, level: "REQUIRED" as const, label: "Business registration certificate", description: "Registrar-General business/company registration evidence." },
    // Category-specific, conditional credential examples (item: "ELECTRICAL: licence/certificate
    // may be REQUIRED where applicable"). CONDITIONAL rows are advisory in the onboarding UI —
    // never block submission by themselves — the admin can promote one to REQUIRED per-market once
    // a real licensing regime is confirmed.
    { countryCode: "GH", categoryKey: "electrical", providerType: null, evidenceType: "PROFESSIONAL_LICENSE" as const, level: "CONDITIONAL" as const, label: "Electrical licence/certificate", description: "An electrical trade licence or certification, where applicable.", conditionNote: "Required only where local electrical-work licensing applies." },
    { countryCode: "GH", categoryKey: "security", providerType: "COMPANY" as const, evidenceType: "PROFESSIONAL_LICENSE" as const, level: "CONDITIONAL" as const, label: "Security services licence", description: "A private security services licence, where applicable.", conditionNote: "Required only where local security-services licensing applies." },
  ];
  for (const requirement of providerDocumentRequirements) {
    const categoryId = requirement.categoryKey ? (categoryIdByKey.get(requirement.categoryKey) ?? null) : null;
    // A compound unique index with a nullable column (`categoryId`) can't be targeted by Prisma's
    // generated compound-where type when the value is null, so this uses find-then-write instead
    // of `upsert`.
    const existing = await prisma.providerDocumentRequirement.findFirst({
      where: { countryCode: requirement.countryCode, categoryId, providerType: requirement.providerType, evidenceType: requirement.evidenceType },
    });
    // Legacy boolean: only REQUIRED blocks onboarding submission by itself — CONDITIONAL/OPTIONAL
    // must never block it (see the schema comment on `requirementLevel`), so both map to `false`.
    const data = {
      label: requirement.label,
      description: requirement.description,
      required: (requirement.level as string) === "REQUIRED",
      requirementLevel: requirement.level,
      conditionNote: "conditionNote" in requirement ? requirement.conditionNote : null,
      active: true,
    };
    if (existing) {
      await prisma.providerDocumentRequirement.update({ where: { id: existing.id }, data });
    } else {
      await prisma.providerDocumentRequirement.create({ data: { countryCode: requirement.countryCode, categoryId, providerType: requirement.providerType, evidenceType: requirement.evidenceType, ...data } });
    }
  }

  // Phase 20: seed the default commercial plans/prices/entitlements.
  for (const plan of PLANS) {
    const record = await prisma.subscriptionPlan.upsert({
      where: { key: plan.key },
      update: { name: plan.name, description: plan.description, sortOrder: plan.sortOrder, isActive: true, isPublic: true },
      create: { key: plan.key, name: plan.name, description: plan.description, sortOrder: plan.sortOrder },
    });
    for (const price of plan.prices) {
      await prisma.planPrice.upsert({
        where: { planId_currencyCode_billingCycle: { planId: record.id, currencyCode: price.currencyCode, billingCycle: price.billingCycle } },
        update: { amountMinor: price.amountMinor, isActive: true },
        create: { planId: record.id, currencyCode: price.currencyCode, billingCycle: price.billingCycle, amountMinor: price.amountMinor },
      });
    }
    for (const [featureKey, entitlement] of Object.entries(plan.entitlements)) {
      const data = "isUnlimited" in entitlement && entitlement.isUnlimited
        ? { kind: entitlement.kind, isUnlimited: true, limitValue: null, booleanValue: null }
        : { kind: entitlement.kind, isUnlimited: false, limitValue: "limitValue" in entitlement ? entitlement.limitValue : null, booleanValue: "booleanValue" in entitlement ? entitlement.booleanValue : null };
      await prisma.planEntitlement.upsert({
        where: { planId_featureKey: { planId: record.id, featureKey } },
        update: data,
        create: { planId: record.id, featureKey, ...data },
      });
    }
  }

  // Phase 21A: seed the marketplace's own, entirely separate plan/price/entitlement family.
  for (const plan of MARKETPLACE_PLANS) {
    const record = await prisma.marketplacePlan.upsert({
      where: { key: plan.key },
      update: { name: plan.name, description: plan.description, sortOrder: plan.sortOrder, isActive: true, isPublic: true },
      create: { key: plan.key, name: plan.name, description: plan.description, sortOrder: plan.sortOrder },
    });
    for (const price of plan.prices) {
      await prisma.marketplacePlanPrice.upsert({
        where: { planId_currencyCode_billingCycle: { planId: record.id, currencyCode: price.currencyCode, billingCycle: price.billingCycle } },
        update: { amountMinor: price.amountMinor, isActive: true },
        create: { planId: record.id, currencyCode: price.currencyCode, billingCycle: price.billingCycle, amountMinor: price.amountMinor },
      });
    }
    for (const [featureKey, entitlement] of Object.entries(plan.entitlements)) {
      const data = "isUnlimited" in entitlement && entitlement.isUnlimited
        ? { kind: entitlement.kind, isUnlimited: true, limitValue: null, booleanValue: null }
        : { kind: entitlement.kind, isUnlimited: false, limitValue: "limitValue" in entitlement ? entitlement.limitValue : null, booleanValue: "booleanValue" in entitlement ? entitlement.booleanValue : null };
      await prisma.marketplacePlanEntitlement.upsert({
        where: { planId_featureKey: { planId: record.id, featureKey } },
        update: data,
        create: { planId: record.id, featureKey, ...data },
      });
    }
  }

  // Phase 20: backfill a TRIALING subscription for any organisation that predates Phase 20 and
  // therefore has none yet (item 1 — no organisation ever exists without exactly one subscription).
  const starterPlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: "starter" } });
  const organisationsWithoutSubscription = await prisma.organisation.findMany({ where: { subscription: null }, select: { id: true, defaultCurrencyCode: true } });
  for (const organisation of organisationsWithoutSubscription) {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const subscription = await prisma.organisationSubscription.create({
      data: { organisationId: organisation.id, planId: starterPlan.id, status: "TRIALING", currencyCode: organisation.defaultCurrencyCode, trialEndsAt, currentPeriodStart: now, currentPeriodEnd: trialEndsAt },
    });
    await prisma.subscriptionStatusHistory.create({ data: { subscriptionId: subscription.id, organisationId: organisation.id, fromStatus: null, toStatus: "TRIALING", reason: "Backfilled by Phase 20 seed for a pre-existing organisation." } });
  }
}

main().finally(() => prisma.$disconnect());
