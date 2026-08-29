import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/platform/database/generated/client";
import { GHANA, GHS } from "../src/modules/geography/config";
import { ENTITLEMENTS } from "../src/modules/entitlements/catalog";
import { MARKETPLACE_ENTITLEMENTS } from "../src/modules/marketplace-professionals/catalog";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

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
  const categories = [
    ["plumbing", "Plumbing", "REPAIRS_MAINTENANCE", 10],
    ["electrical", "Electrical", "REPAIRS_MAINTENANCE", 20],
    ["hvac", "Air conditioning / HVAC", "REPAIRS_MAINTENANCE", 30],
    ["appliance", "Appliance repair", "REPAIRS_MAINTENANCE", 40],
    ["locksmith", "Locksmith", "REPAIRS_MAINTENANCE", 50],
    ["handyman", "General handyman", "REPAIRS_MAINTENANCE", 60],
    ["facility_maintenance", "Facility maintenance", "REPAIRS_MAINTENANCE", 70],
    ["masonry", "Masonry", "BUILDING_CONSTRUCTION", 10],
    ["carpentry", "Carpentry", "BUILDING_CONSTRUCTION", 20],
    ["tiling", "Tiling", "BUILDING_CONSTRUCTION", 30],
    ["roofing", "Roofing", "BUILDING_CONSTRUCTION", 40],
    ["welding", "Welding / metal work", "BUILDING_CONSTRUCTION", 50],
    ["glass_aluminium", "Glass / aluminium work", "BUILDING_CONSTRUCTION", 60],
    ["structural", "Structural work", "BUILDING_CONSTRUCTION", 70],
    ["general_contractor", "General contractor", "BUILDING_CONSTRUCTION", 80],
    ["painting", "Painting", "BUILDING_CONSTRUCTION", 90],
    ["cleaning", "Cleaning", "PROPERTY_CARE", 10],
    ["deep_cleaning", "Deep cleaning", "PROPERTY_CARE", 20],
    ["landscaping", "Landscaping / gardening", "PROPERTY_CARE", 30],
    ["pest_control", "Pest control", "PROPERTY_CARE", 40],
    ["pool_maintenance", "Pool maintenance", "PROPERTY_CARE", 50],
    ["sanitation", "Sanitation", "PROPERTY_CARE", 60],
    ["security", "CCTV / security system installation", "SECURITY_SYSTEMS", 10],
    ["generator_power_backup", "Generator / power backup services", "SECURITY_SYSTEMS", 20],
    ["solar", "Solar installation / maintenance", "SECURITY_SYSTEMS", 30],
    ["water_tank_pump", "Water tank / pump services", "SECURITY_SYSTEMS", 40],
    ["borehole_water_systems", "Borehole / water system services", "SECURITY_SYSTEMS", 50],
    ["interior_design", "Interior design", "DESIGN_PROPERTY_SERVICES", 10],
    ["interior_fitout", "Interior fit-out", "DESIGN_PROPERTY_SERVICES", 20],
    ["furniture_joinery", "Furniture / joinery", "DESIGN_PROPERTY_SERVICES", 30],
    ["moving", "Moving / relocation", "DESIGN_PROPERTY_SERVICES", 40],
    ["photography", "Property photography", "DESIGN_PROPERTY_SERVICES", 50],
    ["property_inspection", "Property inspection", "DESIGN_PROPERTY_SERVICES", 60],
    ["other_property_service", "Other property service", "OTHER", 10],
  ] as const;
  for (const [key, name, group, sortOrder] of categories) {
    await prisma.serviceCategory.upsert({ where: { key }, update: { name, active: true, group, sortOrder }, create: { key, name, group, sortOrder } });
  }
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
