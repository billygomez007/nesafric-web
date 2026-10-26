import { describe, expect, it } from "vitest";
import { parseWhatsAppEvents } from "@/modules/conversations/channels/whatsapp-payload";
import { metaContentHash, renderTemplate, templateContentHash, templateCreationPayload, templateParameters, validateUtilityTemplate } from "@/modules/whatsapp-templates/format";
import { metaTemplateClient, MetaTemplateApiError } from "@/modules/whatsapp-templates/meta-client";
import { metaTemplateName, UTILITY_TEMPLATES, utilityTemplate, type UtilityTemplate } from "@/modules/whatsapp-templates/registry";
import CATALOGUE from "./fixtures/whatsapp-utility-catalogue.json";

/** Mapped to templates Meta already approved on the NesAfric WABA (exact `nesafric_*` text). */
const ON_META: Record<string, string> = {
  U01: "nesafric_inquiry_received", U02: "nesafric_viewing_confirmed", U03: "nesafric_viewing_reminder", U04: "nesafric_viewing_rescheduled", U05: "nesafric_inquiry_response", U06: "nesafric_viewing_cancelled",
  U10: "nesafric_listing_submitted", U23: "nesafric_maintenance_request_received", U24: "nesafric_maintenance_assigned", U25: "nesafric_maintenance_status_update", U26: "nesafric_maintenance_completed", U31: "nesafric_inquiry_agent_alert",
};
const GROUPS: Array<[string, number, number]> = [
  ["CUSTOMER_ENQUIRIES", 1, 6], ["AGENT_ONBOARDING", 7, 11], ["LANDLORD_ONBOARDING", 12, 16],
  ["TENANT_MANAGEMENT", 17, 22], ["PROPERTY_OPERATIONS", 23, 27], ["ACCOUNT_ACTIVITY", 28, 30],
];
const withBody = (body: string, params = utilityTemplate("U19").params): UtilityTemplate => ({ ...utilityTemplate("U19"), body, params, reviewFlag: undefined });
/** Every catalogue body passes the Meta format checks (none ends with a variable). */
const NEEDS_REVIEW: string[] = [];

describe("Utility template registry", () => {
  it("defines U01-U31 once each, in their six categories, as English Utility templates", () => {
    expect(UTILITY_TEMPLATES.map(({ key }) => key)).toEqual(Array.from({ length: 31 }, (_, index) => `U${String(index + 1).padStart(2, "0")}`));
    expect(new Set(UTILITY_TEMPLATES.map(metaTemplateName)).size).toBe(31);
    for (const [group, from, to] of GROUPS) {
      const expected = Array.from({ length: to - from + 1 }, (_, index) => from + index);
      expect(UTILITY_TEMPLATES.filter((template) => template.group === group).map(({ key }) => Number(key.slice(1)))).toEqual(group === "CUSTOMER_ENQUIRIES" ? [...expected, 31] : expected);
    }
    for (const template of UTILITY_TEMPLATES) {
      expect(template).toMatchObject({ category: "UTILITY", language: "en", version: 1 });
      expect(metaTemplateName(template)).toBe(ON_META[template.key] ?? metaTemplateName(template));
      expect(metaTemplateName(template)).toMatch(ON_META[template.key] ? /^nesafric_[a-z0-9_]+$/ : /^nes_[a-z0-9_]+$/);
      expect(template.buttons ?? []).toEqual([]);
      expect(template.trigger.event).toBeTruthy();
      expect(template.optIn.length).toBeGreaterThan(0);
      if (template.wiring.status === "NOT_WIRED") expect(template.wiring.reason.length).toBeGreaterThan(10);
    }
  });

  it("holds the approved catalogue's names and bodies exactly, except those mapped to Meta's approved text", () => {
    expect(UTILITY_TEMPLATES.filter(({ key }) => !ON_META[key]).map(({ key, name, body }) => ({ key, name, body }))).toEqual(CATALOGUE.filter(({ key }: { key: string }) => !ON_META[key]));
  });

  it.each(UTILITY_TEMPLATES.map((template) => [template.key, template] as const))("%s is FINAL only if it passes Meta's format rules with realistic samples", (_, template) => {
    const { errors, flags } = validateUtilityTemplate(template);
    expect(flags.filter((flag) => /promotional|link|emoji|not realistic/.test(flag))).toEqual([]);
    const parameters = templateParameters(template, Object.fromEntries(template.params.map(({ name, sample }) => [name, sample])));
    expect(renderTemplate(template, parameters)).not.toMatch(/\{\{\d+\}\}/);
    if (NEEDS_REVIEW.includes(template.key)) {
      expect(template.content).toBe("NEEDS_REVIEW");
      expect(errors).toContain("Body must not end with a placeholder.");
      expect(template.reviewFlag).toMatch(/ends with a variable/);
    } else {
      expect(template.content).toBe("FINAL");
      // Meta already approved the mapped ones; the local rules guard new submissions only.
      if (!ON_META[template.key]) expect(errors).toEqual([]);
    }
  });

  it("adds a version suffix to the Meta name from version 2", () => {
    expect(metaTemplateName({ name: "nesafric_enquiry_received", version: 1 })).toBe("nesafric_enquiry_received");
    expect(metaTemplateName({ name: "nesafric_enquiry_received", version: 2 })).toBe("nesafric_enquiry_received_v2");
  });

  it("never puts the tenant access code in the invitation", () => {
    expect(utilityTemplate("U17").params.map(({ name }) => name)).not.toContain("access_code");
    expect(utilityTemplate("U17").params.find(({ name }) => name === "invitation_reference")?.sample).toMatch(/^TI-/);
    expect(utilityTemplate("U21").optIn).toEqual(["TENANT_CONSENT_RECORDED"]);
    expect(utilityTemplate("U17").optIn).toEqual(["TENANT_CONSENT_RECORDED"]);
  });
});

