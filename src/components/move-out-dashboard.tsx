"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";

type Member = { id: string; user: { displayName: string } };
type LeaseParty = { id: string; isPrimary: boolean; tenantOrganisationId: string; tenantOrganisation: { tenant: { legalName: string; preferredName: string | null } } };
type NoticeHistory = { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string };
type MoveHistory = NoticeHistory;
type Inspection = {
  id: string;
  inspectedAt: string;
  overallCondition: string | null;
  cleaningCondition: string | null;
  notes: string | null;
  tenantAcknowledged: boolean;
  areas: { id: string; name: string; condition: string; notes: string | null }[];
  meterReadings: { id: string; type: string; identifier: string | null; value: string; unit: string; notes: string | null }[];
  inventory: { id: string; category: string; item: string; quantity: number; condition: string; missing: boolean; notes: string | null }[];
};
type KeyHandover = {
  id: string;
  type: string;
  identifier: string | null;
  quantity: number;
  issuedAt: string;
  returnedQuantity: number;
  missingQuantity: number;
  returnNotes: string | null;
  returnedAt: string | null;
};
type Deduction = {
  id: string;
  category: string;
  amountMinor: string;
  currencyCode: string;
  explanation: string;
  evidenceReference: string | null;
  status: string;
  createdAt: string;
  decisionReason: string | null;
  decidedAt: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
};
type LedgerEntry = { id: string; type: string; direction: string; amountMinor: string; currencyCode: string; effectiveAt: string; description: string | null };
type TurnoverTask = { id: string; key: string; label: string; required: boolean; status: string; notes: string | null; completedAt: string | null; maintenanceRequest: { id: string; title: string; status: string } | null };
type Turnover = {
  id: string;
  status: string;
  relistingReady: boolean;
  marketingReadyAt: string | null;
  occupancyReadyAt: string | null;
  completedAt: string | null;
  tasks: TurnoverTask[];
  history: NoticeHistory[];
};
type ComparisonRow<TBefore, TAfter> = { key: string; before: TBefore | null; after: TAfter; differences: string[]; changed: boolean };
type MoveOutData = {
  id: string;
  status: string;
  scheduledDate: string | null;
  actualDate: string | null;
  closedAt: string | null;
  notes: string | null;
  responsibleMemberId: string | null;
  closureRequirements: { inspectionRequired?: boolean; keyReturnRequired?: boolean; settlementRequired?: boolean } | null;
  notice: { id: string; status: string; noticeDate: string; intendedMoveOutDate: string; source: string; reason: string | null; notes: string | null; history: NoticeHistory[] } | null;
  history: MoveHistory[];
  inspections: Inspection[];
  depositSettlement: {
    id: string;
    status: string;
    currencyCode: string;
    depositReceivedMinor: string;
    priorAdjustmentMinor: string;
    outstandingBalanceMinor: string;
    approvedDeductionMinor: string;
    refundAmountMinor: string;
    refundedAmountMinor: string;
    approvalReason: string | null;
    approvedAt: string | null;
    refundReference: string | null;
    refundEvidenceReference: string | null;
    refundRecordedAt: string | null;
    closedAt: string | null;
    deductions: Deduction[];
    ledgerEntries: LedgerEntry[];
  } | null;
  turnover: Turnover | null;
  lease: {
    id: string;
    referenceNumber: string;
    status: string;
    currencyCode: string;
    property: { name: string; referenceNumber: string };
    unit: { name: string; status: string } | null;
    parties: LeaseParty[];
    moveIn: { inspections: Inspection[]; keyHandovers: KeyHandover[] } | null;
  };
  comparison: {
    available: boolean;
    areas: ComparisonRow<{ name: string; condition: string }, { name: string; condition: string }>[];
    inventory: ComparisonRow<{ category: string; item: string; quantity: number; condition: string; missing: boolean }, { category: string; item: string; quantity: number; condition: string; missing: boolean }>[];
    meters: ComparisonRow<{ type: string; identifier: string | null; value: string }, { type: string; identifier: string | null; value: string }>[];
    keys: { type: string; identifier: string | null; issued: number; returned: number; missing: number; changed: boolean }[];
  };
  previousListings: { id: string; title: string; status: string; archivedAt: string | null }[];
  capabilities: { manage: boolean; approveSettlement: boolean; recordRefund: boolean; closeLease: boolean };
};
type LeaseSummary = {
  id: string;
  referenceNumber: string;
  status: string;
  currencyCode: string;
  property: { name: string; referenceNumber: string };
  unit: { name: string; status: string } | null;
  parties: LeaseParty[];
};
type FinalStatement = {
  tenant: { legalName: string; preferredName: string | null };
  lease: { id: string; referenceNumber: string };
  property: { name: string };
  unit: { name: string } | null;
  moveOutDate: string | null;
  currencyCode: string;
  outstandingRentMinor: string;
  depositReceivedMinor: string;
  approvedDeductionMinor: string;
  refundAmountMinor: string;
  refundedAmountMinor: string;
  remainingRefundMinor: string;
  status: string;
  deductions: Deduction[];
};

const turnoverTransitions: Record<string, string[]> = {
  INSPECTION_REQUIRED: ["REPAIRS_REQUIRED", "CLEANING_REQUIRED", "READY_FOR_MARKETING"],
  REPAIRS_REQUIRED: ["CLEANING_REQUIRED", "READY_FOR_MARKETING"],
  CLEANING_REQUIRED: ["READY_FOR_MARKETING"],
  READY_FOR_MARKETING: ["READY_FOR_OCCUPANCY"],
  READY_FOR_OCCUPANCY: ["COMPLETED"],
};

