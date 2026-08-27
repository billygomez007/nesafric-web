import Image from "next/image";
import { BRAND } from "@/platform/brand";

/**
 * The official UmoAfric wordmark: navy symbol + turquoise "o" on transparent, or the same
 * artwork recolored to white + turquoise for dark surfaces. `variant="dark"` (default) is for
 * dark surfaces (marketing header/footer, hero sections); `variant="light"` is for light
 * surfaces (auth pages, authenticated app shells). Both share the same aspect ratio.
 */
export function BrandLogo({ variant = "dark", height = 28, className = "" }: { variant?: "dark" | "light"; height?: number; className?: string }) {
  const width = Math.round((height * BRAND.logo.width) / BRAND.logo.height);
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
