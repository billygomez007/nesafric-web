import Link from "next/link";
import type { ReactNode } from "react";

export function DashboardStat({
  label,
  value,
  helper,
  icon,
  href,
  tone = "teal",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  icon: ReactNode;
  href?: string;
  tone?: "teal" | "gold" | "forest" | "red";
}) {
  const toneClasses = {
    teal: "bg-teal/10 text-teal",
    gold: "bg-gold/15 text-amber-700",
    forest: "bg-forest/10 text-forest",
    red: "bg-red-50 text-red-700",
  };

  const body = (
    <div className="group h-full rounded-[22px] border border-hairline bg-white p-5 shadow-[0_12px_36px_rgba(16,45,42,0.045)] transition duration-200 hover:-translate-y-0.5 hover:border-teal/20 hover:shadow-[0_18px_44px_rgba(16,45,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneClasses[tone]}`}>
          {icon}
        </div>
        {href && (
          <span className="text-xs font-semibold text-muted transition group-hover:text-teal">
            View →
          </span>
        )}
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.11em] text-muted">
        {label}
      </p>

      <div className="mt-2 text-[30px] font-semibold tracking-[-0.045em] text-ink">
        {value}
      </div>

      {helper && (
        <div className="mt-2 text-xs leading-5 text-muted">
          {helper}
        </div>
      )}
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

export function DashboardPanel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[24px] border border-hairline bg-white shadow-[0_12px_36px_rgba(16,45,42,0.045)] ${className}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-5 sm:px-6">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-xs leading-5 text-muted">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>

      {children}
    </section>
  );
}

export function ProgressBar({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const safe = Math.max(0, Math.min(100, value));

  return (
    <div className={`h-2 overflow-hidden rounded-full bg-cream ${className}`}>
      <div
        className="h-full rounded-full bg-teal transition-all duration-500"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "gold";
}) {
  const tones = {
    neutral: "bg-surface text-muted",
    success: "bg-teal/10 text-teal",
    warning: "bg-amber-50 text-amber-800",
    danger: "bg-red-50 text-red-800",
    gold: "bg-gold/15 text-amber-800",
  };

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.09em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function DashboardIcon({
  name,
}: {
  name:
    | "building"
    | "units"
    | "money"
    | "maintenance"
    | "users"
    | "listing"
    | "leads"
    | "calendar"
    | "chart";
}) {
  const paths = {
    building: (
      <>
        <path d="M4 21V7l8-4 8 4v14" />
        <path d="M8 10h2M14 10h2M8 14h2M14 14h2M10 21v-4h4v4" />
      </>
    ),
    units: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" />
      </>
    ),
    money: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18M7 15h4" />
      </>
    ),
    maintenance: (
      <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3z" />
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6M15 15c3-.2 5 1.3 5.5 4" />
      </>
    ),
    listing: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 13h7M7 17h5" />
      </>
    ),
    leads: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 21a7 7 0 0 1 14 0" />
        <path d="M18 5h3M19.5 3.5v3" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}
