import { BRAND, absoluteUrl } from "@/platform/brand";

/**
 * The NesAfric branded transactional email design system: one base layout plus a small set of
 * reusable content components (heading, paragraphs, detail rows, badge, CTA, support block,
 * footer), rather than hand-rolled HTML per email. Every render produces both an HTML document
 * and a plain-text alternative from the same structured content, so the two can never drift.
 *
 * Security: every piece of caller-supplied text (`heading`, `greeting`, `paragraphs`, detail
 * labels/values) is HTML-escaped before it reaches the template — there is no raw-HTML slot, so
 * user-controlled data (organisation names, tenant names, notes, references) can never inject
 * markup. `cta.url` must be a same-origin application path — `absoluteUrl()` is the only way to
 * produce one, so an email can never link off the NesAfric domain.
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
  steps?: Array<{ title: string; description: string }>;
  /** Short capability/feature words (e.g. "Manage", "Market", "Connect", "Automate"), rendered as
   * a compact row of turquoise-tinted chips. Keep this short — it's a visual accent, not a list. */
  features?: string[];
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
  const logoUrl = absoluteUrl(BRAND.logo.onDark);
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
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;"><tr><td style="border-radius:8px;background:#00816e;">
        <a href="${escapeHtml(absoluteUrl(content.cta.path))}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(content.cta.label)}</a>
      </td></tr></table>`
    : "";
  const features = content.features?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 28px;"><tr>
        ${content.features
          .map(
            (feature) =>
              `<td style="padding:0 8px 0 0;"><span style="display:inline-block;padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600;background:#e6f7f5;color:#00816e;white-space:nowrap;">${escapeHtml(feature)}</span></td>`,
          )
          .join("")}
      </tr></table>`
    : "";
  const steps = content.steps?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;border-collapse:collapse;">
        <tr>
          <td colspan="2" style="padding:0 0 14px;">
            <p style="margin:0 0 5px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c48729;">Get started in 3 simple steps</p>
            <p style="margin:0;font-size:17px;line-height:1.45;font-weight:700;color:#082f49;">Set up your account and start managing with ease</p>
          </td>
        </tr>
        ${content.steps
          .map(
            (step, index) =>
              `<tr>
                <td valign="top" width="42" style="padding:12px 12px 12px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;border-radius:15px;background:#083b46;color:#ffffff;font-size:12px;font-weight:700;">
                        ${index + 1}
                      </td>
                    </tr>
                  </table>
                </td>
                <td valign="top" style="padding:12px 0;border-bottom:1px solid #e7edf2;">
                  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#082f49;">${escapeHtml(step.title)}</p>
                  <p style="margin:0;font-size:13px;line-height:1.55;color:#64748b;">${escapeHtml(step.description)}</p>
                </td>
              </tr>`,
          )
          .join("")}
      </table>`
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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dce5ec;box-shadow:0 12px 30px rgba(15,23,42,.08);">
<tr>
  <td align="center" style="background:#ffffff;padding:30px 34px 24px;border-top:4px solid #00a99d;">
    <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(BRAND.name)}" height="58" style="display:block;height:58px;max-width:270px;width:auto;" />
    <p style="margin:9px 0 0;font-size:11px;letter-spacing:.8px;color:#64748b;">${escapeHtml(BRAND.tagline)}</p>
  </td>
</tr>
<tr>
  <td style="padding:36px 36px 10px;">
    <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c48729;">NesAfric Platform</p>
    <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;color:#082f49;font-weight:750;">${escapeHtml(content.heading)}</h1>
${badge ? `<div style="margin:0 0 16px;">${badge}</div>` : ""}
${greeting}
${paragraphs}
${details}
${steps}
${features}
${cta}
<p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(supportNote)}</p>
</td></tr>
<tr>
  <td style="background:#062f3a;padding:28px 36px 30px;">
    <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9fc4c8;">Powered by NesAfric</p>

    <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(BRAND.name)}" height="38" style="display:block;height:38px;max-width:190px;width:auto;margin:0 0 16px;" />

    <p style="margin:0 0 5px;font-size:12px;color:#d6e6e8;">${escapeHtml(BRAND.tagline)}</p>

    <p style="margin:0 0 3px;font-size:11px;line-height:1.5;color:#9fc4c8;">
      ${escapeHtml(BRAND.contact.address)}
    </p>

    <p style="margin:0 0 3px;font-size:11px;line-height:1.5;color:#9fc4c8;">
      <a href="mailto:${escapeHtml(BRAND.contact.support)}" style="color:#9fc4c8;text-decoration:none;">${escapeHtml(BRAND.contact.support)}</a>
      &nbsp;·&nbsp;
      <a href="mailto:${escapeHtml(BRAND.contact.hello)}" style="color:#9fc4c8;text-decoration:none;">${escapeHtml(BRAND.contact.hello)}</a>
    </p>

    <p style="margin:0 0 12px;font-size:11px;line-height:1.5;color:#9fc4c8;">
      <a href="https://${escapeHtml(BRAND.domain)}" style="color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(BRAND.domain)}</a>
    </p>

    <div style="height:1px;background:#174b55;margin:16px 0;"></div>

    <p style="margin:0;font-size:10px;line-height:1.55;color:#6f9ca3;">
      You received this email because of activity on your ${escapeHtml(BRAND.name)} account.
      If this wasn't you, please contact ${escapeHtml(BRAND.contact.support)}.
    </p>
  </td>
</tr>
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
  if (content.steps?.length) {
    lines.push("GET STARTED IN 3 SIMPLE STEPS", "");
    content.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.title}`, step.description, "");
    });
  }
  if (content.features?.length) lines.push(content.features.join(" · "), "");
  if (content.cta) lines.push(`${content.cta.label}: ${absoluteUrl(content.cta.path)}`, "");
  lines.push(content.supportNote ?? `Need help? Contact us at ${BRAND.contact.support}.`, "");
  lines.push("—", BRAND.name, BRAND.contact.address, `${BRAND.contact.support} · ${BRAND.contact.hello} · ${BRAND.domain}`);
  return lines.join("\n");
}
