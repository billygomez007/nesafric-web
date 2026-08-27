/**
 * UmoAfric shared button system (Phase 2 visual refresh). Exported as className strings —
 * rather than a component that renders its own element — because the majority of "buttons" in
 * this codebase are Next.js `<Link>`s (navigation) sitting alongside real `<button>`s (form
 * submission), and both need the identical visual treatment without one being forced to wrap
 * the other.
 *
 * Text-on-brand-orange is intentionally dark (`text-navy`), not white: WCAG contrast checked
 * during this refresh — white-on-#FF7A00 is 2.61:1 (fails AA at any size), navy-on-#FF7A00 is
 * 7.24:1 (passes AAA). See the Phase 2 completion report for the full contrast table.
 */
const base = "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const sizing = "px-6 py-3.5";

export const buttonStyles = {
  primary: `${base} ${focus} ${sizing} bg-brand text-navy hover:bg-brand-hover active:bg-brand-active`,
  secondary: `${base} ${focus} ${sizing} bg-surface-elevated text-navy border border-hairline hover:border-navy/30`,
  dark: `${base} ${focus} ${sizing} bg-navy text-white hover:bg-navy/90`,
  outline: `${base} ${focus} ${sizing} bg-transparent text-white border border-white/25 hover:border-white/50`,
  danger: `${base} ${focus} ${sizing} bg-danger text-white hover:bg-danger/90`,
} as const;

export type ButtonVariant = keyof typeof buttonStyles;
