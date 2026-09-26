/**
 * Coded product fragments for marketing pages — small, honest slices of NesAfric drawn in the
 * product's own visual language (address-first records, hairline ledger rows, tabular money).
 *
 * They replace image mockups. Every fragment is labelled "Illustrative example" on the page: the
 * places are real Accra/Tema neighbourhoods, the records are not real customers or listings.
 */
import type { ReactNode } from "react";

function FragmentFrame({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-[var(--radius-panel)] border border-white/10 bg-white text-ink">
      <div className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 py-3.5">
        <p className="font-display text-sm font-semibold text-forest-deep">{title}</p>
        <p className="text-xs text-muted">{meta}</p>
      </div>
      {children}
      <figcaption className="border-t border-hairline bg-warm-white px-5 py-2 text-[11px] text-slate-500">Illustrative example</figcaption>
    </figure>
  );
}

const RENT_ROWS: Array<{ unit: string; detail: string; rent: number; state: "paid" | "due" | "overdue" | "vacant"; note: string }> = [
  { unit: "B1", detail: "2 bed", rent: 6500, state: "paid", note: "Paid 1 Sep" },
  { unit: "B2", detail: "2 bed", rent: 6500, state: "paid", note: "Paid 3 Sep" },
  { unit: "B3", detail: "3 bed", rent: 7200, state: "due", note: "Due 30 Sep" },
  { unit: "B4", detail: "2 bed", rent: 6500, state: "paid", note: "Paid 2 Sep" },
  { unit: "B5", detail: "1 bed", rent: 5800, state: "overdue", note: "12 days overdue" },
  { unit: "B6", detail: "2 bed", rent: 6500, state: "vacant", note: "Vacant · listed" },
];

const STATE_STYLE = {
  paid: "text-success",
  due: "text-ink",
  overdue: "text-danger-ink font-semibold",
  vacant: "text-muted",
} as const;

const cedi = (value: number) => `GH₵${value.toLocaleString("en")}`;

/** Owners/managers: one building's rent position for the month. */
export function RentLedgerFragment() {
  const let_ = RENT_ROWS.filter((row) => row.state !== "vacant");
  const expected = let_.reduce((sum, row) => sum + row.rent, 0);
  const collected = let_.filter((row) => row.state === "paid").reduce((sum, row) => sum + row.rent, 0);

  return (
    <FragmentFrame meta="September rent" title="Ridge House · North Ridge, Accra">
      <table className="w-full text-sm">
        <caption className="sr-only">Rent position by unit for September</caption>
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="px-5 py-2 font-medium" scope="col">Unit</th>
            <th className="py-2 pr-4 text-right font-medium" scope="col">Rent</th>
            <th className="py-2 pr-5 text-right font-medium" scope="col">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline border-t border-hairline">
          {RENT_ROWS.map((row) => (
            <tr key={row.unit}>
              <td className="px-5 py-2.5">
                <span className="font-semibold text-forest-deep">{row.unit}</span>
                <span className="ml-2 text-xs text-muted">{row.detail}</span>
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{cedi(row.rent)}</td>
              <td className={`py-2.5 pr-5 text-right text-xs ${STATE_STYLE[row.state]}`}>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-forest/20 px-5 py-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Collected</span>
          <span className="font-semibold tabular-nums text-forest-deep">
            {cedi(collected)} <span className="font-normal text-muted">of {cedi(expected)}</span>
          </span>
        </div>
        <div aria-hidden="true" className="mt-2 h-1 bg-cream">
          <div className="h-full bg-forest" style={{ width: `${Math.round((collected / expected) * 100)}%` }} />
        </div>
      </div>
    </FragmentFrame>
  );
}

const LEADS: Array<{ property: string; place: string; source: string; stage: string; next: string }> = [
  { property: "3-bed house", place: "East Legon", source: "Marketplace enquiry", stage: "New", next: "Reply within the hour" },
  { property: "2-bed apartment", place: "Airport Residential", source: "Marketplace enquiry", stage: "Viewing booked", next: "Sat 27 Sep · 10:00" },
  { property: "Office floor, 180 m²", place: "Osu", source: "Phone call", stage: "Contacted", next: "Send floor plan" },
  { property: "Plot, 70 × 100 ft", place: "Oyarifa", source: "Referral", stage: "Offer", next: "Confirm documents" },
];

/** Agents/brokers: the lead inbox — every enquiry with its next step. */
export function LeadInboxFragment() {
  return (
    <FragmentFrame meta="This week" title="Leads">
      <ul className="divide-y divide-hairline">
        {LEADS.map((lead) => (
          <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-5 py-3" key={lead.property}>
            <p className="truncate text-sm font-semibold text-forest-deep">
              {lead.property} <span className="font-normal text-muted">· {lead.place}</span>
            </p>
            <p className="text-right text-xs font-semibold text-forest">{lead.stage}</p>
            <p className="truncate text-xs text-muted">{lead.source}</p>
            <p className="text-right text-xs text-ink">{lead.next}</p>
          </li>
        ))}
      </ul>
    </FragmentFrame>
  );
}

type UnitState = "sold" | "reserved" | "available";
const FLOORS: Array<{ floor: string; units: UnitState[] }> = [
  { floor: "5", units: ["available", "available", "reserved", "available"] },
  { floor: "4", units: ["sold", "available", "reserved", "available"] },
  { floor: "3", units: ["sold", "sold", "available", "reserved"] },
  { floor: "2", units: ["sold", "sold", "sold", "available"] },
  { floor: "1", units: ["sold", "sold", "sold", "sold"] },
];
const UNIT_STYLE: Record<UnitState, string> = {
  sold: "bg-forest text-white",
  reserved: "bg-gold-light text-forest-deep",
  available: "border border-forest/25 bg-white text-forest",
};
const UNIT_LABEL: Record<UnitState, string> = { sold: "Sold", reserved: "Reserved", available: "Available" };

/** Developers: unit inventory by floor — the view a sales team actually works from. */
export function DevelopmentInventoryFragment() {
  const counts = FLOORS.flatMap((floor) => floor.units).reduce<Record<UnitState, number>>(
    (acc, state) => ({ ...acc, [state]: acc[state] + 1 }),
    { sold: 0, reserved: 0, available: 0 },
  );

  return (
    <FragmentFrame meta="Block A · 20 apartments" title="The Palms · Community 25, Tema">
      <div className="px-5 py-4">
        <div className="grid gap-1.5" role="list">
          {FLOORS.map((floor) => (
            <div className="grid grid-cols-[28px_repeat(4,minmax(0,1fr))] items-center gap-1.5" key={floor.floor} role="listitem">
              <span className="text-xs tabular-nums text-muted">L{floor.floor}</span>
              {floor.units.map((state, index) => (
                <span
                  className={`flex h-8 items-center justify-center rounded-[3px] text-[11px] font-medium ${UNIT_STYLE[state]}`}
                  key={index}
                >
                  <span aria-hidden="true">{floor.floor}0{index + 1}</span>
                  <span className="sr-only">{`Unit ${floor.floor}0${index + 1}: ${UNIT_LABEL[state]}`}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline pt-3 text-xs">
          {(Object.keys(counts) as UnitState[]).map((state) => (
            <div className="flex items-center gap-1.5" key={state}>
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[2px] ${UNIT_STYLE[state]}`} />
              <dt className="text-muted">{UNIT_LABEL[state]}</dt>
              <dd className="font-semibold tabular-nums text-ink">{counts[state]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </FragmentFrame>
  );
}
