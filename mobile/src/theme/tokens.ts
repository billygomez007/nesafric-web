/**
 * NesAfric design tokens for the native app, mirrored from the web design system in
 * `src/app/globals.css` (web repo). `src/__tests__/tokens.test.ts` fails if they drift.
 * Light mode only, like the web product.
 */
export const webCssVariables = {
  "--background": "#fcfbf8",
  "--foreground": "#102d2a",
  "--color-brand": "#009b8c",
  "--color-brand-hover": "#008f80",
  "--color-brand-active": "#006b5f",
  "--color-brand-strong": "#005248",
  "--color-forest-deep": "#002f2b",
  "--color-forest": "#003f3a",
  "--color-teal-light": "#35bdaa",
  "--color-gold": "#c99a45",
  "--color-gold-light": "#e6ce9b",
  "--color-surface": "#f8f5ef",
  "--color-surface-elevated": "#ffffff",
  "--color-cream": "#f2ece2",
  "--color-ink": "#102d2a",
  "--color-muted": "#61706d",
  "--color-hairline": "#e5e6e1",
  "--color-success": "#047857",
  "--color-warning": "#d97706",
  "--color-danger": "#dc2626",
  "--color-info": "#2563eb",
  "--color-market-rent": "#2563eb",
  "--color-market-rent-tint": "#eff6ff",
  "--color-market-sale": "#047857",
  "--color-market-sale-tint": "#e8f3ee",
  "--color-market-new": "#8a6424",
  "--color-market-new-tint": "#fbf3e4",
  "--color-market-land": "#6b5d4a",
  "--color-market-land-tint": "#f5f0e8",
  "--color-market-commercial": "#574a80",
  "--color-market-commercial-tint": "#f1eff8",
  "--color-market-verified": "#006b5f",
  "--color-market-verified-tint": "#e7f5f2",
  "--radius-control": "6px",
  "--radius-field": "6px",
  "--radius-panel": "8px",
  "--radius-shell": "10px",
} as const;

const css = webCssVariables;

export const colors = {
  background: css["--background"],
  ink: css["--color-ink"],
  muted: css["--color-muted"],
  hairline: css["--color-hairline"],
  surface: css["--color-surface"],
  elevated: css["--color-surface-elevated"],
  cream: css["--color-cream"],
  brand: css["--color-brand"],
  brandPressed: css["--color-brand-active"],
  brandStrong: css["--color-brand-strong"],
  forest: css["--color-forest"],
  forestDeep: css["--color-forest-deep"],
  tealLight: css["--color-teal-light"],
  gold: css["--color-gold"],
  goldLight: css["--color-gold-light"],
  success: css["--color-success"],
  warning: css["--color-warning"],
  danger: css["--color-danger"],
  info: css["--color-info"],
  marketRent: css["--color-market-rent"],
  marketRentTint: css["--color-market-rent-tint"],
  marketSale: css["--color-market-sale"],
  marketSaleTint: css["--color-market-sale-tint"],
  marketNew: css["--color-market-new"],
  marketNewTint: css["--color-market-new-tint"],
  marketLand: css["--color-market-land"],
  marketLandTint: css["--color-market-land-tint"],
  marketCommercial: css["--color-market-commercial"],
  marketCommercialTint: css["--color-market-commercial-tint"],
  marketVerified: css["--color-market-verified"],
  marketVerifiedTint: css["--color-market-verified-tint"],
  white: "#ffffff",
  // Explicit disabled pair instead of opacity (the web contrast guard bans `disabled:opacity-*`).
  disabledBackground: css["--color-hairline"],
  disabledText: css["--color-muted"],
} as const;

const px = (value: string) => Number.parseInt(value, 10);

export const radii = {
  control: px(css["--radius-control"]),
  field: px(css["--radius-field"]),
  panel: px(css["--radius-panel"]),
  shell: px(css["--radius-shell"]),
  pill: 999,
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Noto Sans, bundled from the same TTFs the web app and PDF documents use. */
export const fonts = { regular: "NotoSans", bold: "NotoSans-Bold" } as const;

export const type = {
  title: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, color: colors.ink },
  heading: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: colors.ink },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
} as const;
