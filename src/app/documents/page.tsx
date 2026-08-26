import Link from "next/link";
import { DocumentCenter } from "@/components/document-center";

export default function DocumentCenterPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <div className="mb-6"><Link className="text-sm font-semibold text-emerald-700" href="/dashboard">← Dashboard</Link></div>
    <DocumentCenter />
  </main>;
}
