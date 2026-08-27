import Image from "next/image";
import { BRAND } from "@/platform/brand";

/**
 * The official Umo Afric wordmark. `variant="dark"` (default) is the transparent-background
 * artwork for dark surfaces (marketing header/footer, hero sections); `variant="light"` is the
 * same artwork on a dark rounded chip, for light surfaces (authenticated app shells) where the
 * white-on-transparent artwork would otherwise have no contrast.
 */
// The light-surface chip variant bakes in its own padding, so it has a different aspect ratio
// from the raw dark-surface artwork — each needs its own width/height source.
const DIMENSIONS = {
  dark: { width: BRAND.logo.width, height: BRAND.logo.height },
  light: { width: 2398, height: 741 },
} as const;

export function BrandLogo({ variant = "dark", height = 28, className = "" }: { variant?: "dark" | "light"; height?: number; className?: string }) {
  const source = DIMENSIONS[variant];
  const width = Math.round((height * source.width) / source.height);
  return (
    <Image
      alt={BRAND.name}
      className={className}
      height={height}
      priority
      src={variant === "dark" ? BRAND.logo.onDark : BRAND.logo.onLight}
      width={width}
    />
  );
}
