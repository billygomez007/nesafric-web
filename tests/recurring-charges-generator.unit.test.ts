import { describe, expect, it } from "vitest";

import {
  enumerateRecurringChargePeriods,
  nextRecurringChargeAnchor,
} from "@/modules/recurring-charges/domain";

function utc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

describe("recurring charge period enumeration", () => {
  it("generates monthly periods through the requested date", () => {
    const periods = enumerateRecurringChargePeriods({
      frequency: "MONTHLY",
      startDate: utc(2026, 1, 1),
      endDate: null,
      throughDate: utc(2026, 3, 31),
    });

    expect(periods).toHaveLength(3);

    expect(
      periods.map((period) => [
        period.periodStart.toISOString().slice(0, 10),
        period.periodEnd.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
    ]);
  });

  it("does not generate beyond the definition end date", () => {
    const periods = enumerateRecurringChargePeriods({
      frequency: "MONTHLY",
      startDate: utc(2026, 1, 1),
      endDate: utc(2026, 2, 28),
      throughDate: utc(2026, 6, 30),
    });

    expect(periods).toHaveLength(2);
  });

  it("returns no periods when throughDate precedes startDate", () => {
    expect(
      enumerateRecurringChargePeriods({
        frequency: "MONTHLY",
        startDate: utc(2026, 5, 1),
        endDate: null,
        throughDate: utc(2026, 4, 30),
      }),
    ).toEqual([]);
  });

  it("generates exactly one one-time period", () => {
    const periods = enumerateRecurringChargePeriods({
      frequency: "ONE_TIME",
      startDate: utc(2026, 9, 15),
      endDate: null,
      throughDate: utc(2026, 12, 31),
    });

    expect(periods).toHaveLength(1);
    expect(periods[0]?.periodStart).toEqual(utc(2026, 9, 15));
    expect(periods[0]?.periodEnd).toEqual(utc(2026, 9, 15));
  });

  it("generates weekly periods", () => {
    const periods = enumerateRecurringChargePeriods({
      frequency: "WEEKLY",
      startDate: utc(2026, 9, 1),
      endDate: null,
      throughDate: utc(2026, 9, 21),
    });

    expect(periods).toHaveLength(3);
  });

  it("generates quarterly periods without duplicates", () => {
    const periods = enumerateRecurringChargePeriods({
      frequency: "QUARTERLY",
      startDate: utc(2026, 1, 1),
      endDate: null,
      throughDate: utc(2026, 9, 30),
    });

    expect(periods).toHaveLength(3);

    const keys = periods.map(
      (period) =>
        `${period.periodStart.toISOString()}:${period.periodEnd.toISOString()}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("generates semi-annual periods", () => {
    const periods = enumerateRecurringChargePeriods({
      frequency: "SEMI_ANNUALLY",
      startDate: utc(2026, 1, 1),
      endDate: null,
      throughDate: utc(2026, 12, 31),
    });

    expect(periods).toHaveLength(2);
  });

  it("generates annual periods", () => {
    const periods = enumerateRecurringChargePeriods({
      frequency: "ANNUALLY",
      startDate: utc(2025, 1, 1),
      endDate: null,
      throughDate: utc(2027, 12, 31),
    });

    expect(periods).toHaveLength(3);
  });

  it("refuses to invent a CUSTOM recurrence schedule", () => {
    expect(() =>
      enumerateRecurringChargePeriods({
        frequency: "CUSTOM",
        startDate: utc(2026, 1, 1),
        endDate: null,
        throughDate: utc(2026, 12, 31),
      }),
    ).toThrow(/explicit scheduling strategy/i);
  });

  it("advances monthly anchors deterministically", () => {
    expect(
      nextRecurringChargeAnchor({
        frequency: "MONTHLY",
        currentAnchor: utc(2026, 4, 1),
      }),
    ).toEqual(utc(2026, 5, 1));
  });

  it("stops a one-time schedule", () => {
    expect(
      nextRecurringChargeAnchor({
        frequency: "ONE_TIME",
        currentAnchor: utc(2026, 4, 1),
      }),
    ).toBeNull();
  });
});
