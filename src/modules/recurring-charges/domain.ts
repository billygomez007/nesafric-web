type CalculationType = "FIXED" | "VARIABLE";

type Frequency =
  | "ONE_TIME"
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMI_ANNUALLY"
  | "ANNUALLY"
  | "CUSTOM";

type BillingMode = "SEPARATE" | "INCLUDED_IN_RENT";

type ObligationStatus =
  | "DRAFT"
  | "UPCOMING"
  | "DUE"
  | "OVERDUE"
  | "SATISFIED"
  | "WAIVED"
  | "CANCELLED";

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function startOfUtcDay(value: Date) {
  return utcDate(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

function lastDayOfUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function validateRecurringChargeDefinition(input: {
  calculationType: CalculationType;
  amountMinor: bigint | null;
  frequency: Frequency;
  customFrequency: string | null;
  billingMode: BillingMode;
  startDate: Date;
  endDate: Date | null;
  dueDay: number | null;
}) {
  if (input.calculationType === "FIXED") {
    if (input.amountMinor === null || input.amountMinor < BigInt("0")) {
      throw new Error("Fixed recurring charges require a non-negative amount.");
    }
  }

  if (input.amountMinor !== null && input.amountMinor < BigInt("0")) {
    throw new Error("Recurring charge amount cannot be negative.");
  }

  if (
    input.dueDay !== null &&
    (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31)
  ) {
    throw new Error("dueDay must be between 1 and 31.");
  }

  if (input.frequency === "CUSTOM" && !input.customFrequency?.trim()) {
    throw new Error("Custom frequency requires a description.");
  }

  if (
    input.endDate &&
    startOfUtcDay(input.endDate).getTime() <
      startOfUtcDay(input.startDate).getTime()
  ) {
    throw new Error("Recurring charge end date cannot precede start date.");
  }

  return input;
}

export function calculateRecurringChargeAmount(input: {
  calculationType: CalculationType;
  configuredAmountMinor: bigint | null;
}) {
  if (input.calculationType === "VARIABLE") {
    return input.configuredAmountMinor;
  }

  if (input.configuredAmountMinor === null) {
    throw new Error("Fixed recurring charge is missing its configured amount.");
  }

  return input.configuredAmountMinor;
}

export function calculateRecurringChargePeriod(input: {
  frequency: Frequency;
  anchorDate: Date;
}) {
  const anchor = startOfUtcDay(input.anchorDate);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();

  if (input.frequency === "ONE_TIME") {
    return {
      periodStart: anchor,
      periodEnd: anchor,
    };
  }

  if (input.frequency === "WEEKLY") {
    return {
      periodStart: anchor,
      periodEnd: utcDate(year, month, day + 6),
    };
  }

  if (input.frequency === "MONTHLY") {
    return {
      periodStart: utcDate(year, month, 1),
      periodEnd: utcDate(year, month, lastDayOfUtcMonth(year, month)),
    };
  }

  if (input.frequency === "QUARTERLY") {
    const quarterStartMonth = Math.floor(month / 3) * 3;

    return {
      periodStart: utcDate(year, quarterStartMonth, 1),
      periodEnd: utcDate(year, quarterStartMonth + 3, 0),
    };
  }

  if (input.frequency === "SEMI_ANNUALLY") {
    const halfStartMonth = month < 6 ? 0 : 6;

    return {
      periodStart: utcDate(year, halfStartMonth, 1),
      periodEnd: utcDate(year, halfStartMonth + 6, 0),
    };
  }

  if (input.frequency === "ANNUALLY") {
    return {
      periodStart: utcDate(year, 0, 1),
      periodEnd: utcDate(year, 11, 31),
    };
  }

  throw new Error(
    "CUSTOM recurring-charge periods require an explicit scheduling strategy.",
  );
}

export function calculateRecurringChargeDueDate(input: {
  periodStart: Date;
  periodEnd: Date;
  dueDay: number | null;
}) {
  if (input.dueDay === null) {
    return startOfUtcDay(input.periodStart);
  }

  if (
    !Number.isInteger(input.dueDay) ||
    input.dueDay < 1 ||
    input.dueDay > 31
  ) {
    throw new Error("dueDay must be between 1 and 31.");
  }

  const start = startOfUtcDay(input.periodStart);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const maximumDay = lastDayOfUtcMonth(year, month);

  const due = utcDate(year, month, Math.min(input.dueDay, maximumDay));

  const periodEnd = startOfUtcDay(input.periodEnd);

  if (due.getTime() > periodEnd.getTime()) {
    return periodEnd;
  }

  return due;
}

export function determineChargeObligationStatus(input: {
  amountMinor: bigint | null;
  finalisedAt: Date | null;
  dueDate: Date;
  now: Date;
  collectedAmountMinor: bigint;
  waivedAmountMinor: bigint;
}): ObligationStatus {
  if (input.amountMinor === null || input.finalisedAt === null) {
    return "DRAFT";
  }

  const satisfied =
    input.collectedAmountMinor + input.waivedAmountMinor >= input.amountMinor;

  if (satisfied) {
    return "SATISFIED";
  }

  const dueDate = startOfUtcDay(input.dueDate);
  const today = startOfUtcDay(input.now);

  if (today.getTime() < dueDate.getTime()) {
    return "UPCOMING";
  }

  if (today.getTime() === dueDate.getTime()) {
    return "DUE";
  }

  return "OVERDUE";
}

export type RecurringChargePeriod = {
  periodStart: Date;
  periodEnd: Date;
};

function addUtcDaysForChargePeriod(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return startOfUtcDay(result);
}

function addUtcMonthsForChargePeriod(value: Date, months: number) {
  return utcDate(
    value.getUTCFullYear(),
    value.getUTCMonth() + months,
    value.getUTCDate(),
  );
}

function addUtcYearsForChargePeriod(value: Date, years: number) {
  return utcDate(
    value.getUTCFullYear() + years,
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

export function nextRecurringChargeAnchor(input: {
  frequency: Frequency;
  currentAnchor: Date;
}): Date | null {
  const current = startOfUtcDay(input.currentAnchor);

  switch (input.frequency) {
    case "ONE_TIME":
      return null;

    case "WEEKLY":
      return addUtcDaysForChargePeriod(current, 7);

    case "MONTHLY":
      return addUtcMonthsForChargePeriod(current, 1);

    case "QUARTERLY":
      return addUtcMonthsForChargePeriod(current, 3);

    case "SEMI_ANNUALLY":
      return addUtcMonthsForChargePeriod(current, 6);

    case "ANNUALLY":
      return addUtcYearsForChargePeriod(current, 1);

    case "CUSTOM":
      throw new Error(
        "CUSTOM recurring charges require an explicit scheduling strategy.",
      );
  }
}

export function enumerateRecurringChargePeriods(input: {
  frequency: Frequency;
  startDate: Date;
  endDate: Date | null;
  throughDate: Date;
}): RecurringChargePeriod[] {
  const startDate = startOfUtcDay(input.startDate);
  const throughDate = startOfUtcDay(input.throughDate);

  const effectiveEnd =
    input.endDate === null
      ? throughDate
      : new Date(
          Math.min(
            startOfUtcDay(input.endDate).getTime(),
            throughDate.getTime(),
          ),
        );

  if (effectiveEnd.getTime() < startDate.getTime()) {
    return [];
  }

  if (input.frequency === "CUSTOM") {
    throw new Error(
      "CUSTOM recurring charges require an explicit scheduling strategy.",
    );
  }

  const periods: RecurringChargePeriod[] = [];
  let anchor: Date | null = startDate;

  while (anchor && anchor.getTime() <= effectiveEnd.getTime()) {
    const period = calculateRecurringChargePeriod({
      frequency: input.frequency,
      anchorDate: anchor,
    });

    if (
      period.periodEnd.getTime() >= startDate.getTime() &&
      period.periodStart.getTime() <= effectiveEnd.getTime()
    ) {
      periods.push(period);
    }

    anchor = nextRecurringChargeAnchor({
      frequency: input.frequency,
      currentAnchor: anchor,
    });
  }

  const seen = new Set<string>();

  return periods.filter((period) => {
    const key =
      period.periodStart.toISOString() + ":" + period.periodEnd.toISOString();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
