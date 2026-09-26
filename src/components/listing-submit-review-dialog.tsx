"use client";

import { type FormEvent, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass, fieldLabelClass, textareaClass } from "@/components/ui/field-styles";

export const AUTHORITY_EVIDENCE_OPTIONS = [
  { value: "owner_mandate", label: "Owner mandate", hint: "A signed instruction from the owner to market the property." },
  { value: "listing_authority", label: "Listing authority document", hint: "An agency or brokerage agreement for this listing." },
  { value: "developer_authority", label: "Developer authority", hint: "Authority from the developer to sell or let units." },
  { value: "ownership_reference", label: "Ownership reference", hint: "Your own title, indenture or land registration reference." },
] as const;

/**
 * Asks for the authority evidence NesAfric verifies before a listing can go live, then submits the
 * listing for review in one step. The reference is private — only NesAfric reviewers see it.
 */
export function SubmitForReviewDialog({ listingTitle, hasExistingEvidence, busy, error, onCancel, onSubmit }: {
  listingTitle: string;
  hasExistingEvidence: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (evidence: { type: string; reference: string } | null) => void;
}) {
  const [type, setType] = useState<string>(AUTHORITY_EVIDENCE_OPTIONS[0].value);
  const [reference, setReference] = useState("");
  const hint = AUTHORITY_EVIDENCE_OPTIONS.find((option) => option.value === type)?.hint;
  const trimmed = reference.trim();
  const canSubmit = !busy && (trimmed.length >= 3 || (hasExistingEvidence && trimmed.length === 0));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed ? { type, reference: trimmed } : null);
  }

  return (
    <Dialog
      busy={busy}
      description={
        <>
          NesAfric checks that you&apos;re authorised to market <span className="font-medium text-ink">{listingTitle}</span> before it goes live.
          Tell us which document proves it and where we can find it.
        </>
      }
      footer={
        <>
          <button className={buttonClass("secondary")} disabled={busy} onClick={onCancel} type="button">Cancel</button>
          <button className={buttonClass("primary")} disabled={!canSubmit} form="submit-for-review-form" type="submit">
            {busy ? "Submitting…" : "Submit for review"}
          </button>
        </>
      }
      onClose={onCancel}
      title="Submit for review"
    >
      <form className="grid gap-4" id="submit-for-review-form" onSubmit={submit}>
        <div>
          <label className={fieldLabelClass} htmlFor="evidence-type">Authority evidence</label>
          <select className={controlClass} id="evidence-type" onChange={(event) => setType(event.target.value)} value={type}>
            {AUTHORITY_EVIDENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
        </div>
        <div>
          <label className={fieldLabelClass} htmlFor="evidence-reference">
            Reference {hasExistingEvidence && <span className="font-normal">(optional — your earlier evidence is kept)</span>}
          </label>
          <textarea
            aria-describedby="evidence-reference-help"
            className={textareaClass}
            id="evidence-reference"
            maxLength={1000}
            onChange={(event) => setReference(event.target.value)}
            placeholder="e.g. Mandate dated 12 Sept 2026, signed by the owner — copy held at our East Legon office"
            rows={3}
            value={reference}
          />
          <p className="mt-1.5 text-xs text-muted" id="evidence-reference-help">
            A document number, date and where it&apos;s held. Don&apos;t paste personal ID numbers. Only NesAfric reviewers see this.
          </p>
        </div>
        {error && <p className="rounded-[var(--radius-control)] border border-red-200 bg-danger-tint p-3 text-sm text-danger-ink" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
