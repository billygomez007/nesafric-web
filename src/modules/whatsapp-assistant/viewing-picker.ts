import type { WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";

/**
 * Choosing a viewing time with two WhatsApp lists (the pop-up WhatsApp offers outside Flows): a day
 * in the next week, then an hourly slot that day. Ghana is on GMT all year, so a Ghana date and
 * time is the same as UTC here. Typing a time ("tomorrow 3pm") still works at either step.
 */

const DAY_MS = 24 * 60 * 60_000;
const FIRST_SLOT = 8;
const LAST_SLOT = 17;
/** A slot must start at least this long from now. */
const NOTICE_MS = 60 * 60_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayLabel = (date: Date) => `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH[date.getUTCMonth()]}`;
const slotLabel = (hour: number) => `${hour % 12 || 12}:00 ${hour < 12 ? "am" : "pm"}`;

/** The hourly slots still bookable on a day (YYYY-MM-DD). */
export function openSlots(day: string, now = new Date()) {
  const slots: Date[] = [];
  for (let hour = FIRST_SLOT; hour <= LAST_SLOT; hour += 1) {
    const at = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00.000Z`);
    if (at.getTime() - now.getTime() >= NOTICE_MS) slots.push(at);
  }
  return slots;
}

/** Days that still have a slot: today (if any slot is left) and the next days, up to 7 in all. */
export function openDays(now = new Date()) {
  const days: string[] = [];
  for (let offset = 0; days.length < 7 && offset < 8; offset += 1) {
    const day = isoDay(new Date(now.getTime() + offset * DAY_MS));
    if (openSlots(day, now).length) days.push(day);
  }
  return days;
}

export const DAY_PROMPT = "When would you like to view it? Tap \"Choose a day\" below, or type a date and time such as tomorrow 2pm or 20/12 14:00 (Ghana time).";

export function dayPicker(now = new Date()): { reply: string; interactive: WhatsAppInteractive } {
  const today = isoDay(now);
  const tomorrow = isoDay(new Date(now.getTime() + DAY_MS));
  const rows = openDays(now).map((day) => {
    const date = new Date(`${day}T12:00:00.000Z`);
    const prefix = day === today ? "Today, " : day === tomorrow ? "Tomorrow, " : "";
    return { id: `day ${day}`, title: `${prefix}${dayLabel(date)}` };
  });
  return {
    reply: `${DAY_PROMPT}\n${rows.map((row) => `• ${row.title}`).join("\n")}`,
    interactive: { type: "list", body: DAY_PROMPT, button: "Choose a day", sections: [{ title: "Next 7 days", rows: [...rows, { id: "other date", title: "Another date", description: "Type the date and time yourself" }] }] },
  };
}

export function timePicker(day: string, now = new Date()): { reply: string; interactive: WhatsAppInteractive } | null {
  const slots = openSlots(day, now);
  if (!slots.length) return null;
  const label = dayLabel(new Date(`${day}T12:00:00.000Z`));
  const body = `What time on ${label}? Tap "Choose a time" below, or type one such as 3:30pm. The agent confirms the time.`;
  const rows = slots.map((at) => ({ id: `time ${day} ${String(at.getUTCHours()).padStart(2, "0")}:00`, title: slotLabel(at.getUTCHours()) }));
  return {
    reply: `${body}\n${rows.map((row) => `• ${row.title}`).join("\n")}`,
    interactive: { type: "list", body, button: "Choose a time", sections: [{ title: label, rows }] },
  };
}

const DAY_ANSWER = /^day (\d{4}-\d{2}-\d{2})$/;
const TIME_ANSWER = /^time (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/;
/** A typed time on the chosen day: "3pm", "3:30 pm", "15:30". */
const CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/;

export type PickerAnswer = { day: string } | { startsAt: Date } | { other: true } | null;

/** Reads a tapped day or slot (or a time typed after choosing a day). Null: not a picker answer. */
export function readPickerAnswer(said: string, chosenDay: string | undefined, now = new Date()): PickerAnswer | "unavailable" {
  const text = said.trim().toLowerCase();
  if (text === "other date" || text === "another date") return { other: true };
  const day = DAY_ANSWER.exec(text);
  if (day) return openDays(now).includes(day[1]) ? { day: day[1] } : "unavailable";
  const time = TIME_ANSWER.exec(text);
  if (time) {
    const at = new Date(`${time[1]}T${time[2]}:${time[3]}:00.000Z`);
    return Number.isFinite(at.getTime()) && openSlots(time[1], now).some((slot) => slot.getTime() === at.getTime()) ? { startsAt: at } : "unavailable";
  }
  const clock = chosenDay ? CLOCK.exec(text) : null;
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? "0");
    if (clock[3] === "pm" && hour < 12) hour += 12;
    if (clock[3] === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return "unavailable";
    const at = new Date(`${chosenDay}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
    return at.getTime() - now.getTime() >= NOTICE_MS ? { startsAt: at } : "unavailable";
  }
  return null;
}
