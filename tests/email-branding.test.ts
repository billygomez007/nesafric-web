import { describe, expect, it } from "vitest";
import { renderEmail } from "@/modules/notifications/email-templates/render";
import { buildReminderEventEmail } from "@/modules/notifications/email-templates/events";
import { contentFor } from "@/modules/account-emails/service";
import { BRAND } from "@/platform/brand";

describe("renderEmail escaping", () => {
  it("escapes a script tag in a heading instead of emitting raw HTML", () => {
    const { html } = renderEmail({ heading: "<script>alert(1)</script>", paragraphs: [] });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes user-controlled paragraph text", () => {
    const { html } = renderEmail({ heading: "Test", paragraphs: ['<img src=x onerror="alert(1)">'] });
    expect(html).not.toContain("<img src=x onerror=");
    expect(html).toContain("&lt;img src=x onerror=");
  });

  it("escapes user-controlled detail row labels and values", () => {
    const { html } = renderEmail({ heading: "Test", paragraphs: [], details: [{ label: "<b>x</b>", value: "\"><script>bad()</script>" }] });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<script>bad()</script>");
  });

  it("resolves a CTA path to an absolute UmoAfric application URL, never an external origin", () => {
    const { html } = renderEmail({ heading: "Test", paragraphs: [], cta: { label: "Go", path: "/dashboard" } });
    expect(html).toContain(`href="${BRAND.siteUrl}/dashboard"`);
  });

  it("produces a plain-text alternative that carries the same core content", () => {
    const { text } = renderEmail({ heading: "Rent due soon", paragraphs: ["A rent payment is due."], cta: { label: "Pay now", path: "/payments" } });
    expect(text).toContain("Rent due soon");
    expect(text).toContain("A rent payment is due.");
    expect(text).toContain("Pay now");
    expect(text).toContain(`${BRAND.siteUrl}/payments`);
  });

  it("never mentions the old NesAfric brand", () => {
    const { html, text } = renderEmail({ heading: "Test", paragraphs: ["Body"] });
    expect(html.toLowerCase()).not.toContain("nesafric");
    expect(text.toLowerCase()).not.toContain("nesafric");
    expect(html).toContain(BRAND.name);
  });
});

describe("buildReminderEventEmail", () => {
  it("maps every known ReminderEventType to distinct, branded content", () => {
    const rentDue = buildReminderEventEmail("RENT_DUE");
    const rentOverdue = buildReminderEventEmail("RENT_OVERDUE");
    expect(rentDue.subject).not.toBe(rentOverdue.subject);
    expect(rentDue.sender).toBe("notifications");
  });

  it("falls back to a generic branded notification for an unknown event type", () => {
    const unknown = buildReminderEventEmail("SOME_FUTURE_EVENT_TYPE");
    expect(unknown.subject).toBeTruthy();
    expect(unknown.content.heading).toBeTruthy();
  });
});

describe("account email sender-identity mapping", () => {
  it("sends the welcome email from notifications@, the default automated transactional sender", () => {
    const welcome = contentFor("WELCOME", "Ama");
    expect(welcome.sender).toBe("notifications");
    expect(BRAND.sender[welcome.sender]).toBe("UmoAfric <notifications@umoafric.com>");
    expect(welcome.subject).toBe("Welcome to UmoAfric");
  });

  it("sends onboarding-completion emails from notifications@ too", () => {
    expect(contentFor("ONBOARDING_COMPLETE_PROPERTYOS", "Ama", "Golden Coast Properties").sender).toBe("notifications");
    expect(contentFor("ONBOARDING_COMPLETE_MARKETPLACE", "Ama", "Adjoa Realty").sender).toBe("notifications");
    expect(contentFor("ONBOARDING_COMPLETE_SERVICES", "Ama", "Ama's Plumbing").sender).toBe("notifications");
  });

  it("personalizes onboarding-completion content with the actual workspace name", () => {
    const { content } = contentFor("ONBOARDING_COMPLETE_PROPERTYOS", "Ama", "Golden Coast Properties");
    expect(content.heading).toContain("Golden Coast Properties");
  });
});

describe("service-professional verification emails", () => {
  it("sends every verification-lifecycle email from notifications@", () => {
    for (const template of ["PROVIDER_VERIFICATION_SUBMITTED", "PROVIDER_VERIFICATION_MORE_INFO", "PROVIDER_VERIFICATION_APPROVED", "PROVIDER_VERIFICATION_REJECTED"] as const) {
      expect(contentFor(template, "Kwame", undefined, "provider-1").sender).toBe("notifications");
    }
  });

  it("links the CTA to the specific provider's own profile", () => {
    const { content } = contentFor("PROVIDER_VERIFICATION_APPROVED", "Kwame", undefined, "provider-123");
    expect(content.cta?.path).toBe("/providers/provider-123");
  });

  it("surfaces the reviewer's reason on rejection and more-info outcomes, never inventing one", () => {
    const withReason = contentFor("PROVIDER_VERIFICATION_REJECTED", "Kwame", undefined, "provider-1", "Document image was unreadable.");
    expect(withReason.content.paragraphs.join(" ")).toContain("Document image was unreadable.");
    const withoutReason = contentFor("PROVIDER_VERIFICATION_REJECTED", "Kwame", undefined, "provider-1");
    expect(withoutReason.content.paragraphs.join(" ")).not.toContain("Reason provided:");
  });

  it("uses respectful, neutral subject lines rather than exposing internal review jargon", () => {
    expect(contentFor("PROVIDER_VERIFICATION_SUBMITTED", "Kwame").subject).toBe("Verification submitted — UmoAfric");
    expect(contentFor("PROVIDER_VERIFICATION_MORE_INFO", "Kwame").subject).toBe("More information is required for your UmoAfric verification");
    expect(contentFor("PROVIDER_VERIFICATION_APPROVED", "Kwame").subject).toBe("Your UmoAfric service professional profile is verified");
    expect(contentFor("PROVIDER_VERIFICATION_REJECTED", "Kwame").subject).toBe("Update on your UmoAfric verification");
  });
});

describe("brand sender identities", () => {
  it("maps every sender to the correct official UmoAfric address", () => {
    expect(BRAND.sender.hello).toBe("UmoAfric <hello@umoafric.com>");
    expect(BRAND.sender.notifications).toBe("UmoAfric <notifications@umoafric.com>");
    expect(BRAND.sender.support).toBe("UmoAfric <support@umoafric.com>");
    expect(BRAND.sender.info).toBe("UmoAfric <info@umoafric.com>");
  });
});
