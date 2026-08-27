import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <Link className="text-sm font-semibold text-emerald-700" href="/">NesAfric · PropertyOS</Link>
      <h1 className="mt-3 text-3xl font-semibold">Welcome back</h1>
      <AuthForm mode="login" />
      <p className="mt-6 text-sm text-slate-600">New to PropertyOS? <Link className="font-semibold text-emerald-700" href="/register">Create an account</Link></p>
    </main>
  );
}