export function MoveOutDashboard({ leaseId }: { leaseId: string }) {
  const [data, setData] = useState<MoveOutData | null>(null);
  const [lease, setLease] = useState<LeaseSummary | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [statement, setStatement] = useState<FinalStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) throw new Error("Choose an organisation.");
    const headers = { "x-organisation-id": organisationId };
    setLoading(true);
    setError("");
    const [moveOutResponse, memberResponse] = await Promise.all([
      fetch(`/api/leases/${leaseId}/move-out`, { headers }),
      fetch("/api/maintenance/assignees", { headers }),
    ]);
    if (memberResponse.ok) setMembers(await memberResponse.json());
    if (moveOutResponse.ok) {
      const moveOutData: MoveOutData = await moveOutResponse.json();
      setData(moveOutData);
      setLease(moveOutData.lease);
      if (moveOutData.depositSettlement) {
        const statementResponse = await fetch(`/api/leases/${leaseId}/move-out/final-statement`, { headers });
        setStatement(statementResponse.ok ? await statementResponse.json() : null);
      } else {
        setStatement(null);
      }
      setLoading(false);
      return;
    }
    const moveOutError = await moveOutResponse.json().catch(() => null);
    if (moveOutResponse.status !== 404) throw new Error(moveOutError?.error?.message ?? "Unable to load move-out record.");
    const leaseResponse = await fetch(`/api/leases/${leaseId}`, { headers });
    if (!leaseResponse.ok) {
      const leaseError = await leaseResponse.json().catch(() => null);
      throw new Error(leaseError?.error?.message ?? "Unable to load move-out record.");
    }
    setData(null);
    setStatement(null);
    setLease(await leaseResponse.json());
    setLoading(false);
  }, [leaseId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load().catch((cause) => {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "Unable to load move-out record.");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function mutate(path: string, method: "POST" | "PATCH", body: unknown, message: string) {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation.");
    setBusy(true);
    setError("");
    setSuccess("");
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setBusy(false);
      return setError((await response.json().catch(() => null))?.error?.message ?? "Unable to update move-out.");
    }
    setSuccess(message);
    await load();
    setBusy(false);
  }

  if (error && !loading && !lease && !data) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (loading || !lease) return <p className="rounded-xl border bg-white p-6 text-slate-500">Loading move-out...</p>;

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-700">MOVE-OUT</p>
            <h1 className="mt-1 text-3xl font-semibold">{lease.referenceNumber}</h1>
            <p className="mt-2 text-slate-500">{lease.property.name}{lease.unit ? ` · ${lease.unit.name}` : ""}</p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Badge value={lease.status} />
            {data && <Badge value={data.status} />}
            {data?.depositSettlement && <Badge value={data.depositSettlement.status} />}
            {data?.turnover && <Badge value={data.turnover.status} />}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href={`/leases/${lease.id}`}>Lease detail</Link>
          <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href={`/leases/${lease.id}/execution`}>Execution & move-in</Link>
        </div>
      </section>

      {(error || success) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{error || success}</p>}

      {!data ? <MoveOutStarter lease={lease} members={members} busy={busy} mutate={mutate} /> : <MoveOutContent data={data} members={members} statement={statement} busy={busy} mutate={mutate} />}
    </div>
  );
}

function MoveOutStarter({
  lease,
  members,
  busy,
  mutate,
}: {
  lease: LeaseSummary;
  members: Member[];
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Lease status" value={lease.status} />
        <SummaryCard label="Unit status" value={lease.unit?.status ?? "NO_UNIT"} />
        <SummaryCard label="Move-out record" value="NOT_STARTED" tone="amber" />
        <SummaryCard label="Tenants" value={`${lease.parties.length}`} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Notice to vacate">
          <p className="text-sm text-slate-500">Create the initial notice. The full move-out dashboard becomes available once scheduling creates the move-out record.</p>
          <NoticeCreateForm lease={lease} busy={busy} mutate={mutate} />
        </Panel>
        <Panel title="Schedule move-out">
          <p className="text-sm text-slate-500">Scheduling starts the move-out workflow even if notice was handled elsewhere.</p>
          <ScheduleForm lease={lease} members={members} busy={busy} mutate={mutate} />
        </Panel>
      </div>
    </>
  );
}

