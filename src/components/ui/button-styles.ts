/**
 * UmoAfric shared button system (Phase 2 visual refresh; recolored orange -> turquoise in the
 * brand color correction). Exported as className strings — rather than a component that renders
 * its own element — because the majority of "buttons" in this codebase are Next.js `<Link>`s
 * (navigation) sitting alongside real `<button>`s (form submission), and both need the identical
 * visual treatment without one being forced to wrap the other.
 *
 * Text-on-brand-turquoise is intentionally dark (`text-navy`), not white: WCAG contrast checked —
 * white-on-#00b6a3 is 2.55:1 (fails AA at any size), navy-on-#00b6a3 is 7.41:1 (passes AAA).
 * `active:bg-brand-active` keeps that same navy text at 5.33:1 when pressed.
 *
 * The focus ring uses `outline-brand-strong`, not the raw brand color: these buttons sit on both
 * light (white cards) and dark (navy hero/nav) surfaces, and the ring itself needs >=3:1 against
 * whatever's behind it (WCAG 1.4.11) — raw --color-brand only clears that on dark surfaces
 * (7.41:1) and fails on light ones (2.55:1), while --color-brand-strong clears both (4.81:1 on
 * white, 3.93:1 on navy).
 */
const base = "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong";
const sizing = "px-6 py-3.5";

export const buttonStyles = {
  primary: `${base} ${focus} ${sizing} bg-brand text-navy hover:bg-brand-hover active:bg-brand-active`,
  secondary: `${base} ${focus} ${sizing} bg-surface-elevated text-navy border border-hairline hover:border-navy/30`,
  dark: `${base} ${focus} ${sizing} bg-navy text-white hover:bg-navy/90`,
  outline: `${base} ${focus} ${sizing} bg-transparent text-white border border-white/25 hover:border-white/50`,
  danger: `${base} ${focus} ${sizing} bg-danger text-white hover:bg-danger/90`,
} as const;

export type ButtonVariant = keyof typeof buttonStyles;
