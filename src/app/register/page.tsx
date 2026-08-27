import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <Link className="text-sm font-semibold text-emerald-700" href="/">NesAfric · PropertyOS</Link>
      <h1 className="mt-3 text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-slate-600">Your account can belong to more than one organisation.</p>
      <AuthForm mode="register" />
      <p className="mt-6 text-sm text-slate-600">Already registered? <Link className="font-semibold text-emerald-700" href="/login">Sign in</Link></p>
    </main>
  );
}
