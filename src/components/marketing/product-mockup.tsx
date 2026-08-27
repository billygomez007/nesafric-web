import Image from "next/image";

// Every approved mockup was exported at the same canvas size — a single intrinsic size keeps
// Image from guessing and avoids layout shift across every placement.
const MOCKUP_WIDTH = 1536;
const MOCKUP_HEIGHT = 1024;

const THEME_FRAME = {
  dark: "border border-white/10 bg-navy shadow-[0_40px_80px_-32px_rgba(0,0,0,0.6)]",
  light: "border border-slate-200 bg-white shadow-xl shadow-slate-200/60",
} as const;

/**
 * A single approved marketing mockup, presented as a contained, floating product canvas rather
 * than a full-bleed screenshot strip. `theme` should match the mockup's own baked-in background
 * (most are near-black; the Ghana mobile trio is on white) so the frame reads as part of the
 * image, not a mismatched border around it.
 */
export function ProductMockup({
  src,
  alt,
  maxWidthClassName = "max-w-6xl",
  theme = "dark",
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  maxWidthClassName?: string;
  theme?: keyof typeof THEME_FRAME;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`mx-auto ${maxWidthClassName} ${className}`}>
      <div className={`overflow-hidden rounded-2xl ${THEME_FRAME[theme]}`}>
        <Image
          alt={alt}
          className="h-auto w-full"
          height={MOCKUP_HEIGHT}
          priority={priority}
          sizes="(min-width: 1280px) 1152px, (min-width: 640px) 90vw, 100vw"
          src={src}
          width={MOCKUP_WIDTH}
        />
      </div>
    </div>
  );
}
