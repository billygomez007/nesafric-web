"use client";

import { useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { LOGO_MIME_TYPES, MAX_LOGO_BYTES } from "@/modules/marketplace-professionals/logo";

// The exact types and size the server's logo upload targets accept (it re-checks the bytes).
const ACCEPTED: readonly string[] = LOGO_MIME_TYPES;
const MAX_BYTES = MAX_LOGO_BYTES;

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Upload, preview, replace and remove a logo. Used by a marketplace company's own profile page, the
 * platform admin, and a service provider's own workspace; only `endpoint` (each with its own
 * server-side authorization) and the wording differ. The endpoint's JSON `{ logoUrl }` is the
 * source of truth — nothing here changes until the server has accepted the change.
 */
export function MarketplaceLogoUploader({
  name,
  logoUrl,
  endpoint,
  canEdit,
  onChange,
  usage = "This logo appears on the public profile, in the directory and, for featured companies, on the NesAfric homepage.",
  emptyTitle = "Add your company logo",
  emptyHint = "A logo helps buyers and tenants recognise the company.",
}: {
  name: string;
  logoUrl: string | null;
  /** POST uploads/replaces, DELETE removes. */
  endpoint: string;
  canEdit: boolean;
  onChange: (logoUrl: string | null) => void;
  /** Where the current logo is shown (read by everyone who sees the preview). */
  usage?: string;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function upload(file: File) {
    setError("");
    setNotice("");
    if (!ACCEPTED.includes(file.type)) { setError("Choose a PNG, JPG, WebP or GIF image."); return; }
    if (file.size > MAX_BYTES) { setError("The logo must be 2 MB or smaller."); return; }
    setBusy("upload");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, dataBase64: await readAsBase64(file) }),
      });
      if (!response.ok) throw new Error(await readError(response, "The logo could not be uploaded."));
      const body = await response.json();
      onChange(body.logoUrl ?? null);
      setNotice(logoUrl ? "Logo replaced." : "Logo uploaded.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The logo could not be uploaded.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setError("");
    setNotice("");
    setBusy("remove");
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response, "The logo could not be removed."));
      onChange(null);
      setConfirmRemove(false);
      setNotice("Logo removed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The logo could not be removed.");
    } finally {
      setBusy(null);
    }
  }

  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "?";

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex h-28 w-40 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-white p-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`${name} logo`} className="max-h-full max-w-full object-contain" src={logoUrl} />
        ) : (
          <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-cream text-xl font-semibold text-forest">{initials}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {logoUrl ? (
          <p className="text-sm text-muted">{usage}</p>
        ) : (
          <>
            <p className="font-semibold text-forest-deep">{canEdit ? emptyTitle : "No logo uploaded"}</p>
            <p className="mt-1 text-sm text-muted">{emptyHint} PNG, JPG, WebP or GIF, up to 2 MB. A square or wide logo on a transparent or white background works best.</p>
          </>
        )}
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input accept={ACCEPTED.join(",")} aria-label={`${name} logo file`} className="sr-only" id={inputId} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} ref={input} type="file" />
            <button className={buttonClass(logoUrl ? "secondary" : "primary", "sm")} disabled={busy !== null} onClick={() => input.current?.click()} type="button">
              {busy === "upload" ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </button>
            {logoUrl && !confirmRemove && (
              <button className={`${buttonClass("tertiary")} text-danger-ink hover:text-danger`} disabled={busy !== null} onClick={() => setConfirmRemove(true)} type="button">Remove logo</button>
            )}
            {confirmRemove && (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink">Remove this logo?</span>
                <button className={buttonClass("danger", "sm")} disabled={busy !== null} onClick={() => void remove()} type="button">{busy === "remove" ? "Removing…" : "Remove"}</button>
                <button className={buttonClass("secondary", "sm")} disabled={busy !== null} onClick={() => setConfirmRemove(false)} type="button">Keep logo</button>
              </span>
            )}
          </div>
        )}
        <div aria-live="polite">
          {notice && <p className="mt-3 text-sm font-medium text-success">{notice}</p>}
        </div>
        {error && <p className="mt-3 border-l-2 border-danger bg-danger-tint px-3 py-2 text-sm text-danger-ink" role="alert">{error}</p>}
      </div>
    </div>
  );
}
