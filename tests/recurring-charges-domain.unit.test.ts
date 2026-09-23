import { describe, expect, it } from "vitest";

import {
  calculateRecurringChargePeriod,
  calculateRecurringChargeDueDate,
  calculateRecurringChargeAmount,
  determineChargeObligationStatus,
  validateRecurringChargeDefinition,
} from "../src/modules/recurring-charges/domain";

describe("recurring charges domain", () => {
  describe("definition validation", () => {
    it("accepts a fixed monthly service charge", () => {
      expect(() =>
        validateRecurringChargeDefinition({
          calculationType: "FIXED",
          amountMinor: BigInt("25000"),
          frequency: "MONTHLY",
          customFrequency: null,
          billingMode: "SEPARATE",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: null,
          dueDay: 5,
        }),
      ).not.toThrow();
    });

    it("requires an amount for fixed charges", () => {
      expect(() =>
        validateRecurringChargeDefinition({
          calculationType: "FIXED",
          amountMinor: null,
          frequency: "MONTHLY",
          customFrequency: null,
          billingMode: "SEPARATE",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: null,
          dueDay: 5,
        }),
      ).toThrow();
    });

    it("allows variable charges without an amount", () => {
      expect(() =>
        validateRecurringChargeDefinition({
          calculationType: "VARIABLE",
          amountMinor: null,
          frequency: "MONTHLY",
          customFrequency: null,
          billingMode: "SEPARATE",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: null,
          dueDay: 10,
        }),
      ).not.toThrow();
    });

    it("rejects an invalid monthly due day", () => {
      expect(() =>
        validateRecurringChargeDefinition({
          calculationType: "FIXED",
          amountMinor: BigInt("10000"),
          frequency: "MONTHLY",
          customFrequency: null,
          billingMode: "SEPARATE",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: null,
          dueDay: 32,
        }),
      ).toThrow();
    });

    it("requires customFrequency when frequency is CUSTOM", () => {
      expect(() =>
        validateRecurringChargeDefinition({
          calculationType: "FIXED",
          amountMinor: BigInt("10000"),
          frequency: "CUSTOM",
          customFrequency: null,
          billingMode: "SEPARATE",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: null,
          dueDay: null,
        }),
      ).toThrow();
    });

    it("rejects an end date before the start date", () => {
      expect(() =>
        validateRecurringChargeDefinition({
          calculationType: "FIXED",
          amountMinor: BigInt("10000"),
          frequency: "MONTHLY",
          customFrequency: null,
          billingMode: "SEPARATE",
          startDate: new Date("2026-10-01T00:00:00.000Z"),
          endDate: new Date("2026-09-01T00:00:00.000Z"),
          dueDay: 5,
        }),
      ).toThrow();
    });
  });

  describe("amount calculation", () => {
    it("returns the configured amount for fixed charges", () => {
      expect(
        calculateRecurringChargeAmount({
          calculationType: "FIXED",
          configuredAmountMinor: BigInt("45000"),
        }),
      ).toBe(BigInt("45000"));
    });

    it("keeps variable charges unfinalised until an amount is supplied", () => {
      expect(
        calculateRecurringChargeAmount({
          calculationType: "VARIABLE",
          configuredAmountMinor: null,
        }),
      ).toBeNull();
    });
  });

  describe("monthly periods", () => {
    it("generates a September monthly period", () => {
      const result = calculateRecurringChargePeriod({
        frequency: "MONTHLY",
        anchorDate: new Date("2026-09-01T00:00:00.000Z"),
      });

      expect(result.periodStart.toISOString().slice(0, 10)).toBe("2026-09-01");
      expect(result.periodEnd.toISOString().slice(0, 10)).toBe("2026-09-30");
    });

    it("handles February correctly", () => {
      const result = calculateRecurringChargePeriod({
        frequency: "MONTHLY",
        anchorDate: new Date("2027-02-01T00:00:00.000Z"),
      });

      expect(result.periodStart.toISOString().slice(0, 10)).toBe("2027-02-01");
      expect(result.periodEnd.toISOString().slice(0, 10)).toBe("2027-02-28");
    });

    it("handles leap-year February correctly", () => {
      const result = calculateRecurringChargePeriod({
        frequency: "MONTHLY",
        anchorDate: new Date("2028-02-01T00:00:00.000Z"),
      });

      expect(result.periodEnd.toISOString().slice(0, 10)).toBe("2028-02-29");
    });
  });

  describe("due dates", () => {
    it("uses the configured monthly due day", () => {
      const due = calculateRecurringChargeDueDate({
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-30T00:00:00.000Z"),
        dueDay: 5,
      });

      expect(due.toISOString().slice(0, 10)).toBe("2026-09-05");
    });

    it("clamps due day to the last day of a short month", () => {
      const due = calculateRecurringChargeDueDate({
        periodStart: new Date("2027-02-01T00:00:00.000Z"),
        periodEnd: new Date("2027-02-28T00:00:00.000Z"),
        dueDay: 31,
      });

      expect(due.toISOString().slice(0, 10)).toBe("2027-02-28");
    });
  });

  describe("obligation status", () => {
    it("keeps variable charges as DRAFT until finalised", () => {
      expect(
        determineChargeObligationStatus({
          amountMinor: null,
          finalisedAt: null,
          dueDate: new Date("2026-09-10T00:00:00.000Z"),
          now: new Date("2026-09-01T00:00:00.000Z"),
          collectedAmountMinor: BigInt("0"),
          waivedAmountMinor: BigInt("0"),
        }),
      ).toBe("DRAFT");
    });

    it("returns UPCOMING before the due date", () => {
      expect(
        determineChargeObligationStatus({
          amountMinor: BigInt("10000"),
          finalisedAt: new Date("2026-09-01T00:00:00.000Z"),
          dueDate: new Date("2026-09-10T00:00:00.000Z"),
          now: new Date("2026-09-05T00:00:00.000Z"),
          collectedAmountMinor: BigInt("0"),
          waivedAmountMinor: BigInt("0"),
        }),
      ).toBe("UPCOMING");
    });

    it("returns DUE on the due date", () => {
      expect(
        determineChargeObligationStatus({
          amountMinor: BigInt("10000"),
          finalisedAt: new Date("2026-09-01T00:00:00.000Z"),
          dueDate: new Date("2026-09-10T00:00:00.000Z"),
          now: new Date("2026-09-10T12:00:00.000Z"),
          collectedAmountMinor: BigInt("0"),
          waivedAmountMinor: BigInt("0"),
        }),
      ).toBe("DUE");
    });

    it("returns OVERDUE after the due date", () => {
      expect(
        determineChargeObligationStatus({
          amountMinor: BigInt("10000"),
          finalisedAt: new Date("2026-09-01T00:00:00.000Z"),
          dueDate: new Date("2026-09-10T00:00:00.000Z"),
          now: new Date("2026-09-11T00:00:00.000Z"),
          collectedAmountMinor: BigInt("0"),
          waivedAmountMinor: BigInt("0"),
        }),
      ).toBe("OVERDUE");
    });

    it("returns SATISFIED when collected plus waived covers the obligation", () => {
      expect(
        determineChargeObligationStatus({
          amountMinor: BigInt("10000"),
          finalisedAt: new Date("2026-09-01T00:00:00.000Z"),
          dueDate: new Date("2026-09-10T00:00:00.000Z"),
          now: new Date("2026-09-11T00:00:00.000Z"),
          collectedAmountMinor: BigInt("8000"),
          waivedAmountMinor: BigInt("2000"),
        }),
      ).toBe("SATISFIED");
    });
  });
});
