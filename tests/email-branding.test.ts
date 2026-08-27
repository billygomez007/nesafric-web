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

  it("resolves a CTA path to an absolute Umo Afric application URL, never an external origin", () => {
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
  it("sends the welcome email from hello@, matching the brand's relationship-communication identity", () => {
    const welcome = contentFor("WELCOME", "Ama");
    expect(welcome.sender).toBe("hello");
    expect(BRAND.sender[welcome.sender]).toBe("Umo Afric <hello@umoafric.com>");
    expect(welcome.subject).toBe("Welcome to Umo Afric");
  });

  it("sends onboarding-completion emails from hello@ too", () => {
    expect(contentFor("ONBOARDING_COMPLETE_PROPERTYOS", "Ama", "Golden Coast Properties").sender).toBe("hello");
    expect(contentFor("ONBOARDING_COMPLETE_MARKETPLACE", "Ama", "Adjoa Realty").sender).toBe("hello");
  });

  it("personalizes onboarding-completion content with the actual workspace name", () => {
    const { content } = contentFor("ONBOARDING_COMPLETE_PROPERTYOS", "Ama", "Golden Coast Properties");
    expect(content.heading).toContain("Golden Coast Properties");
  });
});

describe("brand sender identities", () => {
  it("maps every sender to the correct official Umo Afric address", () => {
    expect(BRAND.sender.hello).toBe("Umo Afric <hello@umoafric.com>");
    expect(BRAND.sender.notifications).toBe("Umo Afric <notifications@umoafric.com>");
    expect(BRAND.sender.support).toBe("Umo Afric <support@umoafric.com>");
    expect(BRAND.sender.info).toBe("Umo Afric <info@umoafric.com>");
  });
});