function MoveOutContent({
  data,
  members,
  statement,
  busy,
  mutate,
}: {
  data: MoveOutData;
  members: Member[];
  statement: FinalStatement | null;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  const lease = data.lease;
  const closure = normalizeRequirements(data.closureRequirements);
  const keys = lease.moveIn?.keyHandovers ?? [];
  const inspectionReady = !closure.inspectionRequired || data.inspections.some((inspection) => Boolean(inspection.id));
  const keyReady = !closure.keyReturnRequired || keys.every((key) => key.returnedQuantity + key.missingQuantity === key.quantity);
  const settlementReady = !closure.settlementRequired || data.depositSettlement?.status === "CLOSED";
  const requiredTasks = data.turnover?.tasks.filter((task) => task.required) ?? [];
  const completedRequiredTasks = requiredTasks.filter((task) => task.status === "COMPLETED").length;
  const readyActions = turnoverTransitions[data.turnover?.status ?? ""] ?? [];
  const availability = lease.unit?.status === "AVAILABLE"
    ? "AVAILABLE"
    : data.turnover?.status === "READY_FOR_OCCUPANCY" || data.turnover?.status === "COMPLETED"
      ? "READY_FOR_OCCUPANCY"
      : data.turnover?.status === "READY_FOR_MARKETING"
        ? "READY_FOR_MARKETING"
        : lease.unit?.status ?? "OCCUPIED";

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Notice" value={data.notice?.status ?? "NONE"} tone={data.notice ? "default" : "amber"} />
        <SummaryCard label="Schedule" value={data.scheduledDate ? date(data.scheduledDate) : "PENDING"} />
        <SummaryCard label="Inspection" value={inspectionReady ? "READY" : "REQUIRED"} tone={inspectionReady ? "emerald" : "amber"} />
        <SummaryCard label="Keys" value={keyReady ? "ACCOUNTED" : "OUTSTANDING"} tone={keyReady ? "emerald" : "amber"} />
        <SummaryCard label="Settlement" value={data.depositSettlement?.status ?? "PENDING"} tone={settlementReady ? "emerald" : "amber"} />
        <SummaryCard label="Availability" value={availability} tone={availability === "AVAILABLE" ? "emerald" : "default"} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="grid content-start gap-6">
          <Panel title="Notice and move-out history">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid gap-4">
                {data.notice ? <NoticeCard notice={data.notice} /> : <Empty text="No notice has been recorded." />}
                {!data.notice && <NoticeCreateForm lease={lease} busy={busy} mutate={mutate} />}
                {data.notice?.status === "SUBMITTED" && data.capabilities.manage && <NoticeTransitionForm leaseId={lease.id} busy={busy} mutate={mutate} />}
              </div>
              <Timeline title="Notice history" items={data.notice?.history ?? []} empty="No notice events yet." />
            </div>
            <Timeline title="Move-out history" items={data.history} empty="No move-out events yet." />
          </Panel>

          <Panel title="Schedule and closure requirements">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border p-4 text-sm">
                <p><strong>Scheduled:</strong> {data.scheduledDate ? dateTime(data.scheduledDate) : "Pending"}</p>
                <p className="mt-1"><strong>Responsible:</strong> {memberName(data.responsibleMemberId, members)}</p>
                <p className="mt-1"><strong>Actual move-out:</strong> {data.actualDate ? date(data.actualDate) : "Not closed"}</p>
                {data.notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-slate-700">{data.notes}</p>}
                <ul className="mt-3 grid gap-2 text-slate-600">
                  <li>Inspection required: {yesNo(closure.inspectionRequired)}</li>
                  <li>Key return required: {yesNo(closure.keyReturnRequired)}</li>
                  <li>Settlement required: {yesNo(closure.settlementRequired)}</li>
                </ul>
              </div>
              {data.capabilities.manage ? <ScheduleForm lease={lease} members={members} busy={busy} mutate={mutate} current={data} /> : <Empty text="Only staff with move-out access can edit the schedule." />}
            </div>
          </Panel>

          <Panel title="Inspection">
            {data.inspections.length ? <div className="grid gap-4">{data.inspections.map((inspection) => <InspectionCard inspection={inspection} key={inspection.id} />)}</div> : <Empty text="No move-out inspection recorded yet." />}
            {data.capabilities.manage && <InspectionForm leaseId={lease.id} members={members} busy={busy} mutate={mutate} />}
          </Panel>

          <Panel title="Condition comparison">
            {!data.comparison.available ? <Empty text="A move-in and move-out inspection are both required before comparison is available." /> : <div className="grid gap-4 lg:grid-cols-2"><DiffList title="Areas" rows={data.comparison.areas.map((row) => ({ key: row.key, before: row.before?.condition ?? "—", after: row.after.condition, changed: row.changed }))} /><DiffList title="Inventory" rows={data.comparison.inventory.map((row) => ({ key: row.key, before: `${row.before?.quantity ?? 0} · ${row.before?.condition ?? "—"}${row.before?.missing ? " · missing" : ""}`, after: `${row.after.quantity} · ${row.after.condition}${row.after.missing ? " · missing" : ""}`, changed: row.changed }))} /><DiffList title="Meters" rows={data.comparison.meters.map((row) => ({ key: row.key, before: row.before?.value ?? "—", after: row.after.value, changed: row.changed }))} /><DiffList title="Keys" rows={data.comparison.keys.map((row) => ({ key: `${row.type}${row.identifier ? ` · ${row.identifier}` : ""}`, before: `${row.issued} issued`, after: `${row.returned} returned · ${row.missing} missing`, changed: row.changed }))} /></div>}
          </Panel>

          <Panel title="Keys and access return">
            {keys.length ? <div className="grid gap-4 lg:grid-cols-2">{keys.map((key) => <KeyReturnCard keyItem={key} key={key.id} leaseId={lease.id} busy={busy} mutate={mutate} canManage={data.capabilities.manage} />)}</div> : <Empty text="No move-in keys or access devices were issued." />}
          </Panel>
        </div>

        <aside className="grid content-start gap-6">
          <Panel title="Settlement">
            {data.depositSettlement ? <SettlementPanel leaseId={lease.id} currencyCode={lease.currencyCode} settlement={data.depositSettlement} canManage={data.capabilities.manage} canApprove={data.capabilities.approveSettlement} canRefund={data.capabilities.recordRefund} busy={busy} mutate={mutate} /> : <Empty text="Settlement is created automatically after inspection." />}
          </Panel>

          <Panel title="Final statement">
            {statement ? <FinalStatementCard leaseId={lease.id} statement={statement} /> : <Empty text="Final statement will appear once settlement exists." />}
          </Panel>

          <Panel title="Turnover checklist and readiness">
            {!data.turnover ? <Empty text="Turnover starts after lease close." /> : <>
              <div className="rounded-xl border p-4 text-sm">
                <p><strong>Status:</strong> {humanize(data.turnover.status)}</p>
                <p className="mt-1"><strong>Required tasks:</strong> {completedRequiredTasks}/{requiredTasks.length || 0} complete</p>
                <p className="mt-1"><strong>Relisting ready:</strong> {yesNo(data.turnover.relistingReady)}</p>
                <p className="mt-1"><strong>Marketing ready:</strong> {data.turnover.marketingReadyAt ? dateTime(data.turnover.marketingReadyAt) : "Pending"}</p>
                <p className="mt-1"><strong>Occupancy ready:</strong> {data.turnover.occupancyReadyAt ? dateTime(data.turnover.occupancyReadyAt) : "Pending"}</p>
              </div>
              <div className="grid gap-3">
                {data.turnover.tasks.map((task) => <TurnoverTaskCard key={task.id} task={task} leaseId={lease.id} busy={busy} mutate={mutate} canManage={data.capabilities.manage} />)}
              </div>
              {data.capabilities.manage && <TurnoverTaskForm leaseId={lease.id} busy={busy} mutate={mutate} />}
              {data.capabilities.manage && readyActions.length > 0 && <div className="grid gap-2">{readyActions.map((status) => <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy} key={status} onClick={() => void mutate(`/api/leases/${lease.id}/move-out`, "PATCH", { action: "turnover.transition", status }, `Turnover moved to ${humanize(status)}.`)}>{humanize(status)}</button>)}</div>}
              <Timeline title="Turnover history" items={data.turnover.history} empty="No turnover history yet." compact />
            </>}
          </Panel>

          <Panel title="Availability and closure">
            <div className="rounded-xl border p-4 text-sm">
              <p><strong>Unit status:</strong> {lease.unit?.status ?? "No managed unit"}</p>
              <p className="mt-1"><strong>Availability:</strong> {availability}</p>
              <p className="mt-1"><strong>Ready to close:</strong> {yesNo(inspectionReady && keyReady && settlementReady)}</p>
            </div>
            {data.previousListings.length ? <div className="grid gap-2">{data.previousListings.map((listing) => <div className="rounded-lg border p-3 text-sm" key={listing.id}><p className="font-semibold">{listing.title}</p><p className="text-slate-500">{humanize(listing.status)}{listing.archivedAt ? ` · archived ${date(listing.archivedAt)}` : ""}</p></div>)}</div> : <Empty text="No linked listing history." />}
            {data.capabilities.closeLease && data.status !== "COMPLETED" && <CloseLeaseForm leaseId={lease.id} busy={busy} mutate={mutate} />}
          </Panel>
        </aside>
      </div>
    </>
  );
}

