import Link from "next/link";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "#operating-system", label: "Operating system" },
      { href: "#ai-employees", label: "AI employees" },
      { href: "#payments", label: "Payments" },
      { href: "#lifecycle", label: "Property lifecycle" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { href: "#solutions", label: "For landlords" },
      { href: "#solutions", label: "For property managers" },
      { href: "#solutions", label: "For developers" },
    ],
  },
  {
    title: "Marketplace",
    links: [
      { href: "/marketplace/properties", label: "Browse properties" },
      { href: "/marketplace", label: "Find service providers" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Get started" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <p className="text-lg font-semibold tracking-tight text-white">NesAfric</p>
            <p className="mt-1 text-xs font-medium tracking-[0.14em] text-slate-500">PROPERTYOS</p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-slate-400">
              The operating system for real estate — for landlords, property managers and developers.
            </p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-sm font-semibold text-white">{column.title}</p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link className="text-sm text-slate-400 transition-colors hover:text-white" href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col gap-4 border-t border-slate-800 pt-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} NesAfric. All rights reserved.</p>
          <p>Built for landlords, property managers and developers across Ghana and Africa.</p>
        </div>
      </div>
    </footer>
  );
}