describe("Template format validation", () => {
  it("rejects bodies Meta would reject", () => {
    expect(validateUtilityTemplate(withBody("{{1}} your viewing of {{2}} has moved to {{3}}. Please reply if that does not suit you at all.")).errors).toContain("Body must not start with a placeholder.");
    expect(validateUtilityTemplate(withBody("Hello there, your viewing of the property has moved. Details: {{1}} and {{2}} and finally {{3}}.")).errors).toContain("Body must not end with a placeholder.");
    expect(validateUtilityTemplate(withBody("Hello {{1}}, your viewing of the property has moved to {{2}}{{3}} so please reply to this message.")).errors).toContain("Placeholders must not be next to each other.");
    expect(validateUtilityTemplate(withBody("Hello {{1}}, your viewing of {{3}} has moved to {{2}}. Please reply to this message if it does not suit you.")).errors).toContain("Placeholders must run {{1}}, {{2}}, ... in order, each used once.");
    expect(validateUtilityTemplate(withBody("Hello {{1}}, your viewing has moved. Please reply to this message if it does not suit you.")).errors).toContain("Body has 1 placeholders but 3 parameters are mapped.");
    expect(validateUtilityTemplate(withBody("Hi {{1}} {{2}} at {{3}} ok.")).errors.join(" ")).toMatch(/Too many parameters|next to each other/);
  });

  it("flags promotional wording and unrealistic samples for review", () => {
    expect(validateUtilityTemplate(withBody("Hello {{1}}, get a discount on {{2}} when you book before {{3}}. Reply to this message to claim it today.")).flags.join(" ")).toMatch(/promotional wording \("discount"\)/);
    const unrealistic = utilityTemplate("U19").params.map((param, index) => (index === 0 ? { ...param, sample: "test" } : param));
    expect(validateUtilityTemplate(withBody(utilityTemplate("U19").body, unrealistic)).flags).toContain("Sample for recipient_name is not realistic.");
  });
});

describe("Parameters and payloads", () => {
  const template = utilityTemplate("U09");

  it("substitutes parameters in placeholder order", () => {
    const parameters = templateParameters(template, { required_information: "a readable business registration certificate", business_name: "Golden Key Realty", recipient_name: "Kofi" });
    expect(parameters).toEqual(["Kofi", "Golden Key Realty", "a readable business registration certificate"]);
    expect(renderTemplate(template, parameters)).toBe("Hello Kofi, your verification for Golden Key Realty requires additional information: a readable business registration certificate. Reply to this message to continue the verification process.");
  });

  it("strips links, phone numbers and newlines from typed values and caps their length", () => {
    const [name, title, reason] = templateParameters(template, { recipient_name: "Kwame\nAsante", business_name: "Call 024 123 4567 or visit https://spam.example.com now", required_information: "x".repeat(500) });
    expect(name).toBe("Kwame Asante");
    expect(title).not.toMatch(/024|https|spam/);
    expect(reason).toHaveLength(160);
  });

  it("refuses missing parameters and ignores values a template does not use", () => {
    expect(() => templateParameters(template, { recipient_name: "Kofi", business_name: "Golden Key Realty" })).toThrow(/missing required_information/);
    expect(templateParameters(template, { recipient_name: "Kofi", business_name: "Golden Key Realty", required_information: "a licence", extra: "x" })).toEqual(["Kofi", "Golden Key Realty", "a licence"]);
  });

  it("builds the Meta creation payload: body only, samples, no buttons and no silent recategorisation", () => {
    expect(templateCreationPayload(utilityTemplate("U19"))).toEqual({
      name: "nes_tenant_link_confirmed", language: "en", category: "UTILITY", allow_category_change: false,
      components: [{ type: "BODY", text: utilityTemplate("U19").body, example: { body_text: [["Kojo", "Adenta Court, Unit 4B", "Mensah Properties"]] } }],
    });
  });

  it("hashes content the same way for the registry and Meta, and differently after an edit", () => {
    const registry = utilityTemplate("U19");
    const remote = { name: "nes_tenant_link_confirmed", language: "en", components: [{ type: "BODY", text: registry.body }] };
    expect(metaContentHash(remote)).toBe(templateContentHash(registry));
    expect(metaContentHash({ ...remote, components: [{ type: "BODY", text: `${registry.body} ` }] })).not.toBe(templateContentHash(registry));
  });
});