function NoticeCreateForm({
  lease,
  busy,
  mutate,
}: {
  lease: LeaseSummary;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  return <form className="grid gap-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(`/api/leases/${lease.id}/move-out`, "POST", {
      action: "notice.create",
      noticeDate: form.get("noticeDate"),
      intendedMoveOutDate: form.get("intendedMoveOutDate"),
      source: form.get("source"),
      tenantOrganisationId: form.get("tenantOrganisationId") || undefined,
      reason: form.get("reason") || undefined,
      notes: form.get("notes") || undefined,
    }, "Notice recorded.");
  }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <input className="rounded-lg border p-2 text-sm" name="noticeDate" required type="date" />
      <input className="rounded-lg border p-2 text-sm" name="intendedMoveOutDate" required type="date" />
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <select className="rounded-lg border p-2 text-sm" defaultValue="TENANT" name="source">
        <option value="TENANT">Tenant</option>
        <option value="LANDLORD">Landlord</option>
        <option value="PROPERTY_MANAGER">Property manager</option>
      </select>
      <select className="rounded-lg border p-2 text-sm" defaultValue={lease.parties[0]?.tenantOrganisationId ?? ""} name="tenantOrganisationId">
        {lease.parties.map((party) => <option key={party.id} value={party.tenantOrganisationId}>{tenantName(party)}</option>)}
      </select>
    </div>
    <input className="rounded-lg border p-2 text-sm" name="reason" placeholder="Reason" />
    <textarea className="rounded-lg border p-2 text-sm" name="notes" placeholder="Notice notes" rows={3} />
    <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={busy}>Create notice</button>
  </form>;
}

function NoticeTransitionForm({
  leaseId,
  busy,
  mutate,
}: {
  leaseId: string;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  return <form className="grid gap-2 rounded-xl border p-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = String(form.get("status"));
    void mutate(`/api/leases/${leaseId}/move-out`, "PATCH", { action: "notice.transition", status, note: form.get("note") || undefined }, `Notice ${humanize(status)}.`);
  }}>
    <h3 className="font-semibold">Notice action</h3>
    <select className="rounded-lg border p-2 text-sm" name="status"><option value="ACKNOWLEDGED">Acknowledge</option><option value="WITHDRAWN">Withdraw</option></select>
    <input className="rounded-lg border p-2 text-sm" name="note" placeholder="Optional note" />
    <button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Apply</button>
  </form>;
}

function NoticeCard({ notice }: { notice: NonNullable<MoveOutData["notice"]> }) {
  return <div className="rounded-xl border p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Notice to vacate</p><Badge value={notice.status} /></div><p className="mt-2 text-slate-600">{humanize(notice.source)} · notice {date(notice.noticeDate)} · intended move-out {date(notice.intendedMoveOutDate)}</p>{notice.reason && <p className="mt-2"><strong>Reason:</strong> {notice.reason}</p>}{notice.notes && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-slate-700">{notice.notes}</p>}</div>;
}

