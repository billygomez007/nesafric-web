import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { BrandLogo } from "@/components/brand-logo";

export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <Link href="/"><BrandLogo height={26} variant="light" /></Link>
      <h1 className="mt-3 text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-slate-600">Your account can belong to more than one organisation.</p>
      <AuthForm mode="register" />
      <p className="mt-6 text-sm text-slate-600">Already registered? <Link className="font-semibold text-navy transition-colors hover:text-brand-strong" href="/login">Sign in</Link></p>
    </main>
  );
}
