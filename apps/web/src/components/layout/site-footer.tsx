import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

const GROUPS = [
  {
    title: 'Product',
    links: [
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#features', label: 'Features' },
      { href: '/explore', label: 'Explore problems' },
      { href: '/leaderboard', label: 'Leaderboard' },
    ],
  },
  {
    title: 'Participate',
    links: [
      { href: '/report', label: 'Report a problem' },
      { href: '/dashboard', label: 'Citizen dashboard' },
      { href: '/explore', label: 'For organisations' },
    ],
  },
  {
    title: 'Platform',
    links: [{ href: '/status', label: 'System status' }],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Logo size="md" />
            <p className="mt-3.5 type-body-sm text-ink-muted">
              Civic problems, understood and resolved — together.
            </p>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="type-overline text-ink-subtle">{group.title}</h2>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={`${group.title}-${link.href}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="type-body-sm text-ink-muted transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <p className="type-caption text-ink-subtle">
            © {new Date().getFullYear()} Samadhaan
          </p>
          <p className="type-caption text-ink-subtle">
            Built for communities, organisations and local government.
          </p>
        </div>
      </div>
    </footer>
  );
}
