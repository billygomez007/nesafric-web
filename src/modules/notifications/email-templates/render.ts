import { BRAND, absoluteUrl } from "@/platform/brand";

/**
 * The UmoAfric branded transactional email design system: one base layout plus a small set of
 * reusable content components (heading, paragraphs, detail rows, badge, CTA, support block,
 * footer), rather than hand-rolled HTML per email. Every render produces both an HTML document
 * and a plain-text alternative from the same structured content, so the two can never drift.
 *
 * Security: every piece of caller-supplied text (`heading`, `greeting`, `paragraphs`, detail
 * labels/values) is HTML-escaped before it reaches the template — there is no raw-HTML slot, so
 * user-controlled data (organisation names, tenant names, notes, references) can never inject
 * markup. `cta.url` must be a same-origin application path — `absoluteUrl()` is the only way to
 * produce one, so an email can never link off the UmoAfric domain.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

export type DetailRow = { label: string; value: string };
export type Badge = { label: string; tone: "neutral" | "positive" | "warning" | "critical" };
export type CallToAction = { label: string; path: string };

export type EmailContent = {
  /** Hidden preview text shown by email clients next to the subject line. */
  preheader?: string;
  heading: string;
  greeting?: string;
  paragraphs: string[];
  badge?: Badge;
  details?: DetailRow[];
  cta?: CallToAction;
  /** Overrides the default "Need help? Contact support" block. */
  supportNote?: string;
};

const BADGE_COLORS: Record<Badge["tone"], { bg: string; text: string }> = {
  neutral: { bg: "#f1f5f9", text: "#334155" },
  positive: { bg: "#ecfdf5", text: "#047857" },
  warning: { bg: "#fffbeb", text: "#b45309" },
  critical: { bg: "#fef2f2", text: "#b91c1c" },
};

export function renderEmail(content: EmailContent): { html: string; text: string } {
  return { html: renderHtml(content), text: renderText(content) };
}

function renderHtml(content: EmailContent): string {
  const logoUrl = absoluteUrl(BRAND.logo.onLight);
  const badge = content.badge
    ? `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${BADGE_COLORS[content.badge.tone].bg};color:${BADGE_COLORS[content.badge.tone].text};">${escapeHtml(content.badge.label)}</span>`
    : "";
  const greeting = content.greeting ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0f172a;">${escapeHtml(content.greeting)}</p>` : "";
  const paragraphs = content.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(paragraph)}</p>`)
    .join("");
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-collapse:collapse;">
        ${content.details
          .map(
            (row) =>
              `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;width:40%;">${escapeHtml(row.label)}</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">${escapeHtml(row.value)}</td></tr>`,
          )
          .join("")}
      </table>`
    : "";
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;"><tr><td style="border-radius:8px;background:#020617;">
        <a href="${escapeHtml(absoluteUrl(content.cta.path))}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(content.cta.label)}</a>
      </td></tr></table>`
    : "";
  const supportNote = content.supportNote ?? `Need help? Reply to this email or contact us at ${BRAND.contact.support}.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(content.heading)}</title>
${content.preheader ? `<meta name="description" content="${escapeHtml(content.preheader)}" />` : ""}
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${content.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#020617;padding:28px 32px;">
<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(BRAND.name)}" height="28" style="display:block;height:28px;width:auto;" />
</td></tr>
<tr><td style="padding:36px 32px 8px;">
<h1 style="margin:0 0 20px;font-size:21px;line-height:1.35;color:#020617;font-weight:700;">${escapeHtml(content.heading)}</h1>
${badge ? `<div style="margin:0 0 16px;">${badge}</div>` : ""}
${greeting}
${paragraphs}
${details}
${cta}
<p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(supportNote)}</p>
</td></tr>
<tr><td style="padding:24px 32px 32px;border-top:1px solid #e2e8f0;">
<p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#0f172a;">${escapeHtml(BRAND.name)}</p>
<p style="margin:0 0 2px;font-size:12px;color:#94a3b8;">${escapeHtml(BRAND.contact.address)}</p>
<p style="margin:0 0 2px;font-size:12px;color:#94a3b8;"><a href="mailto:${escapeHtml(BRAND.contact.support)}" style="color:#94a3b8;">${escapeHtml(BRAND.contact.support)}</a> · <a href="https://${escapeHtml(BRAND.domain)}" style="color:#94a3b8;">${escapeHtml(BRAND.domain)}</a></p>
<p style="margin:12px 0 0;font-size:11px;color:#cbd5e1;">You received this email because of activity on your ${escapeHtml(BRAND.name)} account. If this wasn't you, please contact ${escapeHtml(BRAND.contact.support)}.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText(content: EmailContent): string {
  const lines: string[] = [BRAND.name, "", content.heading, ""];
  if (content.badge) lines.push(`[${content.badge.label}]`, "");
  if (content.greeting) lines.push(content.greeting, "");
  for (const paragraph of content.paragraphs) lines.push(paragraph, "");
  if (content.details?.length) {
    for (const row of content.details) lines.push(`${row.label}: ${row.value}`);
    lines.push("");
  }
  if (content.cta) lines.push(`${content.cta.label}: ${absoluteUrl(content.cta.path)}`, "");
  lines.push(content.supportNote ?? `Need help? Contact us at ${BRAND.contact.support}.`, "");
  lines.push("—", BRAND.name, BRAND.contact.address, `${BRAND.contact.support} · ${BRAND.domain}`);
  return lines.join("\n");
}
