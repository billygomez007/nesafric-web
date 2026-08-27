import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { BrandLogo } from "@/components/brand-logo";

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <Link href="/"><BrandLogo height={26} variant="light" /></Link>
      <h1 className="mt-3 text-3xl font-semibold">Welcome back</h1>
      <AuthForm mode="login" />
      <p className="mt-6 text-sm text-slate-600">New to UmoAfric? <Link className="font-semibold text-navy transition-colors hover:text-brand-active" href="/register">Create an account</Link></p>
    </main>
  );
}
