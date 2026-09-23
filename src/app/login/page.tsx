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
        <Link href="/">
          <BrandLogo height={31} variant="light" />
        </Link>

        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-soft">
            REAL ESTATE OS FOR AFRICA
          </p>

          <h1 className="mt-5 text-4xl font-semibold leading-tight xl:text-5xl">
            Your properties, people and opportunities in one place.
          </h1>

          <p className="mt-5 text-base leading-7 text-white/70">
            Manage the work behind every property with a connected NesAfric workspace.
          </p>
        </div>

        <p className="text-xs text-white/45">
          © NesAfric
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <Link
            className="inline-flex lg:hidden"
            href="/"
          >
            <BrandLogo
              height={27}
              variant="light"
            />
          </Link>

          <div className="mt-10 rounded-3xl border border-hairline bg-white p-7 shadow-card sm:p-9 lg:mt-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              WELCOME BACK
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-forest">
              Sign in to NesAfric
            </h2>

            <p className="mt-2 text-sm leading-6 text-muted">
              Use your email and password to continue to your workspace.
            </p>

            {googleError && (
              <p
                className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                role="alert"
              >
                {googleError}
              </p>
            )}

            <AuthForm mode="login" />

            <p className="mt-6 text-center text-sm text-muted">
              New to NesAfric?{" "}
              <Link
                className="font-semibold text-teal hover:text-emerald"
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
