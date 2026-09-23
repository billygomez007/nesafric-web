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

  it("resolves a CTA path to an absolute NesAfric application URL, never an external origin", () => {
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

  it("renders NesAfric branding and never mentions the retired UmoAfric brand", () => {
    const { html, text } = renderEmail({
      heading: "Test",
      paragraphs: ["Body"],
    });

    expect(html).toContain(BRAND.name);
    expect(text).toContain(BRAND.name);
    expect(html.toLowerCase()).not.toContain("umoafric");
    expect(text.toLowerCase()).not.toContain("umoafric");
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
  it("sends the welcome email from hello@, the branded onboarding sender", () => {
    const welcome = contentFor("WELCOME", "Ama");
    expect(welcome.sender).toBe("hello");
    expect(BRAND.sender[welcome.sender]).toBe("NesAfric <hello@nesafric.com>");
    expect(welcome.subject).toBe("Welcome to NesAfric");
  });

  it("uses hello@ for PropertyOS onboarding while preserving notification senders for the other tracks", () => {
    expect(contentFor("ONBOARDING_COMPLETE_PROPERTYOS", "Ama", "Golden Coast Properties").sender).toBe("hello");
    expect(contentFor("ONBOARDING_COMPLETE_MARKETPLACE", "Ama", "Adjoa Realty").sender).toBe("notifications");
    expect(contentFor("ONBOARDING_COMPLETE_SERVICES", "Ama", "Ama's Plumbing").sender).toBe("notifications");
  });

  it("personalizes onboarding-completion content with the actual workspace name", () => {
    const email = contentFor(
      "ONBOARDING_COMPLETE_PROPERTYOS",
      "Ama",
      "Golden Coast Properties",
    );

    const rendered = renderEmail(email.content);

    expect(email.subject).toBe(
      "Welcome to NesAfric — your property workspace is ready",
    );
    expect(email.content.heading).toBe("Welcome to NesAfric");
    expect(rendered.text).toContain("Golden Coast Properties");
    expect(rendered.html).toContain("Golden Coast Properties");
    expect(email.content.cta).toEqual({
      label: "Open your workspace",
      path: "/dashboard",
    });
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
    expect(contentFor("PROVIDER_VERIFICATION_SUBMITTED", "Kwame").subject).toBe("Verification submitted — NesAfric");
    expect(contentFor("PROVIDER_VERIFICATION_MORE_INFO", "Kwame").subject).toBe("More information is required for your NesAfric verification");
    expect(contentFor("PROVIDER_VERIFICATION_APPROVED", "Kwame").subject).toBe("Your NesAfric service professional profile is verified");
    expect(contentFor("PROVIDER_VERIFICATION_REJECTED", "Kwame").subject).toBe("Update on your NesAfric verification");
  });
});

describe("brand sender identities", () => {
  it("maps every sender to the correct official NesAfric address", () => {
    expect(BRAND.sender.hello).toBe("NesAfric <hello@nesafric.com>");
    expect(BRAND.sender.notifications).toBe("NesAfric <notifications@nesafric.com>");
    expect(BRAND.sender.support).toBe("NesAfric <support@nesafric.com>");
    expect(BRAND.sender.info).toBe("NesAfric <info@nesafric.com>");
  });
});
