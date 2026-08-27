import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicMarketplaceProfessionalProfile } from "@/modules/marketplace-professionals/service";

const TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL_AGENT: "Individual Agent",
  BROKER: "Broker",
  BROKERAGE: "Brokerage",
  REAL_ESTATE_COMPANY: "Real Estate Company",
  DEVELOPER: "Developer",
  PROPERTY_MARKETING_COMPANY: "Property Marketing Company",
  OTHER: "Real Estate Professional",
};

export default async function PublicMarketplaceProfessionalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await getPublicMarketplaceProfessionalProfile(slug).catch(() => null);
  if (!profile) notFound();

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b bg-slate-950 px-4 py-14 text-white sm:px-6">
        <div className="mx-auto max-w-5xl">
          <nav className="flex justify-between text-sm"><Link href="/">NesAfric</Link><Link href="/marketplace/properties">Browse properties</Link></nav>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/10 text-xl font-semibold">
              {profile.displayName.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-semibold sm:text-4xl">{profile.displayName}</h1>
                {profile.verificationStatus === "VERIFIED" && (
                  <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-300">Verified</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-300">{TYPE_LABELS[profile.type] ?? profile.type}</p>
            </div>
          </div>
          {profile.description && <p className="mt-6 max-w-2xl text-slate-300">{profile.description}</p>}
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          {profile.developments.length > 0 && (
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Developments</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {profile.developments.map((development) => (
                  <div className="rounded-xl border p-4" key={development.id}>
                    <p className="font-semibold">{development.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{[development.city, development.region].filter(Boolean).join(", ") || development.countryCode}</p>
                    <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{development.status.replaceAll("_", " ")}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Active listings</h2>
            {profile.listings.length === 0 ? <p className="mt-3 text-sm text-slate-500">No published listings yet.</p> : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {profile.listings.map((listing) => (
                  <Link className="rounded-xl border p-4 transition hover:border-emerald-500" href={`/marketplace/properties/${listing.id}`} key={listing.id}>
                    <p className="font-semibold">{listing.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{listing.city ?? ""} · {listing.listingType}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {profile.members.length > 0 && (
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Team</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {profile.members.map((member, index) => (
                  <span className="rounded-full border px-3 py-1.5 text-sm" key={index}>{member.user.displayName} · {member.role.toLowerCase()}</span>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="grid content-start gap-6">
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Contact</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              {profile.contactEmail && <div><dt className="text-slate-500">Email</dt><dd className="font-medium">{profile.contactEmail}</dd></div>}
              {profile.contactPhone && <div><dt className="text-slate-500">Phone</dt><dd className="font-medium">{profile.contactPhone}</dd></div>}
              {profile.websiteUrl && <div><dt className="text-slate-500">Website</dt><dd className="font-medium">{profile.websiteUrl}</dd></div>}
            </dl>
          </section>
          {profile.specialities.length > 0 && (
            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Specialities</h2>
              <div className="mt-3 flex flex-wrap gap-2">{profile.specialities.map((item) => <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold" key={item}>{item}</span>)}</div>
            </section>
          )}
          {profile.serviceAreas.length > 0 && (
            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Service areas</h2>
              <div className="mt-3 flex flex-wrap gap-2">{profile.serviceAreas.map((item) => <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold" key={item}>{item}</span>)}</div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
