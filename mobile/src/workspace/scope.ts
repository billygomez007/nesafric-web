/**
 * Which workspace an inbox belongs to. Property-management organisations are addressed with the
 * `x-organisation-id` header on the organisation routes; marketplace professional (agent)
 * workspaces through their own `/api/marketplace-professionals/:id/…` routes, which the server
 * scopes to that professional's listings. Either id must come from the server's `/api/workspaces`.
 */
export type InboxScope = { kind: "organisation"; id: string } | { kind: "professional"; id: string };

/** Cache and identity key: never collides between an organisation and a professional. */
export const scopeKey = (scope: InboxScope) => `${scope.kind === "organisation" ? "org" : "pro"}:${scope.id}`;

type Route =
  | { pathname: "/workspace/[organisationId]/inbox"; params: { organisationId: string; tab?: string } }
  | { pathname: "/agent/[professionalId]/inbox"; params: { professionalId: string; tab?: string } }
  | { pathname: "/workspace/[organisationId]/enquiry/[leadId]"; params: { organisationId: string; leadId: string } }
  | { pathname: "/agent/[professionalId]/enquiry/[leadId]"; params: { professionalId: string; leadId: string } }
  | { pathname: "/workspace/[organisationId]/viewing/[viewingId]"; params: { organisationId: string; viewingId: string } }
  | { pathname: "/agent/[professionalId]/viewing/[viewingId]"; params: { professionalId: string; viewingId: string } };

export function inboxRoute(scope: InboxScope, tab?: string): Route {
  return scope.kind === "organisation"
    ? { pathname: "/workspace/[organisationId]/inbox", params: { organisationId: scope.id, tab } }
    : { pathname: "/agent/[professionalId]/inbox", params: { professionalId: scope.id, tab } };
}

export function enquiryRoute(scope: InboxScope, leadId: string): Route {
  return scope.kind === "organisation"
    ? { pathname: "/workspace/[organisationId]/enquiry/[leadId]", params: { organisationId: scope.id, leadId } }
    : { pathname: "/agent/[professionalId]/enquiry/[leadId]", params: { professionalId: scope.id, leadId } };
}

export function viewingRoute(scope: InboxScope, viewingId: string): Route {
  return scope.kind === "organisation"
    ? { pathname: "/workspace/[organisationId]/viewing/[viewingId]", params: { organisationId: scope.id, viewingId } }
    : { pathname: "/agent/[professionalId]/viewing/[viewingId]", params: { professionalId: scope.id, viewingId } };
}

/** Where the same item is managed on the website. */
export function webPath(scope: InboxScope, item: { kind: "enquiry" | "viewing"; id: string }) {
  if (scope.kind === "professional") return `/pro/${scope.id}/leads`;
  return item.kind === "enquiry" ? `/leasing/leads/${item.id}` : `/leasing/viewings/${item.id}`;
}
