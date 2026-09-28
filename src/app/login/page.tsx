import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { BrandLogo } from "@/components/brand-logo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    google_error?: string;
  }>;
}) {
  const {
    google_error: googleError,
  } = await searchParams;

  return (
    <main className="min-h-screen bg-warm-white lg:grid lg:grid-cols-[0.9fr_1.1fr]">
      <section className="hidden bg-forest-deep p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <Link aria-label="NesAfric home" href="/">
          <BrandLogo height={31} variant="dark" />
        </Link>

        <div className="max-w-md">
          <p className="text-sm font-medium text-gold-soft">
            The operating system for real estate
          </p>

          <p className="font-display mt-5 text-4xl font-semibold leading-tight xl:text-5xl">
            Your properties, people and opportunities in one place.
          </p>

          <p className="mt-5 text-base leading-7 text-white/70">
            Manage the work behind every property with a connected NesAfric workspace.
          </p>
        </div>

        <p className="text-xs text-white/65">
          © NesAfric
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <Link
            aria-label="NesAfric home"
            className="inline-flex lg:hidden"
            href="/"
          >
            <BrandLogo
              height={27}
              variant="light"
            />
          </Link>

          <div className="mt-10 rounded-panel border border-hairline bg-white p-7 sm:p-9 lg:mt-0">
            <p className="text-sm font-medium text-gold-ink">
              Welcome back
            </p>

            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-forest-deep">
              Sign in to NesAfric
            </h1>

            <p className="mt-2 text-sm leading-6 text-muted">
              Get a one-time code by text message or email. No password needed.
            </p>

            {googleError && (
              <p
                className="mt-5 border-l-2 border-danger bg-danger-tint p-3 text-sm text-danger-ink"
                role="alert"
              >
                {googleError}
              </p>
            )}

            <AuthForm mode="login" />

            <p className="mt-6 text-center text-sm text-muted">
              New to NesAfric?{" "}
              <Link
                className="font-semibold text-emerald underline-offset-4 hover:text-forest hover:underline"
                href="/register"
              >
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
