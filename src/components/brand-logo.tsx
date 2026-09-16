import Image from "next/image";
import { BRAND } from "@/platform/brand";

/**
 * Official NesAfric wordmark.
 *
 * The approved transparent wordmark is used throughout the redesigned
 * marketing website and authenticated application shell.
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
