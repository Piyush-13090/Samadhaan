'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { homeRouteFor, useAuth } from '@/components/auth/auth-provider';
import { Logo } from '@/components/brand/logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/** Marketing navigation. Anchors into the landing page's sections. */
const LINKS = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#features', label: 'Features' },
  { href: '/explore', label: 'Explore problems' },
  { href: '/status', label: 'Status' },
] as const;

/**
 * Public site header.
 *
 * Separate from `AppTopbar`: a visitor and a signed-in citizen need different
 * things from the top of the page, and merging the two into one conditional
 * component is how that kind of header becomes unmaintainable.
 *
 * The actions do switch on authentication state, though — a signed-in visitor
 * landing on the marketing page should be offered their workspace rather than a
 * sign-in form they do not need.
 */
export function SiteHeader() {
  const { user, status } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <header
      className="sticky top-0 border-b border-border bg-canvas/85 backdrop-blur-md"
      style={{ zIndex: 'var(--z-topbar)' }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Samadhaan home">
          <Logo size="md" />
        </Link>

        <nav aria-label="Site" className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-control px-3 py-2 type-body-sm font-medium text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {status === 'loading' ? (
            <Skeleton className="h-8 w-28" />
          ) : user ? (
            <Button variant="ghost" size="sm" className="gap-2" asChild>
              <Link href={homeRouteFor(user)}>
                <Avatar
                  name={user.fullName}
                  src={user.avatarUrl ?? undefined}
                  size="xs"
                />
                <span className="hidden sm:inline">Go to workspace</span>
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          )}

          <Button variant="primary" size="sm" asChild>
            <Link href="/report">Report a problem</Link>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className="md:hidden"
            aria-expanded={open}
            aria-controls="site-nav-mobile"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      <div
        id="site-nav-mobile"
        hidden={!open}
        className={cn('border-t border-border bg-canvas px-4 py-3 md:hidden')}
      >
        <nav aria-label="Site">
          <ul className="space-y-0.5">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-control px-3 py-2.5 type-body-sm font-medium text-ink-muted hover:bg-subtle hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={user ? homeRouteFor(user) : '/login'}
                onClick={() => setOpen(false)}
                className="block rounded-control px-3 py-2.5 type-body-sm font-medium text-ink-muted hover:bg-subtle hover:text-ink"
              >
                {user ? 'Go to workspace' : 'Sign in'}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
