/**
 * Explicit response shapes for marketplace enquiries (leads) and viewing requests.
 *
 * Every lead/viewing HTTP route returns one of these instead of the raw Prisma rows, so internal
 * columns never leave the server by accident: duplicate-submission hashes, owning organisation and
 * user ids, the enquirer's account record, actor ids, activity metadata, application/lease ids,
 * and team members' email addresses are not included in any shape.
 *
 * - `full`  (default): what the website's leasing and marketplace CRM screens use, including the
 *   staff-only private notes the team edits there.
 * - `inbox` (`?view=inbox`): the read-only mobile inbox. No private notes, no internal activity or
 *   status-change notes.
 */
export type LeadView = "full" | "inbox";

export function parseLeadView(value: string | null | undefined): LeadView {
  return value === "inbox" ? "inbox" : "full";
}

type StatusChange = { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: Date };
type PreferredTime = { id: string; startsAt: Date; endsAt: Date; timezone: string };
type ListingRef = { id: string; title: string; listingType: string; status: string };
type AssigneeRef = { id: string; user: { displayName: string } } | null;

const listingRef = (listing: ListingRef) => ({ id: listing.id, title: listing.title, listingType: listing.listingType, status: listing.status });
const assigneeRef = (assignee: AssigneeRef) => (assignee ? { id: assignee.id, user: { displayName: assignee.user.displayName } } : null);
const preferredTime = (time: PreferredTime) => ({ id: time.id, startsAt: time.startsAt, endsAt: time.endsAt, timezone: time.timezone });
const statusChange = (entry: StatusChange, view: LeadView) => ({
  id: entry.id,
  fromStatus: entry.fromStatus,
  toStatus: entry.toStatus,
  ...(view === "full" ? { note: entry.note } : {}),
  createdAt: entry.createdAt,
});

type LeadListRow = {
  id: string;
  listingId: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  createdAt: Date;
  lastActivityAt: Date;
  listing: ListingRef;
  assignee: AssigneeRef;
  viewingRequests: { id: string; status: string; confirmedStartsAt: Date | null; createdAt: Date }[];
  rentalApplications: { id: string; status: string }[];
};

type LeadDetailRow = Omit<LeadListRow, "viewingRequests" | "rentalApplications"> & {
  message: string | null;
  marketingConsent: boolean;
  privateNotes: string | null;
  assigneeMemberId: string | null;
  updatedAt: Date;
  history: StatusChange[];
  activities: { id: string; type: string; note: string | null; createdAt: Date }[];
  viewingRequests: { id: string; status: string; confirmedStartsAt: Date | null; createdAt: Date; preferredTimes: PreferredTime[] }[];
  rentalApplications: { id: string; status: string; submittedAt: Date | null; decisionAt: Date | null }[];
};

/** List rows. The inbox view drops contact details and related records it doesn't list. */
export function leadListItem(lead: LeadListRow, view: LeadView) {
  const base = { id: lead.id, name: lead.name, status: lead.status, createdAt: lead.createdAt, lastActivityAt: lead.lastActivityAt, listing: listingRef(lead.listing) };
  if (view === "inbox") return base;
  return {
    ...base,
    listingId: lead.listingId,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    assignee: assigneeRef(lead.assignee),
    viewingRequests: lead.viewingRequests.map((viewing) => ({ id: viewing.id, status: viewing.status, confirmedStartsAt: viewing.confirmedStartsAt, createdAt: viewing.createdAt })),
    rentalApplications: lead.rentalApplications.map((application) => ({ id: application.id, status: application.status })),
  };
}

export function leadDetail(lead: LeadDetailRow, view: LeadView) {
  const shared = {
    id: lead.id,
    listingId: lead.listingId,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    message: lead.message,
    source: lead.source,
    status: lead.status,
    createdAt: lead.createdAt,
    lastActivityAt: lead.lastActivityAt,
    listing: listingRef(lead.listing),
    assignee: assigneeRef(lead.assignee),
    history: lead.history.map((entry) => statusChange(entry, view)),
    viewingRequests: lead.viewingRequests.map((viewing) => ({
      id: viewing.id,
      status: viewing.status,
      confirmedStartsAt: viewing.confirmedStartsAt,
      createdAt: viewing.createdAt,
      preferredTimes: viewing.preferredTimes.map(preferredTime),
    })),
    rentalApplications: lead.rentalApplications.map((application) => ({ id: application.id, status: application.status, submittedAt: application.submittedAt, decisionAt: application.decisionAt })),
  };
  if (view === "inbox") return shared;
  return {
    ...shared,
    marketingConsent: lead.marketingConsent,
    privateNotes: lead.privateNotes,
    assigneeMemberId: lead.assigneeMemberId,
    updatedAt: lead.updatedAt,
    activities: lead.activities.map((activity) => ({ id: activity.id, type: activity.type, note: activity.note, createdAt: activity.createdAt })),
  };
}

type ViewingListRow = {
  id: string;
  status: string;
  confirmedStartsAt: Date | null;
  confirmedEndsAt: Date | null;
  createdAt: Date;
  listing: ListingRef;
  lead: { id: string; name: string; status: string };
  assignee: AssigneeRef;
  preferredTimes: PreferredTime[];
};

type ViewingDetailRow = ViewingListRow & {
  listingId: string;
  leadId: string;
  requesterNote: string | null;
  privateNotes: string | null;
  outcome: string | null;
  assigneeMemberId: string | null;
  updatedAt: Date;
  lead: { id: string; name: string; email: string | null; phone: string | null; status: string };
  history: StatusChange[];
};

/** Viewing list rows: the same for the website's schedule and the mobile inbox. */
export function viewingListItem(viewing: ViewingListRow) {
  return {
    id: viewing.id,
    status: viewing.status,
    confirmedStartsAt: viewing.confirmedStartsAt,
    confirmedEndsAt: viewing.confirmedEndsAt,
    createdAt: viewing.createdAt,
    listing: listingRef(viewing.listing),
    lead: { id: viewing.lead.id, name: viewing.lead.name, status: viewing.lead.status },
    assignee: assigneeRef(viewing.assignee),
    preferredTimes: viewing.preferredTimes.map(preferredTime),
  };
}

export function viewingDetail(viewing: ViewingDetailRow, view: LeadView) {
  const shared = {
    ...viewingListItem(viewing),
    listingId: viewing.listingId,
    leadId: viewing.leadId,
    requesterNote: viewing.requesterNote,
    outcome: viewing.outcome,
    lead: { id: viewing.lead.id, name: viewing.lead.name, email: viewing.lead.email, phone: viewing.lead.phone, status: viewing.lead.status },
    history: viewing.history.map((entry) => statusChange(entry, view)),
  };
  if (view === "inbox") return shared;
  return { ...shared, privateNotes: viewing.privateNotes, assigneeMemberId: viewing.assigneeMemberId, updatedAt: viewing.updatedAt };
}

export function pageOf<T, R>(page: { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }, shape: (item: T) => R) {
  return { items: page.items.map(shape), pagination: page.pagination };
}