function ScheduleForm({
  lease,
  members,
  busy,
  mutate,
  current,
}: {
  lease: LeaseSummary;
  members: Member[];
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
  current?: MoveOutData;
}) {
  return <form className="grid gap-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(`/api/leases/${lease.id}/move-out`, "POST", {
      action: "schedule",
      scheduledDate: form.get("scheduledDate"),
      responsibleMemberId: form.get("responsibleMemberId") || undefined,
      notes: form.get("notes") || undefined,
      closureRequirements: {
        inspectionRequired: true,
        keyReturnRequired: true,
        settlementRequired: true,
      },
    }, "Move-out schedule saved.");
  }}>
    <input className="rounded-lg border p-2 text-sm" defaultValue={localDate(current?.scheduledDate)} name="scheduledDate" required type="datetime-local" />
    <select className="rounded-lg border p-2 text-sm" defaultValue={current?.responsibleMemberId ?? ""} name="responsibleMemberId">
      <option value="">Responsible staff</option>
      {members.map((member) => <option key={member.id} value={member.id}>{member.user.displayName}</option>)}
    </select>
    <textarea className="rounded-lg border p-2 text-sm" defaultValue={current?.notes ?? ""} name="notes" placeholder="Schedule notes" rows={3} />
    <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Closure requires a completed inspection, accounted-for keys, and a closed settlement.</p>
    <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={busy}>{current ? "Update schedule" : "Schedule move-out"}</button>
  </form>;
}

function InspectionCard({ inspection }: { inspection: Inspection }) {
  return <div className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Inspection · {dateTime(inspection.inspectedAt)}</p><span className="text-xs font-semibold text-slate-500">{inspection.tenantAcknowledged ? "Tenant acknowledged" : "Unacknowledged"}</span></div><p className="mt-1 text-sm text-slate-500">{inspection.overallCondition || "Condition recorded"}{inspection.cleaningCondition ? ` · Cleaning ${inspection.cleaningCondition}` : ""}</p>{inspection.notes && <p className="mt-3 text-sm text-slate-700">{inspection.notes}</p>}<div className="mt-4 grid gap-3 lg:grid-cols-3"><MiniList title="Areas" items={inspection.areas.map((area) => `${area.name}: ${area.condition}`)} /><MiniList title="Meters" items={inspection.meterReadings.map((reading) => `${reading.type}: ${reading.value} ${reading.unit}`)} /><MiniList title="Inventory" items={inspection.inventory.map((item) => `${item.category} · ${item.item} (${item.condition})${item.missing ? " missing" : ""}`)} /></div></div>;
}

function InspectionForm({
  leaseId,
  members,
  busy,
  mutate,
}: {
  leaseId: string;
  members: Member[];
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  return <form className="mt-4 grid gap-3 border-t pt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const inspectedAt = toIso(String(form.get("inspectedAt")));
    void mutate(`/api/leases/${leaseId}/move-out`, "POST", {
      action: "inspection.create",
      inspectorMemberId: form.get("inspectorMemberId"),
      inspectedAt,
      overallCondition: form.get("overallCondition") || undefined,
      cleaningCondition: form.get("cleaningCondition") || undefined,
      notes: form.get("notes") || undefined,
      tenantAcknowledged: false,
      areas: [{ name: form.get("areaName"), condition: form.get("areaCondition"), notes: form.get("areaNotes") || undefined }],
      meterReadings: form.get("meterType") ? [{ type: form.get("meterType"), identifier: form.get("meterIdentifier") || undefined, value: form.get("meterValue"), unit: form.get("meterUnit"), readAt: inspectedAt, notes: form.get("meterNotes") || undefined }] : [],
      inventory: form.get("inventoryItem") ? [{ category: form.get("inventoryCategory"), item: form.get("inventoryItem"), quantity: Number(form.get("inventoryQuantity")), condition: form.get("inventoryCondition"), missing: form.get("inventoryMissing") === "on", notes: form.get("inventoryNotes") || undefined }] : [],
    }, "Inspection recorded.");
  }}>
    <h3 className="font-semibold">Record inspection</h3>
    <select className="rounded-lg border p-2 text-sm" name="inspectorMemberId" required><option value="">Inspector</option>{members.map((member) => <option key={member.id} value={member.id}>{member.user.displayName}</option>)}</select>
    <input className="rounded-lg border p-2 text-sm" name="inspectedAt" required type="datetime-local" />
    <div className="grid gap-3 sm:grid-cols-2"><input className="rounded-lg border p-2 text-sm" name="overallCondition" placeholder="Overall condition" required /><input className="rounded-lg border p-2 text-sm" name="cleaningCondition" placeholder="Cleaning condition" /></div>
    <textarea className="rounded-lg border p-2 text-sm" name="notes" placeholder="Inspection notes" rows={3} />
    <div className="grid gap-3 sm:grid-cols-2"><input className="rounded-lg border p-2 text-sm" name="areaName" placeholder="Area name" required /><input className="rounded-lg border p-2 text-sm" name="areaCondition" placeholder="Area condition" required /></div>
    <input className="rounded-lg border p-2 text-sm" name="areaNotes" placeholder="Area notes" />
    <div className="grid gap-3 sm:grid-cols-2"><input className="rounded-lg border p-2 text-sm" name="meterType" placeholder="Meter type" /><input className="rounded-lg border p-2 text-sm" name="meterIdentifier" placeholder="Meter identifier" /></div>
    <div className="grid gap-3 sm:grid-cols-3"><input className="rounded-lg border p-2 text-sm" name="meterValue" placeholder="Meter reading" /><input className="rounded-lg border p-2 text-sm" name="meterUnit" placeholder="Unit" /><input className="rounded-lg border p-2 text-sm" name="meterNotes" placeholder="Meter note" /></div>
    <div className="grid gap-3 sm:grid-cols-2"><input className="rounded-lg border p-2 text-sm" name="inventoryCategory" placeholder="Inventory category" /><input className="rounded-lg border p-2 text-sm" name="inventoryItem" placeholder="Inventory item" /></div>
    <div className="grid gap-3 sm:grid-cols-3"><input className="rounded-lg border p-2 text-sm" defaultValue="1" min={1} name="inventoryQuantity" type="number" /><input className="rounded-lg border p-2 text-sm" name="inventoryCondition" placeholder="Inventory condition" /><input className="rounded-lg border p-2 text-sm" name="inventoryNotes" placeholder="Inventory note" /></div>
    <label className="flex gap-2 text-sm"><input name="inventoryMissing" type="checkbox" />Mark inventory as missing</label>
    <button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Save inspection</button>
  </form>;
}