describe("Meta template API client", () => {
  const env = { WHATSAPP_GRAPH_API_VERSION: "v21.0", WHATSAPP_PROVIDER_ACCESS_TOKEN: "secret-token" };

  it("lists templates across pages with the bearer token", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (url: URL, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      const first = !String(url).includes("after=");
      return Response.json({ data: [{ id: first ? "1" : "2", name: first ? "a" : "b", language: "en", status: "APPROVED", category: "UTILITY" }], paging: first ? { next: "https://graph.facebook.com/v21.0/555/message_templates?after=x" } : {} });
    }) as unknown as typeof fetch;
    const templates = await metaTemplateClient(env, fetchImpl).list("555");
    expect(templates.map(({ name }) => name)).toEqual(["a", "b"]);
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/555/message_templates?fields=id,name,language,status,category,rejected_reason,quality_score,components&limit=100");
    expect(calls.every(({ auth }) => auth === "Bearer secret-token")).toBe(true);
  });

  it("refuses to follow paging links off graph.facebook.com", async () => {
    const fetchImpl = (async () => Response.json({ data: [], paging: { next: "https://evil.example.com/steal" } })) as unknown as typeof fetch;
    await expect(metaTemplateClient(env, fetchImpl).list("555")).rejects.toThrow(/only go to https:\/\/graph.facebook.com/);
  });

  it("creates a template and reports Meta's errors without the token", async () => {
    let body: unknown;
    const ok = (async (_: URL, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return Response.json({ id: "9001", status: "PENDING", category: "UTILITY" }); }) as unknown as typeof fetch;
    const payload = templateCreationPayload(utilityTemplate("U01"));
    await expect(metaTemplateClient(env, ok).create("555", payload)).resolves.toEqual({ id: "9001", status: "PENDING", category: "UTILITY" });
    expect(body).toEqual(payload);
    const rejected = (async () => Response.json({ error: { message: "Invalid parameter", code: 100, error_user_msg: "Template name already exists" } }, { status: 400 })) as unknown as typeof fetch;
    const error = await metaTemplateClient(env, rejected).create("555", payload).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaTemplateApiError);
    expect((error as Error).message).toBe("Meta template API responded 400: Template name already exists");
    expect((error as Error).message).not.toContain("secret-token");
  });

  it("needs a Graph API version and token", async () => {
    await expect(metaTemplateClient({}, fetch).list("555")).rejects.toThrow(/WHATSAPP_GRAPH_API_VERSION/);
    await expect(metaTemplateClient({ WHATSAPP_GRAPH_API_VERSION: "v21.0" }, fetch).list("555")).rejects.toThrow(/ACCESS_TOKEN/);
  });
});

describe("Template webhooks", () => {
  const envelope = (wabaId: string, field: string, value: unknown) => ({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field, value }] }] });

  it("reads status, category and quality updates for the number's WABA", () => {
    const status = parseWhatsAppEvents(envelope("555", "message_template_status_update", { event: "REJECTED", message_template_id: 9001, message_template_name: "nesafric_enquiry_received", message_template_language: "en", reason: "INVALID_FORMAT" }), "999", "555");
    expect(status.templates).toEqual([{ kind: "status", wabaId: "555", metaTemplateId: "9001", name: "nesafric_enquiry_received", language: "en", event: "REJECTED", reason: "INVALID_FORMAT" }]);
    const category = parseWhatsAppEvents(envelope("555", "template_category_update", { message_template_id: "9001", message_template_name: "nesafric_enquiry_received", message_template_language: "en", previous_category: "UTILITY", new_category: "MARKETING" }), "999", "555");
    expect(category.templates[0]).toMatchObject({ kind: "category", newCategory: "MARKETING", previousCategory: "UTILITY" });
    const quality = parseWhatsAppEvents(envelope("555", "message_template_quality_update", { message_template_id: "9001", message_template_name: "nesafric_enquiry_received", message_template_language: "en", new_quality_score: "YELLOW" }), "999", "555");
    expect(quality.templates[0]).toMatchObject({ kind: "quality", newScore: "YELLOW" });
  });

  it("ignores template events for another WABA or when the WABA is unknown, and skips malformed ones", () => {
    const value = { event: "APPROVED", message_template_id: "1", message_template_name: "x", message_template_language: "en" };
    expect(parseWhatsAppEvents(envelope("777", "message_template_status_update", value), "999", "555").templates).toEqual([]);
    expect(parseWhatsAppEvents(envelope("555", "message_template_status_update", value), "999").templates).toEqual([]);
    expect(parseWhatsAppEvents(envelope("555", "message_template_status_update", { event: "APPROVED" }), "999", "555")).toMatchObject({ templates: [], skipped: 1 });
  });
});
