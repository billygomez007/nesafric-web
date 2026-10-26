import { afterEach, describe, expect, it, vi } from "vitest";
import { dayPicker, openDays, openSlots, readPickerAnswer, timePicker } from "@/modules/whatsapp-assistant/viewing-picker";
import { advanceConversation } from "@/modules/whatsapp-assistant/engine";
import { whatsappInteractiveSchema } from "@/modules/conversations/channels/whatsapp-interactive";

const NOW = new Date("2026-10-26T09:20:00Z"); // Monday, 9:20 am in Ghana
const LISTING = "2c7e1b3a-4d5f-4a6b-8c9d-0e1f2a3b4c5d";

describe("viewing day and time lists", () => {
  it("offers the next 7 days with slots, as a valid WhatsApp list with Another date", () => {
    const picker = dayPicker(NOW);
    expect(whatsappInteractiveSchema.safeParse(picker.interactive).success).toBe(true);
    const rows = picker.interactive.type === "list" ? picker.interactive.sections[0].rows : [];
    expect(rows.map(({ id }) => id)).toEqual(["day 2026-10-26", "day 2026-10-27", "day 2026-10-28", "day 2026-10-29", "day 2026-10-30", "day 2026-10-31", "day 2026-11-01", "other date"]);
    expect(rows[0].title).toBe("Today, Mon 26 Oct");
    expect(rows[1].title).toBe("Tomorrow, Tue 27 Oct");
  });

  it("drops today once no slot is an hour away, and past slots from today's list", () => {
    expect(openDays(new Date("2026-10-26T16:30:00Z"))[0]).toBe("2026-10-27");
    expect(openSlots("2026-10-26", NOW).map((at) => at.getUTCHours())).toEqual([11, 12, 13, 14, 15, 16, 17]);
    const times = timePicker("2026-10-27", NOW)!;
    expect(whatsappInteractiveSchema.safeParse(times.interactive).success).toBe(true);
    expect(times.interactive.type === "list" && times.interactive.sections[0].rows.map(({ title }) => title)).toEqual(["8:00 am", "9:00 am", "10:00 am", "11:00 am", "12:00 pm", "1:00 pm", "2:00 pm", "3:00 pm", "4:00 pm", "5:00 pm"]);
    expect(timePicker("2026-10-26", new Date("2026-10-26T17:30:00Z"))).toBeNull();
  });

  it("reads taps and typed times, and refuses stale or invented ones", () => {
    expect(readPickerAnswer("day 2026-10-27", undefined, NOW)).toEqual({ day: "2026-10-27" });
    expect(readPickerAnswer("time 2026-10-27 15:00", "2026-10-27", NOW)).toEqual({ startsAt: new Date("2026-10-27T15:00:00Z") });
    expect(readPickerAnswer("3:30pm", "2026-10-27", NOW)).toEqual({ startsAt: new Date("2026-10-27T15:30:00Z") });
    expect(readPickerAnswer("other date", undefined, NOW)).toEqual({ other: true });
    expect(readPickerAnswer("day 2026-12-25", undefined, NOW)).toBe("unavailable");
    expect(readPickerAnswer("time 2026-10-26 09:00", "2026-10-26", NOW)).toBe("unavailable");
    expect(readPickerAnswer("time 2026-10-27 03:00", "2026-10-27", NOW)).toBe("unavailable");
    expect(readPickerAnswer("tomorrow 2pm", undefined, NOW)).toBeNull();
  });
});

describe("booking a viewing with the lists", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("asks for a day, then a time, then shows a clear review and a well-organised confirmation", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const listing = { id: LISTING, title: "3-bedroom house in Spintex", location: { label: "Spintex, Accra" } };
    const tools = {
      propertyDetails: vi.fn(async () => ({ title: listing.title, description: "", enquiryEnabled: true, url: "u", listing })),
      submitCustomerRequest: vi.fn(async () => ({ listingId: LISTING, leadId: "8a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d", viewingId: "9c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f" })),
      searchProperties: vi.fn(), searchServices: vi.fn(), customerRequestStatus: vi.fn(), propertyTypes: vi.fn(),
    };
    let state: unknown = {};
    const say = async (body: string) => { const result = await advanceConversation({ state, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: `m-${body}`, defaultCountry: "GH", defaultCurrency: "GHS" }, { tools: tools as never, interpret: vi.fn() as never }); state = result.state; return result; };

    await say(`view ${LISTING}`);
    const days = await say("Kwame Mensah");
    expect(days.interactive).toMatchObject({ type: "list", button: "Choose a day" });
    const times = await say("day 2026-10-27");
    expect(times.interactive).toMatchObject({ type: "list", button: "Choose a time", sections: [{ title: "Tue 27 Oct" }] });
    const review = await say("time 2026-10-27 15:00");
    expect(review.reply).toBe("*Please check your viewing request*\n\n🏠 3-bedroom house in Spintex\n📅 Tue 27 Oct 2026\n🕒 3:00 pm (Ghana time)\n👤 Kwame Mensah\n📱 +233241234567 (shared with the agent)\n\nTap Confirm to send it to the agent, or Cancel.");
    expect(review.interactive).toMatchObject({ type: "button", buttons: [{ id: "confirm" }, { id: "cancel" }] });

    const done = await say("confirm");
    expect(tools.submitCustomerRequest).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ startsAt: "2026-10-27T15:00:00.000Z", name: "Kwame Mensah" }) }));
    expect(done.reply).toBe([
      "✅ *Viewing request received*", "",
      "🏠 3-bedroom house in Spintex", "📍 Spintex, Accra", "📅 Tue 27 Oct 2026", "🕒 3:00 pm (Ghana time)", "👤 Kwame Mensah", "🔖 Reference: VW-9C1D2E", "",
      "*What happens next*", "1. We have sent your request to the agent.", "2. The agent will confirm this time or suggest another.", "3. We will notify you here on WhatsApp as soon as they reply.", "",
      "This viewing is not confirmed yet. Reply status at any time to check it.",
    ].join("\n"));
  });

  it("still accepts a typed date and time, and asks again with the day list when it cannot read one", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const tools = { propertyDetails: vi.fn(async () => ({ title: "House", description: "", enquiryEnabled: true, url: "u", listing: null })), submitCustomerRequest: vi.fn(), searchProperties: vi.fn(), searchServices: vi.fn(), customerRequestStatus: vi.fn(), propertyTypes: vi.fn() };
    const state = { workflow: "viewing", step: "time", selectedListingId: LISTING, name: "Ama" };
    const run = (body: string, current: unknown = state) => advanceConversation({ state: current, body, kind: "text", phone: "233241234567", conversationId: "c", messageId: "m", defaultCountry: "GH", defaultCurrency: "GHS" }, { tools: tools as never, interpret: vi.fn() as never });
    expect((await run("tomorrow 2pm")).state).toMatchObject({ step: "confirm", startsAt: "2026-10-27T14:00:00.000Z" });
    const unclear = await run("sometime next week");
    expect(unclear.reply).toContain("I could not read that");
    expect(unclear.interactive).toMatchObject({ type: "list", button: "Choose a day" });
    expect((await run("other date")).reply).toContain("Send a date and time in Ghana time");
  });
});