function KeyReturnCard({
  keyItem,
  leaseId,
  busy,
  mutate,
  canManage,
}: {
  keyItem: KeyHandover;
  leaseId: string;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
  canManage: boolean;
}) {
  const complete = keyItem.returnedQuantity + keyItem.missingQuantity === keyItem.quantity;
  return <div className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{keyItem.quantity} × {humanize(keyItem.type)}</p><p className="text-sm text-slate-500">{keyItem.identifier || "No identifier"} · issued {dateTime(keyItem.issuedAt)}</p></div><Badge value={complete ? "ACCOUNTED" : "OUTSTANDING"} /></div><p className="mt-3 text-sm text-slate-600">Returned {keyItem.returnedQuantity} · Missing {keyItem.missingQuantity}</p>{keyItem.returnNotes && <p className="mt-2 text-sm text-slate-700">{keyItem.returnNotes}</p>}{canManage && !complete && <form className="mt-4 grid gap-3 border-t pt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(`/api/leases/${leaseId}/move-out`, "POST", {
      action: "key-return.record",
      keyHandoverId: keyItem.id,
      returnedQuantity: Number(form.get("returnedQuantity")),
      missingQuantity: Number(form.get("missingQuantity")),
      returnedAt: toIso(String(form.get("returnedAt"))),
      notes: form.get("notes") || undefined,
    }, "Key return recorded.");
  }}><div className="grid gap-3 sm:grid-cols-2"><input className="rounded-lg border p-2 text-sm" defaultValue={Math.max(keyItem.quantity - keyItem.missingQuantity, 0)} max={keyItem.quantity} min={0} name="returnedQuantity" required type="number" /><input className="rounded-lg border p-2 text-sm" defaultValue={keyItem.missingQuantity} max={keyItem.quantity} min={0} name="missingQuantity" required type="number" /></div><input className="rounded-lg border p-2 text-sm" name="returnedAt" required type="datetime-local" /><input className="rounded-lg border p-2 text-sm" name="notes" placeholder="Return notes" /><button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Record return</button></form>}</div>;
}

function SettlementPanel({
  leaseId,
  currencyCode,
  settlement,
  canManage,
  canApprove,
  canRefund,
  busy,
  mutate,
}: {
  leaseId: string;
  currencyCode: string;
  settlement: NonNullable<MoveOutData["depositSettlement"]>;
  canManage: boolean;
  canApprove: boolean;
  canRefund: boolean;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  return <div className="grid gap-4 text-sm"><div className="grid gap-3 sm:grid-cols-2"><SummaryCard label="Deposit received" value={money(settlement.depositReceivedMinor, currencyCode)} compact /><SummaryCard label="Approved deductions" value={money(settlement.approvedDeductionMinor, currencyCode)} compact /><SummaryCard label="Outstanding balance" value={money(settlement.outstandingBalanceMinor, currencyCode)} compact /><SummaryCard label="Refund available" value={money(settlement.refundAmountMinor, currencyCode)} compact /></div>{settlement.deductions.length ? <div className="grid gap-3">{settlement.deductions.map((deduction) => <DeductionCard deduction={deduction} key={deduction.id} leaseId={leaseId} busy={busy} mutate={mutate} canApprove={canApprove} />)}</div> : <Empty text="No deductions recorded." />}
    {canManage && <form className="grid gap-3 border-t pt-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void mutate(`/api/leases/${leaseId}/move-out`, "POST", {
        action: "deduction.create",
        category: form.get("category"),
        amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
        currencyCode,
        explanation: form.get("explanation"),
        evidenceReference: form.get("evidenceReference") || undefined,
      }, "Deduction created.");
    }}>
      <h3 className="font-semibold">Add deduction</h3>
      <select className="rounded-lg border p-2 text-sm" name="category"><option value="PROPERTY_DAMAGE">Property damage</option><option value="MISSING_INVENTORY">Missing inventory</option><option value="CLEANING">Cleaning</option><option value="UNPAID_RENT">Unpaid rent</option><option value="UNPAID_APPROVED_CHARGES">Approved charges</option><option value="KEY_REPLACEMENT">Key replacement</option><option value="OTHER">Other</option></select>
      <input className="rounded-lg border p-2 text-sm" min="0" name="amount" placeholder={`Amount (${currencyCode})`} required step="0.01" type="number" />
      <textarea className="rounded-lg border p-2 text-sm" name="explanation" placeholder="Explanation" required rows={3} />
      <input className="rounded-lg border p-2 text-sm" name="evidenceReference" placeholder="Evidence reference" />
      <button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Create deduction</button>
    </form>}
    {canApprove && <form className="grid gap-3 border-t pt-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void mutate(`/api/leases/${leaseId}/move-out`, "POST", { action: "settlement.approve", reason: form.get("reason") }, "Settlement approved.");
    }}><h3 className="font-semibold">Approve settlement</h3><textarea className="rounded-lg border p-2 text-sm" name="reason" placeholder="Approval note" required rows={2} /><button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={busy}>Approve</button></form>}
    {canRefund && <form className="grid gap-3 border-t pt-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void mutate(`/api/leases/${leaseId}/move-out`, "POST", {
        action: "settlement.refund",
        amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
        reference: form.get("reference"),
        idempotencyKey: crypto.randomUUID(),
        evidenceReference: form.get("evidenceReference") || undefined,
        recordedAt: toIso(String(form.get("recordedAt"))),
      }, "Refund recorded.");
    }}><h3 className="font-semibold">Record refund</h3><input className="rounded-lg border p-2 text-sm" min="0" name="amount" placeholder={`Amount (${currencyCode})`} required step="0.01" type="number" /><input className="rounded-lg border p-2 text-sm" name="reference" placeholder="Reference" required /><input className="rounded-lg border p-2 text-sm" name="evidenceReference" placeholder="Evidence reference" /><input className="rounded-lg border p-2 text-sm" name="recordedAt" required type="datetime-local" /><button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Record refund</button></form>}
    {canApprove && <button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy} onClick={() => void mutate(`/api/leases/${leaseId}/move-out`, "POST", { action: "settlement.close" }, "Settlement closed.")}>Close settlement</button>}
    {settlement.ledgerEntries.length ? <MiniList title="Ledger activity" items={settlement.ledgerEntries.map((entry) => `${humanize(entry.type)} · ${entry.direction} · ${money(entry.amountMinor, entry.currencyCode)}`)} /> : null}
  </div>;
}

