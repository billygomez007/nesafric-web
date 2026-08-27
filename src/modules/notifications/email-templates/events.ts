import { BRAND } from "@/platform/brand";
import type { EmailContent } from "./render";

/**
 * Branded subject + content for every `ReminderEventType` the existing notification pipeline
 * already fires (see `EVENT_MESSAGES` in `../providers.ts`, which remains the SMS/WhatsApp
 * plain-text source of truth). This only upgrades how the *same* existing events are presented
 * over email — it does not add new event types or new data-fetching.
 */
export type ReminderEmailEvent = { subject: string; sender: keyof typeof BRAND.sender; content: EmailContent };

const EVENTS: Record<string, ReminderEmailEvent> = {
  LEASE_EXPIRY: {
    subject: "Your lease is approaching its expiry date",
    sender: "notifications",
    content: {
      heading: "Lease expiry reminder",
      badge: { label: "Action may be needed", tone: "warning" },
      paragraphs: ["Your lease is approaching its expiry date. Please review your lease details, or contact your property manager if you have questions about renewal."],
    },
  },
  RENT_DUE: {
    subject: "A rent payment is due soon",
    sender: "notifications",
    content: {
      heading: "Rent due soon",
      badge: { label: "Payment due", tone: "neutral" },
      paragraphs: ["A rent payment on your lease is due soon. Please arrange payment before the due date to keep your account in good standing."],
    },
  },
  RENT_OVERDUE: {
    subject: "A rent payment is overdue",
    sender: "notifications",
    content: {
      heading: "Rent payment overdue",
      badge: { label: "Overdue", tone: "critical" },
      paragraphs: ["A rent payment on your lease is now overdue. Please arrange payment as soon as possible, or contact your property manager if you need to discuss this."],
    },
  },
  DOCUMENT_EXPIRY: {
    subject: "A document on file is approaching its expiry date",
    sender: "notifications",
    content: {
      heading: "Document expiry reminder",
      badge: { label: "Action may be needed", tone: "warning" },
      paragraphs: ["A document on file for your lease is approaching its expiry date. Please arrange a renewal or replacement where applicable."],
    },
  },
  INSPECTION_DUE: {
    subject: "A property inspection is due",
    sender: "notifications",
    content: {
      heading: "Inspection due",
      paragraphs: ["A property inspection is due. Your property manager will be in touch to arrange a suitable time."],
    },
  },
  MAINTENANCE_FOLLOWUP: {
    subject: "Update on your maintenance request",
    sender: "notifications",
    content: {
      heading: "Maintenance request update",
      badge: { label: "Update available", tone: "neutral" },
      paragraphs: ["There is a follow-up on your maintenance request. Sign in to view the latest status and any notes from the assigned team."],
      cta: { label: "View maintenance request", path: "/maintenance" },
    },
  },
  PAYMENT_RECEIVED: {
    subject: "Payment received",
    sender: "notifications",
    content: {
      heading: "Payment received",
      badge: { label: "Received", tone: "positive" },
      paragraphs: ["A payment has been received and applied to your account. A receipt is available in your account's payment history."],
      cta: { label: "View payment history", path: "/payments" },
    },
  },
  PAYMENT_FAILED: {
    subject: "A payment attempt failed",
    sender: "notifications",
    content: {
      heading: "Payment attempt failed",
      badge: { label: "Action needed", tone: "critical" },
      paragraphs: ["A payment attempt on your account failed to process. Please try again, or contact support if the issue continues."],
      cta: { label: "Review payment", path: "/payments" },
    },
  },
  SUBSCRIPTION_TRIAL_ENDING: {
    subject: "Your subscription trial is ending soon",
    sender: "notifications",
    content: {
      heading: "Your trial is ending soon",
      badge: { label: "Trial ending", tone: "warning" },
      paragraphs: ["Your subscription trial is ending soon. Choose a plan to keep uninterrupted access to your workspace."],
      cta: { label: "Review plans", path: "/settings/billing" },
    },
  },
  SUBSCRIPTION_BILLING_ISSUE: {
    subject: "There is an issue with your subscription billing",
    sender: "notifications",
    content: {
      heading: "Billing issue on your subscription",
      badge: { label: "Action needed", tone: "critical" },
      paragraphs: ["There is an issue with your subscription billing. Please review your billing details to avoid any interruption to your account."],
      cta: { label: "Review billing", path: "/settings/billing" },
    },
  },
  SUBSCRIPTION_ACTIVATED: {
    subject: "Your subscription has been activated",
    sender: "notifications",
    content: {
      heading: "Subscription activated",
      badge: { label: "Active", tone: "positive" },
      paragraphs: ["Your subscription has been activated. You now have full access to your plan's features."],
    },
  },
  SUBSCRIPTION_CHANGED: {
    subject: "Your subscription plan has changed",
    sender: "notifications",
    content: {
      heading: "Subscription plan changed",
      paragraphs: ["Your subscription plan has changed. Review your current plan and included capabilities at any time."],
      cta: { label: "View plan", path: "/settings/billing" },
    },
  },
  SUBSCRIPTION_GRACE_PERIOD: {
    subject: "Your subscription is in a billing grace period",
    sender: "notifications",
    content: {
      heading: "Subscription in grace period",
      badge: { label: "Action needed", tone: "warning" },
      paragraphs: ["Your subscription is currently in a billing grace period. Please resolve your billing details to avoid service interruption."],
      cta: { label: "Resolve billing", path: "/settings/billing" },
    },
  },
  SUBSCRIPTION_SUSPENDED: {
    subject: "Your subscription has been suspended",
    sender: "notifications",
    content: {
      heading: "Subscription suspended",
      badge: { label: "Suspended", tone: "critical" },
      paragraphs: ["Your subscription has been suspended. Existing data remains safe, but changes are currently blocked until this is resolved."],
      cta: { label: "Resolve billing", path: "/settings/billing" },
    },
  },
  ENTITLEMENT_LIMIT_APPROACHING: {
    subject: "You are approaching a plan usage limit",
    sender: "notifications",
    content: {
      heading: "Approaching a plan limit",
      badge: { label: "Approaching limit", tone: "warning" },
      paragraphs: ["Your account is approaching a usage limit included in your current plan. Consider reviewing your plan if you expect to need more capacity."],
      cta: { label: "View plan", path: "/settings/billing" },
    },
  },
  ENTITLEMENT_LIMIT_REACHED: {
    subject: "You have reached a plan usage limit",
    sender: "notifications",
    content: {
      heading: "Plan limit reached",
      badge: { label: "Limit reached", tone: "critical" },
      paragraphs: ["Your account has reached a usage limit included in your current plan. Upgrade your plan to continue growing without interruption."],
      cta: { label: "Upgrade plan", path: "/settings/billing" },
    },
  },
};

const DEFAULT_EVENT: ReminderEmailEvent = {
  subject: "You have a new notification",
  sender: "notifications",
  content: { heading: "New notification", paragraphs: ["You have a new notification. Sign in to your account for details."] },
};

export function buildReminderEventEmail(eventType: string): ReminderEmailEvent {
  return EVENTS[eventType] ?? DEFAULT_EVENT;
}
