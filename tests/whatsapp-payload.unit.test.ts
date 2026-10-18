import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWhatsAppEvents } from "@/modules/conversations/channels/whatsapp-payload";
import { WhatsAppChannelAdapter } from "@/modules/conversations/channels/whatsapp";

const envelope = (value: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "111", changes: [{ field: "messages", value: { metadata: { phone_number_id: "999" }, ...value } }] }],
  ...extra,
});
const text = (id: string, body = "hello") => ({ id, from: "233241234567", timestamp: "1760000000", type: "text", text: { body } });

describe("WhatsApp webhook payload parsing", () => {
  it("keeps valid items and skips unrecognised ones instead of failing the batch", () => {
    const events = parseWhatsAppEvents(envelope({
      messages: [text("wamid.1"), { id: "wamid.2", from: "not-a-number", timestamp: "x" }, text("wamid.3", "second")],
      statuses: [{ id: "wamid.out", recipient_id: "233241234567", status: "delivered", timestamp: "1760000001" }, { id: "wamid.odd", status: "deleted" }],
      some_new_meta_field: { anything: true },
    }), "999");
    expect(events.messages.map((message) => message.externalMessageId)).toEqual(["wamid.1", "wamid.3"]);
    expect(events.statuses).toHaveLength(1);
    expect(events.skipped).toBe(2);
  });

  it("ignores other objects and other receiving numbers without throwing", () => {
    expect(parseWhatsAppEvents({ object: "instagram", entry: [] }, "999")).toMatchObject({ messages: [], statuses: [] });
    expect(parseWhatsAppEvents("not json at all", "999").messages).toEqual([]);
    expect(parseWhatsAppEvents(envelope({ metadata: { phone_number_id: "123" }, messages: [text("wamid.1")] }), "999").messages).toEqual([]);
    expect(parseWhatsAppEvents(envelope({ messages: [text("wamid.1")] }), "999", "222").messages).toEqual([]);
  });

  it("marks media and location messages with their kind", () => {
    const events = parseWhatsAppEvents(envelope({ messages: [{ id: "wamid.img", from: "233241234567", timestamp: "1760000000", type: "image", image: { id: "media-1", mime_type: "image/jpeg", caption: "leak under sink" } }] }), "999");
    expect(events.messages[0]).toMatchObject({ body: "leak under sink", providerPayload: { kind: "image", media: { id: "media-1" } } });
  });
});

describe("WhatsApp send outcomes", () => {
  const adapter = new WhatsAppChannelAdapter();
  const request = { organisationId: "o", conversationId: "c", messageId: "m", channel: "WHATSAPP" as const, recipientAddress: "233241234567", fromAddress: null, body: "hi", config: { phoneNumberId: "999" }, lastInboundAt: new Date() };
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const configure = (response: () => Promise<Response>) => {
    vi.stubEnv("WHATSAPP_PROVIDER_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v21.0");
    vi.stubGlobal("fetch", vi.fn(response));
  };

  it("never treats missing configuration or a closed window as retryable", async () => {
    vi.stubEnv("WHATSAPP_PROVIDER_ACCESS_TOKEN", "");
    await expect(adapter.send(request)).resolves.toMatchObject({ status: "FAILED", retryable: false });
    configure(async () => new Response("{}"));
    await expect(adapter.send({ ...request, lastInboundAt: new Date(Date.now() - 25 * 3_600_000) })).resolves.toMatchObject({ status: "FAILED", retryable: false });
  });

  it("separates transient, permanent and unconfirmed provider failures", async () => {
    configure(async () => new Response("{}", { status: 500 }));
    await expect(adapter.send(request)).resolves.toMatchObject({ status: "FAILED", retryable: true });
    configure(async () => new Response("{}", { status: 400 }));
    await expect(adapter.send(request)).resolves.toMatchObject({ status: "FAILED", retryable: false });
    configure(async () => { throw new DOMException("timed out", "TimeoutError"); });
    await expect(adapter.send(request)).resolves.toMatchObject({ status: "FAILED", unconfirmed: true, retryable: false });
    configure(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.ok" }] })));
    await expect(adapter.send(request)).resolves.toMatchObject({ status: "SENT", providerReference: "wamid.ok" });
  });
});