function DeductionCard({
  deduction,
  leaseId,
  busy,
  mutate,
  canApprove,
}: {
  deduction: Deduction;
  leaseId: string;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
  canApprove: boolean;
}) {
  return <div className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{humanize(deduction.category)}</p><p className="text-sm text-slate-500">{money(deduction.amountMinor, deduction.currencyCode)} · created {date(deduction.createdAt)}</p></div><Badge value={deduction.status} /></div><p className="mt-2 text-sm text-slate-700">{deduction.explanation}</p>{deduction.evidenceReference && <p className="mt-1 text-xs text-slate-500">Evidence: {deduction.evidenceReference}</p>}{deduction.decisionReason && <p className="mt-2 text-xs text-slate-500">Decision: {deduction.decisionReason}</p>}{deduction.reversalReason && <p className="mt-1 text-xs text-slate-500">Reversal: {deduction.reversalReason}</p>}{canApprove && deduction.status === "PENDING" && <form className="mt-4 grid gap-2 border-t pt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = String(form.get("status"));
    void mutate(`/api/leases/${leaseId}/move-out/deductions/${deduction.id}`, "PATCH", { action: "decision", status, reason: form.get("reason") }, `Deduction ${humanize(status)}.`);
  }}><select className="rounded-lg border p-2 text-sm" name="status"><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select><input className="rounded-lg border p-2 text-sm" name="reason" placeholder="Decision reason" required /><button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Save decision</button></form>}{canApprove && deduction.status === "APPROVED" && <form className="mt-4 grid gap-2 border-t pt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(`/api/leases/${leaseId}/move-out/deductions/${deduction.id}`, "PATCH", { action: "reversal", reason: form.get("reason") }, "Deduction reversed.");
  }}><input className="rounded-lg border p-2 text-sm" name="reason" placeholder="Reversal reason" required /><button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Reverse deduction</button></form>}</div>;
}

