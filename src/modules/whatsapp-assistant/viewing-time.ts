/**
 * Viewing times as shoppers actually type them on WhatsApp. Ghana uses GMT (UTC+0) all year and the
 * assistant treats a time without an offset as Ghana time; see docs/whatsapp-operations.md
 * ("Times are Ghana time (UTC)"). Only an exact date and time is accepted: nothing is guessed from
 * "evening" or "sometime next week", so the shopper always confirms what will be sent.
 */
// Whole words only, so "may" in "maybe" or "mon" in "month" is never a date.
const MONTHS = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "june?", "july?", "aug(?:ust)?", "sep(?:t|tember)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"];
const DAYS = ["sun(?:day)?", "mon(?:day)?", "tue(?:s|sday)?", "wed(?:nesday)?", "thu(?:r|rs|rsday)?", "fri(?:day)?", "sat(?:urday)?"];
const indexIn = (patterns: string[], word: string) => patterns.findIndex((pattern) => new RegExp(`^${pattern}$`).test(word));
// Day first, as written in Ghana: 20/12/2026, 20-12, 20.12.26. A dot needs all three parts, so a
// clock such as 14.00 is never read as a date.
const NUMERIC_DATE = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?\b|\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/i;

function clock(text: string): { hour: number; minute: number } | null {
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0 };
  const twelve = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/);
  if (twelve) {
    const hour = Number(twelve[1]); const minute = Number(twelve[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return { hour: (hour % 12) + (twelve[3] === "pm" ? 12 : 0), minute };
  }
  const match = text.match(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function utc(year: number, month: number, day: number, time: { hour: number; minute: number }) {
  const value = new Date(Date.UTC(year, month, day, time.hour, time.minute));
  // Reject rolled-over dates such as 31 February.
  return value.getUTCMonth() === month && value.getUTCDate() === day ? value : null;
}

function calendarDate(text: string, now: Date): { year: number; month: number; day: number; explicitYear: boolean } | null {
  const today = { year: now.getUTCFullYear(), month: now.getUTCMonth(), day: now.getUTCDate() };
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) - 1, day: Number(iso[3]), explicitYear: true };
  const numeric = text.match(NUMERIC_DATE);
  if (numeric) {
    const [day, month, year] = numeric[1] ? [numeric[1], numeric[2], numeric[3]] : [numeric[4], numeric[5], numeric[6]];
    return { year: year ? (year.length === 2 ? 2000 + Number(year) : Number(year)) : today.year, month: Number(month) - 1, day: Number(day), explicitYear: Boolean(year) };
  }
  const month = `(${MONTHS.join("|")})\\.?`;
  const dayMonth = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}(?:,?\\s+(\\d{4}))?\\b`));
  if (dayMonth) return { year: dayMonth[3] ? Number(dayMonth[3]) : today.year, month: indexIn(MONTHS, dayMonth[2]), day: Number(dayMonth[1]), explicitYear: Boolean(dayMonth[3]) };
  const monthDay = text.match(new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
  if (monthDay) return { year: monthDay[3] ? Number(monthDay[3]) : today.year, month: indexIn(MONTHS, monthDay[1]), day: Number(monthDay[2]), explicitYear: Boolean(monthDay[3]) };
  const offset = (days: number) => {
    const value = new Date(Date.UTC(today.year, today.month, today.day + days));
    return { year: value.getUTCFullYear(), month: value.getUTCMonth(), day: value.getUTCDate(), explicitYear: true };
  };
  // "Saturday next week", "last Saturday" or "the day after tomorrow" name a different day than the
  // bare word; rather than guess, ask for the date. "this Saturday" and "coming Saturday" are the
  // bare word's day.
  if (/\b(?:next|last|previous|past|ago|after|before|weeks?|fortnight)\b/.test(text)) return null;
  if (/\btoday\b/.test(text)) return offset(0);
  if (/\btomorrow\b/.test(text)) return offset(1);
  const weekday = text.match(new RegExp(`\\b(${DAYS.join("|")})\\b`));
  if (weekday) {
    // The coming occurrence; "monday" on a Monday means next week's.
    const ahead = (indexIn(DAYS, weekday[1]) - now.getUTCDay() + 7) % 7 || 7;
    return offset(ahead);
  }
  return null;
}

/** A future viewing start time, or null when the text is not an exact, plausible date and time. */
export function parseViewingTime(body: string, now = new Date()): Date | null {
  const raw = body.trim();
  if (ISO.test(raw)) {
    // JavaScript rolls 31 February over into March; the date as written must exist.
    const [year, month, day] = raw.slice(0, 10).split("-").map(Number);
    if (!utc(year, month - 1, day, { hour: 0, minute: 0 })) return null;
    const value = new Date(raw);
    return Number.isFinite(value.getTime()) && value > now && value.getTime() - now.getTime() <= MAX_AHEAD_MS ? value : null;
  }
  const text = raw.toLowerCase().replace(/\s+/g, " ");
  if (text.length > 80) return null;
  // Strip the date before reading the time so "20.12" or "2026-12-20" is never read as a clock.
  const date = calendarDate(text, now);
  if (!date) return null;
  const rest = text.replace(/\b\d{4}-\d{2}-\d{2}\b/, " ").replace(NUMERIC_DATE, " ");
  const time = clock(rest);
  if (!time) return null;
  let value = utc(date.year, date.month, date.day, time);
  // "20 Dec 2pm" in late December after the slot means next year's.
  // A 29 February with no year that this year lacks is next year's, if that year has one.
  if ((!value || value <= now) && !date.explicitYear) value = utc(date.year + 1, date.month, date.day, time);
  if (!value || value <= now || value.getTime() - now.getTime() > MAX_AHEAD_MS) return null;
  return value;
}

/** "Sat 20 Dec 2026, 2:00 pm GMT" — Ghana time, which is UTC. */
export function formatViewingTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const hour = date.getUTCHours();
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${weekday} ${date.getUTCDate()} ${month} ${date.getUTCFullYear()}, ${hour % 12 || 12}:${minute} ${hour < 12 ? "am" : "pm"} GMT`;
}
