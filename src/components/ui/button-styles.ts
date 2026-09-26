/**
 * NesAfric button system — the single source of truth for button and button-like link styling.
 * Exported as className strings (not only a component) because many "buttons" here are Next.js
 * `<Link>`s sitting beside real `<button>`s, and both need the identical treatment.
 *
 * Hierarchy
 * - primary          forest on light surfaces        white on #003f3a = 11.85:1
 * - primaryOnDark    gold on dark (forest) surfaces  #002f2b on #c99a45 = 5.68:1
 * - secondary        hairline outline on light
 * - secondaryOnDark  hairline outline on dark
 * - tertiary         text link with an underline on hover (no box)
 * - danger           destructive confirmation only
 *
 * Geometry: 6px control radius (not pills). Default height 44px — a comfortable touch target —
 * with a compact 36px size for dense desktop toolbars.
 *
 * Focus: `outline-brand-strong` clears 3:1 on both white (4.81:1) and forest (3.93:1) surfaces;
 * the on-dark variants use gold-soft, which clears 3:1 on forest.
 */
// Disabled controls get an explicit muted fill and text (never opacity alone, which washes both
// the fill and the label toward the page — see tests/theme-contrast.unit.test.ts).
const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:border-hairline disabled:bg-surface disabled:text-slate-500";
const focusLight = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong";
const focusDark = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-soft";

export const buttonSizes = {
  md: "min-h-11 px-5 py-2.5",
  sm: "min-h-9 px-3.5 py-2 text-[13px]",
} as const;

const boxed = {
  primary: `${base} ${focusLight} bg-forest text-white hover:bg-emerald active:bg-forest-deep`,
  primaryOnDark: `${base} ${focusDark} bg-gold text-forest-deep hover:bg-gold-soft active:bg-gold`,
  secondary: `${base} ${focusLight} border border-forest/20 bg-white text-forest hover:border-forest/45 active:bg-surface`,
  secondaryOnDark: `${base} ${focusDark} border border-white/25 bg-transparent text-white hover:border-white/55 hover:bg-white/[0.06]`,
  danger: `${base} ${focusLight} bg-danger text-white hover:bg-danger-ink`,
} as const;

/** Text-style action: no box, so it carries no size padding. */
export const tertiaryButton =
  "inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-forest underline-offset-4 transition-colors hover:text-emerald hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong";

export type ButtonSize = keyof typeof buttonSizes;
export type ButtonVariant = keyof typeof boxed | "tertiary" | "dark" | "outline";

/** Compose a button className. `dark` and `outline` are kept as aliases for older call sites. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  if (variant === "tertiary") return tertiaryButton;
  const key = variant === "dark" ? "primary" : variant === "outline" ? "secondaryOnDark" : variant;
  return `${boxed[key]} ${buttonSizes[size]}`;
}

/** Back-compatible map of full (md) classNames. */
export const buttonStyles: Record<ButtonVariant, string> = {
  primary: buttonClass("primary"),
  primaryOnDark: buttonClass("primaryOnDark"),
  secondary: buttonClass("secondary"),
  secondaryOnDark: buttonClass("secondaryOnDark"),
  danger: buttonClass("danger"),
  tertiary: tertiaryButton,
  dark: buttonClass("primary"),
  outline: buttonClass("secondaryOnDark"),
};
