import Image from "next/image";
import { BRAND } from "@/platform/brand";

/**
 * Official NesAfric five-part identity.
 *
 * One canonical asset is used everywhere so marketing, authentication,
 * workspace shells and marketplace surfaces cannot drift into legacy branding.
 */
export function BrandLogo({
  variant = "dark",
  height = 28,
  className = "",
}: {
  variant?: "dark" | "light";
  height?: number;
  className?: string;
}) {
  const width = Math.round((height * BRAND.logo.width) / BRAND.logo.height);
  const image = (
    <Image
      alt={BRAND.name}
      className={className}
      height={height}
      priority
      src={variant === "dark" ? BRAND.logo.onDark : BRAND.logo.onLight}
      width={width}
    />
  );

  if (variant === "dark") {
    return (
      <span className="inline-flex rounded-[9px] bg-white/96 px-2.5 py-1.5 shadow-[0_1px_0_rgba(255,255,255,0.18)]">
        {image}
      </span>
    );
  }

  return image;
}