function FinalStatementCard({ leaseId, statement }: { leaseId: string; statement: FinalStatement }) {
  const [pdfUrl, setPdfUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function downloadPdf() {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/move-out/statement-pdf`, { method: "POST", headers: { "x-organisation-id": organisationId } });
      const body = await response.json();
      if (response.ok) setPdfUrl(body.downloadUrl);
    } finally {
      setBusy(false);
    }
  }
  return <div className="grid gap-3 text-sm"><div className="rounded-xl border p-4"><p className="font-semibold">{statement.tenant.preferredName || statement.tenant.legalName}</p><p className="text-slate-500">{statement.property.name}{statement.unit ? ` · ${statement.unit.name}` : ""}</p><p className="mt-1 text-slate-500">Status: {humanize(statement.status)}</p><p className="mt-1 text-slate-500">Move-out: {statement.moveOutDate ? date(statement.moveOutDate) : "Pending"}</p></div><div className="grid gap-2 rounded-xl border p-4"><p>Deposit received: <strong>{money(statement.depositReceivedMinor, statement.currencyCode)}</strong></p><p>Approved deductions: <strong>{money(statement.approvedDeductionMinor, statement.currencyCode)}</strong></p><p>Outstanding rent: <strong>{money(statement.outstandingRentMinor, statement.currencyCode)}</strong></p><p>Refund due: <strong>{money(statement.refundAmountMinor, statement.currencyCode)}</strong></p></div>{statement.deductions.length ? <MiniList title="Statement deductions" items={statement.deductions.map((deduction) => `${humanize(deduction.category)} · ${money(deduction.amountMinor, deduction.currencyCode)} · ${humanize(deduction.status)}`)} /> : null}{pdfUrl ? <a className="rounded-lg border px-3 py-2 text-center text-sm font-semibold" href={pdfUrl} rel="noreferrer" target="_blank">Open PDF statement</a> : <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy} onClick={() => void downloadPdf()}>{busy ? "Generating..." : "Get PDF statement"}</button>}</div>;
}

function TurnoverTaskCard({
  task,
  leaseId,
  busy,
  mutate,
  canManage,
}: {
  task: TurnoverTask;
  leaseId: string;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
  canManage: boolean;
}) {
  return <div className="rounded-xl border p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{task.label}{task.required ? " *" : ""}</p><p className="text-slate-500">{task.key}{task.maintenanceRequest ? ` · ${task.maintenanceRequest.title}` : ""}</p></div><Badge value={task.status} /></div>{task.notes && <p className="mt-2 text-slate-700">{task.notes}</p>}{canManage && <form className="mt-4 grid gap-2 border-t pt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(`/api/leases/${leaseId}/move-out`, "PATCH", { action: "turnover.task.update", taskId: task.id, status: form.get("status"), notes: form.get("notes") || undefined }, "Turnover task updated.");
  }}><select className="rounded-lg border p-2 text-sm" defaultValue={task.status} name="status"><option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select><input className="rounded-lg border p-2 text-sm" defaultValue={task.notes ?? ""} name="notes" placeholder="Task notes" /><button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Save task</button></form>}</div>;
}

function TurnoverTaskForm({
  leaseId,
  busy,
  mutate,
}: {
  leaseId: string;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  return <form className="grid gap-3 border-t pt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(`/api/leases/${leaseId}/move-out`, "POST", {
      action: "turnover.task.create",
      key: form.get("key"),
      label: form.get("label"),
      required: form.get("required") === "on",
      notes: form.get("notes") || undefined,
    }, "Turnover task created.");
  }}><h3 className="font-semibold">Add task</h3><input className="rounded-lg border p-2 text-sm" name="key" placeholder="Task key" required /><input className="rounded-lg border p-2 text-sm" name="label" placeholder="Task label" required /><label className="flex gap-2 text-sm"><input defaultChecked name="required" type="checkbox" />Required for readiness</label><input className="rounded-lg border p-2 text-sm" name="notes" placeholder="Task notes" /><button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={busy}>Add task</button></form>;
}

function CloseLeaseForm({
  leaseId,
  busy,
  mutate,
}: {
  leaseId: string;
  busy: boolean;
  mutate: (path: string, method: "POST" | "PATCH", body: unknown, message: string) => Promise<void>;
}) {
  return <form className="grid gap-3 border-t pt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(`/api/leases/${leaseId}/move-out`, "POST", { action: "lease.close", actualMoveOutDate: form.get("actualMoveOutDate"), note: form.get("note") || undefined }, "Lease closed after move-out.");
  }}><h3 className="font-semibold">Close lease</h3><input className="rounded-lg border p-2 text-sm" name="actualMoveOutDate" required type="date" /><textarea className="rounded-lg border p-2 text-sm" name="note" placeholder="Closure note" rows={2} /><button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={busy}>Close lease</button></form>;
}

function Timeline({ title, items, empty, compact = false }: { title: string; items: NoticeHistory[]; empty: string; compact?: boolean }) {
  return <div><h3 className="font-semibold">{title}</h3>{items.length ? <div className={`mt-3 grid ${compact ? "gap-2" : "gap-3"}`}>{items.map((item) => <div className="rounded-lg border p-3 text-sm" key={item.id}><div className="flex justify-between gap-3"><strong>{item.fromStatus ? `${humanize(item.fromStatus)} → ${humanize(item.toStatus)}` : humanize(item.toStatus)}</strong><span className="text-slate-500">{dateTime(item.createdAt)}</span></div>{item.note && <p className="mt-1 text-slate-700">{item.note}</p>}</div>)}</div> : <Empty text={empty} />}</div>;
}

function DiffList({ title, rows }: { title: string; rows: { key: string; before: string; after: string; changed: boolean }[] }) {
  return <div><h3 className="font-semibold">{title}</h3>{rows.length ? <div className="mt-3 grid gap-2">{rows.map((row) => <div className={`rounded-lg border p-3 text-sm ${row.changed ? "border-amber-300 bg-amber-50" : ""}`} key={row.key}><p className="font-medium">{row.key}</p><p className="text-slate-500">Before: {row.before}</p><p className="text-slate-500">After: {row.after}</p></div>)}</div> : <Empty text={`No ${title.toLowerCase()} differences.`} />}</div>;
}

function SummaryCard({ label, value, tone = "default", compact = false }: { label: string; value: string; tone?: "default" | "emerald" | "amber"; compact?: boolean }) {
  const toneClass = tone === "emerald" ? "bg-emerald-50" : tone === "amber" ? "bg-amber-50" : "bg-white";
  return <div className={`rounded-xl border ${compact ? "p-3" : "p-4"} ${toneClass}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 ${compact ? "text-sm" : "text-base"} font-semibold`}>{value}</p></div>;
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return <div><h3 className="font-semibold">{title}</h3>{items.length ? <ul className="mt-2 grid gap-2 text-sm text-slate-600">{items.map((item, index) => <li className="rounded-lg bg-slate-50 p-2" key={`${title}-${index}`}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-slate-500">None.</p>}</div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">{title}</h2><div className="mt-4 grid gap-4">{children}</div></section>; }
function Badge({ value }: { value: string }) { return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{humanize(value)}</span>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">{text}</p>; }
function normalizeRequirements(value: MoveOutData["closureRequirements"]) { return { inspectionRequired: value?.inspectionRequired ?? true, keyReturnRequired: value?.keyReturnRequired ?? true, settlementRequired: value?.settlementRequired ?? true }; }
function humanize(value: string) { return value.replaceAll("_", " "); }
function date(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value)); }
function dateTime(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function money(value: string, currency: string) { return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value) / 100); }
function yesNo(value: boolean) { return value ? "Yes" : "No"; }
function tenantName(party: LeaseParty) { return party.tenantOrganisation.tenant.preferredName || party.tenantOrganisation.tenant.legalName; }
function memberName(memberId: string | null, members: Member[]) { return members.find((member) => member.id === memberId)?.user.displayName ?? (memberId ? `Member ${memberId.slice(0, 8)}` : "Unassigned"); }
function localDate(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }
function toIso(value: string) { return new Date(value).toISOString(); }
