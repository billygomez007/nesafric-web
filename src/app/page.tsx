import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-20 text-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold tracking-[0.2em] text-emerald-300">PROPERTYOS AI</p>
        <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight">The operating system for property teams.</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">Secure multi-organisation property operations, beginning with Ghana and built to scale across Africa.</p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link className="rounded-lg bg-emerald-400 px-5 py-3 font-semibold text-slate-950" href="/register">Create account</Link>
          <Link className="rounded-lg border border-slate-600 px-5 py-3 font-semibold" href="/login">Sign in</Link>
          <Link className="rounded-lg border border-slate-600 px-5 py-3 font-semibold" href="/marketplace">Find a service provider</Link>
          <Link className="rounded-lg border border-slate-600 px-5 py-3 font-semibold" href="/marketplace/properties">Find a property</Link>
        </div>
      </div>
    </main>
  );
}
